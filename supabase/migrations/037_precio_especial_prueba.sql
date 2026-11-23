-- 037 · PRECIO ESPECIAL POR PRUEBA: ajuste puntual del monto de UNA prueba, con motivo (brief del CFO, 23-nov-2026)
--
-- Por qué: a dos socioeconómicos de NIT 320501 (DET-0031) no se les pudo terminar el proceso porque faltó papelería
-- del candidato: se cobran Q274.40 con IVA (Q245.00 sin IVA) en vez de la tarifa (Q375.00 sin IVA). Hoy el monto sale
-- siempre de la tarifa (`monto_calculado`) y, si se editara a mano, el próximo sync lo pisaría.
--
-- Qué hace:
--  1. facturacion_componente: monto_ajustado numeric(12,2) (sin IVA, ≥ 0), ajuste_motivo (obligatorio si hay monto),
--     ajuste_motivo_cliente (true = el motivo se le muestra al cliente en el PDF y en el link; los internos no salen),
--     ajustado_por y ajustado_en.
--     MONTO EFECTIVO = coalesce(monto_ajustado, monto_calculado).
--     El sync / webhook / «Re-resolver» (facturacion_componentes_sincronizar, 025) NO cambia: su upsert solo escribe
--     monto_calculado y las columnas de tarifa; nunca nombra las columnas del ajuste, así que el ajuste sobrevive.
--  2. facturacion_componente_ajuste: bitácora (quién, cuándo, de cuánto a cuánto, por qué, en qué detalle y versión, y
--     el total del detalle antes y después). Es el «historial» que muestra la vista del detalle.
--  3. facturacion_componente_ajustar(p_actor, p_componente_id, p_monto_sin_iva, p_motivo, p_motivo_cliente default null):
--     · p_monto_sin_iva null quita el ajuste (vuelve a la tarifa);
--     · rechaza una prueba facturada (PRUEBA_FACTURADA) o cubierta por paquete (PRUEBA_CUBIERTA_POR_PAQUETE);
--     · exige una prueba cobrable con tarifa resuelta (PRUEBA_SIN_TARIFA) y un monto > 0 (MONTO_INVALIDO: una línea de
--       Q0 no puede ir en una FEL y desaparecería del detalle; para no cobrarla se quita la línea);
--     · en un detalle `aprobada` rechaza (DETALLE_APROBADO: «anulá o reabrí el detalle primero»);
--     · en un detalle vivo (borrador / enviada / con_observaciones) recalcula sus totales (regla FEL 030). Si estaba
--       `enviada`, además SUBE la versión y revoca los links vigentes: el link viejo responde «hay una versión nueva»
--       (igual que hoy cuando cambia el contenido) y la pantalla marca «cambió después de enviado: reenviar».
--       Sube UNA versión por reenvío: varios ajustes seguidos antes de reenviar (las dos líneas de DET-0031) dejan el
--       detalle en la versión siguiente, no dos más arriba.
--       En borrador no se sube (nunca se envió) y en con_observaciones la sube el reenvío (detalle_link_emitir), para no
--       saltar una versión y perder de vista las notas del cliente de la versión anterior;
--     · p_motivo_cliente null = se deduce: los motivos «Proceso incompleto…» son de tipo cliente; el resto, internos.
--  4. Monto efectivo en todo lo que cobra (se recrean las versiones vigentes, mismo cuerpo salvo el monto):
--     · facturacion_agenda_resumen (034): listos / total_sin_iva / total_con_iva de Por facturar;
--     · detalle_facturacion_crear_pruebas (034): la validación de precio > 0 y los totales al armar el detalle;
--     · detalle_facturacion_recalcular (030): totales al quitar una línea o al ajustar;
--     · detalle_link_contenido (030): el precio con IVA de cada línea del link público (+ `nota_precio` si el motivo es
--       de tipo cliente);
--     · detalle_link_responder (029): qué líneas cuentan como «del detalle» al responder;
--     · facturacion_produccion_mensual (034): terminado / backlog / fuera de cola valen el monto efectivo (una prueba
--       cubierta por paquete sigue valiendo su precio unitario; lo ya facturado, el monto de la factura).
--  5. Ayuda «Detalle de facturación» (la de Por facturar): línea «Precio especial» (append idempotente).
--
-- No toca: tarifario, lookup de tarifa, fel_precio_con_iva / fel_totales (030), paquetes (034/036), «cobrada» (026),
-- mapa de precios (027: analiza la TARIFA, no lo cobrado), detalle_facturacion_crear (019: vieja, por expediente, sin
-- uso desde la 024), facturacion_agenda_emitir (los montos de la factura los arma la app con el monto efectivo).
-- RLS activado y solo service_role. Idempotente; sin drop de tablas / funciones, sin delete, truncate, begin / commit.
-- Sin backfill: ningún dato cambia al aplicarla (monto_ajustado nace null → monto efectivo = tarifa).

