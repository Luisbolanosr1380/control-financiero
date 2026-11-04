-- 029 · DETALLE DIGITAL PR 2: aprobación por link (ruta pública) + correo (brief "Detalle digital", partes C y D)
--
-- Qué hace:
--  1. detalle_facturacion: version, destinatarios, respondido_* (nombre / cargo / correo del firmante), firma_png
--     (data URL PNG ≤ 200 KB), documento_hash (huella SHA-256 del contenido firmado) y el estado nuevo
--     `con_observaciones` (el cliente devolvió líneas con corrección / próximo mes / no aplica).
--  2. detalle_facturacion_link: un link por versión; en la base SOLO el sha256 del token (nunca el token);
--     expira a los 30 días; se revoca al reenviar, anular o por botón; un solo uso para responder (usado_en);
--     abierto_en es informativo (los antivirus de correo abren los links solos).
--  3. detalle_facturacion_respuesta: una fila por línea y versión (aprobado / correccion / proximo_mes / no_aplica,
--     nota del cliente y respuesta de Golden).
--  4. detalle_facturacion_envio: bitácora de cada envío (a quién, versión, modo, resultado del proveedor).
--  5. detalle_link_intento + detalle_link_rate_limit(): rate limit por IP y por token en tabla (sin Redis), con purga.
--  6. facturacion_componente.diferida_hasta: "cobrar el próximo mes" es solo una marca y un filtro de pantalla;
--     la regla SQL de la cola NO cambia.
--  7. RPCs (plpgsql, una transacción cada una; execute solo para service_role, como en la 027):
--     · detalle_facturacion_quitar_linea(p_actor, p_detalle_id, p_componente_id, p_motivo, p_diferir_hasta):
--       solo en borrador / con_observaciones; libera la prueba (vuelve a la cola), recalcula los totales y, si
--       viene p_diferir_hasta, la deja marcada "diferida".
--     · detalle_link_emitir(p_actor, p_detalle_id, p_token_hash, p_documento_hash, p_destinatarios, p_dias):
--       revoca los links vigentes, sube la versión si venía con observaciones, crea el link y deja el detalle en
--       `enviada` con sus destinatarios.
--     · detalle_link_revocar(p_actor, p_detalle_id, p_motivo).
--     · detalle_link_abrir(p_token_hash): SOLO LEE (nunca consume el link ni cambia el estado; solo fija
--       abierto_en la primera vez). Devuelve el estado del link (invalido / nueva_version / vigente / respondido)
--       y, si corresponde, el contenido para la página pública SIN nada interno.
--     · detalle_link_responder(p_token_hash, p_respuestas, p_firma, p_ip, p_user_agent, p_documento_hash): valida
--       link vigente (no revocado, no usado, no vencido, versión actual), detalle en `enviada`, huella igual,
--       respuestas que cubren EXACTAMENTE las líneas, nota obligatoria donde se exige, firma solo con todo
--       aprobado; guarda todo y cambia el estado (aprobada con canal link, o con_observaciones).
--
-- Idempotente; sin drop de tablas / funciones, sin delete de datos, sin begin/commit (se recrea el check del estado,
-- patrón 018). No toca tarifario, motor de cobro (024), fechas (025), "cobrada" (026), mapa de precios (027),
-- emisión SAT, write-back ni la regla SQL de la cola.

-- ── 1. detalle_facturacion ───────────────────────────────────────────────────────────────────────
alter table detalle_facturacion add column if not exists version integer not null default 1;
alter table detalle_facturacion add column if not exists destinatarios text[];
alter table detalle_facturacion add column if not exists respondido_en timestamptz;
alter table detalle_facturacion add column if not exists respondido_por_nombre text;
alter table detalle_facturacion add column if not exists respondido_por_cargo text;
alter table detalle_facturacion add column if not exists respondido_por_correo text;
alter table detalle_facturacion add column if not exists firma_png text;
alter table detalle_facturacion add column if not exists documento_hash text;
alter table detalle_facturacion drop constraint if exists detalle_facturacion_estado_check;
alter table detalle_facturacion add constraint detalle_facturacion_estado_check
  check (estado in ('borrador', 'enviada', 'con_observaciones', 'aprobada', 'facturada', 'anulada'));
