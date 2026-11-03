-- 026 · "Cobrada" en el reporte de producción (025): el estado de la factura se compara SIN espacios
--
-- Por qué: en esta base `facturas_clientes.estado` se guarda a propósito con un espacio al final
-- ("COBRADO ", "COBRADO PARCIAL ", "PENDIENTE "), igual que en Airtable. La 025 comparaba
-- upper(coalesce(estado,'')) contra 'COBRADO' / 'COBRADA' sin btrim, así que casi ninguna factura
-- cobrada contaba como cobrada (Golden: 1,033 líneas "COBRADO " vs 4 "COBRADO") y la columna
-- "cobrado" del reporte salía de menos.
--
-- Qué hace:
--  1. facturacion_factura_cobrada(no_factura): UNA definición de "factura cobrada", la misma que usa
--     la app al cobrar (cobros.ts canoniza con trim + upper y descarta las líneas anuladas/refacturadas):
--       - se canoniza upper(btrim(coalesce(estado,'')))
--       - cobrada = COBRADO / COBRADA
--       - las líneas ANULADO / REFACTURADO de la misma factura no la descalifican (una factura con una
--         línea anulada y el resto cobrado está cobrada); una factura SOLO anulada NO está cobrada
--       - cualquier otra línea (EMITIDA, PENDIENTE, COBRADO PARCIAL, vacío) → no cobrada
--     CONTABILIZADO no existe como estado de factura en estas bases (los estados reales son EMITIDA,
--     PENDIENTE, COBRADO PARCIAL, COBRADO, ANULADO, REFACTURADO; "contabilizado" es de movimientos
--     bancarios / asientos), así que NO cuenta como cobrado. Si algún día aparece, se agrega acá.
--  2. facturacion_produccion_mensual: mismo cuerpo que la 025, solo cambia `cobrada` para usar la función.
--
-- Idempotente; sin drop, delete, truncate, begin/commit. No toca tablas ni datos.
-- Depende de la 025 (recrea la RPC que la 025 definió).

-- ── 1. Definición única de "factura cobrada" ─────────────────────────────────────────────────────
create or replace function facturacion_factura_cobrada(p_no_factura text)
returns boolean
language sql stable
as $fn$
  select p_no_factura is not null
     and exists (select 1 from facturas_clientes f
                  where f.no_factura = p_no_factura
                    and upper(btrim(coalesce(f.estado, ''))) in ('COBRADO', 'COBRADA'))
     and not exists (select 1 from facturas_clientes f
                      where f.no_factura = p_no_factura
                        and upper(btrim(coalesce(f.estado, ''))) not in ('COBRADO', 'COBRADA', 'ANULADO', 'ANULADA', 'REFACTURADO', 'REFACTURADA'))
$fn$;

comment on function facturacion_factura_cobrada(text) is
  '026: true si todas las líneas vivas (no ANULADO/REFACTURADO) de la factura están COBRADO/COBRADA, comparando upper(btrim(estado)). Al menos una línea cobrada.';

-- ── 2. Reporte de producción por mes (025) con la definición nueva de "cobrada" ──────────────────
create or replace function facturacion_produccion_mensual(p_desde date, p_hasta date, p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with base as (
  select c.id, c.servicio, facturacion_linea_negocio(c.servicio) as linea, c.situacion, c.estado_tarifa,
         coalesce(c.monto_calculado, 0) as monto, c.factura_id, c.no_factura, c.fecha_resultado, c.fecha_resultado_fuente,
         (c.fecha_resultado at time zone 'America/Guatemala')::date as dia,
         to_char(c.fecha_resultado at time zone 'America/Guatemala', 'YYYY-MM') as mes,
         e.nit_resuelto, coalesce(nullif(e.empresa_nombre_externo, ''), e.empresa_id_externo, '—') as empresa, e.fecha_ingreso,
         (c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0) as con_precio,
         e.fuente as e_fuente, e.empresa_id_externo, e.status_cobro_externo, e.estatus_pago_externo, e.terminado, e.cancelado
    from facturacion_componente c
    join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and c.situacion in ('cobra', 'no_cobra')
     and not e.eliminado and e.estado_tarifa not in ('excluido_psicometrica', 'excluido_no_factura')
), fact as (
  -- monto de la línea de factura de cada prueba facturada (024: componente_id; antes: el monto calculado) y si su factura está cobrada
  -- 026: "cobrada" = facturacion_factura_cobrada (upper(btrim(estado)); las líneas anuladas no descalifican)
  select b.id,
         coalesce((select d.monto from factura_detalle_expediente d where d.componente_id = b.id order by d.id limit 1), b.monto) as monto_facturado,
         facturacion_factura_cobrada(b.no_factura) as cobrada
    from base b where b.factura_id is not null
), r as (
  -- solo las del rango: acá se evalúa "en cola" (cobro pendiente + arranque + terminado si el servicio lo exige), no por cada fila del espejo
  select b.*, coalesce(f.monto_facturado, 0) as monto_facturado, coalesce(f.cobrada, false) as cobrada,
         ((now() at time zone 'America/Guatemala')::date - b.dia) as dias,
         (b.factura_id is null
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
         count(*) filter (where situacion = 'cobra' and factura_id is null and en_cola) as backlog_n,
         coalesce(sum(monto) filter (where situacion = 'cobra' and factura_id is null and en_cola and con_precio), 0) as backlog_q,
         round(avg(dias) filter (where situacion = 'cobra' and factura_id is null and en_cola)) as backlog_dias_prom,
         max(dias) filter (where situacion = 'cobra' and factura_id is null and en_cola) as backlog_dias_max,
         count(*) filter (where situacion = 'cobra' and factura_id is null and not en_cola) as fuera_cola_n,
         coalesce(sum(monto) filter (where situacion = 'cobra' and factura_id is null and not en_cola and con_precio), 0) as fuera_cola_q,
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