-- ── 1. modelo ──────────────────────────────────────────────────────────────────────────────────
alter table facturacion_componente add column if not exists monto_ajustado numeric(12,2);
alter table facturacion_componente add column if not exists ajuste_motivo text;
alter table facturacion_componente add column if not exists ajuste_motivo_cliente boolean not null default false;
alter table facturacion_componente add column if not exists ajustado_por text;
alter table facturacion_componente add column if not exists ajustado_en timestamptz;
alter table facturacion_componente drop constraint if exists facturacion_componente_monto_ajustado_check;
alter table facturacion_componente add constraint facturacion_componente_monto_ajustado_check check (monto_ajustado is null or monto_ajustado >= 0);
alter table facturacion_componente drop constraint if exists facturacion_componente_ajuste_motivo_check;
alter table facturacion_componente add constraint facturacion_componente_ajuste_motivo_check check (monto_ajustado is null or length(btrim(coalesce(ajuste_motivo, ''))) >= 3);
comment on column facturacion_componente.monto_ajustado is '037: precio especial de ESTA prueba, sin IVA. Monto efectivo = coalesce(monto_ajustado, monto_calculado). El sync nunca lo toca; se cambia solo con facturacion_componente_ajustar.';
comment on column facturacion_componente.ajuste_motivo is '037: por qué se cobra distinto a la tarifa (obligatorio si hay monto_ajustado).';
comment on column facturacion_componente.ajuste_motivo_cliente is '037: true = el motivo se le muestra al cliente (PDF y link público); false = interno.';

create table if not exists facturacion_componente_ajuste (
  id               uuid primary key default gen_random_uuid(),
  componente_id    uuid not null references facturacion_componente(id) on delete cascade,
  detalle_id       uuid references detalle_facturacion(id) on delete set null,
  detalle_version  integer,
  monto_tarifa     numeric(12,2),
  monto_anterior   numeric(12,2),
  monto_nuevo      numeric(12,2),
  quita_ajuste     boolean not null default false,
  motivo           text,
  motivo_cliente   boolean not null default false,
  total_anterior   numeric(12,2),
  total_nuevo      numeric(12,2),
  actor            text,
  creado_en        timestamptz not null default now()
);
comment on table facturacion_componente_ajuste is 'PRECIO ESPECIAL (037): bitácora de cada ajuste de precio de una prueba: quién, cuándo, de cuánto a cuánto (sin IVA, monto efectivo antes y después), por qué y, si estaba en un detalle, cuál, su versión nueva y su total antes y después.';
create index if not exists idx_componente_ajuste_componente on facturacion_componente_ajuste (componente_id, creado_en desc);
create index if not exists idx_componente_ajuste_detalle on facturacion_componente_ajuste (detalle_id, creado_en desc);
alter table facturacion_componente_ajuste enable row level security;
revoke all on table facturacion_componente_ajuste from public, anon, authenticated;
grant all on table facturacion_componente_ajuste to service_role;

-- ── 2. totales con el monto efectivo (030) ─────────────────────────────────────────────────────
create or replace function detalle_facturacion_recalcular(p_detalle_id uuid)
returns void
language plpgsql
as $fn$
declare
  v_fel jsonb; v_n integer; v_exp integer;
