-- 034 · PAQUETES PREPAGADOS: el cliente paga N pruebas por adelantado y el sistema descuenta cada una al terminar (brief del CFO, 11-nov-2026)
--
-- Por qué: «A este cliente se le vendió un paquete de 100 polígrafos y pagó adelantado los 100. Deberíamos ir descontando
-- cada vez que se termina un proceso: el remanente de procesos pagados con anticipación». Hoy no se sabe cuánto lleva
-- consumido cada cliente y se corre el riesgo de facturarle dos veces lo que ya pagó.
--
-- Decisiones del CFO: se factura UNA vez, por adelantado; cada prueba terminada descuenta 1 y no se vuelve a facturar.
-- Cobertura exacta por línea (un servicio + una categoría, territorio opcional). Al agotarse, las siguientes van a tarifa
-- y el sistema avisa antes. Vencimiento opcional: vencido no descuenta; el CFO lo extiende o lo cierra.
--
-- Qué hace:
--  1. paquete / paquete_linea / paquete_consumo (una fila por prueba descontada; una prueba tiene a lo sumo UN consumo
--     vigente: índice único parcial; la reversión conserva la fila con su motivo). Remanente = cantidad − consumos vigentes:
--     se calcula (paquete_remanente), no se guarda.
--  2. paquete_aplicar_consumos(nit): el corazón. Transaccional, bloquea las líneas (for update). Revierte los consumos de
--     pruebas que dejaron de ser `cobra` (o cuyo expediente se eliminó), descuenta las que pasan a `cobra` sin factura ni
--     detalle vivo, de un cliente con línea activa que coincide en servicio + categoría (+ territorio si la línea lo fija),
--     con fecha de resultado (025; o de ingreso) dentro de [fecha_inicio, vence_en] y paquete no vencido ni cerrado;
--     las ya terminadas ANTES de crear el paquete solo entran si el CFO confirmó la aplicación retroactiva. Orden
--     determinista: pruebas más viejas primero; paquete más antiguo primero (FIFO). Luego recalcula estados (agotado /
--     vencido / de vuelta a activo) y deja los avisos (por agotarse / agotado) como eventos `cambio_condicion` en el
--     historial de cobranza (033). La app la llama en el mismo paso del sync / webhook / re-resolver.
--  3. Una prueba cubierta SALE de la cola de Por facturar (facturacion_componente_en_cola, resumen, sin_mapear: se
--     conserva todo lo de 017–030), no entra a un detalle (detalle_facturacion_crear_pruebas la rechaza con
--     PRUEBA_CUBIERTA_POR_PAQUETE) ni a una factura (facturacion_agenda_emitir). Paridad SQL / TS (mapeo.ts).
--  4. facturacion_agenda_cerrar_parciales también cierra los expedientes cuyas pruebas cobrables quedaron facturadas o
--     cubiertas (sin pendientes): writeback 'pendiente' con el número de la factura del anticipo del paquete
--     («F-123 (PAQ-0001)», o «PAQ-0001» si todavía no tiene factura); la app compone los números y escribe a la Agenda.
--  5. facturacion_produccion_mensual (025/026): una prueba cubierta cuenta como producida a su precio unitario del paquete
--     y como «cubierta por anticipo» (cubierta_n / cubierta_q), nunca como backlog.
--  6. RPCs de pantalla: paquete_crear (con vista previa retroactiva aparte: paquete_vista_previa), paquete_editar,
--     paquete_cerrar, paquete_confirmar_retroactivo, paquete_resumen (lista / tarifario / banner), paquete_detalle.
--  7. Artículo de ayuda «Paquetes prepagados».
--
-- No toca: tarifas, lookup, IVA (030), 026, el flujo del detalle digital, el mapa de precios. Las psicométricas sin paquete
-- siguen excluidas de la cola (la app resuelve su cliente; el descuento solo pasa si hay paquete que las cubra).
-- RLS activado y solo service_role. Idempotente; sin drop de tablas / funciones, sin delete, truncate, begin / commit.

-- ── 1. modelo ──────────────────────────────────────────────────────────────────────────────────
create sequence if not exists paquete_seq;

create table if not exists paquete (
  id                     uuid primary key default gen_random_uuid(),
  correlativo            text not null unique default ('PAQ-' || lpad(nextval('paquete_seq')::text, 4, '0')),
  nit                    text not null,
  cliente_id             uuid references clientes(id),
  nombre                 text not null,
  fecha_inicio           date not null,
  vence_en               date,
  estado                 text not null default 'activo' check (estado in ('activo', 'agotado', 'vencido', 'cerrado')),
  no_factura             text,
  factura_id             uuid references facturas_clientes(id),
  umbral_aviso           integer not null default 5 check (umbral_aviso >= 0),
  retroactivo_confirmado boolean not null default false,
  retroactivo_por        text,
  retroactivo_en         timestamptz,
  notas                  text,
  creado_por             text,
  cerrado_por            text,
  cerrado_motivo         text,
  cerrado_en             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint paquete_vence_check check (vence_en is null or vence_en >= fecha_inicio)
);
comment on table paquete is 'PAQUETES PREPAGADOS (034): el cliente pagó N pruebas por adelantado; cada prueba terminada descuenta una y no se vuelve a facturar.';
comment on column paquete.fecha_inicio is 'Cubre pruebas con fecha de resultado (025; o de ingreso si no la tiene) desde esta fecha.';
comment on column paquete.no_factura is 'Factura del anticipo; opcional al crear, se enlaza cuando se emite. Va en el write-back a la Agenda: «F-123 (PAQ-0001)».';
comment on column paquete.umbral_aviso is 'Aviso «por agotarse» cuando a una línea le quedan N o menos. Por defecto max(5, 10 % de la cantidad).';
comment on column paquete.retroactivo_confirmado is 'Las pruebas terminadas ANTES de crear el paquete (fecha_inicio en el pasado) solo se descuentan si el CFO confirmó la vista previa.';
create index if not exists idx_paquete_nit on paquete (nit, estado);

