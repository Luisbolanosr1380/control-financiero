-- ============================================================
-- 022 · Corte de arranque por cliente: cliente_externo.facturar_desde
--
-- Corre en AMBAS bases. Una columna nullable + funciones (create or replace).
-- Sin begin/commit propio, sin drop/delete. No toca datos: el corte de cada
-- cliente se SETEA aparte (GENESIS: '2026-08-01' en sus filas de cliente_externo).
--
-- Por qué: Fundación Génesis (NIT 11854243) facturó históricamente por provisión
-- mensual; todo lo de julio 2026 para atrás ya está cubierto y no debe contar como
-- "por facturar" (no solo lo PAGADO —021—: TODO el histórico de ese periodo). De
-- agosto en adelante sigue en la cola normal. En vez de clavar NIT + fecha en el SQL,
-- cada cliente puede tener una fecha de arranque: la cola excluye los expedientes
-- con fecha_ingreso ANTERIOR a facturar_desde de su empresa (empresa_id_externo).
-- Sirve para cualquier otro cliente migrado con un arranque. Las filas excluidas
-- SIGUEN en la data (conciliación); solo salen del conteo y de las listas.
--
-- Durable y a prueba de sync: vive en cliente_externo (el sync no escribe esa tabla
-- y los upserts del mapeo no incluyen la columna). Vale también para una empresa
-- SIN mapear: basta una fila de cliente_externo con nit '' / activo false y la fecha.
-- La app replica la regla al leer (anotarArranque / enCola) y en el filtro PostgREST.
-- ============================================================

alter table cliente_externo add column if not exists facturar_desde date;
comment on column cliente_externo.facturar_desde is 'Arranque de la facturación por este flujo: los expedientes con fecha_ingreso anterior quedan fuera de la cola (histórico ya cubierto, p. ej. provisión). null = sin corte.';

-- true si el expediente NO queda fuera por el corte de arranque de su empresa (sin fecha de ingreso → no se excluye).
create or replace function facturacion_agenda_en_arranque(p_fuente text, p_empresa text, p_fecha date)
returns boolean
language sql stable
as $fn$
  select not exists (
    select 1 from cliente_externo m
     where m.fuente = p_fuente and m.empresa_id_externo = p_empresa
       and m.facturar_desde is not null and p_fecha is not null and p_fecha < m.facturar_desde
  )
$fn$;

-- Resumen para la lista (misma definición que la 021, con el corte de arranque en la cola).
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
     and facturacion_agenda_cobro_pendiente(status_cobro_externo, estatus_pago_externo)
     and facturacion_agenda_en_arranque(fuente, empresa_id_externo, fecha_ingreso)
), conteos as (
  select e.estado_tarifa,
         count(*) as total,
         count(*) filter (where e.terminado and not e.cancelado and not e.eliminado and e.factura_id is null
                            and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
                            and facturacion_agenda_en_arranque(e.fuente, e.empresa_id_externo, e.fecha_ingreso)) as en_cola,
         count(distinct e.empresa_id_externo) filter (where e.terminado and not e.cancelado and not e.eliminado and e.factura_id is null
                            and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
                            and facturacion_agenda_en_arranque(e.fuente, e.empresa_id_externo, e.fecha_ingreso)) as empresas_en_cola
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

-- Empresas de la Agenda sin mapear (en cola), agregadas por empresa (misma definición que la 021, con el corte de arranque).
create or replace function facturacion_agenda_sin_mapear(p_fuente text default 'agenda', p_q text default '', p_limit integer default 25, p_offset integer default 0)
returns jsonb
language sql stable
as $fn$
with cola as (
  select empresa_id_externo, empresa_nombre_externo, fecha_ingreso
    from facturacion_expediente
   where fuente = p_fuente and estado_tarifa = 'cliente_sin_mapear'
     and terminado and not cancelado and not eliminado and factura_id is null
     and facturacion_agenda_cobro_pendiente(status_cobro_externo, estatus_pago_externo)
     and facturacion_agenda_en_arranque(fuente, empresa_id_externo, fecha_ingreso)
), emp as (
  select empresa_id_externo,
         min(empresa_nombre_externo) as empresa_nombre_externo,
         count(*)                    as expedientes,
         min(fecha_ingreso)          as fecha_mas_antigua,
         max(fecha_ingreso)          as fecha_mas_reciente
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
