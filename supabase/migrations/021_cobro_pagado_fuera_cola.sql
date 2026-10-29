-- ============================================================
-- 021 · "Cobro pendiente" respeta estatusPago = PAGADO (lo ya pagado sale de la cola)
--
-- Corre en AMBAS bases. Solo funciones: sin tabla nueva, sin begin/commit propio,
-- sin drop/delete. Idempotente (create or replace). No toca datos ni escribe a la
-- Agenda: solo deja de CONTAR lo que ya está pagado.
--
-- Por qué: la cola marcaba "cobro pendiente" mirando solo status_cobro_externo e
-- ignoraba estatus_pago_externo. Fundación Génesis paga por provisión mensual: en
-- la Agenda cobro.statusCobro queda PENDIENTE pero cobro.estatusPago = PAGADO, así
-- que servicios ya pagados seguían sumando "por facturar" (81 filas / Q36,450 en
-- Golden al 2026-10-29; 80 de GENESIS). Las filas siguen en la data (conciliación);
-- solo salen del total. A prueba de sync: estatus_pago_externo viene del raw.
--
-- Regla: en cola = (status pendiente: null / '' / PENDIENTE / SIN_STATUS)
--                  Y (pago distinto de PAGADO; null y 'NO PAGADO' SÍ siguen en cola).
-- La app replica la misma regla en enCola() (puro) y en el filtro PostgREST.
-- ============================================================

-- Variante de dos argumentos: status de cobro + estatus de pago.
create or replace function facturacion_agenda_cobro_pendiente(s_status text, s_pago text)
returns boolean
language sql immutable
as $fn$
  select (s_status is null or upper(btrim(s_status)) in ('', 'PENDIENTE', 'SIN_STATUS'))
         and upper(btrim(coalesce(s_pago, ''))) <> 'PAGADO'   -- igualdad exacta: 'NO PAGADO' NO matchea
$fn$;

-- Compat: la de un argumento sigue existiendo y delega asumiendo pago desconocido.
create or replace function facturacion_agenda_cobro_pendiente(s text)
returns boolean
language sql immutable
as $fn$
  select facturacion_agenda_cobro_pendiente(s, null)
$fn$;

-- Resumen para la lista (misma definición que la 019, con la cola pasando AMBOS campos).
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
), conteos as (
  select e.estado_tarifa,
         count(*) as total,
         count(*) filter (where e.terminado and not e.cancelado and not e.eliminado and e.factura_id is null
                            and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)) as en_cola,
         count(distinct e.empresa_id_externo) filter (where e.terminado and not e.cancelado and not e.eliminado and e.factura_id is null
                            and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)) as empresas_en_cola
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

-- Empresas de la Agenda sin mapear (en cola), agregadas por empresa (misma definición que la 017, cola con AMBOS campos).
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
