-- ============================================================
-- 024 · Cobro por PRUEBA: polígrafo y socio se facturan por separado según su propio estado
--
-- Corre en AMBAS bases (primero HIT y verificar). Idempotente: if not exists / create or
-- replace. Sin begin/commit propio. Sin delete/truncate/drop de tablas (ni en las funciones);
-- se recrea UN check (writeback_estado, para agregar 'parcial'; mismo patrón que la 018).
--
-- Por qué: con Airtable un COMPLETO llegaba en DOS filas (una por prueba); el sistema nuevo de
-- la Agenda manda UN registro con varios servicios ("POLIGRAFO, SOCIOECONOMICO") y, desde el
-- 29-oct-2026, el estado de CADA prueba (`estadoPoligrafo` / `estadoSocio`). El CFO quiere cobrar
-- el polígrafo apenas tiene resultado y el socio después, en otra factura, viendo por candidato
-- qué se cobró, qué falta y qué no se cobra. La unidad que se factura pasa a ser la PRUEBA.
--
--  1. facturacion_expediente.estado_poligrafo / estado_socio (el sync los llena; backfill desde raw)
--     + pruebas_firma (huella de los componentes calculados, para re-resolver solo lo que cambió)
--     + writeback_estado admite 'parcial' (se cobró una prueba; falta otra → NO se escribe a la Agenda).
--  2. facturacion_componente: una fila por prueba de cada expediente, con su `situacion`
--     (cobra | pendiente | no_cobra), el texto de la Agenda que decidió, su precio y, cuando se
--     factura, su factura. Único (expediente_id, servicio). Las decide la app (reglas del CFO en
--     src/lib/facturacion-agenda/situacion.ts) y las escribe por la RPC
--     facturacion_componentes_sincronizar, que NUNCA pisa detalle_id / factura_id / facturado_*.
--  3. Backfill: los expedientes ya facturados reciben sus componentes marcados como facturados
--     (desde factura_detalle_expediente, con la factura del expediente).
--  4. La cola (resumen / sin_mapear) pasa a NIVEL COMPONENTE: en cola = componente 'cobra', sin
--     factura, sin detalle vivo, con la regla de cobro del expediente (021) y el corte (022).
--     POLIGRAFO / SOCIO (y el fee) NO exigen `terminado` (el polígrafo de un expediente abierto
--     entra); los demás servicios siguen exigiéndolo. Conserva todo lo de 017/018/019/021/022.
--  5. Detalle (reserva), anulación y emisión por componente: detalle_facturacion_crear_pruebas,
--     detalle_facturacion_anular (libera componentes) y facturacion_agenda_emitir (p_detalle trae
--     componente_id + resultado). El expediente queda `factura_id` solo cuando está COMPLETO
--     (todas sus pruebas 'cobra' facturadas y ninguna 'pendiente'); si no, writeback 'parcial'.
--     facturacion_agenda_cerrar_parciales cierra los parciales que se completan por el sync
--     (p. ej. el socio pasó a no_cobra después de facturar el polígrafo).
-- La RPC vieja detalle_facturacion_crear (por expediente) queda sin uso; no se dropea.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Expediente: estado de cada prueba + huella + writeback 'parcial'
-- ------------------------------------------------------------
alter table facturacion_expediente add column if not exists estado_poligrafo text;
alter table facturacion_expediente add column if not exists estado_socio text;
alter table facturacion_expediente add column if not exists pruebas_firma text;
comment on column facturacion_expediente.estado_poligrafo is 'estadoPoligrafo de la Agenda (texto exacto). null = sin polígrafo o sin estado.';
comment on column facturacion_expediente.estado_socio is 'estadoSocio de la Agenda (texto exacto). null = sin socio o sin estado.';
comment on column facturacion_expediente.pruebas_firma is 'Huella de los componentes calculados por la app (servicio|situacion|monto|estado_tarifa…): re-resolver solo reescribe si cambia.';

update facturacion_expediente
   set estado_poligrafo = nullif(btrim(raw->>'estadoPoligrafo'), ''),
       estado_socio     = nullif(btrim(raw->>'estadoSocio'), '')
 where fuente = 'agenda' and raw is not null and estado_poligrafo is null and estado_socio is null
   and (coalesce(raw->>'estadoPoligrafo', '') <> '' or coalesce(raw->>'estadoSocio', '') <> '');