create table if not exists paquete_linea (
  id               uuid primary key default gen_random_uuid(),
  paquete_id       uuid not null references paquete(id) on delete cascade,
  servicio         text not null,
  categoria        text not null,
  territorio       text,
  cantidad         integer not null check (cantidad > 0),
  precio_unitario  numeric(12,2) not null default 0 check (precio_unitario >= 0),
  aviso_umbral_en  timestamptz,
  agotado_en       timestamptz,
  created_at       timestamptz not null default now()
);
comment on column paquete_linea.servicio is 'Servicio canónico del tarifario (POLIGRAFO, SOCIOECONOMICO, PSICOMETRICAS…).';
comment on column paquete_linea.categoria is 'Categoría canónica (PRE EMPLEO / RUTINA / ESPECIFICO) o UNICA = cualquiera (servicios sin categoría).';
comment on column paquete_linea.territorio is 'null o UNICA = cualquiera; si lo fija, la prueba debe coincidir.';
comment on column paquete_linea.precio_unitario is 'Sin IVA: lo que pagó por cada prueba (valora el remanente y la producción).';
create index if not exists idx_paquete_linea_paquete on paquete_linea (paquete_id);

create table if not exists paquete_consumo (
  id                uuid primary key default gen_random_uuid(),
  paquete_linea_id  uuid not null references paquete_linea(id),
  componente_id     uuid not null references facturacion_componente(id),
  fecha             timestamptz not null default now(),
  fecha_resultado   timestamptz,
  revertido_en      timestamptz,
  motivo_reversion  text,
  creado_por        text,
  created_at        timestamptz not null default now()
);
comment on table paquete_consumo is 'Una fila por prueba descontada de un paquete. Nunca se borra: la reversión marca revertido_en + motivo.';
create unique index if not exists uq_paquete_consumo_vigente on paquete_consumo (componente_id) where revertido_en is null;
create index if not exists idx_paquete_consumo_linea on paquete_consumo (paquete_linea_id) where revertido_en is null;

alter table paquete enable row level security;
alter table paquete_linea enable row level security;
alter table paquete_consumo enable row level security;
revoke all on table paquete, paquete_linea, paquete_consumo from public, anon, authenticated;
grant all on table paquete, paquete_linea, paquete_consumo to service_role;
revoke all on sequence paquete_seq from public, anon, authenticated;
grant all on sequence paquete_seq to service_role;

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────
create or replace function paquete_remanente(p_linea_id uuid)
returns integer
language sql stable
as $fn$
  select greatest(0, l.cantidad - (select count(*) from paquete_consumo x where x.paquete_linea_id = l.id and x.revertido_en is null))::integer
    from paquete_linea l where l.id = p_linea_id
$fn$;

/** true si la prueba tiene un consumo VIGENTE (cubierta por un paquete). Misma regla que `cubiertaPor` en TS. */
create or replace function paquete_componente_cubierto(p_componente_id uuid)
returns boolean
language sql stable
as $fn$
  select exists (select 1 from paquete_consumo x where x.componente_id = p_componente_id and x.revertido_en is null)
$fn$;

/** La línea cubre la prueba: mismo servicio, misma categoría (o UNICA = cualquiera), territorio si la línea lo fija. Espejo: lineaCubre en TS. */
create or replace function paquete_linea_cubre(p_servicio text, p_categoria text, p_territorio text, c_servicio text, c_categoria text, c_territorio text)
returns boolean
language sql immutable
as $fn$
  select upper(btrim(coalesce(p_servicio, ''))) = upper(btrim(coalesce(c_servicio, '')))
     and (upper(btrim(coalesce(p_categoria, ''))) in ('', 'UNICA') or upper(btrim(coalesce(p_categoria, ''))) = upper(btrim(coalesce(c_categoria, ''))))
     and (upper(btrim(coalesce(p_territorio, ''))) in ('', 'UNICA') or upper(btrim(coalesce(p_territorio, ''))) = upper(btrim(coalesce(c_territorio, ''))))
$fn$;

/** Número con el que el paquete va a la Agenda: «F-123 (PAQ-0001)» si ya tiene factura, si no «PAQ-0001». */
create or replace function paquete_token(p paquete)
returns text
language sql immutable
as $fn$
  select case when nullif(btrim(coalesce(p.no_factura, '')), '') is not null then btrim(p.no_factura) || ' (' || p.correlativo || ')' else p.correlativo end
$fn$;

-- ── 2. el corazón: aplicar consumos (descontar y revertir) ───────────────────────────────────────
-- p_nit: solo ese cliente (null = todos los que tienen paquetes); p_hoy para vencimientos. Devuelve lo que pasó.
create or replace function paquete_aplicar_consumos(p_nit text default null, p_fuente text default 'agenda', p_hoy date default null, p_actor text default 'sistema')
returns jsonb
language plpgsql
as $fn$
declare
  v_hoy        date := coalesce(p_hoy, (now() at time zone 'America/Guatemala')::date);
  v_nits       text[];
  r            record;
  v_linea      uuid;
  v_consumidos integer := 0;
  v_revertidos integer := 0;
  v_avisos     jsonb := '[]'::jsonb;
  p            paquete%rowtype;
  l            record;
  v_rem        integer;
  v_total_rem  integer;
  v_etq        text;
