-- ============================================================
-- 025 · Fecha de resultado por PRUEBA + producción por mes de terminación
--
-- Corre en AMBAS bases (primero HIT y verificar). Idempotente: if not exists / create or
-- replace. Sin begin/commit propio. Sin delete/truncate/drop de tablas ni de funciones.
-- Depende de la 024 (facturacion_componente).
--
-- Por qué: hoy todo se mide por fecha_ingreso, pero un socio entra hoy y termina 15 días
-- después. El CFO necesita saber EN QUÉ MES SE TERMINÓ cada prueba (producción real) y
-- compararlo con lo facturado y lo cobrado de ese mes. `fechaEntrega` de la Agenda es UNA
-- por expediente (en un COMPLETO el polígrafo termina antes que el socio), solo viene en el
-- 35 % de los terminados y a veces es anterior al ingreso; y el webhook no guardaba qué
-- expediente cambió ni qué cambió, así que el momento real de cada cambio se perdía.
--
--  1. facturacion_expediente.fecha_resultado_poligrafo / fecha_resultado_socio: espejo de los
--     campos nuevos que la Agenda va a mandar (nombres TENTATIVOS `fechaResultadoPoligrafo` /
--     `fechaResultadoSocio`; el sync los llena; backfill desde `raw` si ya llegaron).
--  2. facturacion_componente.fecha_resultado + fecha_resultado_fuente
--     (agenda | fecha_entrega | detectado | sin_dato). Regla, en orden (la primera que exista gana):
--       agenda        → el campo de la Agenda de ESA prueba. Siempre gana (es la fecha real),
--                       incluso sobre una prueba ya facturada.
--       detectado     → el momento en que ESTE sistema vio la prueba pasar a cobra / no_cobra:
--                       el `ocurrido` del aviso que trajo el cambio, o si llegó por sync, el
--                       `actualizadoEn` del expediente. Se fija UNA vez; no se pisa con syncs
--                       posteriores (solo la reemplaza la fuente agenda).
--       fecha_entrega → solo para el backfill histórico y solo si es confiable: expediente
--                       terminado, fecha_entrega >= fecha_ingreso y el expediente es de UNA
--                       sola prueba (en un COMPLETO no sirve para el polígrafo). Para otros
--                       servicios (INFORNET, MIDOT, BACKGROUND, PDA…) vale la del terminado.
--       sin_dato      → no hay nada confiable. Se cuenta aparte en el reporte; nunca se inventa.
--     Una fecha anterior a fecha_ingreso NO se usa (cae a la siguiente fuente). Las pruebas
--     `pendiente` quedan en null. Una prueba facturada conserva su fecha (facturar no la toca);
--     re-resolver y sync nunca borran una fecha ya fijada.
--     La app calcula la candidata en el mismo paso que la `situacion` (fecha-resultado.ts) y la
--     RPC facturacion_componentes_sincronizar aplica la regla de "no pisar".
--  3. facturacion_webhook_evento.id_externo + cambios (solo el bloque `cambios` del aviso:
--     campo / antes / después; sin datos personales extra) + índice (fuente, id_externo, ocurrido).
--  4. facturacion_fecha_resultado_backfill(p_fuente): fija la fuente de las pruebas que todavía
--     no la tienen (agenda → fecha_entrega confiable → sin_dato). Se corre una vez acá; es
--     idempotente (solo toca filas con fuente null) y la usan las pruebas del validador.
--  5. facturacion_produccion_mensual(p_desde, p_hasta, p_fuente): producción por mes de
--     fecha_resultado (zona America/Guatemala): terminado (con precio / sin tarifa), facturado,
--     cobrado, backlog (con antigüedad), fuera de la cola (resuelto del lado de la Agenda:
--     pagado / facturado fuera / antes del arranque), no se cobra, sin fecha; cortes por línea
--     de negocio (polígrafo / socio / otros) y por cliente.
-- No se toca: la regla de situacion (024), la cola, la emisión, el write-back, los cortes
-- 021/022, el tarifario.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Expediente: espejo de las fechas de resultado que manda la Agenda (nombres tentativos)
-- ------------------------------------------------------------
alter table facturacion_expediente add column if not exists fecha_resultado_poligrafo timestamptz;
alter table facturacion_expediente add column if not exists fecha_resultado_socio timestamptz;
comment on column facturacion_expediente.fecha_resultado_poligrafo is 'fechaResultadoPoligrafo de la Agenda (nombre tentativo): cuándo estadoPoligrafo pasó a APROBO / NO APROBO / APROBO CON PREGUNTA MODIFICADA. El sync lo llena.';
comment on column facturacion_expediente.fecha_resultado_socio is 'fechaResultadoSocio de la Agenda (nombre tentativo): cuándo estadoSocio pasó a SOCIO-COMPLETO / AUDITADO-QA / visita o entrevista realizada. El sync lo llena.';

