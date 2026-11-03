-- 027 · MAPA DE PRECIOS (solo admin): RPC de SOLO LECTURA `precios_mapa` + artículo de ayuda
--
-- Por qué: el CFO hizo la revisión de precios 2026 en un tablero externo y la quiere dentro de
-- Finanzas, visible solo para las cuentas admin (muestra el precio y la brecha de cada cliente).
--
-- Qué hace:
--  1. precios_mapa(p_desde, p_hasta, p_umbral_vol, p_umbral_idx) → jsonb { parametros, clientes, franjas,
--     referencias, servicios, resumen }. Son las consultas del tablero (Anexo del brief) con las fechas y
--     los umbrales como parámetros. `stable`, no escribe nada.
--     Base común: componentes situacion='cobra', estado_tarifa='resuelta', monto_calculado > 0; expediente
--     no eliminado y con nit_resuelto; fecha_ingreso dentro del rango; montos SIN IVA.
--     · clientes: benchmark = mediana (entre clientes) del precio promedio por (servicio, categoría;
--       categoría nula = 'UNICA'); produccion_mercado = Σ referencia de cada prueba; indice = prod / prod_mercado;
--       brecha = max(prod_mercado − prod, 0); cuadrante por (pruebas ≥ umbral_vol, indice ≥ umbral_idx).
--     · resumen: totales, participación top 5/10/20, brecha total, mayor cliente / mayor brecha / mayor índice,
--       y por cuadrante clientes/pruebas/producción/brecha con su % del total (los 4 cuadrantes siempre).
--     · referencias: min, p25, mediana, p75, max del TARIFARIO activo (precio promedio por cliente) y el precio
--       real cobrado en el periodo, para las seis líneas del tablero.
--     · franjas: polígrafo y socio PRE EMPLEO; cada cliente cae en Bajo (< p25), Medio o Alto (> p75) según su
--       precio cobrado promedio (las 6 celdas siempre, en cero si no hay nadie).
--     · servicios: pruebas, producción y precio promedio por servicio.
--  2. Permisos: se le quita execute a public, anon y authenticated y se le da solo a service_role. La app la
--     llama desde el servidor (SUPABASE_SERVICE_KEY) tras validar rol admin; desde el navegador con la llave
--     pública falla con "permission denied".
--  3. Artículo de ayuda "Mapa de precios" (categoría Configuración), upsert por slug.
--
-- Idempotente; sin drop, delete, truncate, update de datos de negocio, begin/commit. No toca tarifario,
-- facturación ni la definición de "cobrada" (026). Depende de la 024 (facturacion_componente).