begin
  -- clientes con paquetes (solo los que importan) y bloqueo de sus líneas: dos syncs a la vez se serializan acá
  select coalesce(array_agg(distinct nit), array[]::text[]) into v_nits from paquete where (p_nit is null or nit = p_nit) and estado <> 'cerrado';
  if cardinality(v_nits) = 0 then return jsonb_build_object('consumidos', 0, 'revertidos', 0, 'avisos', '[]'::jsonb, 'clientes', 0); end if;
  perform 1 from paquete_linea pl join paquete p2 on p2.id = pl.paquete_id where p2.nit = any(v_nits) order by pl.id for update of pl;

  -- a) reversión: la prueba dejó de cobrarse (la Agenda corrigió el resultado) o el expediente se eliminó → la unidad vuelve al paquete
  with rev as (
    update paquete_consumo x
       set revertido_en = now(),
           motivo_reversion = case when e.eliminado then 'expediente eliminado en la Agenda'
                                   else 'la prueba pasó a ' || c.situacion || coalesce(': ' || nullif(c.motivo, ''), '') end
      from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
     where x.componente_id = c.id and x.revertido_en is null and c.fuente = p_fuente
       and (c.situacion <> 'cobra' or e.eliminado)
       and exists (select 1 from paquete_linea pl2 join paquete p2 on p2.id = pl2.paquete_id where pl2.id = x.paquete_linea_id and p2.nit = any(v_nits))
    returning 1
  ) select count(*) into v_revertidos from rev;

  -- b) estados por vencimiento antes de descontar (vencido no descuenta; extendido vuelve a activo)
  update paquete set estado = 'vencido', updated_at = now()
   where nit = any(v_nits) and estado in ('activo', 'agotado') and vence_en is not null and vence_en < v_hoy;
  update paquete set estado = 'activo', updated_at = now()
   where nit = any(v_nits) and estado = 'vencido' and (vence_en is null or vence_en >= v_hoy);

  -- c) descuento FIFO: pruebas más viejas primero (fecha de resultado, o de ingreso), paquete más antiguo primero
  for r in
    select c.id as componente_id, e.nit_resuelto as nit, c.servicio, c.categoria, c.territorio, c.fecha_resultado,
           coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) as fecha,
           coalesce(c.fecha_resultado, e.fecha_ingreso::timestamptz) as momento
      from facturacion_componente c
      join facturacion_expediente e on e.id = c.expediente_id
     where c.fuente = p_fuente and c.situacion = 'cobra' and c.factura_id is null
       and (c.detalle_id is null or exists (select 1 from detalle_facturacion d where d.id = c.detalle_id and d.estado = 'anulada'))
       and not e.eliminado and e.estado_tarifa <> 'excluido_no_factura'
       and e.nit_resuelto is not null and e.nit_resuelto = any(v_nits)
       and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
       and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)
     order by coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) nulls last, c.fecha_resultado nulls last, c.created_at, c.id
  loop
    if r.fecha is null then continue; end if;
    select l2.id into v_linea
      from paquete_linea l2 join paquete p2 on p2.id = l2.paquete_id
     where p2.nit = r.nit and p2.estado in ('activo', 'agotado')
       and r.fecha >= p2.fecha_inicio and (p2.vence_en is null or r.fecha <= p2.vence_en)
       and (p2.retroactivo_confirmado or r.momento is null or r.momento >= p2.created_at)
       and paquete_linea_cubre(l2.servicio, l2.categoria, l2.territorio, r.servicio, r.categoria, r.territorio)
       and paquete_remanente(l2.id) > 0
     order by p2.fecha_inicio, p2.created_at, l2.created_at, l2.id
     limit 1;
    if v_linea is null then continue; end if;
    insert into paquete_consumo (paquete_linea_id, componente_id, fecha_resultado, creado_por) values (v_linea, r.componente_id, r.fecha_resultado, p_actor);
    v_consumidos := v_consumidos + 1;
  end loop;

  -- d) estados (agotado ↔ activo) y avisos por línea (eventos cambio_condicion en el historial de cobranza, 033)
  for p in select * from paquete where nit = any(v_nits) and estado in ('activo', 'agotado') order by created_at loop
    v_total_rem := 0;
    for l in select l2.*, paquete_remanente(l2.id) as rem from paquete_linea l2 where l2.paquete_id = p.id order by l2.created_at loop
      v_rem := l.rem; v_total_rem := v_total_rem + v_rem;
      v_etq := initcap(lower(l.servicio)) || case when upper(coalesce(l.categoria, '')) in ('', 'UNICA') then '' else ' ' || lower(l.categoria) end;
      if v_rem = 0 and l.agotado_en is null then
        update paquete_linea set agotado_en = now() where id = l.id;
        if p.cliente_id is not null then
          insert into cobranza_evento (cliente_id, tipo, origen, fecha, comentario, facturas, creado_por, datos)
          values (p.cliente_id, 'cambio_condicion', 'automatico', now(), 'Paquete ' || p.correlativo || ' agotado: ' || v_etq || ' 0 de ' || l.cantidad || ' · las siguientes pruebas se facturan a tarifa',
                  '{}'::text[], p_actor, jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'agotado', 'remanente', 0));
        end if;
        v_avisos := v_avisos || jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'agotado', 'remanente', 0);
      elsif v_rem > 0 and l.agotado_en is not null then
        update paquete_linea set agotado_en = null where id = l.id;
      end if;
      if v_rem > 0 and v_rem <= p.umbral_aviso and l.aviso_umbral_en is null then
        update paquete_linea set aviso_umbral_en = now() where id = l.id;
        if p.cliente_id is not null then
          insert into cobranza_evento (cliente_id, tipo, origen, fecha, comentario, facturas, creado_por, datos)
          values (p.cliente_id, 'cambio_condicion', 'automatico', now(), 'Paquete ' || p.correlativo || ' por agotarse: quedan ' || v_rem || ' de ' || l.cantidad || ' (' || v_etq || ') · ofrecer la renovación',
                  '{}'::text[], p_actor, jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'por_agotarse', 'remanente', v_rem));
        end if;
        v_avisos := v_avisos || jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'por_agotarse', 'remanente', v_rem);
      elsif v_rem > p.umbral_aviso and l.aviso_umbral_en is not null then
        update paquete_linea set aviso_umbral_en = null where id = l.id;
      end if;
    end loop;
    if v_total_rem = 0 and p.estado = 'activo' then update paquete set estado = 'agotado', updated_at = now() where id = p.id;
    elsif v_total_rem > 0 and p.estado = 'agotado' then update paquete set estado = 'activo', updated_at = now() where id = p.id;
    end if;
  end loop;

  return jsonb_build_object('consumidos', v_consumidos, 'revertidos', v_revertidos, 'avisos', v_avisos, 'clientes', cardinality(v_nits));
