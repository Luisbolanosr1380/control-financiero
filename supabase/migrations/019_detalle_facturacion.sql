-- ============================================================
-- 019 · Detalle de facturación (pre-liquidación) con aprobación del cliente
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit propio y
-- sin delete/drop (el runner aporta la transacción). Idempotente.
--
-- Flujo: seleccionar procesos → generar DETALLE (borrador) → imprimir / enviar al
-- cliente (enviada) → el cliente aprueba (aprobada) → emitir la factura SAT
-- (facturada). 'anulada' libera los expedientes. Todo lo de la Agenda pasa por
-- acá, incluso 1–2 procesos: queda el registro de quién aprobó y por qué canal.
--
--  · detalle_facturacion         → un detalle agrupa los expedientes de UN cliente con su estado y totales.
--  · facturacion_expediente.detalle_id → reserva: un expediente en un detalle no anulado no entra en otro.
--  · RPC detalle_facturacion_crear  → crea el detalle y reserva los expedientes en UNA transacción
--                                      (solo resueltos con precio, en cola, mismo NIT, no reservados).
--  · RPC detalle_facturacion_anular → anula y libera (nunca una facturada).
--  · facturacion_agenda_resumen()   → además cuenta detalles por estado (tablero "pendientes de aprobación").
-- La RPC de emisión (016) y el write-back no se tocan: se invocan desde un detalle aprobado.
-- ============================================================

create sequence if not exists detalle_facturacion_seq;

create table if not exists detalle_facturacion (
  id               uuid primary key default gen_random_uuid(),
  fuente           text not null default 'agenda',
  cliente_id       uuid references clientes(id),
  nit              text not null,
  correlativo      text not null unique default ('DET-' || lpad(nextval('detalle_facturacion_seq')::text, 4, '0')),
  estado           text not null default 'borrador' check (estado in ('borrador', 'enviada', 'aprobada', 'facturada', 'anulada')),
  subtotal         numeric(12,2) not null default 0,
  iva              numeric(12,2) not null default 0,
  total            numeric(12,2) not null default 0,
  expedientes      integer not null default 0,
  creado_por       text,
  created_at       timestamptz not null default now(),
  enviada_en       timestamptz,
  enviada_por      text,
  aprobada_en      timestamptz,
  aprobado_por     text,
  aprobado_canal   text check (aprobado_canal is null or aprobado_canal in ('correo', 'link', 'otro')),
  factura_id       uuid references facturas_clientes(id),
  factura_app_id   text,
  no_factura       text,
  facturado_en     timestamptz,
  anulada_en       timestamptz,
  anulada_por      text,
  motivo_anulacion text,
  notas            text,
  updated_at       timestamptz not null default now()
);
create index if not exists idx_detalle_fact_nit    on detalle_facturacion (fuente, nit);
create index if not exists idx_detalle_fact_estado on detalle_facturacion (fuente, estado);
alter table detalle_facturacion enable row level security;

alter table facturacion_expediente add column if not exists detalle_id uuid references detalle_facturacion(id);
create index if not exists idx_fact_exp_detalle on facturacion_expediente (detalle_id) where detalle_id is not null;

-- ------------------------------------------------------------
-- RPC: crear el detalle y reservar sus expedientes (todo o nada)
-- p_ids_externos: ids de la Agenda. Devuelve el detalle como jsonb.
-- ------------------------------------------------------------
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
  v_id       uuid;
  v_row      detalle_facturacion%rowtype;