-- Backfill desde raw si los campos ya llegaron (texto ISO; un valor no parseable se ignora).
update facturacion_expediente e
   set fecha_resultado_poligrafo = case when (raw->>'fechaResultadoPoligrafo') ~ '^\d{4}-\d{2}-\d{2}' then (raw->>'fechaResultadoPoligrafo')::timestamptz end,
       fecha_resultado_socio     = case when (raw->>'fechaResultadoSocio') ~ '^\d{4}-\d{2}-\d{2}' then (raw->>'fechaResultadoSocio')::timestamptz end
 where fuente = 'agenda' and raw is not null and fecha_resultado_poligrafo is null and fecha_resultado_socio is null
   and ((raw->>'fechaResultadoPoligrafo') ~ '^\d{4}-\d{2}-\d{2}' or (raw->>'fechaResultadoSocio') ~ '^\d{4}-\d{2}-\d{2}');

-- ------------------------------------------------------------
-- 2. Prueba: fecha de resultado + fuente
-- ------------------------------------------------------------
alter table facturacion_componente add column if not exists fecha_resultado timestamptz;
alter table facturacion_componente add column if not exists fecha_resultado_fuente text;
alter table facturacion_componente drop constraint if exists facturacion_componente_fecha_resultado_fuente_check;
alter table facturacion_componente add constraint facturacion_componente_fecha_resultado_fuente_check
  check (fecha_resultado_fuente is null or fecha_resultado_fuente in ('agenda', 'fecha_entrega', 'detectado', 'sin_dato'));
comment on column facturacion_componente.fecha_resultado is 'Cuándo la prueba tuvo resultado (cobra / no_cobra). null = pendiente o sin dato confiable. Nunca se inventa.';
comment on column facturacion_componente.fecha_resultado_fuente is 'De dónde salió la fecha: agenda (campo real, siempre gana) | detectado (primera vez que este sistema vio el cambio: ocurrido del aviso o actualizadoEn del sync; se fija una vez) | fecha_entrega (backfill histórico confiable) | sin_dato.';
create index if not exists idx_fact_comp_fecha_resultado on facturacion_componente (fuente, situacion, fecha_resultado) where situacion in ('cobra', 'no_cobra');

-- ------------------------------------------------------------
-- 3. Webhook: qué expediente y qué cambió (solo el bloque `cambios` del aviso)
-- ------------------------------------------------------------
alter table facturacion_webhook_evento add column if not exists id_externo text;
alter table facturacion_webhook_evento add column if not exists cambios jsonb;
comment on column facturacion_webhook_evento.cambios is 'Bloque `cambios` del aviso tal como lo normaliza la app: [{campo, antes, despues}]. Sin datos personales extra.';
create index if not exists idx_fact_webhook_externo on facturacion_webhook_evento (fuente, id_externo, ocurrido);

-- Línea de negocio del CFO por servicio (igual que lineaNegocio() en la app).
create or replace function facturacion_linea_negocio(p_servicio text)
returns text
language sql immutable
as $fn$
  select case
    when upper(coalesce(p_servicio, '')) in ('POLIGRAFO', 'POLIGRAFO BASIC') then 'poligrafo'
    when upper(coalesce(p_servicio, '')) in ('SOCIOECONOMICO', 'SOCIOECONOMICO VIRTUAL', 'SOCIOECONOMICO EMPRESARIAL', 'FEE VISITA SOCIO CANCELADO', 'VISITA DOMICILIAR') then 'socio'
    else 'otros' end