alter table facturacion_expediente drop constraint if exists facturacion_expediente_writeback_estado_check;
alter table facturacion_expediente add constraint facturacion_expediente_writeback_estado_check
  check (writeback_estado is null or writeback_estado in ('omitido', 'pendiente', 'confirmado', 'conflicto', 'error', 'parcial'));

alter table detalle_facturacion add column if not exists pruebas integer not null default 0;
comment on column detalle_facturacion.pruebas is 'Componentes (pruebas) reservados en el detalle. `expedientes` cuenta candidatos distintos.';

alter table factura_detalle_expediente add column if not exists componente_id uuid;
alter table factura_detalle_expediente add column if not exists resultado text;
comment on column factura_detalle_expediente.resultado is 'Texto legible para el cliente: "Polígrafo — aprobó", "Socioeconómico — completo", "Fee visita realizada (socio cancelado)".';

-- ------------------------------------------------------------
-- 2. Una fila por prueba de cada expediente
-- ------------------------------------------------------------
create table if not exists facturacion_componente (
  id               uuid primary key default gen_random_uuid(),
  expediente_id    uuid not null references facturacion_expediente(id) on delete cascade,
  fuente           text not null default 'agenda',
  id_externo       text not null,
  servicio         text not null,
  estado_prueba    text,
  situacion        text not null check (situacion in ('cobra', 'pendiente', 'no_cobra')),
  motivo           text,
  categoria        text,
  territorio       text,
  monto_calculado  numeric(12,2),
  estado_tarifa    text not null default 'sin_tarifa',
  detalle_tarifa   text,
  tarifario_id     uuid,
  aprobada         boolean,
  detalle_id       uuid references detalle_facturacion(id),
  factura_id       uuid references facturas_clientes(id),
  no_factura       text,
  facturado_en     timestamptz,
  facturado_por    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (expediente_id, servicio)
);
create index if not exists idx_fact_comp_cola     on facturacion_componente (fuente, situacion, estado_tarifa) where factura_id is null;
create index if not exists idx_fact_comp_externo  on facturacion_componente (fuente, id_externo);
create index if not exists idx_fact_comp_detalle  on facturacion_componente (detalle_id) where detalle_id is not null;
create index if not exists idx_fact_comp_factura  on facturacion_componente (factura_id) where factura_id is not null;
alter table facturacion_componente enable row level security;

-- Servicios cuya prueba se cobra por su propio estado (no exigen `terminado` del expediente).
create or replace function facturacion_servicio_por_estado(p_servicio text)
returns boolean
language sql immutable
as $fn$
  select upper(coalesce(p_servicio, '')) in ('POLIGRAFO', 'POLIGRAFO BASIC', 'SOCIOECONOMICO', 'SOCIOECONOMICO VIRTUAL', 'FEE VISITA SOCIO CANCELADO')
$fn$;

-- true si el componente está EN COLA: cobra, sin factura, sin detalle vivo; el expediente vigente (no eliminado,
-- no excluido), con cobro pendiente (021) y dentro del arranque (022); `terminado` solo para servicios que no van por estado.
create or replace function facturacion_componente_en_cola(c facturacion_componente, e facturacion_expediente)
returns boolean
language sql stable
as $fn$
  select c.situacion = 'cobra' and c.factura_id is null
     and (c.detalle_id is null or exists (select 1 from detalle_facturacion d where d.id = c.detalle_id and d.estado = 'anulada'))
     and not e.eliminado and e.estado_tarifa not in ('excluido_psicometrica', 'excluido_no_factura')
     and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
     and facturacion_agenda_en_arranque(e.fuente, e.empresa_id_externo, e.fecha_ingreso)
     and (facturacion_servicio_por_estado(c.servicio) or (e.terminado and not e.cancelado))
$fn$;

