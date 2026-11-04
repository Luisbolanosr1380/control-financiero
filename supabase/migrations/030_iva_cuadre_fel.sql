-- 030 · EL IVA DEL DETALLE Y LA FACTURA CUADRA AL CENTAVO CON LA FEL (brief del CFO, caso GTL 4-nov-2026)
--
-- Por qué: las tarifas están guardadas SIN IVA redondeadas a 2 decimales (450 con IVA → 401.79, no 401.7857…). Sumar
-- los montos sin IVA y aplicar el 12 % al final acumula el redondeo: 16 × 401.79 + 12 × 424.11 daba Q12,900.12 cuando la
-- FEL (y la SAT) dicen Q12,900.00. La FEL parte del PRECIO CON IVA por unidad y separa el IVA del TOTAL.
--
-- La regla (una sola, igual que `totalesFel` en src/lib/tarifario/canon.ts):
--   precio con IVA de cada prueba = round(monto_sin_iva × 1.12, 2)   → 401.79 → 450.00, 424.11 → 475.00, 312.50 → 350.00…
--   total = Σ precios con IVA · base (sin IVA) = round(total / 1.12, 2) · iva = total − base (por resta: base + iva = total).
--
-- Qué hace:
--  1. fel_totales(numeric[]) → jsonb { total, base, iva }: el espejo SQL de la regla.
--  2. detalle_facturacion_crear_pruebas (024) y detalle_facturacion_crear (019, sin uso pero viva): totales con la regla.
--  3. detalle_facturacion_recalcular (029): totales con la regla (quitar línea).
--  4. detalle_link_contenido (029): el `monto` de cada línea que ve el cliente en el link pasa a ser el PRECIO CON IVA
--     (la app calcula la huella con los mismos montos).
--  5. facturacion_agenda_resumen (024): `total_con_iva` por grupo = Σ precios con IVA por prueba (la lista "Por facturar").
--  6. Backfill de subtotal / iva / total SOLO para detalles en borrador / enviada / aprobada; facturada y anulada no se
--     tocan. Un link en `enviada` emitido con la regla vieja daría DOCUMENTO_CAMBIO al responder: NO se revoca acá, se
--     cuenta y se avisa (raise notice) para que facturación lo reenvíe.
--
-- No toca: tarifas (siguen sin IVA), lookup de precio, facturas emitidas, producción (025) ni mapa de precios (027).
-- Idempotente; sin drop, delete, truncate, begin/commit.

-- ── 1. La regla ──────────────────────────────────────────────────────────────────────────────────
create or replace function fel_precio_con_iva(p_monto_sin_iva numeric)
returns numeric
language sql immutable
as $fn$ select round(coalesce(p_monto_sin_iva, 0) * 1.12, 2) $fn$;

create or replace function fel_totales(p_montos numeric[])
returns jsonb
language sql immutable
as $fn$
  with t as (select coalesce(sum(fel_precio_con_iva(m)), 0)::numeric(12,2) as total from unnest(coalesce(p_montos, '{}'::numeric[])) m),
       b as (select total, round(total / 1.12, 2)::numeric(12,2) as base from t)
  select jsonb_build_object('total', total, 'base', base, 'iva', (total - base)::numeric(12,2)) from b
$fn$;

comment on function fel_totales(numeric[]) is '030: regla FEL. total = Σ round(monto × 1.12, 2); base = round(total / 1.12, 2); iva = total − base. Espejo de totalesFel() en TS.';