end
$fn$;

-- ── 3. la cola: una prueba cubierta sale (conserva 017–030) ────────────────────────────────────
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
     and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)   -- 034: cubierta por un paquete
$fn$;

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
         count(*) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0) as listos,
         coalesce(sum(monto_calculado) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0), 0) as total_sin_iva,
         coalesce(sum(fel_precio_con_iva(monto_calculado)) filter (where estado_tarifa = 'resuelta' and coalesce(monto_calculado, 0) > 0), 0) as total_con_iva,
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
     and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)
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

-- Detalle: una prueba cubierta no entra (conserva 019 / 024 / 030)
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
       and (c.estado_tarifa <> 'resuelta' or coalesce(c.monto_calculado, 0) <= 0 or e.nit_resuelto is null or not facturacion_componente_en_cola(c, e))
  ) then raise exception 'EXPEDIENTE_NO_FACTURABLE: solo entran pruebas con resultado, precio resuelto y en cola'; end if;
  select count(distinct e.nit_resuelto), min(e.nit_resuelto), min(e.cliente_id::text)::uuid, count(distinct e.id),
         fel_totales(array_agg(c.monto_calculado))
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

-- Emitir (024): una prueba cubierta no se factura; «completo» = sin cobrables sin factura NI cubiertas pendientes
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
  if exists (select 1 from paquete_consumo pc where pc.componente_id = any(v_cids) and pc.revertido_en is null) then
    raise exception 'PRUEBA_CUBIERTA_POR_PAQUETE: alguna prueba ya está cubierta por un paquete prepagado y no se vuelve a facturar';
  end if;
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
                  not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'cobra' and c.factura_id is null and not paquete_componente_cubierto(c.id)) as sin_cobrables,
                  not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'pendiente') as sin_pendientes,
                  (select string_agg(c.servicio || ' (' || c.situacion || ')', ', ' order by c.servicio) from facturacion_componente c where c.expediente_id = e.id and c.factura_id is null and c.situacion <> 'no_cobra' and not paquete_componente_cubierto(c.id)) as faltan
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

-- ── 4. cerrar parciales y cubiertos (write-back) ───────────────────────────────────────────────
-- Expedientes 'parcial' que se completaron, y expedientes con pruebas cubiertas por paquete cuyas cobrables quedaron
-- todas facturadas o cubiertas (sin pendientes): la última factura si la hay (si no, el número del paquete) y writeback
-- 'pendiente'; la app compone los números («F-140 / F-123 (PAQ-0001)») y escribe a la Agenda. Devuelve [{ id_externo, no_factura }].
create or replace function facturacion_agenda_cerrar_parciales(p_fuente text default 'agenda')
returns jsonb
language plpgsql
as $fn$
declare
  x        record;
  v_out    jsonb := '[]'::jsonb;
  v_token  text;