create or replace function precios_mapa(p_desde date default '2026-01-01', p_hasta date default null, p_umbral_vol int default 60, p_umbral_idx numeric default 1.0)
returns jsonb
language sql stable
as $fn$
with c as (
  select e.nit_resuelto nit, c.servicio, coalesce(c.categoria, 'UNICA') cat, c.categoria cat_raw, c.monto_calculado m
    from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
   where c.situacion = 'cobra' and not e.eliminado and e.nit_resuelto is not null
     and c.estado_tarifa = 'resuelta' and c.monto_calculado > 0
     and e.fecha_ingreso >= p_desde and (p_hasta is null or e.fecha_ingreso <= p_hasta)
), bm as (
  -- benchmark: mediana entre clientes del precio promedio de cada cliente por (servicio, categoría)
  select servicio, cat, (percentile_cont(0.5) within group (order by p))::numeric ref
    from (select nit, servicio, cat, avg(m) p from c group by 1, 2, 3) x group by 1, 2
), cli as (
  select c.nit, count(*) pruebas,
         count(*) filter (where c.servicio like 'POLIGRAFO%') poligrafos,
         count(*) filter (where c.servicio like 'SOCIO%') socios,
         sum(c.m) prod, sum(bm.ref) prod_ref
    from c join bm using (servicio, cat) group by c.nit
), cl as (
  select coalesce((select btrim(x.nombre_empresa) from clientes x where x.nit = cli.nit and x.activo limit 1), 'NIT ' || cli.nit) cliente,
         cli.nit, cli.pruebas, cli.poligrafos, cli.socios,
         round(cli.prod, 2) produccion, round(cli.prod_ref, 2) produccion_mercado,
         round(cli.prod / cli.prod_ref, 3) indice,
         round(greatest(cli.prod_ref - cli.prod, 0), 2) brecha,
         round(cli.prod / cli.pruebas, 2) precio_efectivo,
         case when cli.pruebas >= p_umbral_vol and cli.prod / cli.prod_ref >= p_umbral_idx then 'Estrellas'
              when cli.pruebas >= p_umbral_vol then 'Volumen con descuento'
              when cli.prod / cli.prod_ref >= p_umbral_idx then 'Premium de nicho'
              else 'Por revisar' end cuadrante,
         row_number() over (order by cli.prod desc, cli.nit) rn
    from cli where cli.prod > 0
), tot as (
  select coalesce(sum(produccion), 0) prod, count(*) n, coalesce(sum(pruebas), 0) pruebas, coalesce(sum(brecha), 0) brecha from cl
), cuad as (
  select q.cuadrante, count(cl.nit) clientes, coalesce(sum(cl.pruebas), 0) pruebas,
         coalesce(sum(cl.produccion), 0) produccion, coalesce(sum(cl.brecha), 0) brecha
    from (values ('Estrellas'), ('Volumen con descuento'), ('Premium de nicho'), ('Por revisar')) q(cuadrante)
    left join cl on cl.cuadrante = q.cuadrante
   group by q.cuadrante
), lista as (
  -- tarifario activo: precio promedio por cliente y (servicio, categoría)
  select tipo_prueba servicio, categoria, nit, avg(monto) p from tarifario where activo and monto > 0 group by 1, 2, 3
), st as (
  select servicio, categoria, count(*) clientes, min(p) minimo,
         (percentile_cont(0.25) within group (order by p))::numeric p25,
         (percentile_cont(0.5) within group (order by p))::numeric mediana,
         (percentile_cont(0.75) within group (order by p))::numeric p75,
         max(p) maximo
    from lista group by 1, 2
), vol as (
  select servicio, cat_raw categoria, count(*) pruebas, sum(m) / count(*) precio_real from c group by 1, 2
), refs as (
  select s.servicio, s.categoria, s.clientes,
         round(s.minimo, 2) minimo, round(s.p25, 2) p25, round(s.mediana, 2) mediana, round(s.p75, 2) p75, round(s.maximo, 2) maximo,
         coalesce(v.pruebas, 0) pruebas, round(v.precio_real, 2) precio_real
    from st s left join vol v on v.servicio = s.servicio and v.categoria is not distinct from s.categoria
   where (s.servicio, s.categoria) in (('POLIGRAFO', 'PRE EMPLEO'), ('POLIGRAFO', 'RUTINA'), ('POLIGRAFO', 'ESPECIFICO'),
                                       ('POLIGRAFO BASIC', 'PRE EMPLEO'), ('SOCIOECONOMICO', 'PRE EMPLEO'), ('SOCIOECONOMICO', 'RUTINA'))
), fl as (
  select servicio, categoria, p25, p75 from st where servicio in ('POLIGRAFO', 'SOCIOECONOMICO') and categoria = 'PRE EMPLEO'
), cobro as (
  select nit, servicio, cat_raw categoria, count(*) n, sum(m) m, avg(m) p
    from c where servicio in ('POLIGRAFO', 'SOCIOECONOMICO') and cat_raw = 'PRE EMPLEO' group by 1, 2, 3
), fb as (
  select r.servicio, r.nit, r.n, r.m, case when r.p < l.p25 then 1 when r.p <= l.p75 then 2 else 3 end orden
    from cobro r join fl l on l.servicio = r.servicio and l.categoria = r.categoria
), franjas as (
  select s.servicio, o.orden, case o.orden when 1 then 'Bajo' when 2 then 'Medio' else 'Alto' end franja,
         round(l.p25, 2) p25, round(l.p75, 2) p75,
         count(fb.nit) clientes, coalesce(sum(fb.n), 0) pruebas, round(coalesce(sum(fb.m), 0), 2) produccion
    from (values ('POLIGRAFO'), ('SOCIOECONOMICO')) s(servicio)
   cross join (values (1), (2), (3)) o(orden)
    left join fl l on l.servicio = s.servicio
    left join fb on fb.servicio = s.servicio and fb.orden = o.orden
   group by s.servicio, o.orden, l.p25, l.p75
), servicios as (
  select servicio, count(*) pruebas, round(sum(m), 2) produccion, round(sum(m) / count(*), 2) precio_promedio from c group by servicio
)
select jsonb_build_object(
  'parametros', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'umbral_vol', p_umbral_vol, 'umbral_idx', p_umbral_idx,
                                   'hoy', (now() at time zone 'America/Guatemala')::date),
  'clientes', (select coalesce(jsonb_agg(to_jsonb(x) - 'rn' order by x.rn), '[]'::jsonb) from cl x),
  'franjas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.servicio, x.orden), '[]'::jsonb) from franjas x),
  'referencias', (select coalesce(jsonb_agg(to_jsonb(x) order by x.pruebas desc, x.servicio, x.categoria), '[]'::jsonb) from refs x),
  'servicios', (select coalesce(jsonb_agg(to_jsonb(x) order by x.produccion desc, x.servicio), '[]'::jsonb) from servicios x),
  'resumen', (select jsonb_build_object(
      'produccion', t.prod, 'pruebas', t.pruebas, 'clientes', t.n, 'brecha', t.brecha,
      'top5',  coalesce((select round(sum(produccion) / nullif(t.prod, 0) * 100, 1) from cl where rn <= 5), 0),
      'top10', coalesce((select round(sum(produccion) / nullif(t.prod, 0) * 100, 1) from cl where rn <= 10), 0),
      'top20', coalesce((select round(sum(produccion) / nullif(t.prod, 0) * 100, 1) from cl where rn <= 20), 0),
      'mayor_cliente', (select to_jsonb(x) - 'rn' from cl x where x.rn = 1),
      'mayor_brecha',  (select to_jsonb(x) - 'rn' from cl x order by x.brecha desc, x.rn limit 1),
      'mayor_indice',  (select to_jsonb(x) - 'rn' from cl x order by x.indice desc, x.rn limit 1),
      'cuadrantes', (select jsonb_agg(jsonb_build_object(
                       'cuadrante', q.cuadrante, 'clientes', q.clientes, 'pruebas', q.pruebas, 'produccion', q.produccion, 'brecha', q.brecha,
                       'pct_clientes',   coalesce(round(q.clientes::numeric / nullif(t.n, 0) * 100, 1), 0),
                       'pct_pruebas',    coalesce(round(q.pruebas::numeric / nullif(t.pruebas, 0) * 100, 1), 0),
                       'pct_produccion', coalesce(round(q.produccion / nullif(t.prod, 0) * 100, 1), 0),
                       'pct_brecha',     coalesce(round(q.brecha / nullif(t.brecha, 0) * 100, 1), 0))
                     order by q.produccion desc, q.cuadrante) from cuad q)
    ) from tot t)
)
$fn$;