alter table detalle_facturacion drop constraint if exists detalle_facturacion_firma_png_check;
alter table detalle_facturacion add constraint detalle_facturacion_firma_png_check
  check (firma_png is null or (length(firma_png) <= 280000 and firma_png like 'data:image/png;base64,%'));
comment on column detalle_facturacion.version is '029: versión del detalle enviada al cliente; sube al reenviar una versión corregida.';
comment on column detalle_facturacion.firma_png is '029: firma dibujada por el cliente (data URL PNG, ≤ 200 KB) cuando aprobó por link.';
comment on column detalle_facturacion.documento_hash is '029: sha256 del contenido firmado (líneas, montos y total de esa versión): la huella que muestra el PDF.';

-- ── 6. diferida ──────────────────────────────────────────────────────────────────────────────────
alter table facturacion_componente add column if not exists diferida_hasta date;
comment on column facturacion_componente.diferida_hasta is '029: el cliente pidió cobrarla el próximo mes: marca y filtro de pantalla (la regla SQL de la cola no cambia).';

-- ── 2. links ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists detalle_facturacion_link (
  id                    uuid primary key default gen_random_uuid(),
  detalle_id            uuid not null references detalle_facturacion(id) on delete cascade,
  version               integer not null,
  token_hash            text not null unique,
  documento_hash        text not null,
  creado_en             timestamptz not null default now(),
  creado_por            text,
  expira_en             timestamptz not null,
  revocado_en           timestamptz,
  revocado_motivo       text,
  abierto_en            timestamptz,
  usado_en              timestamptz,
  ip_respuesta          text,
  user_agent_respuesta  text
);
create index if not exists idx_detalle_link_detalle on detalle_facturacion_link (detalle_id, version);
alter table detalle_facturacion_link enable row level security;

-- ── 3. respuestas ────────────────────────────────────────────────────────────────────────────────
create table if not exists detalle_facturacion_respuesta (
  id               uuid primary key default gen_random_uuid(),
  detalle_id       uuid not null references detalle_facturacion(id) on delete cascade,
  version          integer not null,
  componente_id    uuid not null references facturacion_componente(id) on delete cascade,
  decision         text not null check (decision in ('aprobado', 'correccion', 'proximo_mes', 'no_aplica')),
  nota             text,
  respuesta_golden text,
  respondida_por   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (detalle_id, version, componente_id)
);
create index if not exists idx_detalle_resp_detalle on detalle_facturacion_respuesta (detalle_id, version);
alter table detalle_facturacion_respuesta enable row level security;