begin
  for x in
    select e.id, e.id_externo,
           exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.factura_id is not null) as con_factura
      from facturacion_expediente e
     where e.fuente = p_fuente and e.factura_id is null and not e.eliminado
       and (e.writeback_estado = 'parcial'
            or (coalesce(e.writeback_estado, '') not in ('confirmado', 'omitido', 'pendiente', 'conflicto', 'error')
                and exists (select 1 from facturacion_componente c join paquete_consumo pc on pc.componente_id = c.id and pc.revertido_en is null where c.expediente_id = e.id)))
       and not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'cobra' and c.factura_id is null and not paquete_componente_cubierto(c.id))
       and not exists (select 1 from facturacion_componente c where c.expediente_id = e.id and c.situacion = 'pendiente')
       and exists (select 1 from facturacion_componente c where c.expediente_id = e.id and (c.factura_id is not null or paquete_componente_cubierto(c.id)))
  loop
    if x.con_factura then
      update facturacion_expediente e
         set factura_id = u.factura_id, factura_app_id = f.airtable_id, no_factura = u.no_factura, facturado_en = u.facturado_en, facturado_por = u.facturado_por,
             writeback_estado = 'pendiente', writeback_detalle = 'Expediente completo: se escribe a la Agenda con todas sus facturas.', writeback_en = now(), updated_at = now()
        from (select c.factura_id, c.no_factura, c.facturado_en, c.facturado_por from facturacion_componente c where c.expediente_id = x.id and c.factura_id is not null order by c.facturado_en desc nulls last limit 1) u
        left join facturas_clientes f on f.id = u.factura_id
       where e.id = x.id;
    else
      -- 034: todo cubierto por paquete: el número del anticipo del paquete (de la prueba cubierta más vieja)
      select paquete_token(p) into v_token
        from facturacion_componente c join paquete_consumo pc on pc.componente_id = c.id and pc.revertido_en is null
        join paquete_linea l on l.id = pc.paquete_linea_id join paquete p on p.id = l.paquete_id
       where c.expediente_id = x.id order by pc.fecha, pc.id limit 1;
      update facturacion_expediente
         set no_factura = v_token, factura_app_id = null, facturado_en = now(), facturado_por = 'paquete',
             writeback_estado = 'pendiente', writeback_detalle = 'Expediente cubierto por el paquete prepagado ' || v_token || ': se escribe a la Agenda como FACTURADO.', writeback_en = now(), updated_at = now()
       where id = x.id;
    end if;
    v_out := v_out || jsonb_build_object('id_externo', x.id_externo, 'no_factura', (select no_factura from facturacion_expediente where id = x.id));
  end loop;
  return v_out;
end
$fn$;

-- ── 5. producción por mes (025/026) con «cubierta por anticipo» ───────────────────────────────
create or replace function facturacion_produccion_mensual(p_desde date, p_hasta date, p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with base as (
  select c.id, c.servicio, facturacion_linea_negocio(c.servicio) as linea, c.situacion, c.estado_tarifa,
         -- 034: una prueba cubierta vale su precio unitario del paquete
         coalesce(pl.precio_unitario, c.monto_calculado, 0) as monto, c.factura_id, c.no_factura, c.fecha_resultado, c.fecha_resultado_fuente,
         (c.fecha_resultado at time zone 'America/Guatemala')::date as dia,
         to_char(c.fecha_resultado at time zone 'America/Guatemala', 'YYYY-MM') as mes,
         e.nit_resuelto, coalesce(nullif(e.empresa_nombre_externo, ''), e.empresa_id_externo, '—') as empresa, e.fecha_ingreso,
         (pc.id is not null or (c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0)) as con_precio,
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

-- ── 6. RPCs de pantalla ────────────────────────────────────────────────────────────────────────
-- Vista previa: qué pruebas ya terminadas y sin facturar desde fecha_inicio descontaría cada línea (la retroactiva se confirma aparte).
-- p_lineas: [{ servicio, categoria, territorio, cantidad }]
create or replace function paquete_vista_previa(p_nit text, p_fecha_inicio date, p_vence_en date, p_lineas jsonb, p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with cand as (
  select c.id, c.servicio, c.categoria, c.territorio, c.fecha_resultado, e.persona, e.solicitante, e.id_externo, c.estado_prueba,
         coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) as fecha
    from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and c.situacion = 'cobra' and c.factura_id is null
     and (c.detalle_id is null or exists (select 1 from detalle_facturacion d where d.id = c.detalle_id and d.estado = 'anulada'))
     and not e.eliminado and e.estado_tarifa <> 'excluido_no_factura' and e.nit_resuelto = p_nit
     and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
     and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)
), lin as (
  select ordinality as n, l->>'servicio' as servicio, l->>'categoria' as categoria, nullif(l->>'territorio', '') as territorio, coalesce((l->>'cantidad')::integer, 0) as cantidad
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) with ordinality as t(l, ordinality)
), por_linea as (
  select lin.n, lin.servicio, lin.categoria, lin.territorio, lin.cantidad,
         (select coalesce(jsonb_agg(jsonb_build_object('componente_id', c.id, 'persona', c.persona, 'solicitante', c.solicitante, 'id_externo', c.id_externo, 'fecha', c.fecha, 'resultado', c.estado_prueba, 'servicio', c.servicio, 'categoria', c.categoria, 'territorio', c.territorio) order by c.fecha, c.fecha_resultado, c.id), '[]'::jsonb)
            from (select * from cand c where c.fecha is not null and c.fecha >= p_fecha_inicio and (p_vence_en is null or c.fecha <= p_vence_en)
                     and paquete_linea_cubre(lin.servicio, lin.categoria, lin.territorio, c.servicio, c.categoria, c.territorio)
                   order by c.fecha, c.fecha_resultado, c.id limit 200) c) as pruebas
    from lin
)
select coalesce(jsonb_agg(jsonb_build_object('n', n, 'servicio', servicio, 'categoria', categoria, 'territorio', territorio, 'cantidad', cantidad,
                                             'candidatas', jsonb_array_length(pruebas), 'tomaria', least(jsonb_array_length(pruebas), cantidad), 'pruebas', pruebas) order by n), '[]'::jsonb)
  from por_linea
$fn$;