comment on function precios_mapa(date, date, int, numeric) is
  '027: mapa de precios del CFO (benchmark por mediana, cuadrantes, brecha, referencias del tarifario, franjas preempleo, producción por servicio). Solo lectura. Solo service_role: la app valida rol admin antes de llamarla.';

-- Solo el servidor (service_role) puede ejecutarla: nunca desde el navegador con la llave pública.
revoke all on function precios_mapa(date, date, int, numeric) from public;
revoke all on function precios_mapa(date, date, int, numeric) from anon, authenticated;
grant execute on function precios_mapa(date, date, int, numeric) to service_role;

-- Ayuda: artículo corto (Configuración). Upsert por slug: re-aplicar la migración actualiza el texto.
insert into ayuda (titulo, slug, categoria, descripcion_corta, contenido, orden, activo, tags_contextuales)
values (
  'Mapa de precios — cuánto vale cada cliente frente al mercado (solo admin)',
  'mapa-de-precios-solo-admin',
  'Configuración',
  'La herramienta del CFO para la revisión de precios: índice de cada cliente contra la mediana del mercado, cuadrantes por volumen y precio, brecha y franjas de preempleo. Solo lo ven las cuentas admin.',
  E'## Qué es\n\nEl **Mapa de precios** (Admin → Mapa de precios) muestra cuánto vale cada cliente **a su tarifa** comparado con la **mediana del mercado**: lo que cobran los demás clientes por el mismo servicio y categoría. **Es solo para admin**: muestra el precio y la brecha de cada cliente, así que nadie más lo ve en su menú ni puede abrirlo por URL.\n\n## Qué responde\n\n- **Índice de precio** de cada cliente = su producción ÷ lo que valdría esa misma producción a precio de mercado. 1.00 = paga la mediana; 0.50 = paga la mitad.\n- **Cuadrante** según volumen (pruebas) e índice: *Estrellas* (mucho volumen, buen precio), *Volumen con descuento* (mucho volumen, precio bajo), *Premium de nicho* (poco volumen, buen precio) y *Por revisar* (poco volumen y precio bajo). Los umbrales (60 pruebas, índice 1.00) se pueden cambiar arriba.\n- **Brecha**: cuánto se deja sobre la mesa por cobrar debajo de la mediana, en total y por cliente (top 15).\n- **Rangos de precio por línea**: mínimo, p25, mediana, p75 y máximo del tarifario activo, con el precio real cobrado en el periodo. Se ven sin IVA y con IVA.\n- **Franjas preempleo**: cuántos clientes, pruebas y producción caen en Bajo (< p25), Medio y Alto (> p75) para polígrafo y para socio.\n- **Tabla de clientes**: ordenable, con buscador, filtro por cuadrante y exportación a CSV; el nombre lleva al tarifario del cliente.\n\n## Cómo se calcula\n\n1. Solo cuentan las **pruebas que cobran** con **tarifa resuelta** (precio > 0) de expedientes vigentes con NIT, ingresadas en el rango de fechas elegido (por defecto, el año completo). Las pruebas sin tarifa **no entran**: ver *Por facturar*.\n2. Para cada (servicio, categoría) se toma el precio promedio de cada cliente y la **mediana** entre clientes es la referencia de mercado. La categoría vacía cuenta como ÚNICA.\n3. Todos los montos son **sin IVA** (los del tarifario). El interruptor "con IVA" solo multiplica por 1.12 para leerlos como en la factura.\n\n> **Tip:** cambiá el umbral de volumen para ver cómo se mueven los clientes entre cuadrantes antes de decidir con quién negociar. Un cliente con índice bajo y mucha brecha es el primer candidato de la revisión de precios.',
  35, true, 'precios, mapa de precios, benchmark, mediana, cuadrantes, brecha, tarifario, admin, configuracion'
)
on conflict (slug) do update set
  titulo = excluded.titulo, categoria = excluded.categoria, descripcion_corta = excluded.descripcion_corta,
  contenido = excluded.contenido, orden = excluded.orden, activo = excluded.activo,
  tags_contextuales = excluded.tags_contextuales, updated_at = now();