-- ── 4. bitácora de envíos ────────────────────────────────────────────────────────────────────────
create table if not exists detalle_facturacion_envio (
  id            uuid primary key default gen_random_uuid(),
  detalle_id    uuid not null references detalle_facturacion(id) on delete cascade,
  version       integer not null,
  link_id       uuid references detalle_facturacion_link(id) on delete set null,
  tipo          text not null default 'envio' check (tipo in ('envio', 'aviso')),
  destinatarios text[] not null default '{}',
  cc            text[] not null default '{}',
  asunto        text,
  modo          text not null check (modo in ('resend', 'mock', 'copiar_link')),
  resultado     text not null check (resultado in ('enviado', 'error', 'sin_llave')),
  proveedor_id  text,
  error         text,
  enviado_por   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_detalle_envio_detalle on detalle_facturacion_envio (detalle_id, created_at);
alter table detalle_facturacion_envio enable row level security;

-- ── 5. rate limit en tabla ───────────────────────────────────────────────────────────────────────
create table if not exists detalle_link_intento (
  clave    text not null,
  ventana  timestamptz not null,
  n        integer not null default 1,
  primary key (clave, ventana)
);
alter table detalle_link_intento enable row level security;

-- true = dentro del límite (y cuenta el intento); false = excedido. Purga las ventanas de más de un día.
create or replace function detalle_link_rate_limit(p_clave text, p_limite integer, p_ventana_seg integer default 60)
returns boolean
language plpgsql
as $fn$
declare
  v_ventana timestamptz := to_timestamp(floor(extract(epoch from now()) / p_ventana_seg) * p_ventana_seg);
  v_n integer;
begin
  delete from detalle_link_intento where ventana < now() - interval '1 day';
  insert into detalle_link_intento (clave, ventana, n) values (p_clave, v_ventana, 1)
    on conflict (clave, ventana) do update set n = detalle_link_intento.n + 1
    returning n into v_n;
  return v_n <= p_limite;
end
$fn$;

-- ── 7. RPCs ──────────────────────────────────────────────────────────────────────────────────────

-- Recalcula pruebas / expedientes / subtotal / iva / total de un detalle a partir de sus componentes reservados.
create or replace function detalle_facturacion_recalcular(p_detalle_id uuid)
returns void
language plpgsql
as $fn$
declare
  v_sub numeric(12,2); v_n integer; v_exp integer;
begin
  select coalesce(sum(c.monto_calculado) filter (where c.situacion = 'cobra' and c.estado_tarifa = 'resuelta'), 0), count(*), count(distinct c.expediente_id)
    into v_sub, v_n, v_exp
    from facturacion_componente c where c.detalle_id = p_detalle_id;
  update detalle_facturacion
     set subtotal = v_sub, iva = round(v_sub * 0.12, 2), total = v_sub + round(v_sub * 0.12, 2), pruebas = v_n, expedientes = v_exp, updated_at = now()
   where id = p_detalle_id;
end
$fn$;

create or replace function detalle_facturacion_quitar_linea(p_actor text, p_detalle_id uuid, p_componente_id uuid, p_motivo text default null, p_diferir_hasta date default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_row detalle_facturacion%rowtype;
begin
  select * into v_row from detalle_facturacion where id = p_detalle_id for update;
  if v_row.id is null then raise exception 'DETALLE_NO_EXISTE'; end if;
  if v_row.estado not in ('borrador', 'con_observaciones') then raise exception 'DETALLE_NO_EDITABLE: solo se quitan líneas en borrador o con observaciones'; end if;
  if not exists (select 1 from facturacion_componente c where c.id = p_componente_id and c.detalle_id = p_detalle_id and c.factura_id is null) then
    raise exception 'LINEA_NO_ESTA: la prueba no está en este detalle';
  end if;
  update facturacion_componente
     set detalle_id = null, diferida_hasta = coalesce(p_diferir_hasta, diferida_hasta), updated_at = now()
   where id = p_componente_id;
  -- queda la nota del cliente y el motivo de Golden en la respuesta de la versión vigente (si existe)
  update detalle_facturacion_respuesta
     set respuesta_golden = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), respuesta_golden), respondida_por = p_actor, updated_at = now()
   where detalle_id = p_detalle_id and version = v_row.version and componente_id = p_componente_id;
  perform detalle_facturacion_recalcular(p_detalle_id);
  select * into v_row from detalle_facturacion where id = p_detalle_id;
  return to_jsonb(v_row);
end
$fn$;

create or replace function detalle_link_emitir(p_actor text, p_detalle_id uuid, p_token_hash text, p_documento_hash text, p_destinatarios text[] default '{}', p_dias integer default 30)
returns jsonb
language plpgsql
as $fn$
declare
  v_row detalle_facturacion%rowtype;
  v_link detalle_facturacion_link%rowtype;
  v_version integer;
