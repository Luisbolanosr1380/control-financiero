-- ============================================================
-- 017 · "Por facturar" a escala: agregados en SQL + índices parciales de la cola
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit propio y
-- sin delete/drop (el runner aporta la transacción). Idempotente. Solo lectura
-- (índices y funciones): no toca datos.
--
-- Por qué: la lista /por-facturar traía TODO el espejo (7,878 filas en Golden,
-- ~40 lecturas paginadas) y agrupaba en memoria en cada render. Ahora la
-- pantalla pide dos agregados:
--  · facturacion_agenda_resumen()     → conteos por estado, grupos facturables
--                                       por NIT (listos, total sin IVA, sin tarifa)
--                                       y facturados por NIT. Nunca filas sueltas.
--  · facturacion_agenda_sin_mapear()  → empresas de la Agenda sin mapear,
--                                       agregadas por empresa, con búsqueda y
--                                       paginación (la vista para mapear).
-- "En cola" = terminado, no cancelado, no eliminado, sin factura local y con el
-- cobro PENDIENTE / sin estado en la Agenda (misma regla que enCola() en la app).
-- Las psicométricas nunca se cargan: solo se cuentan.
-- ============================================================

create index if not exists idx_fact_exp_cola
  on facturacion_expediente (fuente, estado_tarifa, nit_resuelto, empresa_id_externo)
  where terminado and not cancelado and not eliminado and factura_id is null;

create index if not exists idx_fact_exp_facturados
  on facturacion_expediente (fuente, nit_resuelto)
  where factura_id is not null;

-- Cobro todavía pendiente del lado de la Agenda (null, vacío, PENDIENTE o SIN_STATUS).
create or replace function facturacion_agenda_cobro_pendiente(s text)
returns boolean
language sql immutable
as $fn$
  select s is null or upper(btrim(s)) in ('', 'PENDIENTE', 'SIN_STATUS')
$fn$;

-- Resumen para la lista: {conteos, grupos, facturados, total, excluidos}
create or replace function facturacion_agenda_resumen(p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with vig as (
  select * from facturacion_expediente
   where fuente = p_fuente and terminado and not cancelado and not eliminado
), cola as (
  select * from vig
   where factura_id is null and estado_tarifa <> 'excluido_psicometrica'
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
)
select jsonb_build_object(
  'conteos',    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from conteos c),
  'grupos',     (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from grupos g),
  'facturados', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from fact f),
  'total',      (select count(*) from facturacion_expediente where fuente = p_fuente),
  'excluidos',  (select count(*) from vig where estado_tarifa = 'excluido_psicometrica')
)
$fn$;

-- Empresas de la Agenda sin mapear (en cola), agregadas por empresa, con búsqueda y paginación.
create or replace function facturacion_agenda_sin_mapear(p_fuente text default 'agenda', p_q text default '', p_limit integer default 25, p_offset integer default 0)
returns jsonb
language sql stable
as $fn$
with cola as (
  select empresa_id_externo, empresa_nombre_externo, fecha_ingreso
    from facturacion_expediente
   where fuente = p_fuente and estado_tarifa = 'cliente_sin_mapear'
     and terminado and not cancelado and not eliminado and factura_id is null
     and facturacion_agenda_cobro_pendiente(status_cobro_externo)
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