-- ── 2. Crear detalle por prueba (024) ────────────────────────────────────────────────────────────
create or replace function detalle_facturacion_crear_pruebas(p_actor text, p_componente_ids uuid[], p_notas text default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_nit      text;
  v_cliente  uuid;
  v_n        integer;
  v_exp      integer;
  v_sub      numeric(12,2);
  v_iva      numeric(12,2);
  v_total    numeric(12,2);
  v_id       uuid;
  v_row      detalle_facturacion%rowtype;
  v_fel      jsonb;
begin
  if p_componente_ids is null or cardinality(p_componente_ids) = 0 then raise exception 'DETALLE_SIN_EXPEDIENTES'; end if;
  select count(*) into v_n from facturacion_componente c where c.id = any(p_componente_ids);
  if v_n <> cardinality(p_componente_ids) then raise exception 'EXPEDIENTE_DESCONOCIDO'; end if;
  if exists (
    select 1 from facturacion_componente c join detalle_facturacion d on d.id = c.detalle_id
     where c.id = any(p_componente_ids) and d.estado <> 'anulada'
  ) then raise exception 'EXPEDIENTE_RESERVADO: alguna prueba ya está en otro detalle'; end if;
  if exists (
    select 1 from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
     where c.id = any(p_componente_ids)
       and (c.estado_tarifa <> 'resuelta' or coalesce(c.monto_calculado, 0) <= 0 or e.nit_resuelto is null or not facturacion_componente_en_cola(c, e))
  ) then raise exception 'EXPEDIENTE_NO_FACTURABLE: solo entran pruebas con resultado, precio resuelto y en cola'; end if;
  select count(distinct e.nit_resuelto), min(e.nit_resuelto), min(e.cliente_id::text)::uuid, count(distinct e.id),
         fel_totales(array_agg(c.monto_calculado))
    into v_n, v_nit, v_cliente, v_exp, v_fel
    from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id where c.id = any(p_componente_ids);
  if v_n <> 1 then raise exception 'DETALLE_VARIOS_CLIENTES: un detalle es de UN cliente'; end if;
  -- 030: regla FEL (total = Σ precios con IVA; base por división; IVA por resta)
  v_total := (v_fel->>'total')::numeric; v_sub := (v_fel->>'base')::numeric; v_iva := (v_fel->>'iva')::numeric;
  insert into detalle_facturacion (fuente, cliente_id, nit, estado, subtotal, iva, total, expedientes, pruebas, creado_por, notas)
  values ('agenda', v_cliente, v_nit, 'borrador', v_sub, v_iva, v_total, v_exp, cardinality(p_componente_ids), p_actor, nullif(btrim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  update facturacion_componente set detalle_id = v_id, updated_at = now() where id = any(p_componente_ids);
  select * into v_row from detalle_facturacion where id = v_id;
  return to_jsonb(v_row);
end
$fn$;

-- Versión vieja por expediente (019): sin uso desde la 024, pero sigue viva → misma regla.
create or replace function detalle_facturacion_crear(p_actor text, p_ids_externos text[], p_notas text default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_nit      text;
  v_cliente  uuid;
  v_n        integer;
  v_sub      numeric(12,2);
  v_iva      numeric(12,2);
  v_total    numeric(12,2);
  v_id       uuid;
  v_row      detalle_facturacion%rowtype;
  v_fel      jsonb;
begin
  if p_ids_externos is null or cardinality(p_ids_externos) = 0 then raise exception 'DETALLE_SIN_EXPEDIENTES'; end if;
  select count(*) into v_n from facturacion_expediente e where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos);
  if v_n <> cardinality(p_ids_externos) then raise exception 'EXPEDIENTE_DESCONOCIDO'; end if;
  if exists (
    select 1 from facturacion_expediente e join detalle_facturacion d on d.id = e.detalle_id
     where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos) and d.estado <> 'anulada'
  ) then raise exception 'EXPEDIENTE_RESERVADO: alguno ya está en otro detalle'; end if;
  if exists (
    select 1 from facturacion_expediente e
     where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos)
       and (e.estado_tarifa <> 'resuelta' or coalesce(e.monto_calculado, 0) <= 0 or e.factura_id is not null
            or not e.terminado or e.cancelado or e.eliminado or e.nit_resuelto is null
            or not (e.status_cobro_externo is null or upper(btrim(e.status_cobro_externo)) in ('', 'PENDIENTE', 'SIN_STATUS')))
  ) then raise exception 'EXPEDIENTE_NO_FACTURABLE: solo entran expedientes resueltos con precio y en cola'; end if;
  select count(distinct e.nit_resuelto), min(e.nit_resuelto), min(e.cliente_id::text)::uuid, fel_totales(array_agg(e.monto_calculado))
    into v_n, v_nit, v_cliente, v_fel
    from facturacion_expediente e where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos);
  if v_n <> 1 then raise exception 'DETALLE_VARIOS_CLIENTES: un detalle es de UN cliente'; end if;
  v_total := (v_fel->>'total')::numeric; v_sub := (v_fel->>'base')::numeric; v_iva := (v_fel->>'iva')::numeric;
  insert into detalle_facturacion (fuente, cliente_id, nit, estado, subtotal, iva, total, expedientes, creado_por, notas)
  values ('agenda', v_cliente, v_nit, 'borrador', v_sub, v_iva, v_total, cardinality(p_ids_externos), p_actor, nullif(btrim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  update facturacion_expediente set detalle_id = v_id, updated_at = now()
   where fuente = 'agenda' and id_externo = any(p_ids_externos);
  select * into v_row from detalle_facturacion where id = v_id;
  return to_jsonb(v_row);
end
$fn$;

-- ── 3. Recalcular (029: quitar línea) ────────────────────────────────────────────────────────────
create or replace function detalle_facturacion_recalcular(p_detalle_id uuid)
returns void
language plpgsql
as $fn$
declare
  v_fel jsonb; v_n integer; v_exp integer;
begin
  select fel_totales(array_agg(c.monto_calculado) filter (where c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0)), count(*), count(distinct c.expediente_id)
    into v_fel, v_n, v_exp
    from facturacion_componente c where c.detalle_id = p_detalle_id;
  update detalle_facturacion
     set subtotal = (v_fel->>'base')::numeric, iva = (v_fel->>'iva')::numeric, total = (v_fel->>'total')::numeric, pruebas = v_n, expedientes = v_exp, updated_at = now()
   where id = p_detalle_id;
end
$fn$;

-- ── 4. Contenido del link (029): precio CON IVA por línea ────────────────────────────────────────
create or replace function detalle_link_contenido(p_detalle detalle_facturacion)
returns jsonb
language sql stable
as $fn$
  select jsonb_build_object(
    'correlativo', p_detalle.correlativo, 'version', p_detalle.version, 'estado', p_detalle.estado, 'nit', p_detalle.nit,
    'titulo', p_detalle.titulo, 'dirigido_a', p_detalle.dirigido_a, 'notas', p_detalle.notas,
    'cliente', coalesce((select btrim(x.nombre_empresa) from clientes x where x.nit = p_detalle.nit and x.activo limit 1),
                        (select max(e.empresa_nombre_externo) from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id where c.detalle_id = p_detalle.id),
                        'Cliente'),
    'subtotal', p_detalle.subtotal, 'iva', p_detalle.iva, 'total', p_detalle.total,
    'respondido_en', p_detalle.respondido_en, 'respondido_por_nombre', p_detalle.respondido_por_nombre, 'respondido_por_cargo', p_detalle.respondido_por_cargo,
    'firma_png', p_detalle.firma_png, 'documento_hash', p_detalle.documento_hash,
    'lineas', (select coalesce(jsonb_agg(jsonb_build_object(
                 'componente_id', c.id, 'persona', e.persona, 'puesto', e.puesto, 'solicitante', upper(btrim(coalesce(e.solicitante, ''))),
                 'fecha_ingreso', e.fecha_ingreso, 'servicio', c.servicio, 'estado_prueba', c.estado_prueba, 'categoria', c.categoria, 'territorio', c.territorio,
                 'monto', fel_precio_con_iva(c.monto_calculado)) order by e.persona, c.servicio), '[]'::jsonb)
                 from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
                where c.detalle_id = p_detalle.id and c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0),
    'respuestas', (select coalesce(jsonb_agg(jsonb_build_object('componente_id', r.componente_id, 'version', r.version, 'decision', r.decision, 'nota', r.nota, 'respuesta_golden', r.respuesta_golden) order by r.version, r.componente_id), '[]'::jsonb)
                     from detalle_facturacion_respuesta r where r.detalle_id = p_detalle.id and r.version >= p_detalle.version - 1)
  )
$fn$;

-- ── 5. Resumen de la cola (024) con total_con_iva ────────────────────────────────────────────────
create or replace function facturacion_agenda_resumen(p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with vig as (
  select * from facturacion_expediente
   where fuente = p_fuente and terminado and not cancelado and not eliminado
), comp_all as (
  select c.estado_tarifa, c.situacion, c.factura_id, c.expediente_id
    from facturacion_componente c
    join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and not e.eliminado
), cand as (
  select c.id, c.servicio, c.estado_tarifa, c.monto_calculado, c.detalle_id,
         e.nit_resuelto, e.empresa_id_externo, e.empresa_nombre_externo, e.fecha_ingreso, e.cobro_megapaca, e.id as expediente_id,
         (c.detalle_id is not null and exists (select 1 from detalle_facturacion d where d.id = c.detalle_id and d.estado not in ('anulada', 'facturada'))) as en_detalle,
         ((c.detalle_id is null or exists (select 1 from detalle_facturacion d where d.id = c.detalle_id and d.estado = 'anulada'))
            and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
            and facturacion_agenda_en_arranque(e.fuente, e.empresa_id_externo, e.fecha_ingreso)
            and (facturacion_servicio_por_estado(c.servicio) or (e.terminado and not e.cancelado))) as en_cola
    from facturacion_componente c
    join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and c.situacion = 'cobra' and c.factura_id is null
     and not e.eliminado and e.estado_tarifa not in ('excluido_psicometrica', 'excluido_no_factura')
), cola as (
  select * from cand where en_cola
), conteos as (
  select a.estado_tarifa,
         count(*) as total,
         (select count(*) from cola x where x.estado_tarifa = a.estado_tarifa) as en_cola,
         (select count(distinct x.empresa_id_externo) from cola x where x.estado_tarifa = a.estado_tarifa) as empresas_en_cola
    from comp_all a
   group by 1
), grupos as (
  select nit_resuelto,
         min(empresa_id_externo)      as empresa_id_externo,
         min(empresa_nombre_externo)  as empresa_nombre_externo,
         count(*) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0) as listos,
         coalesce(sum(monto_calculado) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0), 0) as total_sin_iva,
         -- 030: como lo verá la factura: suma de los precios con IVA por prueba (no el 12 % de la suma)
         coalesce(sum(fel_precio_con_iva(monto_calculado)) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0), 0) as total_con_iva,
         count(*) filter (where estado_tarifa = 'sin_tarifa') as sin_tarifa,
         count(distinct expediente_id) filter (where coalesce(cobro_megapaca, 0) > 0) as con_megapaca,
         count(distinct expediente_id) as expedientes,
         min(fecha_ingreso) as fecha_mas_antigua
    from cola
   where estado_tarifa in ('resuelta', 'sin_tarifa') and nit_resuelto is not null
   group by nit_resuelto
), reservados as (
  select nit_resuelto, count(*) as en_detalle from cand where en_detalle and nit_resuelto is not null group by nit_resuelto
), pend as (
  select e.nit_resuelto, count(*) as pendientes
    from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and c.situacion = 'pendiente' and c.factura_id is null and not e.eliminado and e.nit_resuelto is not null
   group by e.nit_resuelto
), grupos2 as (
  select g.nit_resuelto, g.empresa_id_externo, g.empresa_nombre_externo, g.listos, g.total_sin_iva, g.total_con_iva, g.sin_tarifa, g.con_megapaca,
         coalesce(r.en_detalle, 0) as en_detalle, g.expedientes, g.fecha_mas_antigua, coalesce(p.pendientes, 0) as pendientes
    from grupos g left join reservados r on r.nit_resuelto = g.nit_resuelto left join pend p on p.nit_resuelto = g.nit_resuelto
), fact as (
  select nit_resuelto,
         count(*) as facturados,
         count(*) filter (where writeback_estado is null or writeback_estado not in ('confirmado', 'omitido')) as writeback_pendiente,
         count(*) filter (where coalesce(cobro_megapaca, 0) > 0) as con_megapaca
    from facturacion_expediente
   where fuente = p_fuente and not eliminado and factura_id is not null
   group by nit_resuelto
), no_facturan as (
  select m.empresa_id_externo, m.empresa_nombre_externo, m.motivo_no_factura, m.creado_por, m.updated_at,
         (select count(*) from vig e where e.empresa_id_externo = m.empresa_id_externo and e.estado_tarifa = 'excluido_no_factura') as expedientes
    from cliente_externo m
   where m.fuente = p_fuente and m.activo and m.no_factura
), detalles as (
  select estado, count(*) as n, coalesce(sum(total), 0) as total
    from detalle_facturacion where fuente = p_fuente group by estado
)
select jsonb_build_object(
  'conteos',    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from conteos c),
  'grupos',     (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from grupos2 g),
  'facturados', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from fact f),
  'total',      (select count(*) from facturacion_expediente where fuente = p_fuente),
  'excluidos',  (select count(*) from vig where estado_tarifa = 'excluido_psicometrica'),
  'excluidos_no_factura', (select count(*) from vig where estado_tarifa = 'excluido_no_factura'),
  'pendientes', (select count(*) from comp_all where situacion = 'pendiente' and factura_id is null),
  'pendientes_expedientes', (select count(distinct expediente_id) from comp_all where situacion = 'pendiente' and factura_id is null),
  'parciales',  (select count(*) from facturacion_expediente where fuente = p_fuente and writeback_estado = 'parcial'),
  'no_facturan', (select coalesce(jsonb_agg(to_jsonb(n) order by n.expedientes desc, n.empresa_nombre_externo), '[]'::jsonb) from no_facturan n),
  'detalles',   (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from detalles d),
  'por_prueba', true
)
$fn$;