begin
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'TOKEN_HASH_INVALIDO'; end if;
  select * into v_row from detalle_facturacion where id = p_detalle_id for update;
  if v_row.id is null then raise exception 'DETALLE_NO_EXISTE'; end if;
  if v_row.estado not in ('borrador', 'enviada', 'con_observaciones') then raise exception 'DETALLE_NO_ENVIABLE: el detalle está %', v_row.estado; end if;
  if coalesce(v_row.pruebas, 0) = 0 then raise exception 'DETALLE_VACIO: el detalle no tiene pruebas'; end if;
  v_version := case when v_row.estado = 'con_observaciones' then v_row.version + 1 else v_row.version end;
  update detalle_facturacion_link set revocado_en = now(), revocado_motivo = 'reemplazado por un link nuevo'
   where detalle_id = p_detalle_id and revocado_en is null and usado_en is null;
  insert into detalle_facturacion_link (detalle_id, version, token_hash, documento_hash, creado_por, expira_en)
  values (p_detalle_id, v_version, p_token_hash, p_documento_hash, p_actor, now() + make_interval(days => greatest(coalesce(p_dias, 30), 1)))
  returning * into v_link;
  update detalle_facturacion
     set estado = 'enviada', version = v_version, enviada_en = now(), enviada_por = p_actor, destinatarios = coalesce(p_destinatarios, '{}'), documento_hash = p_documento_hash, updated_at = now()
   where id = p_detalle_id;
  select * into v_row from detalle_facturacion where id = p_detalle_id;
  return jsonb_build_object('detalle', to_jsonb(v_row), 'link', to_jsonb(v_link) - 'token_hash');
end
$fn$;

create or replace function detalle_link_revocar(p_actor text, p_detalle_id uuid, p_motivo text default null)
returns integer
language plpgsql
as $fn$
declare v_n integer;
begin
  update detalle_facturacion_link set revocado_en = now(), revocado_motivo = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'revocado por ' || coalesce(p_actor, '—'))
   where detalle_id = p_detalle_id and revocado_en is null and usado_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

-- Contenido de la página pública: SOLO lo que el cliente debe ver. (El componente_id y el NIT salen para que la app
-- arme la referencia opaca HMAC y recalcule la huella; la app NUNCA los manda al navegador.)
create or replace function detalle_link_contenido(p_detalle detalle_facturacion)
returns jsonb
language sql stable
as $fn$
  select jsonb_build_object(
    'correlativo', p_detalle.correlativo, 'version', p_detalle.version, 'estado', p_detalle.estado, 'nit', p_detalle.nit,
    'titulo', p_detalle.titulo, 'dirigido_a', p_detalle.dirigido_a, 'notas', p_detalle.notas,
    'cliente', coalesce((select btrim(x.nombre_empresa) from clientes x where x.nit = p_detalle.nit and x.activo limit 1),
                        (select max(e.empresa_nombre_externo) from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id where c.detalle_id = p_detalle.id),
                        'Cliente'),
    'subtotal', p_detalle.subtotal, 'iva', p_detalle.iva, 'total', p_detalle.total,
    'respondido_en', p_detalle.respondido_en, 'respondido_por_nombre', p_detalle.respondido_por_nombre, 'respondido_por_cargo', p_detalle.respondido_por_cargo,
    'firma_png', p_detalle.firma_png, 'documento_hash', p_detalle.documento_hash,
    'lineas', (select coalesce(jsonb_agg(jsonb_build_object(
                 'componente_id', c.id, 'persona', e.persona, 'puesto', e.puesto, 'solicitante', upper(btrim(coalesce(e.solicitante, ''))),
                 'fecha_ingreso', e.fecha_ingreso, 'servicio', c.servicio, 'estado_prueba', c.estado_prueba, 'categoria', c.categoria, 'territorio', c.territorio,
                 'monto', coalesce(c.monto_calculado, 0)) order by e.persona, c.servicio), '[]'::jsonb)
                 from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
                where c.detalle_id = p_detalle.id and c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0),
    'respuestas', (select coalesce(jsonb_agg(jsonb_build_object('componente_id', r.componente_id, 'version', r.version, 'decision', r.decision, 'nota', r.nota, 'respuesta_golden', r.respuesta_golden) order by r.version, r.componente_id), '[]'::jsonb)
                     from detalle_facturacion_respuesta r where r.detalle_id = p_detalle.id and r.version >= p_detalle.version - 1)
  )