$fn$;

-- ------------------------------------------------------------
-- 4. Backfill de la fuente para las pruebas que todavía no la tienen (idempotente).
--    agenda (campo del expediente, >= ingreso) → fecha_entrega confiable → sin_dato.
--    Solo pruebas cobra / no_cobra; las pendientes quedan en null.
-- ------------------------------------------------------------
create or replace function facturacion_fecha_resultado_backfill(p_fuente text default 'agenda')
returns integer
language plpgsql
as $fn$
declare
  n integer := 0;
begin
  update facturacion_componente c
     set fecha_resultado = u.fecha, fecha_resultado_fuente = u.fuente_fecha, updated_at = now()
    from (
      select c.id,
             case when ag.f is not null then ag.f
                  when ent.ok then ent.f
                  else null end as fecha,
             case when ag.f is not null then 'agenda'
                  when ent.ok then 'fecha_entrega'
                  else 'sin_dato' end as fuente_fecha
        from facturacion_componente c
        join facturacion_expediente e on e.id = c.expediente_id
        cross join lateral (
          select case when facturacion_linea_negocio(c.servicio) = 'poligrafo' then e.fecha_resultado_poligrafo
                      when facturacion_linea_negocio(c.servicio) = 'socio' then e.fecha_resultado_socio
                      else null end as f0
        ) a0
        cross join lateral (
          select case when a0.f0 is not null and (e.fecha_ingreso is null or (a0.f0 at time zone 'America/Guatemala')::date >= e.fecha_ingreso) then a0.f0 end as f
        ) ag
        cross join lateral (
          select (e.fecha_entrega::timestamp at time zone 'America/Guatemala') as f,
                 (e.terminado and e.fecha_entrega is not null and (e.fecha_ingreso is null or e.fecha_entrega >= e.fecha_ingreso)
                    and (not facturacion_servicio_por_estado(c.servicio)
                         or (select count(*) from facturacion_componente x where x.expediente_id = c.expediente_id) = 1)) as ok
        ) ent
       where c.fuente = p_fuente and c.fecha_resultado_fuente is null and c.situacion in ('cobra', 'no_cobra')
    ) u
   where u.id = c.id;
  get diagnostics n = row_count;
  return n;
end
$fn$;

