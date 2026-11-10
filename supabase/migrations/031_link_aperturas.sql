-- 031 · REGISTRO DE APERTURAS DEL LINK DEL DETALLE («¿alguien lo vio?») (brief del CFO, 5-nov-2026)
--
-- Por qué: `detalle_facturacion_link.abierto_en` guarda SOLO la primera apertura y no se muestra en ninguna pantalla.
-- Además engaña: en Golden el DET-0010 se abrió 11 segundos después de creado y el DET-0008 a los 2 minutos (casi
-- seguro quien lo envió, probando el link), y esa primera apertura tapa la del cliente. El CFO quiere saber si el
-- cliente ABRIÓ el link, cuándo y cuántas veces, aunque no se sepa quién.
--
-- Qué hace:
--  1. detalle_facturacion_link.creador_ip_hash: el hash de la red de quien envió (Enviar al cliente / Copiar link).
--     Las aperturas desde esa misma red salen marcadas «desde la red de quien envió» y NO cuentan.
--  2. Tabla detalle_facturacion_link_apertura (RLS, solo service_role): una fila por apertura con dispositivo
--     (movil / escritorio / tablet / desconocido) y navegador (familia corta) derivados del user agent EN EL SERVIDOR
--     (nunca el user agent completo), ip_hash = sha256(ip + DETALLE_LINK_SECRET) truncado a 16 (distingue «otra red»
--     sin guardar la IP) y `respondio` (la apertura previa a responder).
--  3. detalle_link_abrir(p_token_hash, p_ip_hash, p_dispositivo, p_navegador): la misma lectura de la 029 (NUNCA
--     consume el link ni cambia el estado; abierto_en del link sigue siendo la primera apertura) + registra la apertura
--     cuando el link está `vigente` o `respondido`. Para no inflar el conteo con recargas, otra apertura del mismo
--     ip_hash + dispositivo dentro de 10 minutos NO crea fila: actualiza la última. Un link inválido, vencido,
--     revocado o reemplazado no registra nada. La versión de un argumento (029) queda como envoltorio.
--  4. detalle_link_emitir(…, p_creador_ip_hash): igual que la 029 + guarda el hash de quien envía. La versión de
--     6 argumentos queda como envoltorio (sin hash).
--  5. Ayuda: una línea en el artículo del detalle («Abierto = alguien abrió el link…»), idempotente.
--
-- Sin overloads ambiguos: las funciones nuevas NO tienen defaults, así una llamada con nombres resuelve a una sola.
-- No toca: la seguridad del link (token en el fragmento, GET que no consume, un solo uso), la huella, el flujo de
-- aprobación ni la regla del IVA (030). Nada nuevo va al navegador del cliente.
-- Idempotente; sin drop, delete, truncate, begin/commit.

-- ── 1. la red de quien envió ─────────────────────────────────────────────────────────────────────
alter table detalle_facturacion_link add column if not exists creador_ip_hash text;
comment on column detalle_facturacion_link.creador_ip_hash is '031: sha256(ip + DETALLE_LINK_SECRET) truncado a 16 de quien presionó Enviar al cliente / Copiar link; las aperturas desde esa red no cuentan.';

-- ── 2. aperturas ─────────────────────────────────────────────────────────────────────────────────
create table if not exists detalle_facturacion_link_apertura (
  id           uuid primary key default gen_random_uuid(),
  link_id      uuid not null references detalle_facturacion_link(id) on delete cascade,
  detalle_id   uuid not null references detalle_facturacion(id) on delete cascade,
  version      integer not null,
  abierto_en   timestamptz not null default now(),
  dispositivo  text not null default 'desconocido' check (dispositivo in ('movil', 'escritorio', 'tablet', 'desconocido')),
  navegador    text,
  ip_hash      text,
  respondio    boolean not null default false
);
comment on table detalle_facturacion_link_apertura is '031: una fila por apertura del link del detalle (recargas del mismo ip_hash + dispositivo dentro de 10 min actualizan la última). «Abierto» ≠ «leído por el cliente»: un antivirus de correo puede ejecutar JS.';
create index if not exists idx_detalle_link_apertura_detalle on detalle_facturacion_link_apertura (detalle_id, abierto_en desc);
create index if not exists idx_detalle_link_apertura_link on detalle_facturacion_link_apertura (link_id, ip_hash, dispositivo, abierto_en desc);
alter table detalle_facturacion_link_apertura enable row level security;
revoke all on table detalle_facturacion_link_apertura from public, anon, authenticated;
grant all on table detalle_facturacion_link_apertura to service_role;

-- ── 3. abrir: lee (nunca consume) + registra la apertura ─────────────────────────────────────────
create or replace function detalle_link_abrir(p_token_hash text, p_ip_hash text, p_dispositivo text, p_navegador text)
returns jsonb
language plpgsql
as $fn$
declare
  v_link detalle_facturacion_link%rowtype;
  v_row detalle_facturacion%rowtype;
  v_estado text;
  v_disp text;
  v_ap_id uuid;
  v_res jsonb;