$fn$;

create or replace function detalle_link_abrir(p_token_hash text)
returns jsonb
language plpgsql
as $fn$
declare
  v_link detalle_facturacion_link%rowtype;
  v_row detalle_facturacion%rowtype;
begin
  select * into v_link from detalle_facturacion_link where token_hash = p_token_hash;
  if v_link.id is null then return jsonb_build_object('estado', 'invalido'); end if;
  select * into v_row from detalle_facturacion where id = v_link.detalle_id;
  if v_row.id is null or v_row.estado in ('anulada', 'facturada') and v_link.usado_en is null then return jsonb_build_object('estado', 'invalido'); end if;
  -- reemplazado por una versión nueva (aunque ya se haya respondido): "Hay una versión más nueva, revisá tu correo"
  if v_link.version < v_row.version or (v_link.revocado_en is not null and v_link.usado_en is null) then return jsonb_build_object('estado', 'nueva_version'); end if;
  if v_link.usado_en is not null then
    return jsonb_build_object('estado', 'respondido', 'version', v_link.version, 'expira_en', v_link.expira_en, 'huella', v_link.documento_hash, 'contenido', detalle_link_contenido(v_row));
  end if;
  if v_link.expira_en < now() then return jsonb_build_object('estado', 'invalido'); end if;
  if v_row.estado <> 'enviada' then return jsonb_build_object('estado', 'invalido'); end if;
  if v_link.abierto_en is null then update detalle_facturacion_link set abierto_en = now() where id = v_link.id; end if;
  return jsonb_build_object('estado', 'vigente', 'version', v_link.version, 'expira_en', v_link.expira_en, 'huella', v_link.documento_hash, 'contenido', detalle_link_contenido(v_row));
end
$fn$;