-- ── 6. Backfill de los detalles vivos (borrador / enviada / aprobada); facturada y anulada no se tocan ────────
do $do$
declare
  v_cambian integer; v_dif numeric(12,2); v_links integer; v_vivos integer;
begin
  with nuevo as (
    select d.id, d.total as total_viejo,
           fel_totales(array_agg(c.monto_calculado) filter (where c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0)) as fel
      from detalle_facturacion d left join facturacion_componente c on c.detalle_id = d.id
     where d.estado in ('borrador', 'enviada', 'aprobada')
     group by d.id
  ), upd as (
    update detalle_facturacion d
       set subtotal = (n.fel->>'base')::numeric, iva = (n.fel->>'iva')::numeric, total = (n.fel->>'total')::numeric, updated_at = now()
      from nuevo n
     where d.id = n.id and (d.total <> (n.fel->>'total')::numeric or d.subtotal <> (n.fel->>'base')::numeric or d.iva <> (n.fel->>'iva')::numeric)
     returning d.id, n.total_viejo, d.total as total_nuevo
  )
  select count(*), coalesce(sum(total_nuevo - total_viejo), 0) into v_cambian, v_dif from upd;
  select count(*) into v_vivos from detalle_facturacion where estado in ('borrador', 'enviada', 'aprobada');
  -- links vigentes de detalles enviados con la regla vieja: NO se revocan acá; facturación los reenvía
  select count(distinct l.detalle_id) into v_links
    from detalle_facturacion_link l join detalle_facturacion d on d.id = l.detalle_id
   where d.estado = 'enviada' and l.revocado_en is null and l.usado_en is null and l.expira_en > now();
  raise notice '030 backfill: % detalles vivos, % cambiaron de total (diferencia acumulada Q%), % detalle(s) enviado(s) con link vigente a reenviar', v_vivos, v_cambian, v_dif, v_links;
end
$do$;