begin
  if p_ids_externos is null or cardinality(p_ids_externos) = 0 then raise exception 'DETALLE_SIN_EXPEDIENTES'; end if;
  select count(*) into v_n from facturacion_expediente e where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos);
  if v_n <> cardinality(p_ids_externos) then raise exception 'EXPEDIENTE_DESCONOCIDO'; end if;
  -- Reservado: ya está en un detalle vivo (no anulado)
  if exists (
    select 1 from facturacion_expediente e join detalle_facturacion d on d.id = e.detalle_id
     where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos) and d.estado <> 'anulada'
  ) then raise exception 'EXPEDIENTE_RESERVADO: alguno ya está en otro detalle'; end if;
  -- Solo resueltos con precio, en cola (terminado, vigente, sin factura, cobro pendiente)
  if exists (
    select 1 from facturacion_expediente e
     where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos)
       and (e.estado_tarifa <> 'resuelta' or coalesce(e.monto_calculado, 0) <= 0 or e.factura_id is not null
            or not e.terminado or e.cancelado or e.eliminado or e.nit_resuelto is null
            or not (e.status_cobro_externo is null or upper(btrim(e.status_cobro_externo)) in ('', 'PENDIENTE', 'SIN_STATUS')))
  ) then raise exception 'EXPEDIENTE_NO_FACTURABLE: solo entran expedientes resueltos con precio y en cola'; end if;
  select count(distinct e.nit_resuelto), min(e.nit_resuelto), min(e.cliente_id::text)::uuid, coalesce(sum(e.monto_calculado), 0)
    into v_n, v_nit, v_cliente, v_sub
    from facturacion_expediente e where e.fuente = 'agenda' and e.id_externo = any(p_ids_externos);
  if v_n <> 1 then raise exception 'DETALLE_VARIOS_CLIENTES: un detalle es de UN cliente'; end if;
  v_iva := round(v_sub * 0.12, 2);
  insert into detalle_facturacion (fuente, cliente_id, nit, estado, subtotal, iva, total, expedientes, creado_por, notas)
  values ('agenda', v_cliente, v_nit, 'borrador', v_sub, v_iva, v_sub + v_iva, cardinality(p_ids_externos), p_actor, nullif(btrim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  update facturacion_expediente set detalle_id = v_id, updated_at = now()
   where fuente = 'agenda' and id_externo = any(p_ids_externos);
  select * into v_row from detalle_facturacion where id = v_id;
  return to_jsonb(v_row);
end
$fn$;

-- ------------------------------------------------------------
-- RPC: anular un detalle y liberar sus expedientes (no una facturada)
-- ------------------------------------------------------------
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
  update facturacion_expediente set detalle_id = null, updated_at = now() where detalle_id = p_id;
  update detalle_facturacion
     set estado = 'anulada', anulada_en = now(), anulada_por = p_actor, motivo_anulacion = nullif(btrim(coalesce(p_motivo, '')), ''), updated_at = now()
   where id = p_id;
  select * into v_row from detalle_facturacion where id = p_id;
  return to_jsonb(v_row);
end
$fn$;

-- Resumen para la lista (reemplaza la versión de la 018): agrega 'detalles' = conteo por estado.
create or replace function facturacion_agenda_resumen(p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with vig as (
  select * from facturacion_expediente
   where fuente = p_fuente and terminado and not cancelado and not eliminado
), cola as (
  select * from vig
   where factura_id is null and estado_tarifa not in ('excluido_psicometrica', 'excluido_no_factura')
     and facturacion_agenda_cobro_pendiente(status_cobro_externo)
), conteos as (
  select e.estado_tarifa,
         count(*) as total,
         count(*) filter (where e.terminado and not e.cancelado and not e.eliminado and e.factura_id is null
                            and facturacion_agenda_cobro_pendiente(e.status_cobro_externo)) as en_cola,
         count(distinct e.empresa_id_externo) filter (where e.terminado and not e.cancelado and not e.eliminado and e.factura_id is null
                            and facturacion_agenda_cobro_pendiente(e.status_cobro_externo)) as empresas_en_cola
    from facturacion_expediente e
   where e.fuente = p_fuente
   group by 1
), grupos as (
  select nit_resuelto,
         min(empresa_id_externo)      as empresa_id_externo,
         min(empresa_nombre_externo)  as empresa_nombre_externo,
         count(*) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0) as listos,
         coalesce(sum(monto_calculado) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0), 0) as total_sin_iva,
         count(*) filter (where estado_tarifa = 'sin_tarifa') as sin_tarifa,
         count(*) filter (where coalesce(cobro_megapaca, 0) > 0) as con_megapaca,
         count(*) filter (where detalle_id is not null) as en_detalle,
         min(fecha_ingreso) as fecha_mas_antigua
    from cola
   where estado_tarifa in ('resuelta', 'sin_tarifa') and nit_resuelto is not null
   group by nit_resuelto
), fact as (
  select nit_resuelto,
         count(*) as facturados,
         count(*) filter (where writeback_estado is null or writeback_estado not in ('confirmado', 'omitido')) as writeback_pendiente,
         count(*) filter (where coalesce(cobro_megapaca, 0) > 0) as con_megapaca
    from vig
   where factura_id is not null
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
  'grupos',     (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from grupos g),
  'facturados', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from fact f),
  'total',      (select count(*) from facturacion_expediente where fuente = p_fuente),
  'excluidos',  (select count(*) from vig where estado_tarifa = 'excluido_psicometrica'),
  'excluidos_no_factura', (select count(*) from vig where estado_tarifa = 'excluido_no_factura'),
  'no_facturan', (select coalesce(jsonb_agg(to_jsonb(n) order by n.expedientes desc, n.empresa_nombre_externo), '[]'::jsonb) from no_facturan n),
  'detalles',   (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from detalles d)
)
$fn$;