begin
  select fel_totales(array_agg(coalesce(c.monto_ajustado, c.monto_calculado)) filter (where c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_ajustado, c.monto_calculado, 0) > 0)), count(*), count(distinct c.expediente_id)
    into v_fel, v_n, v_exp
    from facturacion_componente c where c.detalle_id = p_detalle_id;
  update detalle_facturacion
     set subtotal = (v_fel->>'base')::numeric, iva = (v_fel->>'iva')::numeric, total = (v_fel->>'total')::numeric, pruebas = v_n, expedientes = v_exp, updated_at = now()
   where id = p_detalle_id;
end
$fn$;

-- Crear detalle por prueba (034): precio > 0 y totales con el monto efectivo
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
  if exists (select 1 from paquete_consumo x where x.componente_id = any(p_componente_ids) and x.revertido_en is null) then
    raise exception 'PRUEBA_CUBIERTA_POR_PAQUETE: alguna prueba ya está cubierta por un paquete prepagado y no se vuelve a facturar';
  end if;
  if exists (
    select 1 from facturacion_componente c join detalle_facturacion d on d.id = c.detalle_id
     where c.id = any(p_componente_ids) and d.estado <> 'anulada'
  ) then raise exception 'EXPEDIENTE_RESERVADO: alguna prueba ya está en otro detalle'; end if;
  if exists (
    select 1 from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
     where c.id = any(p_componente_ids)
       and (c.estado_tarifa <> 'resuelta' or coalesce(c.monto_ajustado, c.monto_calculado, 0) <= 0 or e.nit_resuelto is null or not facturacion_componente_en_cola(c, e))
  ) then raise exception 'EXPEDIENTE_NO_FACTURABLE: solo entran pruebas con resultado, precio resuelto y en cola'; end if;
  select count(distinct e.nit_resuelto), min(e.nit_resuelto), min(e.cliente_id::text)::uuid, count(distinct e.id),
         fel_totales(array_agg(coalesce(c.monto_ajustado, c.monto_calculado)))
    into v_n, v_nit, v_cliente, v_exp, v_fel
    from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id where c.id = any(p_componente_ids);
  if v_n <> 1 then raise exception 'DETALLE_VARIOS_CLIENTES: un detalle es de UN cliente'; end if;
  v_total := (v_fel->>'total')::numeric; v_sub := (v_fel->>'base')::numeric; v_iva := (v_fel->>'iva')::numeric;
  insert into detalle_facturacion (fuente, cliente_id, nit, estado, subtotal, iva, total, expedientes, pruebas, creado_por, notas)
  values ('agenda', v_cliente, v_nit, 'borrador', v_sub, v_iva, v_total, v_exp, cardinality(p_componente_ids), p_actor, nullif(btrim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  update facturacion_componente set detalle_id = v_id, updated_at = now() where id = any(p_componente_ids);
  select * into v_row from detalle_facturacion where id = v_id;
  return to_jsonb(v_row);
end
$fn$;

-- ── 3. la RPC del ajuste ───────────────────────────────────────────────────────────────────────
create or replace function facturacion_componente_ajustar(p_actor text, p_componente_id uuid, p_monto_sin_iva numeric, p_motivo text, p_motivo_cliente boolean default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_c         facturacion_componente%rowtype;
  v_d         detalle_facturacion%rowtype;
  v_det       uuid;
  v_motivo    text := nullif(btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g')), '');
  v_monto     numeric(12,2) := round(p_monto_sin_iva, 2);
  v_cliente   boolean;
  v_ant       numeric(12,2);
  v_nuevo     numeric(12,2);
  v_total_ant numeric(12,2);
  v_vivo      boolean := false;
  v_reenviar  boolean := false;
begin
  -- Orden de bloqueo igual que quitar_linea / emitir / responder: primero el detalle, después la prueba.
  select detalle_id into v_det from facturacion_componente where id = p_componente_id;
  if not found then raise exception 'PRUEBA_NO_EXISTE'; end if;
  if v_det is not null then select * into v_d from detalle_facturacion where id = v_det for update; end if;
  select * into v_c from facturacion_componente where id = p_componente_id for update;
  if v_c.detalle_id is distinct from v_det then raise exception 'PRUEBA_CAMBIO: la prueba cambió de detalle mientras tanto; recargá'; end if;

  if v_c.factura_id is not null then raise exception 'PRUEBA_FACTURADA: la prueba ya está en la factura %; el precio de una prueba facturada no se cambia', coalesce(v_c.no_factura, ''); end if;
  if exists (select 1 from paquete_consumo x where x.componente_id = v_c.id and x.revertido_en is null) then
    raise exception 'PRUEBA_CUBIERTA_POR_PAQUETE: la prueba está cubierta por un paquete prepagado y no se cobra';
  end if;
  if v_d.id is not null and v_d.estado = 'aprobada' then raise exception 'DETALLE_APROBADO: el detalle % ya está aprobado por el cliente; anulá o reabrí el detalle primero', v_d.correlativo; end if;
  if v_d.id is not null and v_d.estado = 'facturada' then raise exception 'PRUEBA_FACTURADA: el detalle % ya está facturado', v_d.correlativo; end if;
  v_vivo := v_d.id is not null and v_d.estado in ('borrador', 'enviada', 'con_observaciones');

  if p_monto_sin_iva is not null then
    if v_monto <= 0 or v_monto > 9999999 then raise exception 'MONTO_INVALIDO: el precio especial debe ser mayor a 0 (sin IVA)'; end if;
    if v_motivo is null or length(v_motivo) < 3 then raise exception 'MOTIVO_OBLIGATORIO: escribí por qué se cobra distinto a la tarifa'; end if;
    if v_c.situacion <> 'cobra' or v_c.estado_tarifa <> 'resuelta' or coalesce(v_c.monto_calculado, 0) <= 0 then
      raise exception 'PRUEBA_SIN_TARIFA: el precio especial se pone sobre una prueba cobrable con tarifa resuelta';
    end if;
    v_cliente := coalesce(p_motivo_cliente, v_motivo ilike 'Proceso incompleto%');
  end if;

  v_ant := coalesce(v_c.monto_ajustado, v_c.monto_calculado);
  v_nuevo := coalesce(v_monto, v_c.monto_calculado);
  -- sin cambio (mismo monto, mismo motivo y misma visibilidad, o quitar un ajuste que no hay): no se registra nada
  if (p_monto_sin_iva is null and v_c.monto_ajustado is null)
     or (p_monto_sin_iva is not null and v_c.monto_ajustado = v_monto and v_c.ajuste_motivo = left(v_motivo, 300) and v_c.ajuste_motivo_cliente = v_cliente) then
    return jsonb_build_object('sin_cambio', true, 'componente', to_jsonb(v_c), 'detalle', case when v_d.id is not null then to_jsonb(v_d) end, 'reenviar', false, 'monto_anterior', v_ant, 'monto_nuevo', v_ant);
  end if;

  update facturacion_componente
     set monto_ajustado = v_monto,
         ajuste_motivo = case when v_monto is null then null else left(v_motivo, 300) end,
         ajuste_motivo_cliente = case when v_monto is null then false else v_cliente end,
         ajustado_por = case when v_monto is null then null else p_actor end,
         ajustado_en = case when v_monto is null then null else now() end,
         updated_at = now()
   where id = v_c.id;

  if v_vivo then
    v_total_ant := v_d.total;
    perform detalle_facturacion_recalcular(v_d.id);
    if v_d.estado = 'enviada' then
      -- cambió después de enviado: versión nueva y el link viejo deja de servir para aprobar. UNA sola versión nueva por
      -- reenvío: si esta versión ya nació de un ajuste posterior al último envío, los ajustes siguientes no la vuelven a subir.
      if not exists (select 1 from facturacion_componente_ajuste a where a.detalle_id = v_d.id and a.detalle_version = v_d.version and a.creado_en > coalesce(v_d.enviada_en, '-infinity'::timestamptz)) then
        update detalle_facturacion set version = version + 1, updated_at = now() where id = v_d.id;
      end if;
      update detalle_facturacion_link set revocado_en = now(), revocado_motivo = 'precio especial: el detalle cambió después de enviado'
       where detalle_id = v_d.id and revocado_en is null and usado_en is null;
      v_reenviar := true;
    end if;
    select * into v_d from detalle_facturacion where id = v_d.id;
  end if;

  insert into facturacion_componente_ajuste (componente_id, detalle_id, detalle_version, monto_tarifa, monto_anterior, monto_nuevo, quita_ajuste, motivo, motivo_cliente, total_anterior, total_nuevo, actor)
  values (v_c.id, case when v_vivo then v_d.id end, case when v_vivo then v_d.version end, v_c.monto_calculado, v_ant, v_nuevo, v_monto is null,
          left(v_motivo, 300), coalesce(v_cliente, false), case when v_vivo then v_total_ant end, case when v_vivo then v_d.total end, p_actor);

  select * into v_c from facturacion_componente where id = v_c.id;
  return jsonb_build_object('sin_cambio', false, 'componente', to_jsonb(v_c), 'detalle', case when v_vivo then to_jsonb(v_d) end, 'reenviar', v_reenviar, 'monto_anterior', v_ant, 'monto_nuevo', v_nuevo);
end
$fn$;

comment on function facturacion_componente_ajustar(text, uuid, numeric, text, boolean) is '037: precio especial de una prueba (sin IVA) con motivo; null lo quita. Rechaza facturada / cubierta por paquete / detalle aprobado; en un detalle vivo recalcula totales y, si estaba enviada, sube la versión y revoca el link.';

revoke all on function facturacion_componente_ajustar(text, uuid, numeric, text, boolean) from public, anon, authenticated;
grant execute on function facturacion_componente_ajustar(text, uuid, numeric, text, boolean) to service_role;

-- ── 4. link público (029/030) ──────────────────────────────────────────────────────────────────
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
                 'monto', fel_precio_con_iva(coalesce(c.monto_ajustado, c.monto_calculado)),
                 -- 037: el motivo del precio especial SOLO si es de tipo cliente (los internos no salen)
                 'nota_precio', case when c.monto_ajustado is not null and c.ajuste_motivo_cliente then c.ajuste_motivo end) order by e.persona, c.servicio), '[]'::jsonb)
                 from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
                where c.detalle_id = p_detalle.id and c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_ajustado, c.monto_calculado, 0) > 0),
    'respuestas', (select coalesce(jsonb_agg(jsonb_build_object('componente_id', r.componente_id, 'version', r.version, 'decision', r.decision, 'nota', r.nota, 'respuesta_golden', r.respuesta_golden) order by r.version, r.componente_id), '[]'::jsonb)
                     from detalle_facturacion_respuesta r where r.detalle_id = p_detalle.id and r.version >= p_detalle.version - 1)
  )