-- Crear: p_paquete { nit, cliente_id?, nombre, fecha_inicio, vence_en?, umbral_aviso?, no_factura?, notas?, retroactivo_confirmado? }
--        p_lineas [{ servicio, categoria, territorio?, cantidad, precio_unitario }]. Aplica los consumos del cliente en la misma transacción.
create or replace function paquete_crear(p_actor text, p_paquete jsonb, p_lineas jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_nit       text := upper(btrim(coalesce(p_paquete->>'nit', '')));
  v_nombre    text := btrim(coalesce(p_paquete->>'nombre', ''));
  v_inicio    date := nullif(p_paquete->>'fecha_inicio', '')::date;
  v_vence     date := nullif(p_paquete->>'vence_en', '')::date;
  v_nf        text := nullif(btrim(coalesce(p_paquete->>'no_factura', '')), '');
  v_cliente   uuid := nullif(p_paquete->>'cliente_id', '')::uuid;
  v_factura   uuid;
  v_total     integer := 0;
  v_umbral    integer;
  v_id        uuid;
  l           jsonb;
  v_cant      integer;
  v_res       jsonb;
begin
  if v_nit = '' then raise exception 'PAQUETE_SIN_NIT'; end if;
  if v_nombre = '' then raise exception 'PAQUETE_SIN_NOMBRE'; end if;
  if v_inicio is null then raise exception 'PAQUETE_SIN_FECHA_INICIO'; end if;
  if v_vence is not null and v_vence < v_inicio then raise exception 'PAQUETE_VENCE_ANTES_DE_INICIAR'; end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then raise exception 'PAQUETE_SIN_LINEAS'; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_cant := coalesce((l->>'cantidad')::integer, 0);
    if v_cant <= 0 then raise exception 'PAQUETE_LINEA_SIN_CANTIDAD'; end if;
    if btrim(coalesce(l->>'servicio', '')) = '' then raise exception 'PAQUETE_LINEA_SIN_SERVICIO'; end if;
    if btrim(coalesce(l->>'categoria', '')) = '' then raise exception 'PAQUETE_LINEA_SIN_CATEGORIA'; end if;
    if coalesce((l->>'precio_unitario')::numeric, 0) < 0 then raise exception 'PAQUETE_LINEA_PRECIO_NEGATIVO'; end if;
    v_total := v_total + v_cant;
  end loop;
  if v_cliente is null then select id into v_cliente from clientes where upper(btrim(nit)) = v_nit order by activo desc nulls last, created_at limit 1; end if;
  if v_nf is not null then select id into v_factura from facturas_clientes where btrim(no_factura) = v_nf order by total desc, created_at limit 1; end if;
  -- umbral por defecto: 10 % de la cantidad total o 5, lo que sea mayor
  v_umbral := coalesce(nullif(p_paquete->>'umbral_aviso', '')::integer, greatest(5, ceil(v_total * 0.10)::integer));
  insert into paquete (nit, cliente_id, nombre, fecha_inicio, vence_en, no_factura, factura_id, umbral_aviso, notas, creado_por,
                       retroactivo_confirmado, retroactivo_por, retroactivo_en)
  values (v_nit, v_cliente, v_nombre, v_inicio, v_vence, v_nf, v_factura, v_umbral, nullif(btrim(coalesce(p_paquete->>'notas', '')), ''), p_actor,
          coalesce((p_paquete->>'retroactivo_confirmado')::boolean, false),
          case when coalesce((p_paquete->>'retroactivo_confirmado')::boolean, false) then p_actor end,
          case when coalesce((p_paquete->>'retroactivo_confirmado')::boolean, false) then now() end)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    insert into paquete_linea (paquete_id, servicio, categoria, territorio, cantidad, precio_unitario)
    values (v_id, upper(btrim(l->>'servicio')), upper(btrim(l->>'categoria')), nullif(upper(btrim(coalesce(l->>'territorio', ''))), ''), (l->>'cantidad')::integer, round(coalesce((l->>'precio_unitario')::numeric, 0), 2));
  end loop;
  v_res := paquete_aplicar_consumos(v_nit, 'agenda', null, p_actor);
  return jsonb_build_object('id', v_id, 'correlativo', (select correlativo from paquete where id = v_id), 'aplicado', v_res);
end
$fn$;

-- Editar: nombre, umbral_aviso, no_factura, notas, vence_en (extender un vencido lo reactiva en el próximo aplicar)
create or replace function paquete_editar(p_actor text, p_id uuid, p_cambios jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  p  paquete%rowtype;
  v_nf text;
  v_factura uuid;
begin
  select * into p from paquete where id = p_id for update;
  if p.id is null then raise exception 'PAQUETE_NO_EXISTE'; end if;
  if p.estado = 'cerrado' then raise exception 'PAQUETE_CERRADO: un paquete cerrado no se edita'; end if;
  if p_cambios ? 'nombre' and btrim(coalesce(p_cambios->>'nombre', '')) <> '' then update paquete set nombre = btrim(p_cambios->>'nombre') where id = p_id; end if;
  if p_cambios ? 'umbral_aviso' then update paquete set umbral_aviso = greatest(0, (p_cambios->>'umbral_aviso')::integer) where id = p_id; end if;
  if p_cambios ? 'notas' then update paquete set notas = nullif(btrim(coalesce(p_cambios->>'notas', '')), '') where id = p_id; end if;
  if p_cambios ? 'vence_en' then
    if nullif(p_cambios->>'vence_en', '') is not null and (p_cambios->>'vence_en')::date < p.fecha_inicio then raise exception 'PAQUETE_VENCE_ANTES_DE_INICIAR'; end if;
    update paquete set vence_en = nullif(p_cambios->>'vence_en', '')::date where id = p_id;
  end if;
  if p_cambios ? 'no_factura' then
    v_nf := nullif(btrim(coalesce(p_cambios->>'no_factura', '')), '');
    v_factura := null;
    if v_nf is not null then select id into v_factura from facturas_clientes where btrim(no_factura) = v_nf order by total desc, created_at limit 1; end if;
    update paquete set no_factura = v_nf, factura_id = v_factura where id = p_id;
  end if;
  update paquete set updated_at = now() where id = p_id;
  perform paquete_aplicar_consumos(p.nit, 'agenda', null, p_actor);
  select * into p from paquete where id = p_id;
  return to_jsonb(p);
end
$fn$;

create or replace function paquete_cerrar(p_actor text, p_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
as $fn$
declare
  p paquete%rowtype;
begin
  select * into p from paquete where id = p_id for update;
  if p.id is null then raise exception 'PAQUETE_NO_EXISTE'; end if;
  if p.estado = 'cerrado' then return to_jsonb(p); end if;
  update paquete set estado = 'cerrado', cerrado_por = p_actor, cerrado_motivo = nullif(btrim(coalesce(p_motivo, '')), ''), cerrado_en = now(), updated_at = now() where id = p_id;
  select * into p from paquete where id = p_id;
  return to_jsonb(p);
end
$fn$;

-- Confirmar la aplicación retroactiva (las pruebas terminadas antes de crear el paquete) y aplicar.
create or replace function paquete_confirmar_retroactivo(p_actor text, p_id uuid)
returns jsonb
language plpgsql
as $fn$
declare
  p paquete%rowtype;
begin
  select * into p from paquete where id = p_id for update;
  if p.id is null then raise exception 'PAQUETE_NO_EXISTE'; end if;
  if p.estado = 'cerrado' then raise exception 'PAQUETE_CERRADO'; end if;
  update paquete set retroactivo_confirmado = true, retroactivo_por = p_actor, retroactivo_en = now(), updated_at = now() where id = p_id;
  return paquete_aplicar_consumos(p.nit, 'agenda', null, p_actor);
end
$fn$;

-- Resumen: paquetes (todos o de un NIT) con sus líneas, usadas y remanente. La app deriva el estado efectivo (por agotarse, vence pronto).
create or replace function paquete_resumen(p_nit text default null)
returns jsonb
language sql stable
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'correlativo', p.correlativo, 'nit', p.nit, 'cliente_id', p.cliente_id, 'nombre', p.nombre,
           'fecha_inicio', p.fecha_inicio, 'vence_en', p.vence_en, 'estado', p.estado, 'no_factura', p.no_factura, 'factura_id', p.factura_id,
           'factura_app_id', (select f.airtable_id from facturas_clientes f where f.id = p.factura_id),
           'umbral_aviso', p.umbral_aviso, 'retroactivo_confirmado', p.retroactivo_confirmado, 'notas', p.notas, 'creado_por', p.creado_por, 'created_at', p.created_at, 'updated_at', p.updated_at,
           'cerrado_por', p.cerrado_por, 'cerrado_motivo', p.cerrado_motivo, 'cerrado_en', p.cerrado_en,
           'cliente', (select coalesce(nullif(c.nombre_empresa, ''), c.razon_social) from clientes c where c.id = p.cliente_id),
           'lineas', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', l.id, 'servicio', l.servicio, 'categoria', l.categoria, 'territorio', l.territorio, 'cantidad', l.cantidad, 'precio_unitario', l.precio_unitario,
                        'usadas', (select count(*) from paquete_consumo x where x.paquete_linea_id = l.id and x.revertido_en is null),
                        'remanente', paquete_remanente(l.id), 'aviso_umbral_en', l.aviso_umbral_en, 'agotado_en', l.agotado_en) order by l.created_at), '[]'::jsonb)
                        from paquete_linea l where l.paquete_id = p.id),
           -- pruebas terminadas antes de crear el paquete que esperan la confirmación retroactiva (solo informativo)
           'retro_pendientes', case when p.retroactivo_confirmado or p.estado = 'cerrado' then 0 else
             (select count(*) from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
               where c.situacion = 'cobra' and c.factura_id is null and not e.eliminado and e.nit_resuelto = p.nit
                 and coalesce(c.fecha_resultado, e.fecha_ingreso::timestamptz) < p.created_at
                 and coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) >= p.fecha_inicio
                 and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)
                 and exists (select 1 from paquete_linea l where l.paquete_id = p.id and paquete_linea_cubre(l.servicio, l.categoria, l.territorio, c.servicio, c.categoria, c.territorio))) end
         ) order by p.created_at desc), '[]'::jsonb)
    from paquete p
   where p_nit is null or p.nit = p_nit