-- ------------------------------------------------------------
-- RPC: sincronizar los componentes calculados por la app (todo o nada por lote).
-- p_items: [{ id_externo, componentes: [{ servicio, estado_prueba, situacion, motivo, categoria, territorio,
--            monto_calculado, estado_tarifa, detalle_tarifa, tarifario_id, aprobada }] }]
-- Nunca pisa detalle_id / factura_id / facturado_*: un componente facturado no se toca; uno reservado conserva la
-- reserva; los que ya no existen en el expediente pasan a 'no_cobra' (no se borra nada).
-- ------------------------------------------------------------
create or replace function facturacion_componentes_sincronizar(p_fuente text, p_items jsonb)
returns integer
language plpgsql
as $fn$
declare
  it      jsonb;
  c       jsonb;
  v_exp   uuid;
  v_ids   text[];
  n       integer := 0;
begin
  if p_items is null then return 0; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select id into v_exp from facturacion_expediente where fuente = p_fuente and id_externo = it->>'id_externo';
    if v_exp is null then continue; end if;
    v_ids := array[]::text[];
    for c in select * from jsonb_array_elements(coalesce(it->'componentes', '[]'::jsonb)) loop
      v_ids := v_ids || (c->>'servicio');
      insert into facturacion_componente (expediente_id, fuente, id_externo, servicio, estado_prueba, situacion, motivo, categoria, territorio, monto_calculado, estado_tarifa, detalle_tarifa, tarifario_id, aprobada)
      values (v_exp, p_fuente, it->>'id_externo', c->>'servicio', nullif(c->>'estado_prueba', ''), coalesce(c->>'situacion', 'pendiente'), nullif(c->>'motivo', ''),
              nullif(c->>'categoria', ''), nullif(c->>'territorio', ''), (c->>'monto_calculado')::numeric, coalesce(c->>'estado_tarifa', 'sin_tarifa'), nullif(c->>'detalle_tarifa', ''),
              nullif(c->>'tarifario_id', '')::uuid, (c->>'aprobada')::boolean)
      on conflict (expediente_id, servicio) do update
        set estado_prueba = excluded.estado_prueba, situacion = excluded.situacion, motivo = excluded.motivo, categoria = excluded.categoria, territorio = excluded.territorio,
            monto_calculado = excluded.monto_calculado, estado_tarifa = excluded.estado_tarifa, detalle_tarifa = excluded.detalle_tarifa, tarifario_id = excluded.tarifario_id, aprobada = excluded.aprobada,
            id_externo = excluded.id_externo, updated_at = now()
        where facturacion_componente.factura_id is null;
      n := n + 1;
    end loop;
    -- Las pruebas que ya no están en la fila (la Agenda cambió el servicio) no se borran: quedan 'no_cobra' con el motivo, salvo que estén reservadas o facturadas.
    update facturacion_componente x
       set situacion = 'no_cobra', motivo = 'ya no aplica: la Agenda cambió el servicio del expediente', updated_at = now()
     where x.expediente_id = v_exp and x.factura_id is null and x.detalle_id is null and not (x.servicio = any(v_ids)) and x.situacion <> 'no_cobra';
  end loop;
  return n;
end
$fn$;

-- ------------------------------------------------------------
-- 3. Backfill: expedientes ya facturados → sus componentes marcados como facturados (una vez).
-- ------------------------------------------------------------
insert into facturacion_componente (expediente_id, fuente, id_externo, servicio, estado_prueba, situacion, motivo, categoria, territorio, monto_calculado, estado_tarifa, detalle_tarifa, factura_id, no_factura, facturado_en, facturado_por)
select e.id, e.fuente, e.id_externo, coalesce(nullif(d.tipo_prueba, ''), e.tipo_cobrado, 'SERVICIO'), null, 'cobra', 'facturado antes del cobro por prueba (024)',
       nullif(d.categoria, ''), nullif(d.territorio, ''), d.monto, 'resuelta', null, e.factura_id, e.no_factura, e.facturado_en, e.facturado_por
  from facturacion_expediente e
  join factura_detalle_expediente d on d.id_externo = e.id_externo and d.fuente = e.fuente and d.no_factura = e.no_factura
 where e.fuente = 'agenda' and e.factura_id is not null
   and not exists (select 1 from facturacion_componente c where c.expediente_id = e.id)
on conflict (expediente_id, servicio) do nothing;