$fn$;

create or replace function detalle_link_responder(p_token_hash text, p_respuestas jsonb, p_firma jsonb default null, p_ip text default null, p_user_agent text default null, p_documento_hash text default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_link detalle_facturacion_link%rowtype;
  v_row detalle_facturacion%rowtype;
  v_n_lineas integer; v_n_resp integer; v_n_distintas integer; v_n_fuera integer; v_n_no_aprobadas integer; v_sin_nota integer; v_malas integer;
  v_todas boolean; v_nombre text; v_cargo text; v_correo text; v_png text; v_autoriza boolean;
begin
  select * into v_link from detalle_facturacion_link where token_hash = p_token_hash for update;
  if v_link.id is null then raise exception 'LINK_INVALIDO'; end if;
  select * into v_row from detalle_facturacion where id = v_link.detalle_id for update;
  if v_row.id is null or v_row.estado in ('anulada', 'facturada') then raise exception 'LINK_INVALIDO'; end if;
  if v_link.revocado_en is not null or v_link.version < v_row.version then raise exception 'LINK_NUEVA_VERSION'; end if;
  if v_link.usado_en is not null then raise exception 'LINK_USADO'; end if;
  if v_link.expira_en < now() then raise exception 'LINK_VENCIDO'; end if;
  if v_row.estado <> 'enviada' then raise exception 'LINK_INVALIDO'; end if;
  if p_documento_hash is null or p_documento_hash <> v_link.documento_hash then raise exception 'DOCUMENTO_CAMBIO: el detalle cambió desde que se envió'; end if;
  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'array' then raise exception 'RESPUESTAS_INVALIDAS'; end if;

  -- las respuestas cubren EXACTAMENTE las líneas del detalle (ni una más, ni una menos, sin repetidos)
  select count(*) into v_n_lineas from facturacion_componente c where c.detalle_id = v_row.id and c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_ajustado, c.monto_calculado, 0) > 0;
  select count(*), count(distinct (r->>'componente_id')) into v_n_resp, v_n_distintas from jsonb_array_elements(p_respuestas) r;
  select count(*) into v_n_fuera from jsonb_array_elements(p_respuestas) r
   where not exists (select 1 from facturacion_componente c where c.id::text = r->>'componente_id' and c.detalle_id = v_row.id and c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_ajustado, c.monto_calculado, 0) > 0);
  if v_n_resp <> v_n_lineas or v_n_distintas <> v_n_lineas or v_n_fuera > 0 then raise exception 'RESPUESTAS_NO_CUBREN: % respuestas para % líneas (% fuera)', v_n_resp, v_n_lineas, v_n_fuera; end if;
  select count(*) into v_malas from jsonb_array_elements(p_respuestas) r where coalesce(r->>'decision', '') not in ('aprobado', 'correccion', 'proximo_mes', 'no_aplica');
  if v_malas > 0 then raise exception 'DECISION_INVALIDA'; end if;
  select count(*) into v_sin_nota from jsonb_array_elements(p_respuestas) r where r->>'decision' <> 'aprobado' and length(btrim(coalesce(r->>'nota', ''))) < 3;
  if v_sin_nota > 0 then raise exception 'NOTA_OBLIGATORIA: % línea(s) sin motivo', v_sin_nota; end if;
  select count(*) into v_n_no_aprobadas from jsonb_array_elements(p_respuestas) r where r->>'decision' <> 'aprobado';
  v_todas := v_n_no_aprobadas = 0;

  if v_todas then
    -- solo se firma con todo aprobado
    v_nombre := nullif(btrim(coalesce(p_firma->>'nombre', '')), '');
    v_cargo := nullif(btrim(coalesce(p_firma->>'cargo', '')), '');
    v_correo := nullif(btrim(coalesce(p_firma->>'correo', '')), '');
    v_png := p_firma->>'png';
    v_autoriza := coalesce((p_firma->>'autoriza')::boolean, false);
    if v_nombre is null or v_cargo is null or v_correo is null then raise exception 'FIRMA_INCOMPLETA: nombre, cargo y correo son obligatorios'; end if;
    if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'FIRMA_CORREO_INVALIDO'; end if;
    if not v_autoriza then raise exception 'FIRMA_SIN_AUTORIZACION: falta la casilla de autorización'; end if;
    if v_png is null or v_png not like 'data:image/png;base64,%' or length(v_png) < 200 or length(v_png) > 280000 then raise exception 'FIRMA_PNG_INVALIDA'; end if;
  end if;

  insert into detalle_facturacion_respuesta (detalle_id, version, componente_id, decision, nota)
  select v_row.id, v_link.version, (r->>'componente_id')::uuid, r->>'decision', nullif(btrim(coalesce(r->>'nota', '')), '')
    from jsonb_array_elements(p_respuestas) r
  on conflict (detalle_id, version, componente_id) do update set decision = excluded.decision, nota = excluded.nota, updated_at = now();

  update detalle_facturacion_link set usado_en = now(), ip_respuesta = left(p_ip, 64), user_agent_respuesta = left(p_user_agent, 300) where id = v_link.id;

  if v_todas then
    update detalle_facturacion
       set estado = 'aprobada', aprobada_en = now(), aprobado_por = left(v_nombre, 200), aprobado_canal = 'link',
           respondido_en = now(), respondido_por_nombre = left(v_nombre, 200), respondido_por_cargo = left(v_cargo, 200), respondido_por_correo = left(v_correo, 200),
           firma_png = v_png, documento_hash = v_link.documento_hash, updated_at = now()
     where id = v_row.id;
  else
    update detalle_facturacion
       set estado = 'con_observaciones', respondido_en = now(),
           respondido_por_nombre = nullif(left(btrim(coalesce(p_firma->>'nombre', '')), 200), ''), respondido_por_cargo = nullif(left(btrim(coalesce(p_firma->>'cargo', '')), 200), ''), respondido_por_correo = nullif(left(btrim(coalesce(p_firma->>'correo', '')), 200), ''),
           updated_at = now()
     where id = v_row.id;
  end if;
  return jsonb_build_object('estado', case when v_todas then 'aprobada' else 'con_observaciones' end, 'observaciones', v_n_no_aprobadas, 'version', v_link.version, 'huella', v_link.documento_hash);