create or replace function detalle_link_responder(p_token_hash text, p_respuestas jsonb, p_firma jsonb default null, p_ip text default null, p_user_agent text default null, p_documento_hash text default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_link detalle_facturacion_link%rowtype;
  v_row detalle_facturacion%rowtype;
  v_n_lineas integer; v_n_resp integer; v_n_distintas integer; v_n_fuera integer; v_n_no_aprobadas integer; v_sin_nota integer; v_malas integer;
  v_todas boolean; v_nombre text; v_cargo text; v_correo text; v_png text; v_autoriza boolean;
begin
  select * into v_link from detalle_facturacion_link where token_hash = p_token_hash for update;
  if v_link.id is null then raise exception 'LINK_INVALIDO'; end if;
  select * into v_row from detalle_facturacion where id = v_link.detalle_id for update;
  if v_row.id is null or v_row.estado in ('anulada', 'facturada') then raise exception 'LINK_INVALIDO'; end if;
  if v_link.revocado_en is not null or v_link.version < v_row.version then raise exception 'LINK_NUEVA_VERSION'; end if;
  if v_link.usado_en is not null then raise exception 'LINK_USADO'; end if;
  if v_link.expira_en < now() then raise exception 'LINK_VENCIDO'; end if;
  if v_row.estado <> 'enviada' then raise exception 'LINK_INVALIDO'; end if;
  if p_documento_hash is null or p_documento_hash <> v_link.documento_hash then raise exception 'DOCUMENTO_CAMBIO: el detalle cambió desde que se envió'; end if;
  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'array' then raise exception 'RESPUESTAS_INVALIDAS'; end if;

  -- las respuestas cubren EXACTAMENTE las líneas del detalle (ni una más, ni una menos, sin repetidos)
  select count(*) into v_n_lineas from facturacion_componente c where c.detalle_id = v_row.id and c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0;
  select count(*), count(distinct (r->>'componente_id')) into v_n_resp, v_n_distintas from jsonb_array_elements(p_respuestas) r;
  select count(*) into v_n_fuera from jsonb_array_elements(p_respuestas) r
   where not exists (select 1 from facturacion_componente c where c.id::text = r->>'componente_id' and c.detalle_id = v_row.id and c.situacion = 'cobra' and c.estado_tarifa = 'resuelta' and coalesce(c.monto_calculado, 0) > 0);
  if v_n_resp <> v_n_lineas or v_n_distintas <> v_n_lineas or v_n_fuera > 0 then raise exception 'RESPUESTAS_NO_CUBREN: % respuestas para % líneas (% fuera)', v_n_resp, v_n_lineas, v_n_fuera; end if;
  select count(*) into v_malas from jsonb_array_elements(p_respuestas) r where coalesce(r->>'decision', '') not in ('aprobado', 'correccion', 'proximo_mes', 'no_aplica');
  if v_malas > 0 then raise exception 'DECISION_INVALIDA'; end if;
  select count(*) into v_sin_nota from jsonb_array_elements(p_respuestas) r where r->>'decision' <> 'aprobado' and length(btrim(coalesce(r->>'nota', ''))) < 3;
  if v_sin_nota > 0 then raise exception 'NOTA_OBLIGATORIA: % línea(s) sin motivo', v_sin_nota; end if;
  select count(*) into v_n_no_aprobadas from jsonb_array_elements(p_respuestas) r where r->>'decision' <> 'aprobado';
  v_todas := v_n_no_aprobadas = 0;

  if v_todas then
    -- solo se firma con todo aprobado
    v_nombre := nullif(btrim(coalesce(p_firma->>'nombre', '')), '');
    v_cargo := nullif(btrim(coalesce(p_firma->>'cargo', '')), '');
    v_correo := nullif(btrim(coalesce(p_firma->>'correo', '')), '');
    v_png := p_firma->>'png';
    v_autoriza := coalesce((p_firma->>'autoriza')::boolean, false);
    if v_nombre is null or v_cargo is null or v_correo is null then raise exception 'FIRMA_INCOMPLETA: nombre, cargo y correo son obligatorios'; end if;
    if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'FIRMA_CORREO_INVALIDO'; end if;
    if not v_autoriza then raise exception 'FIRMA_SIN_AUTORIZACION: falta la casilla de autorización'; end if;
    if v_png is null or v_png not like 'data:image/png;base64,%' or length(v_png) < 200 or length(v_png) > 280000 then raise exception 'FIRMA_PNG_INVALIDA'; end if;
  end if;

  insert into detalle_facturacion_respuesta (detalle_id, version, componente_id, decision, nota)
  select v_row.id, v_link.version, (r->>'componente_id')::uuid, r->>'decision', nullif(btrim(coalesce(r->>'nota', '')), '')
    from jsonb_array_elements(p_respuestas) r
  on conflict (detalle_id, version, componente_id) do update set decision = excluded.decision, nota = excluded.nota, updated_at = now();

  update detalle_facturacion_link set usado_en = now(), ip_respuesta = left(p_ip, 64), user_agent_respuesta = left(p_user_agent, 300) where id = v_link.id;

  if v_todas then
    update detalle_facturacion
       set estado = 'aprobada', aprobada_en = now(), aprobado_por = left(v_nombre, 200), aprobado_canal = 'link',
           respondido_en = now(), respondido_por_nombre = left(v_nombre, 200), respondido_por_cargo = left(v_cargo, 200), respondido_por_correo = left(v_correo, 200),
           firma_png = v_png, documento_hash = v_link.documento_hash, updated_at = now()
     where id = v_row.id;
  else
    update detalle_facturacion
       set estado = 'con_observaciones', respondido_en = now(),
           respondido_por_nombre = nullif(left(btrim(coalesce(p_firma->>'nombre', '')), 200), ''), respondido_por_cargo = nullif(left(btrim(coalesce(p_firma->>'cargo', '')), 200), ''), respondido_por_correo = nullif(left(btrim(coalesce(p_firma->>'correo', '')), 200), ''),
           updated_at = now()
     where id = v_row.id;
  end if;
  return jsonb_build_object('estado', case when v_todas then 'aprobada' else 'con_observaciones' end, 'observaciones', v_n_no_aprobadas, 'version', v_link.version, 'huella', v_link.documento_hash);
end
$fn$;

-- ── Permisos: solo el servidor (service_role) ────────────────────────────────────────────────────
revoke all on function detalle_link_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function detalle_facturacion_recalcular(uuid) from public, anon, authenticated;
revoke all on function detalle_facturacion_quitar_linea(text, uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function detalle_link_emitir(text, uuid, text, text, text[], integer) from public, anon, authenticated;
revoke all on function detalle_link_revocar(text, uuid, text) from public, anon, authenticated;
revoke all on function detalle_link_contenido(detalle_facturacion) from public, anon, authenticated;
revoke all on function detalle_link_abrir(text) from public, anon, authenticated;
revoke all on function detalle_link_responder(text, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function detalle_link_rate_limit(text, integer, integer) to service_role;
grant execute on function detalle_facturacion_recalcular(uuid) to service_role;
grant execute on function detalle_facturacion_quitar_linea(text, uuid, uuid, text, date) to service_role;
grant execute on function detalle_link_emitir(text, uuid, text, text, text[], integer) to service_role;
grant execute on function detalle_link_revocar(text, uuid, text) to service_role;
grant execute on function detalle_link_contenido(detalle_facturacion) to service_role;
grant execute on function detalle_link_abrir(text) to service_role;
grant execute on function detalle_link_responder(text, jsonb, jsonb, text, text, text) to service_role;

-- ── Ayuda ────────────────────────────────────────────────────────────────────────────────────────
update ayuda set
  contenido = replace(contenido,
    E'## El flujo\n\nBorrador → *Marcar como enviada* → *Marcar como aprobada* (quién y por qué canal) → *Facturar (SAT/FEL)*. Un detalle se anula y sus pruebas vuelven a la cola; un detalle facturado no se anula (se anula la factura).',
    E'## Enviar al cliente y aprobación digital\n\n*Enviar al cliente* manda un correo (desde facturacion@golden-talent.com) con un **link de aprobación** que vence a los 30 días. Si el correo no está configurado, el botón copia el link con un texto listo para pegar. El cliente abre el link sin usuario, revisa línea por línea (**Aprobado**, **Corrección**, **Cobrar el próximo mes** o **No aplica**, con el motivo obligatorio en las tres últimas) y:\n\n- si todo está aprobado, **firma** (nombre, cargo, correo, casilla de autorización y firma dibujada) y el detalle queda **aprobado** con canal *link*, listo para facturar;\n- si alguna línea no está aprobada, no puede firmar: manda las observaciones y el detalle queda **con observaciones**. En Por facturar → Detalles se ve con su badge; cada línea muestra la respuesta del cliente y su nota. Facturación corrige afuera y presiona *Re-resolver*, **quita la línea** (vuelve a la cola; si pidió el próximo mes queda marcada *Diferida a <mes>* y "Solo cobrable" la esconde hasta entonces) y puede dejar una *Respuesta de Golden* que el cliente verá en la versión siguiente. *Enviar versión corregida* sube la versión, revoca el link anterior y manda el correo otra vez.\n\nAl responder, el link queda en solo lectura y llega un aviso a quien envió el detalle. El PDF de un detalle aprobado por link muestra la firma, el nombre, el cargo, la fecha y la huella del documento.\n\n## El flujo\n\nBorrador → *Enviar al cliente* (o *Marcar como enviada* si fue por otro canal) → aprobación del cliente (por link, o *Marcar como aprobada* indicando quién y por qué canal) → *Facturar (SAT/FEL)*. Un detalle se anula y sus pruebas vuelven a la cola; un detalle facturado no se anula (se anula la factura).'),
  updated_at = now()
where slug = 'detalle-de-facturacion-armar-el-corte';