-- ------------------------------------------------------------
-- RPC de sincronización (024) con la fecha de resultado.
-- p_items: [{ id_externo, componentes: [{ servicio, estado_prueba, situacion, motivo, categoria, territorio,
--            monto_calculado, estado_tarifa, detalle_tarifa, tarifario_id, aprobada,
--            fecha_resultado, fecha_resultado_fuente }] }]
-- Regla de la fecha al actualizar una prueba existente:
--   · fuente 'agenda' con fecha → gana siempre (también sobre pruebas facturadas; es la fecha real).
--   · ya tiene fecha → se conserva (nunca se borra ni se pisa).
--   · no tenía fuente, o estaba pendiente y ahora cobra / no_cobra → se fija la candidata de la app
--     (detectado / fecha_entrega / sin_dato). Si ya tenía fuente (p. ej. sin_dato del backfill) y
--     la situación no cambió, no se inventa un 'detectado' tardío.
-- Nunca pisa detalle_id / factura_id / facturado_*: igual que en la 024.
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
      insert into facturacion_componente (expediente_id, fuente, id_externo, servicio, estado_prueba, situacion, motivo, categoria, territorio, monto_calculado, estado_tarifa, detalle_tarifa, tarifario_id, aprobada, fecha_resultado, fecha_resultado_fuente)
      values (v_exp, p_fuente, it->>'id_externo', c->>'servicio', nullif(c->>'estado_prueba', ''), coalesce(c->>'situacion', 'pendiente'), nullif(c->>'motivo', ''),
              nullif(c->>'categoria', ''), nullif(c->>'territorio', ''), (c->>'monto_calculado')::numeric, coalesce(c->>'estado_tarifa', 'sin_tarifa'), nullif(c->>'detalle_tarifa', ''),
              nullif(c->>'tarifario_id', '')::uuid, (c->>'aprobada')::boolean,
              case when coalesce(c->>'situacion', 'pendiente') in ('cobra', 'no_cobra') then nullif(c->>'fecha_resultado', '')::timestamptz end,
              case when coalesce(c->>'situacion', 'pendiente') in ('cobra', 'no_cobra') then coalesce(nullif(c->>'fecha_resultado_fuente', ''), 'sin_dato') end)
      on conflict (expediente_id, servicio) do update
        set estado_prueba = excluded.estado_prueba, situacion = excluded.situacion, motivo = excluded.motivo, categoria = excluded.categoria, territorio = excluded.territorio,
            monto_calculado = excluded.monto_calculado, estado_tarifa = excluded.estado_tarifa, detalle_tarifa = excluded.detalle_tarifa, tarifario_id = excluded.tarifario_id, aprobada = excluded.aprobada,
            id_externo = excluded.id_externo, updated_at = now(),
            fecha_resultado = case
              when c->>'fecha_resultado_fuente' = 'agenda' and nullif(c->>'fecha_resultado', '') is not null then (c->>'fecha_resultado')::timestamptz
              when facturacion_componente.fecha_resultado is not null then facturacion_componente.fecha_resultado
              when excluded.situacion in ('cobra', 'no_cobra') and (facturacion_componente.fecha_resultado_fuente is null or facturacion_componente.situacion = 'pendiente') then nullif(c->>'fecha_resultado', '')::timestamptz
              else facturacion_componente.fecha_resultado end,
            fecha_resultado_fuente = case
              when c->>'fecha_resultado_fuente' = 'agenda' and nullif(c->>'fecha_resultado', '') is not null then 'agenda'
              when facturacion_componente.fecha_resultado is not null then facturacion_componente.fecha_resultado_fuente
              when excluded.situacion in ('cobra', 'no_cobra') and (facturacion_componente.fecha_resultado_fuente is null or facturacion_componente.situacion = 'pendiente') then coalesce(nullif(c->>'fecha_resultado_fuente', ''), 'sin_dato')
              else facturacion_componente.fecha_resultado_fuente end
        where facturacion_componente.factura_id is null;
      -- Una prueba ya facturada no se toca… salvo para recibir la fecha REAL de la Agenda.
      if c->>'fecha_resultado_fuente' = 'agenda' and nullif(c->>'fecha_resultado', '') is not null then
        update facturacion_componente x
           set fecha_resultado = (c->>'fecha_resultado')::timestamptz, fecha_resultado_fuente = 'agenda', updated_at = now()
         where x.expediente_id = v_exp and x.servicio = c->>'servicio' and x.factura_id is not null
           and (x.fecha_resultado_fuente is distinct from 'agenda' or x.fecha_resultado is distinct from (c->>'fecha_resultado')::timestamptz);
      end if;
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

-- Backfill (una vez; idempotente).
select facturacion_fecha_resultado_backfill('agenda');

-- ------------------------------------------------------------
-- 5. Reporte: producción por mes de terminación (fecha_resultado, zona America/Guatemala)
--    Solo pruebas cobra / no_cobra de expedientes vigentes (no eliminados, no excluidos).
--    terminado  = cobra con resultado en el mes (con precio = monto_calculado sin IVA; sin tarifa = cantidad)
--    facturado  = de esas, con factura (monto de su línea de factura)
--    cobrado    = de las facturadas, con TODAS las líneas de su factura cobradas (facturas_clientes.estado)
--    backlog    = terminado sin factura y todavía en cola (cobro pendiente en la Agenda, dentro del arranque)
--    fuera_cola = terminado sin factura pero ya resuelto del lado de la Agenda (pagado / facturado fuera / antes del arranque)
--    no_cobra   = pruebas que no se cobran (informativo); sin_fecha = cobra sin fecha_resultado (completitud del dato)
-- ------------------------------------------------------------
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
  select b.id,
         coalesce((select d.monto from factura_detalle_expediente d where d.componente_id = b.id order by d.id limit 1), b.monto) as monto_facturado,
         not exists (select 1 from facturas_clientes f where f.no_factura = b.no_factura and upper(coalesce(f.estado, '')) not in ('COBRADO', 'COBRADA')) as cobrada
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
