-- ============================================================
-- 016 · Facturación de evaluaciones desde la Agenda de Golden (Fase B)
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts (HIT solo estructura:
-- ahí no hay evaluaciones ni llave). SIN begin/commit propio y sin
-- delete/drop (el runner aporta la transacción). Idempotente.
--
-- Qué guarda:
--  · cliente_externo            → empresa de la Agenda (empresa.id rec…) ⇄ cliente de financiero (NIT).
--  · facturacion_expediente     → espejo local de cada expediente traído (cola "Por facturar", historial,
--                                 precio resuelto con el tarifario, vínculo a la factura y estado del
--                                 write-back a la Agenda). Único por (fuente, id_externo).
--  · facturacion_sync_estado    → por fuente, el actualizadoEn más reciente procesado (cambiadosDesde).
--  · facturacion_log            → toda llamada saliente a la Agenda y su resultado. SIN secretos.
--  · facturacion_webhook_evento → ids de avisos ya recibidos (un id repetido se ignora).
--  · factura_detalle_expediente → qué procesos cubre cada factura de financiero (facturas_clientes):
--                                 un renglón por servicio (un COMPLETO = polígrafo + socio) con su monto
--                                 SIN IVA y su centro de costo → el ingreso cae en la línea de su servicio.
--  · RPC facturacion_agenda_emitir → crear la factura (mismas columnas y reglas que createFactura:
--                                 no_factura único, subtotal materializado, estado EMITIDA, airtable_id
--                                 sintético), su detalle y el vínculo de los expedientes en UNA
--                                 transacción. El trigger 012 (no_factura sin espacios) corre igual.
-- ============================================================

-- ------------------------------------------------------------
-- Mapeo empresa de la Agenda → cliente de financiero
-- ------------------------------------------------------------
create table if not exists cliente_externo (
  id                      uuid primary key default gen_random_uuid(),
  fuente                  text not null default 'agenda',
  empresa_id_externo      text not null,
  empresa_nombre_externo  text,
  nit                     text not null,
  cliente_id              uuid references clientes(id),
  activo                  boolean not null default true,
  creado_por              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (fuente, empresa_id_externo)
);
create index if not exists idx_cliente_externo_nit on cliente_externo (fuente, nit);
alter table cliente_externo enable row level security;

-- ------------------------------------------------------------
-- Espejo local de los expedientes
-- ------------------------------------------------------------
create table if not exists facturacion_expediente (
  id                      uuid primary key default gen_random_uuid(),
  fuente                  text not null default 'agenda',
  id_externo              text not null,
  empresa_id_externo      text,
  empresa_nombre_externo  text,
  nit_resuelto            text,
  cliente_id              uuid references clientes(id),
  persona                 text,
  puesto                  text,
  solicitante             text,
  tipo_prueba             text,
  categoria_prueba        text,
  proceso_solicitado      text,
  depto_visita            text,
  tipo_cobrado            text,
  categoria_canon         text,
  territorio_resuelto     text,
  fecha_ingreso           date,
  fecha_entrega           date,
  status_proceso          text,
  terminado               boolean not null default false,
  cancelado               boolean not null default false,
  eliminado               boolean not null default false,
  en_vista_facturacion    boolean,
  status_cobro_externo    text,
  estatus_pago_externo    text,
  monto_externo           numeric(12,2),
  numero_factura_externo  text,
  fecha_factura_externo   date,
  cobro_megapaca          numeric(12,2),
  costo_visita            numeric(12,2),
  monto_calculado         numeric(12,2),
  estado_tarifa           text not null check (estado_tarifa in ('resuelta', 'sin_tarifa', 'cliente_sin_mapear', 'excluido_psicometrica')),
  detalle_tarifa          text,
  componentes             jsonb,
  creado_en_externo       timestamptz,
  actualizado_en_externo  timestamptz,
  factura_id              uuid references facturas_clientes(id),
  factura_app_id          text,
  no_factura              text,
  facturado_en            timestamptz,
  facturado_por           text,
  writeback_estado        text check (writeback_estado is null or writeback_estado in ('omitido', 'pendiente', 'confirmado', 'conflicto', 'error')),
  writeback_detalle       text,
  writeback_en            timestamptz,
  cobro_writeback_estado  text,
  cobro_writeback_detalle text,
  cobro_writeback_en      timestamptz,
  raw                     jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (fuente, id_externo)
);
create index if not exists idx_fact_exp_nit        on facturacion_expediente (fuente, nit_resuelto);
create index if not exists idx_fact_exp_empresa    on facturacion_expediente (fuente, empresa_id_externo);
create index if not exists idx_fact_exp_no_factura on facturacion_expediente (no_factura);
create index if not exists idx_fact_exp_actualizado on facturacion_expediente (fuente, actualizado_en_externo desc);
alter table facturacion_expediente enable row level security;

