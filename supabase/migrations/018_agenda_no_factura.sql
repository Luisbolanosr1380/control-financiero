-- ============================================================
-- 018 · Agenda: empresas que NO se facturan por este flujo ("no aplica")
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit propio
-- (el runner aporta la transacción). Idempotente. El único "drop" es el del
-- check de estado_tarifa, que se recrea en la misma sentencia lógica para
-- admitir el valor nuevo (no toca datos).
--
-- Por qué: la Agenda trae empresas internas / intercompany (Golden Talent,
-- GTL, Inquilinos…) y de reclutamiento (TALENT TRACK AI / BAC…) que se
-- facturan por la Fase A, no por evaluaciones. Hoy se atascan como "cliente
-- sin mapear". Se reusa el mapeo por empresa (cliente_externo) con una
-- bandera: no_factura = true ⇒ todos sus expedientes (presentes y futuros)
-- quedan en estado 'excluido_no_factura': no se cotizan, no entran a la cola,
-- se cuentan aparte (como las psicométricas). Reversible.
-- ============================================================

alter table cliente_externo add column if not exists no_factura boolean not null default false;
alter table cliente_externo add column if not exists motivo_no_factura text;

-- estado_tarifa admite 'excluido_no_factura' (drop + recreate idempotente del check inline de la 016)
alter table facturacion_expediente drop constraint if exists facturacion_expediente_estado_tarifa_check;
alter table facturacion_expediente add constraint facturacion_expediente_estado_tarifa_check
  check (estado_tarifa in ('resuelta', 'sin_tarifa', 'cliente_sin_mapear', 'excluido_psicometrica', 'excluido_no_factura'));

-- Resumen para la lista (reemplaza la versión de la 017): los excluidos (psicométricas y
-- no_factura) nunca entran a grupos/cola; se cuentan aparte; y se listan las empresas
-- marcadas con su motivo y cuántos expedientes tienen.
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
)
select jsonb_build_object(
  'conteos',    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from conteos c),
  'grupos',     (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from grupos g),
  'facturados', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from fact f),
  'total',      (select count(*) from facturacion_expediente where fuente = p_fuente),
  'excluidos',  (select count(*) from vig where estado_tarifa = 'excluido_psicometrica'),
  'excluidos_no_factura', (select count(*) from vig where estado_tarifa = 'excluido_no_factura'),
  'no_facturan', (select coalesce(jsonb_agg(to_jsonb(n) order by n.expedientes desc, n.empresa_nombre_externo), '[]'::jsonb) from no_facturan n)
)
$fn$;