end
$fn$;

-- ── 5. Por facturar (034) y producción (025/034) ───────────────────────────────────────────────
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
  select c.id, c.servicio, c.estado_tarifa, coalesce(c.monto_ajustado, c.monto_calculado) as monto, c.detalle_id,   -- 037: monto efectivo
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
     and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)   -- 034: las cubiertas no son candidatas
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
         count(*) filter (where estado_tarifa = 'resuelta' and coalesce(monto, 0) > 0) as listos,
         coalesce(sum(monto) filter (where estado_tarifa = 'resuelta' and coalesce(monto, 0) > 0), 0) as total_sin_iva,
         coalesce(sum(fel_precio_con_iva(monto)) filter (where estado_tarifa = 'resuelta' and coalesce(monto, 0) > 0), 0) as total_con_iva,
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
), cubiertas as (
  -- 034: pruebas cubiertas por paquete (vigentes), por cliente: la pantalla las muestra aparte, fuera de los totales
  select e.nit_resuelto, count(*) as cubiertas
    from paquete_consumo x join facturacion_componente c on c.id = x.componente_id join facturacion_expediente e on e.id = c.expediente_id
   where x.revertido_en is null and c.fuente = p_fuente and not e.eliminado and e.nit_resuelto is not null
   group by e.nit_resuelto
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
  'cubiertas',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from cubiertas x),
  'por_prueba', true
)
$fn$;