-- ------------------------------------------------------------
-- Estado de la sincronización (una fila por fuente)
-- ------------------------------------------------------------
create table if not exists facturacion_sync_estado (
  fuente                 text primary key,
  ultimo_actualizado_en  timestamptz,
  ultima_corrida         timestamptz,
  ultimo_resultado       text,
  expedientes_leidos     integer,
  corridas               integer not null default 0,
  updated_at             timestamptz not null default now()
);
alter table facturacion_sync_estado enable row level security;

-- ------------------------------------------------------------
-- Bitácora de llamadas salientes (sin secretos: ni llave ni cuerpo)
-- ------------------------------------------------------------
create table if not exists facturacion_log (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity,
  fuente        text not null default 'agenda',
  accion        text not null,
  metodo        text,
  ruta          text,
  expedientes   text[],
  status_http   integer,
  ok            boolean not null default false,
  detalle       text,
  duracion_ms   integer,
  actor         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_fact_log_fecha on facturacion_log (fuente, created_at desc);
alter table facturacion_log enable row level security;

-- ------------------------------------------------------------
-- Avisos del webhook ya recibidos (idempotencia por id)
-- ------------------------------------------------------------
create table if not exists facturacion_webhook_evento (
  id          text primary key,
  fuente      text not null default 'agenda',
  tipo        text,
  ocurrido    timestamptz,
  recibido_en timestamptz not null default now()
);
alter table facturacion_webhook_evento enable row level security;

-- ------------------------------------------------------------
-- Detalle de la factura: qué procesos cubre, por servicio
-- ------------------------------------------------------------
create table if not exists factura_detalle_expediente (
  id               uuid primary key default gen_random_uuid(),
  factura_id       uuid not null references facturas_clientes(id) on delete cascade,
  no_factura       text not null,
  expediente_id    uuid references facturacion_expediente(id),
  id_externo       text not null,
  fuente           text not null default 'agenda',
  tipo_prueba      text,
  categoria        text,
  territorio       text,
  monto            numeric(12,2) not null,
  centro_costo_id  uuid references centros_costo(id),
  persona          text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_fact_det_no_factura on factura_detalle_expediente (no_factura);
create index if not exists idx_fact_det_factura    on factura_detalle_expediente (factura_id);
create index if not exists idx_fact_det_externo    on factura_detalle_expediente (fuente, id_externo);
alter table factura_detalle_expediente enable row level security;

-- ------------------------------------------------------------
-- RPC: emitir la factura de un grupo de expedientes (todo o nada)
--
-- p_factura: {no_factura, cliente_id (uuid), fecha_emision, writeback_estado ('pendiente' | 'omitido')}
-- p_lineas:  [{airtable_id, centro_costo_id (uuid), subtotal, iva, total}]  (una por centro de costo)
-- p_detalle: [{id_externo, tipo_prueba, categoria, territorio, monto, centro_costo_id (uuid)}]
--
-- Reglas (las mismas de createFactura): no_factura requerido y único;
-- cada expediente debe existir, estar 'resuelta', terminado, no cancelado ni
-- eliminado y sin factura. Si algo falla, no se escribe nada.
-- Devuelve {factura_id, factura_app_id, no_factura, lineas, expedientes}.
-- ------------------------------------------------------------
create or replace function facturacion_agenda_emitir(p_actor text, p_factura jsonb, p_lineas jsonb, p_detalle jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_nf        text := btrim(coalesce(p_factura->>'no_factura', ''), E' \t\r\n' || chr(160));
  v_cliente   uuid := (p_factura->>'cliente_id')::uuid;
  v_fecha     date := (p_factura->>'fecha_emision')::date;
  v_wb        text := coalesce(nullif(p_factura->>'writeback_estado', ''), 'pendiente');
  v_ids       text[];
  v_principal uuid;
  v_app       text;
  v_n         integer;
  l           jsonb;
  d           jsonb;
begin
  if v_nf = '' then raise exception 'FACTURA_SIN_NUMERO'; end if;
  if v_cliente is null then raise exception 'FACTURA_SIN_CLIENTE'; end if;
  if v_fecha is null then raise exception 'FACTURA_SIN_FECHA'; end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then raise exception 'FACTURA_SIN_LINEAS'; end if;
  if p_detalle is null or jsonb_array_length(p_detalle) = 0 then raise exception 'FACTURA_SIN_EXPEDIENTES'; end if;
  if exists (select 1 from facturas_clientes where no_factura = v_nf) then
    raise exception 'FACTURA_DUPLICADA: la factura % ya existe', v_nf;
  end if;

  select array_agg(distinct x->>'id_externo') into v_ids from jsonb_array_elements(p_detalle) x;
  select count(*) into v_n from facturacion_expediente e where e.fuente = 'agenda' and e.id_externo = any(v_ids);
  if v_n <> cardinality(v_ids) then raise exception 'EXPEDIENTE_DESCONOCIDO'; end if;
  if exists (
    select 1 from facturacion_expediente e
     where e.fuente = 'agenda' and e.id_externo = any(v_ids)
       and (e.estado_tarifa <> 'resuelta' or e.factura_id is not null or not e.terminado or e.cancelado or e.eliminado)
  ) then
    raise exception 'EXPEDIENTE_NO_FACTURABLE: alguno no está resuelto, ya tiene factura o no está terminado';
  end if;

  for l in select * from jsonb_array_elements(p_lineas) loop
    insert into facturas_clientes (airtable_id, no_factura, cliente_id, centro_costo_id, fecha_emision, total, iva, subtotal, estado)
    values (l->>'airtable_id', v_nf, v_cliente, (l->>'centro_costo_id')::uuid, v_fecha,
            (l->>'total')::numeric, (l->>'iva')::numeric, (l->>'subtotal')::numeric, 'EMITIDA');
  end loop;

  -- Principal = la línea de mayor total (igual que createFactura: ahí se cuelga el PDF).
  select id, airtable_id into v_principal, v_app
    from facturas_clientes where no_factura = v_nf
   order by total desc, created_at asc limit 1;

  for d in select * from jsonb_array_elements(p_detalle) loop
    insert into factura_detalle_expediente (factura_id, no_factura, expediente_id, id_externo, fuente, tipo_prueba, categoria, territorio, monto, centro_costo_id, persona)
    select v_principal, v_nf, e.id, d->>'id_externo', 'agenda', d->>'tipo_prueba', d->>'categoria', d->>'territorio',
           (d->>'monto')::numeric, nullif(d->>'centro_costo_id', '')::uuid, e.persona
      from facturacion_expediente e where e.fuente = 'agenda' and e.id_externo = d->>'id_externo';
  end loop;

  update facturacion_expediente
     set factura_id = v_principal, factura_app_id = v_app, no_factura = v_nf, facturado_en = now(), facturado_por = p_actor,
         writeback_estado = v_wb, writeback_detalle = null, writeback_en = null, updated_at = now()
   where fuente = 'agenda' and id_externo = any(v_ids);

  return jsonb_build_object('factura_id', v_principal, 'factura_app_id', v_app, 'no_factura', v_nf,
                            'lineas', jsonb_array_length(p_lineas), 'expedientes', cardinality(v_ids));
end
$fn$;