-- ------------------------------------------------------------
-- 4. Cola a nivel componente: resumen y sin mapear (conservan 017/018/019/021/022)
-- ------------------------------------------------------------
create or replace function facturacion_agenda_resumen(p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with vig as (
  select * from facturacion_expediente
   where fuente = p_fuente and terminado and not cancelado and not eliminado
), comp_all as (
  -- todas las pruebas vigentes (solo para los totales por estado_tarifa)
  select c.estado_tarifa, c.situacion, c.factura_id, c.expediente_id
    from facturacion_componente c
    join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and not e.eliminado
), cand as (
  -- candidatas a la cola: cobra, sin factura, expediente vigente (la regla completa va inline para no llamar una función por fila)
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
  select g.nit_resuelto, g.empresa_id_externo, g.empresa_nombre_externo, g.listos, g.total_sin_iva, g.sin_tarifa, g.con_megapaca,
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

create or replace function facturacion_agenda_sin_mapear(p_fuente text default 'agenda', p_q text default '', p_limit integer default 25, p_offset integer default 0)
returns jsonb
language sql stable
as $fn$
with cola as (
  select e.empresa_id_externo, e.empresa_nombre_externo, e.fecha_ingreso, e.id as expediente_id
    from facturacion_componente c
    join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and c.estado_tarifa = 'cliente_sin_mapear' and c.situacion = 'cobra' and c.factura_id is null and c.detalle_id is null
     and not e.eliminado and e.estado_tarifa not in ('excluido_psicometrica', 'excluido_no_factura')
     and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
     and facturacion_agenda_en_arranque(e.fuente, e.empresa_id_externo, e.fecha_ingreso)
     and (facturacion_servicio_por_estado(c.servicio) or (e.terminado and not e.cancelado))
), emp as (
  select empresa_id_externo,
         min(empresa_nombre_externo)   as empresa_nombre_externo,
         count(distinct expediente_id) as expedientes,
         min(fecha_ingreso)            as fecha_mas_antigua,
         max(fecha_ingreso)            as fecha_mas_reciente
    from cola
   group by empresa_id_externo
), filt as (
  select * from emp
   where coalesce(p_q, '') = ''
      or empresa_nombre_externo ilike '%' || p_q || '%'
      or empresa_id_externo ilike '%' || p_q || '%'
)
select jsonb_build_object(
  'total_empresas',    (select count(*) from filt),
  'total_expedientes', (select coalesce(sum(expedientes), 0) from filt),
  'filas', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
              from (select * from filt order by expedientes desc, empresa_nombre_externo nulls last, empresa_id_externo
                    limit greatest(p_limit, 1) offset greatest(p_offset, 0)) f)
)
$fn$;

-- ------------------------------------------------------------
-- 5. Detalle por prueba: reservar componentes (todo o nada)
-- ------------------------------------------------------------
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
  v_id       uuid;
  v_row      detalle_facturacion%rowtype;
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
  select count(distinct e.nit_resuelto), min(e.nit_resuelto), min(e.cliente_id::text)::uuid, coalesce(sum(c.monto_calculado), 0), count(distinct e.id)
    into v_n, v_nit, v_cliente, v_sub, v_exp
    from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id where c.id = any(p_componente_ids);
  if v_n <> 1 then raise exception 'DETALLE_VARIOS_CLIENTES: un detalle es de UN cliente'; end if;
  v_iva := round(v_sub * 0.12, 2);
  insert into detalle_facturacion (fuente, cliente_id, nit, estado, subtotal, iva, total, expedientes, pruebas, creado_por, notas)
  values ('agenda', v_cliente, v_nit, 'borrador', v_sub, v_iva, v_sub + v_iva, v_exp, cardinality(p_componente_ids), p_actor, nullif(btrim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  update facturacion_componente set detalle_id = v_id, updated_at = now() where id = any(p_componente_ids);
  select * into v_row from detalle_facturacion where id = v_id;
  return to_jsonb(v_row);
end
$fn$;

-- Anular: libera los componentes (y los expedientes de detalles viejos por expediente).
create or replace function detalle_facturacion_anular(p_actor text, p_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_row detalle_facturacion%rowtype;
begin
  select * into v_row from detalle_facturacion where id = p_id for update;
  if v_row.id is null then raise exception 'DETALLE_NO_EXISTE'; end if;
  if v_row.estado = 'facturada' then raise exception 'DETALLE_FACTURADO: un detalle facturado no se anula (anulá la factura)'; end if;
  if v_row.estado = 'anulada' then return to_jsonb(v_row); end if;
  update facturacion_componente set detalle_id = null, updated_at = now() where detalle_id = p_id and factura_id is null;
  update facturacion_expediente set detalle_id = null, updated_at = now() where detalle_id = p_id;
  update detalle_facturacion
     set estado = 'anulada', anulada_en = now(), anulada_por = p_actor, motivo_anulacion = nullif(btrim(coalesce(p_motivo, '')), ''), updated_at = now()
   where id = p_id;
  select * into v_row from detalle_facturacion where id = p_id;
  return to_jsonb(v_row);
end
$fn$;

-- ------------------------------------------------------------
-- Emitir por prueba: factura + detalle (un renglón por componente, con el resultado legible) + vínculo.
-- p_detalle: [{ componente_id, id_externo, tipo_prueba, categoria, territorio, monto, centro_costo_id, resultado }]
-- El expediente queda facturado (factura_id) solo si está COMPLETO; si no, writeback 'parcial'.
-- ------------------------------------------------------------
create or replace function facturacion_agenda_emitir(p_actor text, p_factura jsonb, p_lineas jsonb, p_detalle jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_nf        text := btrim(coalesce(p_factura->>'no_factura', ''), E' \t\r\n' || chr(160));
  v_cliente   uuid := (p_factura->>'cliente_id')::uuid;
  v_fecha     date := (p_factura->>'fecha_emision')::date;
  v_wb        text := coalesce(nullif(p_factura->>'writeback_estado', ''), 'pendiente');
  v_cids      uuid[];
  v_exps      uuid[];
  v_principal uuid;
  v_app       text;
  v_n         integer;
  v_completos integer := 0;
  l           jsonb;
  d           jsonb;
  x           record;
begin
  if v_nf = '' then raise exception 'FACTURA_SIN_NUMERO'; end if;
  if v_cliente is null then raise exception 'FACTURA_SIN_CLIENTE'; end if;
  if v_fecha is null then raise exception 'FACTURA_SIN_FECHA'; end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then raise exception 'FACTURA_SIN_LINEAS'; end if;
  if p_detalle is null or jsonb_array_length(p_detalle) = 0 then raise exception 'FACTURA_SIN_EXPEDIENTES'; end if;
  if exists (select 1 from facturas_clientes where no_factura = v_nf) then
    raise exception 'FACTURA_DUPLICADA: la factura % ya existe', v_nf;
  end if;

  select array_agg(distinct (y->>'componente_id')::uuid) into v_cids from jsonb_array_elements(p_detalle) y;
  select count(*) into v_n from facturacion_componente c where c.id = any(v_cids);
  if v_n <> cardinality(v_cids) then raise exception 'EXPEDIENTE_DESCONOCIDO'; end if;
  if exists (
    select 1 from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
     where c.id = any(v_cids)
       and (c.situacion <> 'cobra' or c.estado_tarifa <> 'resuelta' or c.factura_id is not null or e.eliminado
            or not (facturacion_servicio_por_estado(c.servicio) or (e.terminado and not e.cancelado)))
  ) then
    raise exception 'EXPEDIENTE_NO_FACTURABLE: alguna prueba no tiene resultado cobrable, no está resuelta o ya tiene factura';
  end if;
  select array_agg(distinct expediente_id) into v_exps from facturacion_componente where id = any(v_cids);

  for l in select * from jsonb_array_elements(p_lineas) loop
    insert into facturas_clientes (airtable_id, no_factura, cliente_id, centro_costo_id, fecha_emision, total, iva, subtotal, estado)
    values (l->>'airtable_id', v_nf, v_cliente, (l->>'centro_costo_id')::uuid, v_fecha,
            (l->>'total')::numeric, (l->>'iva')::numeric, (l->>'subtotal')::numeric, 'EMITIDA');
  end loop;

  select id, airtable_id into v_principal, v_app
    from facturas_clientes where no_factura = v_nf
   order by total desc, created_at asc limit 1;

  for d in select * from jsonb_array_elements(p_detalle) loop
    insert into factura_detalle_expediente (factura_id, no_factura, expediente_id, id_externo, fuente, tipo_prueba, categoria, territorio, monto, centro_costo_id, persona, componente_id, resultado)
    select v_principal, v_nf, e.id, e.id_externo, 'agenda', d->>'tipo_prueba', d->>'categoria', d->>'territorio',
           (d->>'monto')::numeric, nullif(d->>'centro_costo_id', '')::uuid, e.persona, c.id, nullif(d->>'resultado', '')
      from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
     where c.id = (d->>'componente_id')::uuid;
  end loop;

  update facturacion_componente
     set factura_id = v_principal, no_factura = v_nf, facturado_en = now(), facturado_por = p_actor, updated_at = now()
   where id = any(v_cids);

  for x in select e.id,
                  not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'cobra' and c.factura_id is null) as sin_cobrables,
                  not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'pendiente') as sin_pendientes,
                  (select string_agg(c.servicio || ' (' || c.situacion || ')', ', ' order by c.servicio) from facturacion_componente c where c.expediente_id = e.id and c.factura_id is null and c.situacion <> 'no_cobra') as faltan
             from facturacion_expediente e where e.id = any(v_exps)
  loop
    if x.sin_cobrables and x.sin_pendientes then
      update facturacion_expediente
         set factura_id = v_principal, factura_app_id = v_app, no_factura = v_nf, facturado_en = now(), facturado_por = p_actor,
             writeback_estado = v_wb, writeback_detalle = null, writeback_en = null, detalle_id = null, updated_at = now()
       where id = x.id;
      v_completos := v_completos + 1;
    else
      update facturacion_expediente
         set no_factura = v_nf, factura_app_id = v_app, writeback_estado = 'parcial',
             writeback_detalle = ('Cobro parcial: facturada una prueba; falta ' || coalesce(x.faltan, '') || '. No se escribe a la Agenda hasta completar.'),
             writeback_en = now(), updated_at = now()
       where id = x.id;
    end if;
  end loop;

  return jsonb_build_object('factura_id', v_principal, 'factura_app_id', v_app, 'no_factura', v_nf,
                            'lineas', jsonb_array_length(p_lineas), 'expedientes', cardinality(v_exps), 'pruebas', cardinality(v_cids), 'completos', v_completos);
end
$fn$;

-- ------------------------------------------------------------
-- Cerrar parciales: expedientes 'parcial' que ya quedaron completos (sus pruebas restantes pasaron a no_cobra
-- o se facturaron) → factura_id de la última prueba facturada y writeback 'pendiente' (la app escribe a la Agenda
-- con TODOS los números). Devuelve [{ id_externo, no_factura }].
-- ------------------------------------------------------------
create or replace function facturacion_agenda_cerrar_parciales(p_fuente text default 'agenda')
returns jsonb
language plpgsql
as $fn$
declare
  x        record;
  v_out    jsonb := '[]'::jsonb;
begin
  for x in
    select e.id, e.id_externo
      from facturacion_expediente e
     where e.fuente = p_fuente and e.writeback_estado = 'parcial' and e.factura_id is null
       and not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'cobra' and c.factura_id is null)
       and not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'pendiente')
       and exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.factura_id is not null)
  loop
    update facturacion_expediente e
       set factura_id = u.factura_id, factura_app_id = f.airtable_id, no_factura = u.no_factura, facturado_en = u.facturado_en, facturado_por = u.facturado_por,
           writeback_estado = 'pendiente', writeback_detalle = 'Expediente completo: se escribe a la Agenda con todas sus facturas.', writeback_en = now(), updated_at = now()
      from (select c.factura_id, c.no_factura, c.facturado_en, c.facturado_por from facturacion_componente c where c.expediente_id = x.id and c.factura_id is not null order by c.facturado_en desc nulls last limit 1) u
      left join facturas_clientes f on f.id = u.factura_id
     where e.id = x.id;
    v_out := v_out || jsonb_build_object('id_externo', x.id_externo, 'no_factura', (select no_factura from facturacion_expediente where id = x.id));
  end loop;
  return v_out;
end
$fn$;