$fn$;

-- Detalle de un paquete: líneas con sus pruebas descontadas (persona, solicitante, fecha de resultado, resultado, expediente) y reversiones.
create or replace function paquete_detalle(p_id uuid)
returns jsonb
language sql stable
as $fn$
  select jsonb_build_object(
    'paquete', (select t.v from jsonb_array_elements(paquete_resumen((select nit from paquete where id = p_id))) as t(v) where (t.v->>'id')::uuid = p_id),
    'consumos', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', pc.id, 'linea_id', pc.paquete_linea_id, 'componente_id', pc.componente_id, 'fecha', pc.fecha, 'revertido_en', pc.revertido_en, 'motivo_reversion', pc.motivo_reversion,
                   'fecha_resultado', c.fecha_resultado, 'servicio', c.servicio, 'categoria', c.categoria, 'territorio', c.territorio, 'estado_prueba', c.estado_prueba, 'situacion', c.situacion,
                   'persona', e.persona, 'solicitante', e.solicitante, 'puesto', e.puesto, 'id_externo', e.id_externo, 'expediente_id', e.id,
                   'detalle_id', c.detalle_id, 'no_factura', c.no_factura) order by pc.revertido_en nulls first, coalesce(c.fecha_resultado, pc.fecha), pc.id), '[]'::jsonb)
                   from paquete_consumo pc join paquete_linea l on l.id = pc.paquete_linea_id
                   join facturacion_componente c on c.id = pc.componente_id join facturacion_expediente e on e.id = c.expediente_id
                  where l.paquete_id = p_id)
  )