begin
  select * into v_link from detalle_facturacion_link where token_hash = p_token_hash;
  if v_link.id is null then return jsonb_build_object('estado', 'invalido'); end if;
  select * into v_row from detalle_facturacion where id = v_link.detalle_id;
  if v_row.id is null or v_row.estado in ('anulada', 'facturada') and v_link.usado_en is null then return jsonb_build_object('estado', 'invalido'); end if;
  -- reemplazado por una versión nueva (aunque ya se haya respondido): "Hay una versión más nueva, revisá tu correo"
  if v_link.version < v_row.version or (v_link.revocado_en is not null and v_link.usado_en is null) then return jsonb_build_object('estado', 'nueva_version'); end if;
  if v_link.usado_en is not null then
    v_estado := 'respondido';
  else
    if v_link.expira_en < now() then return jsonb_build_object('estado', 'invalido'); end if;
    if v_row.estado <> 'enviada' then return jsonb_build_object('estado', 'invalido'); end if;
    v_estado := 'vigente';
    if v_link.abierto_en is null then update detalle_facturacion_link set abierto_en = now() where id = v_link.id; end if;
  end if;

  -- registro de la apertura (vigente o respondido): recargas del mismo ip_hash + dispositivo en 10 min → se actualiza la última
  v_disp := case when p_dispositivo in ('movil', 'escritorio', 'tablet') then p_dispositivo else 'desconocido' end;
  select id into v_ap_id from detalle_facturacion_link_apertura
   where link_id = v_link.id and ip_hash is not distinct from left(p_ip_hash, 16) and dispositivo = v_disp and abierto_en > now() - interval '10 minutes'
   order by abierto_en desc limit 1;
  if v_ap_id is not null then
    update detalle_facturacion_link_apertura set abierto_en = now(), navegador = coalesce(left(p_navegador, 40), navegador) where id = v_ap_id;
  else
    insert into detalle_facturacion_link_apertura (link_id, detalle_id, version, dispositivo, navegador, ip_hash)
    values (v_link.id, v_link.detalle_id, v_link.version, v_disp, left(p_navegador, 40), left(p_ip_hash, 16));
  end if;

  v_res := jsonb_build_object('estado', v_estado, 'version', v_link.version, 'expira_en', v_link.expira_en, 'huella', v_link.documento_hash, 'contenido', detalle_link_contenido(v_row));
  return v_res;
end
$fn$;

-- 029: la versión de un argumento queda como envoltorio (registra la apertura sin red ni dispositivo).
create or replace function detalle_link_abrir(p_token_hash text)
returns jsonb
language sql
as $fn$ select detalle_link_abrir(p_token_hash, null, null, null) $fn$;

-- ── 4. emitir: + hash de la red de quien envía ───────────────────────────────────────────────────
create or replace function detalle_link_emitir(p_actor text, p_detalle_id uuid, p_token_hash text, p_documento_hash text, p_destinatarios text[], p_dias integer, p_creador_ip_hash text)
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
  insert into detalle_facturacion_link (detalle_id, version, token_hash, documento_hash, creado_por, expira_en, creador_ip_hash)
  values (p_detalle_id, v_version, p_token_hash, p_documento_hash, p_actor, now() + make_interval(days => greatest(coalesce(p_dias, 30), 1)), left(p_creador_ip_hash, 16))
  returning * into v_link;
  update detalle_facturacion
     set estado = 'enviada', version = v_version, enviada_en = now(), enviada_por = p_actor, destinatarios = coalesce(p_destinatarios, '{}'), documento_hash = p_documento_hash, updated_at = now()
   where id = p_detalle_id;
  select * into v_row from detalle_facturacion where id = p_detalle_id;
  return jsonb_build_object('detalle', to_jsonb(v_row), 'link', to_jsonb(v_link) - 'token_hash');
end
$fn$;

-- 029: la versión de 6 argumentos queda como envoltorio (sin hash del creador).
create or replace function detalle_link_emitir(p_actor text, p_detalle_id uuid, p_token_hash text, p_documento_hash text, p_destinatarios text[] default '{}', p_dias integer default 30)
returns jsonb
language sql
as $fn$ select detalle_link_emitir(p_actor, p_detalle_id, p_token_hash, p_documento_hash, p_destinatarios, p_dias, null) $fn$;

-- ── Permisos: solo el servidor (service_role) ────────────────────────────────────────────────────
revoke all on function detalle_link_abrir(text, text, text, text) from public, anon, authenticated;
revoke all on function detalle_link_abrir(text) from public, anon, authenticated;
revoke all on function detalle_link_emitir(text, uuid, text, text, text[], integer, text) from public, anon, authenticated;
revoke all on function detalle_link_emitir(text, uuid, text, text, text[], integer) from public, anon, authenticated;
grant execute on function detalle_link_abrir(text, text, text, text) to service_role;
grant execute on function detalle_link_abrir(text) to service_role;
grant execute on function detalle_link_emitir(text, uuid, text, text, text[], integer, text) to service_role;
grant execute on function detalle_link_emitir(text, uuid, text, text, text[], integer) to service_role;

-- ── 5. ayuda del detalle: una línea (idempotente) ────────────────────────────────────────────────
update ayuda
   set contenido = contenido || E'\n\n**Abierto** = alguien abrió el link (puede ser un antivirus del correo); no confirma quién lo leyó. En el detalle, junto a *Enviado al cliente*, se ve cuántas veces se abrió, la primera y la última apertura y desde cuántos dispositivos; las aperturas desde la red de quien lo envió (probablemente Golden) se marcan aparte y no cuentan. En Por facturar → Detalles, los enviados llevan *Visto* / *Sin abrir*: enviado hace días y sin abrir = hay que llamar.',
       updated_at = now()
 where slug = 'detalle-de-facturacion-armar-el-corte' and contenido not like '%**Abierto** = alguien abrió el link%';