create or replace function facturacion_produccion_mensual(p_desde date, p_hasta date, p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with base as (
  select c.id, c.servicio, facturacion_linea_negocio(c.servicio) as linea, c.situacion, c.estado_tarifa,
         -- 034: una prueba cubierta vale su precio unitario del paquete
         coalesce(pl.precio_unitario, c.monto_ajustado, c.monto_calculado, 0) as monto, c.factura_id, c.no_factura, c.fecha_resultado, c.fecha_resultado_fuente,
         (c.fecha_resultado at time zone 'America/Guatemala')::date as dia,
         to_char(c.fecha_resultado at time zone 'America/Guatemala', 'YYYY-MM') as mes,
         e.nit_resuelto, coalesce(nullif(e.empresa_nombre_externo, ''), e.empresa_id_externo, '—') as empresa, e.fecha_ingreso,
         (pc.id is not null or (c.estado_tarifa = 'resuelta' and coalesce(c.monto_ajustado, c.monto_calculado, 0) > 0)) as con_precio,
         (pc.id is not null) as cubierta,
         e.fuente as e_fuente, e.empresa_id_externo, e.status_cobro_externo, e.estatus_pago_externo, e.terminado, e.cancelado
    from facturacion_componente c
    join facturacion_expediente e on e.id = c.expediente_id
    left join paquete_consumo pc on pc.componente_id = c.id and pc.revertido_en is null
    left join paquete_linea pl on pl.id = pc.paquete_linea_id
   where c.fuente = p_fuente and c.situacion in ('cobra', 'no_cobra')
     and not e.eliminado and e.estado_tarifa <> 'excluido_no_factura'
     and (e.estado_tarifa <> 'excluido_psicometrica' or pc.id is not null)   -- 034: una psicométrica cuenta solo si la cubre un paquete
), fact as (
  select b.id,
         coalesce((select d.monto from factura_detalle_expediente d where d.componente_id = b.id order by d.id limit 1), b.monto) as monto_facturado,
         facturacion_factura_cobrada(b.no_factura) as cobrada
    from base b where b.factura_id is not null
), r as (
  select b.*, coalesce(f.monto_facturado, 0) as monto_facturado, coalesce(f.cobrada, false) as cobrada,
         ((now() at time zone 'America/Guatemala')::date - b.dia) as dias,
         (b.factura_id is null and not b.cubierta
            and facturacion_agenda_cobro_pendiente(b.status_cobro_externo, b.estatus_pago_externo)
            and facturacion_agenda_en_arranque(b.e_fuente, b.empresa_id_externo, b.fecha_ingreso)
            and (facturacion_servicio_por_estado(b.servicio) or (b.terminado and not b.cancelado))) as en_cola
    from base b left join fact f on f.id = b.id
   where b.dia between p_desde and p_hasta
), agg as (
  select mes, linea, nit_resuelto, empresa,
         count(*) filter (where situacion = 'cobra') as terminado_n,
         coalesce(sum(monto) filter (where situacion = 'cobra' and con_precio), 0) as terminado_q,
         count(*) filter (where situacion = 'cobra' and not con_precio) as sin_tarifa_n,
         count(*) filter (where situacion = 'cobra' and factura_id is not null) as facturado_n,
         coalesce(sum(monto_facturado) filter (where situacion = 'cobra' and factura_id is not null), 0) as facturado_q,
         count(*) filter (where situacion = 'cobra' and cobrada) as cobrado_n,
         coalesce(sum(monto_facturado) filter (where situacion = 'cobra' and cobrada), 0) as cobrado_q,
         count(*) filter (where situacion = 'cobra' and cubierta) as cubierta_n,
         coalesce(sum(monto) filter (where situacion = 'cobra' and cubierta), 0) as cubierta_q,
         count(*) filter (where situacion = 'cobra' and factura_id is null and en_cola) as backlog_n,
         coalesce(sum(monto) filter (where situacion = 'cobra' and factura_id is null and en_cola and con_precio), 0) as backlog_q,
         round(avg(dias) filter (where situacion = 'cobra' and factura_id is null and en_cola)) as backlog_dias_prom,
         max(dias) filter (where situacion = 'cobra' and factura_id is null and en_cola) as backlog_dias_max,
         count(*) filter (where situacion = 'cobra' and factura_id is null and not en_cola and not cubierta) as fuera_cola_n,
         coalesce(sum(monto) filter (where situacion = 'cobra' and factura_id is null and not en_cola and not cubierta and con_precio), 0) as fuera_cola_q,
         count(*) filter (where situacion = 'no_cobra') as no_cobra_n
    from r
   group by grouping sets ((mes), (mes, linea), (mes, nit_resuelto, empresa))
)
select jsonb_build_object(
  'desde', p_desde, 'hasta', p_hasta, 'hoy', (now() at time zone 'America/Guatemala')::date,
  'meses', (select coalesce(jsonb_agg(to_jsonb(a) - 'linea' - 'nit_resuelto' - 'empresa' order by a.mes), '[]'::jsonb) from agg a where a.linea is null and a.nit_resuelto is null and a.empresa is null),
  'por_servicio', (select coalesce(jsonb_agg(to_jsonb(a) - 'nit_resuelto' - 'empresa' order by a.mes, a.linea), '[]'::jsonb) from agg a where a.linea is not null),
  'por_cliente', (select coalesce(jsonb_agg(to_jsonb(a) - 'linea' order by a.mes, a.terminado_q desc, a.empresa), '[]'::jsonb) from agg a where a.linea is null and a.empresa is not null),
  'sin_fecha', (select jsonb_build_object('n', count(*), 'q', coalesce(sum(monto) filter (where con_precio), 0), 'sin_factura_n', count(*) filter (where factura_id is null))
                  from base where situacion = 'cobra' and fecha_resultado is null),
  'por_fuente', (select coalesce(jsonb_agg(jsonb_build_object('fuente', coalesce(fecha_resultado_fuente, 'sin_fuente'), 'n', n) order by n desc), '[]'::jsonb)
                   from (select fecha_resultado_fuente, count(*) as n from base group by 1) f),
  'inconsistencias', (select count(*) from base where fecha_resultado is not null and fecha_ingreso is not null and dia < fecha_ingreso)
)
$fn$;

-- ── 6. ayuda (append idempotente) ──────────────────────────────────────────────────────────────
update ayuda
   set contenido = contenido || E'\n\n**Precio especial:** si a una prueba se le cobra distinto a la tarifa (por ejemplo, un proceso que no se terminó por falta de papelería), usá el lápiz de la línea y escribí el motivo. Si el detalle ya se envió, hay que reenviarlo.',
       updated_at = now()
 where slug = 'detalle-de-facturacion-armar-el-corte' and contenido not like '%**Precio especial:**%';