$fn$;

-- solo service_role
revoke all on function paquete_remanente(uuid), paquete_componente_cubierto(uuid), paquete_linea_cubre(text, text, text, text, text, text), paquete_token(paquete),
  paquete_aplicar_consumos(text, text, date, text), paquete_vista_previa(text, date, date, jsonb, text), paquete_crear(text, jsonb, jsonb), paquete_editar(text, uuid, jsonb),
  paquete_cerrar(text, uuid, text), paquete_confirmar_retroactivo(text, uuid), paquete_resumen(text), paquete_detalle(uuid)
  from public, anon, authenticated;
grant execute on function paquete_remanente(uuid), paquete_componente_cubierto(uuid), paquete_linea_cubre(text, text, text, text, text, text), paquete_token(paquete),
  paquete_aplicar_consumos(text, text, date, text), paquete_vista_previa(text, date, date, jsonb, text), paquete_crear(text, jsonb, jsonb), paquete_editar(text, uuid, jsonb),
  paquete_cerrar(text, uuid, text), paquete_confirmar_retroactivo(text, uuid), paquete_resumen(text), paquete_detalle(uuid)
  to service_role;

-- ── 7. ayuda ───────────────────────────────────────────────────────────────────────────────────
insert into ayuda (airtable_id, titulo, slug, categoria, descripcion_corta, contenido, orden, activo, tags_contextuales)
values ('sbw-ayuda-paquetes-prepagados', 'Paquetes prepagados — el cliente paga N pruebas por adelantado', 'paquetes-prepagados', 'Facturación',
  'Para quien factura y para cobranza: cómo crear un paquete, cómo se descuenta cada prueba terminada y qué pasa al agotarse o vencer.',
  E'## Qué es\n\nUn **paquete prepagado** es una venta por adelantado: el cliente paga, por ejemplo, 100 polígrafos pre empleo en **una sola factura** (la factura del anticipo). Cada vez que una de esas pruebas termina, el sistema **descuenta una** del paquete y esa prueba **no se vuelve a facturar**: sale de *Por facturar* con la etiqueta **«Cubierta por PAQ-0001»** y el expediente va a la Agenda como FACTURADO con el número de la factura del anticipo.\n\n## Cómo crear uno\n\nEn **Tarifario → cliente → Paquetes → Crear paquete**: nombre, fecha de inicio (cubre pruebas con resultado desde esa fecha), vencimiento opcional, umbral de aviso (por defecto el 10 % o 5, lo que sea mayor), la factura del anticipo (buscá el número; si todavía no se emitió, dejala «pendiente de facturar» y enlazala después) y las **líneas**: cada línea cubre **un servicio y una categoría** (por ejemplo «60 polígrafos pre empleo» y «40 socioeconómicos pre empleo»), con territorio opcional, cantidad y precio unitario sin IVA (se propone el de la tarifa vigente). Una prueba de otra categoría (una de rutina, por ejemplo) **no descuenta**: se factura aparte a tarifa.\n\nSi la fecha de inicio está en el pasado, verás una **vista previa** de las pruebas ya terminadas y sin facturar desde esa fecha que descontaría: confirmá para aplicarlas (si no, solo descuentan las que terminen de ahora en adelante).\n\n## Cómo se descuenta\n\nEn cada sincronización con la Agenda (y al re-resolver): una prueba que queda **con resultado cobrable**, sin factura ni detalle, de un cliente con una línea que coincide y con remanente, se descuenta. Las pruebas más viejas se descuentan primero y, si hay dos paquetes, primero el más antiguo. Si la Agenda corrige el resultado (pasa a pendiente o no se cobra), el consumo se **revierte** y la unidad vuelve al paquete; el historial conserva la reversión con su motivo.\n\n**Remanente = cantidad − pruebas descontadas.** Se ve en el tarifario, en la lista global *Paquetes* y como banner en *Por facturar* («37 restantes de 100 · vence 31-dic»). El detalle del paquete muestra persona, solicitante, fecha y resultado de cada prueba descontada, y se imprime como **«Estado del paquete»** (PDF) para mandárselo al cliente.\n\n## Al agotarse o vencer\n\nCuando a una línea le quedan pocas (el umbral), aparece el badge **«Por agotarse»** y queda un aviso en el historial de cobranza del cliente para ofrecer la renovación. Al llegar a cero, **«Agotado»**: las siguientes pruebas entran a *Por facturar* **a tarifa**, como siempre. Si el paquete tiene vencimiento, a 30 días aparece **«Vence pronto»**; un paquete **vencido no descuenta**: el remanente se reporta y el CFO decide si lo **extiende** (cambiando el vencimiento) o lo **cierra**. Un paquete cerrado no vuelve a descontar.\n\n## Permisos\n\nCrear, editar y cerrar paquetes, y confirmar la aplicación retroactiva: **admin y contador**. Ver: quien ve el tarifario o *Por facturar*; cobranza también lo ve.',
  52, true, 'paquetes, prepagado, anticipo, remanente, tarifario, por-facturar, modulo-facturacion, cobranza')
on conflict (slug) do nothing;
