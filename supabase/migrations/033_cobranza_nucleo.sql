-- 033 · CENTRO DE COBROS · PR 1: la ficha de cobranza del cliente + la bandeja del día (brief del CFO, 10-nov-2026)
--
-- Por qué: «no podemos encontrar el tracking: se le manda un correo, no sabemos qué hemos hecho, qué nos dijo el
-- cliente, qué gestionamos». La bitácora que existe (gestiones_cobro + gestion_facturas, 3 registros) está escondida
-- en un modal y no muestra el historial; el contacto de cobro es un texto libre. Se EXTIENDE, no se reemplaza: los
-- registros existentes se migran al historial nuevo.
--
-- Qué hace:
--  1. cliente_contacto: varias personas por cliente (nombre, cargo, rol en el cobro, correo, teléfono, WhatsApp,
--     preferido, notas, activo). Cuando el cliente cambia de persona, el contacto se DESACTIVA, no se borra.
--     Backfill: un contacto «Cobros» preferido por cliente desde email_cobros / correo_cobro / whatsapp_cobros.
--  2. Condiciones de cobro del cliente (columnas opcionales en clientes): día de pago, requisitos (orden de compra,
--     contraseña, portal con URL y usuario SIN clave, detalle aprobado), forma de pago habitual y responsable de cobro.
--  3. cobranza_evento: UNA línea de tiempo por cliente (gestión, promesa, correos, factura emitida, cobro recibido,
--     detalle enviado / aprobado / con observaciones, cambio de condición). Las 3 gestiones viejas pasan a eventos
--     `gestion` (+ `promesa` cuando traían fecha prometida), idempotente por gestion_legacy_id.
--  4. cobranza_adjunto + bucket PRIVADO cobranza-adjuntos (10 MB; PDF, imágenes, .eml): URLs firmadas cortas.
--  5. cobranza_estado_factura(no_factura, hoy): al día → por vencer (≤ 5 días) → vencida → cobrada, con modificadores
--     (cobrada_parcial, con_promesa, promesa_incumplida, en_disputa, pide_documentos, dice_que_pago). Usa
--     facturacion_factura_cobrada (026) para «cobrada»: nunca el texto crudo. Espejo puro en TS (src/lib/cobranza/estado.ts).
--  6. cobranza_cerrar_promesas(hoy): las promesas se cierran solas (cumplida cuando sus facturas quedan cobradas;
--     incumplida cuando pasa la fecha sin cobro). La app la llama al cargar la bandeja y al registrar un cobro.
--  7. Artículo de ayuda «Centro de Cobros».
--
-- No toca: emisión de facturas, registro de cobros, conciliación (solo se leen), detalle digital, IVA, tarifario,
-- ni facturas_clientes.estado. Idempotente; sin drop de tablas / funciones (solo drop constraint, patrón 018), sin
-- delete, truncate, begin / commit.

-- ── 1. contactos de cobro ────────────────────────────────────────────────────────────────────────
create table if not exists cliente_contacto (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references clientes(id) on delete cascade,
  nombre          text not null,
  cargo           text,
  rol             text not null default 'otro' check (rol in ('pagos', 'cuentas_por_pagar', 'aprobador', 'solicitante', 'otro')),
  correo          text,
  telefono        text,
  whatsapp        text,
  preferido       boolean not null default false,
  notas           text,
  activo          boolean not null default true,
  origen          text not null default 'manual' check (origen in ('manual', 'backfill', 'correo')),
  creado_por      text,
  desactivado_en  timestamptz,
  desactivado_por text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table cliente_contacto is '033: personas del lado del cliente para el cobro. Un cambio de persona desactiva el contacto (activo = false), nunca lo borra: el historial sigue diciendo con quién se habló.';
create index if not exists idx_cliente_contacto_cliente on cliente_contacto (cliente_id, activo, preferido desc);
alter table cliente_contacto enable row level security;
revoke all on table cliente_contacto from public, anon, authenticated;
grant all on table cliente_contacto to service_role;

-- ── 2. condiciones de cobro del cliente ──────────────────────────────────────────────────────────
alter table clientes add column if not exists dia_pago text;
alter table clientes add column if not exists req_orden_compra boolean not null default false;
alter table clientes add column if not exists req_contrasena boolean not null default false;
alter table clientes add column if not exists req_contrasena_nota text;
alter table clientes add column if not exists req_portal boolean not null default false;
alter table clientes add column if not exists portal_url text;
alter table clientes add column if not exists portal_usuario text;
alter table clientes add column if not exists req_detalle_aprobado boolean not null default false;
alter table clientes add column if not exists forma_pago text;
alter table clientes add column if not exists responsable_cobro text;
alter table clientes drop constraint if exists clientes_forma_pago_check;
alter table clientes add constraint clientes_forma_pago_check check (forma_pago is null or forma_pago in ('transferencia', 'cheque', 'deposito'));
comment on column clientes.dia_pago is '033: día o semana de pago del cliente («pagan jueves», «cierre el 25»).';
comment on column clientes.portal_usuario is '033: quién tiene el usuario del portal de proveedores. NUNCA la clave.';
comment on column clientes.responsable_cobro is '033: correo del usuario responsable de cobrarle a este cliente (la bandeja filtra «mis clientes»).';

-- ── 3. historial unificado ───────────────────────────────────────────────────────────────────────
create table if not exists cobranza_evento (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  tipo                text not null check (tipo in ('gestion', 'promesa', 'correo_enviado', 'correo_recibido', 'correo_copiado', 'factura_emitida', 'cobro_recibido', 'detalle_enviado', 'detalle_aprobado', 'detalle_observaciones', 'cambio_condicion')),
  origen              text not null default 'manual' check (origen in ('manual', 'automatico')),
  fecha               timestamptz not null default now(),
  canal               text check (canal is null or canal in ('llamada', 'whatsapp', 'correo', 'visita', 'reunion', 'nota')),
  contacto_id         uuid references cliente_contacto(id) on delete set null,
  contacto_texto      text,
  resultado           text check (resultado is null or resultado in ('contactado', 'promesa', 'sin_respuesta', 'pide_documentos', 'revision_interna', 'disputa', 'dice_que_pago', 'reprogramar')),
  comentario          text,
  facturas            text[] not null default '{}',
  monto               numeric,
  fecha_promesa       date,
  promesa_estado      text check (promesa_estado is null or promesa_estado in ('pendiente', 'cumplida', 'incumplida', 'reprogramada')),
  promesa_cerrada_en  timestamptz,
  proximo_seguimiento date,
  seguimiento_hecho_en timestamptz,
  disputa_motivo      text,
  datos               jsonb not null default '{}'::jsonb,
  gestion_id          uuid references cobranza_evento(id) on delete set null,
  gestion_legacy_id   uuid unique,
  creado_por          text not null default 'sistema',
  created_at          timestamptz not null default now(),
  constraint cobranza_evento_gestion_resultado_check check (tipo <> 'gestion' or resultado is not null),
  constraint cobranza_evento_promesa_fecha_check check (tipo <> 'promesa' or (fecha_promesa is not null and promesa_estado is not null))
);
comment on table cobranza_evento is '033: una fila por cosa que pasó con el cliente en cobranza, manual (gestión, promesa) o automática (correos, factura emitida, cobro recibido, detalle, cambio de condición). facturas = números de factura involucrados.';
create index if not exists idx_cobranza_evento_cliente on cobranza_evento (cliente_id, fecha desc);
create index if not exists idx_cobranza_evento_promesa on cobranza_evento (promesa_estado, fecha_promesa) where tipo = 'promesa';
create index if not exists idx_cobranza_evento_seguimiento on cobranza_evento (proximo_seguimiento) where proximo_seguimiento is not null and seguimiento_hecho_en is null;
create index if not exists idx_cobranza_evento_facturas on cobranza_evento using gin (facturas);
alter table cobranza_evento enable row level security;
revoke all on table cobranza_evento from public, anon, authenticated;
grant all on table cobranza_evento to service_role;

-- ── 4. adjuntos (bucket privado) ─────────────────────────────────────────────────────────────────
create table if not exists cobranza_adjunto (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references cobranza_evento(id) on delete cascade,
  path        text not null unique,
  nombre      text not null,
  mime        text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'message/rfc822')),
  bytes       integer not null check (bytes > 0 and bytes <= 10485760),
  sha256      text not null check (length(sha256) = 64),
  subido_por  text not null,
  subido_en   timestamptz not null default now()
);
create index if not exists idx_cobranza_adjunto_evento on cobranza_adjunto (evento_id);
alter table cobranza_adjunto enable row level security;
revoke all on table cobranza_adjunto from public, anon, authenticated;
grant all on table cobranza_adjunto to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cobranza-adjuntos', 'cobranza-adjuntos', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'message/rfc822'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'message/rfc822'];

-- ── 5. backfill de contactos: un «Cobros» preferido por cliente (idempotente) ─────────────────────
insert into cliente_contacto (cliente_id, nombre, rol, correo, whatsapp, preferido, notas, origen, creado_por)
select c.id,
       case when c.email_cobros is not null and btrim(c.email_cobros) <> '' and c.email_cobros !~ '@' then btrim(c.email_cobros) else 'Cobros' end,
       'otro',
       substring(lower(coalesce(c.correo_cobro, '') || ' ' || coalesce(c.email_cobros, '')) from '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'),
       nullif(btrim(coalesce(c.whatsapp_cobros, '')), ''),
       true,
       'Migrado de la ficha del cliente (email_cobros / correo_cobro / whatsapp_cobros).',
       'backfill', 'migracion-033'
  from clientes c
 where c.activo is distinct from false
   and (nullif(btrim(coalesce(c.email_cobros, '')), '') is not null or nullif(btrim(coalesce(c.correo_cobro, '')), '') is not null or nullif(btrim(coalesce(c.whatsapp_cobros, '')), '') is not null)
   and not exists (select 1 from cliente_contacto x where x.cliente_id = c.id and x.origen = 'backfill');

-- ── 6. migración de gestiones_cobro → historial (idempotente; como función para poder repetirla y probarla) ──
create or replace function cobranza_migrar_gestiones_legacy()
returns jsonb
language plpgsql
as $fn$
declare v_g integer; v_p integer;
begin
  insert into cobranza_evento (cliente_id, tipo, origen, fecha, canal, contacto_texto, resultado, comentario, facturas, proximo_seguimiento, gestion_legacy_id, creado_por, created_at, datos)
  select g.cliente_id, 'gestion', 'manual',
         (g.fecha_gestion::timestamp + time '12:00') at time zone 'America/Guatemala',
         case g.canal when 'Llamada' then 'llamada' when 'WhatsApp' then 'whatsapp' when 'Email' then 'correo' when 'Visita' then 'visita' else 'nota' end,
         nullif(btrim(coalesce(g.contacto_cliente, '')), ''),
         case when g.fecha_pago_promesa is not null or exists (select 1 from gestion_facturas gf where gf.gestion_id = g.id and gf.fecha_pago_promesa_factura is not null) then 'promesa' else 'contactado' end,
         g.comentario,
         coalesce((select array_agg(f.no_factura order by f.no_factura) from gestion_facturas gf join facturas_clientes f on f.id = gf.factura_id where gf.gestion_id = g.id and f.no_factura is not null), '{}'),
         g.proximo_seguimiento,
         g.id, coalesce(g.usuario, 'sistema'), g.created_at,
         jsonb_build_object('migrado_de', 'gestiones_cobro')
    from gestiones_cobro g
   where not exists (select 1 from cobranza_evento e where e.gestion_legacy_id = g.id);

  insert into cobranza_evento (cliente_id, tipo, origen, fecha, facturas, fecha_promesa, promesa_estado, gestion_id, creado_por, created_at, datos)
  select e.cliente_id, 'promesa', 'manual', e.fecha, e.facturas,
         coalesce((select min(gf.fecha_pago_promesa_factura) from gestion_facturas gf where gf.gestion_id = g.id and gf.fecha_pago_promesa_factura is not null), g.fecha_pago_promesa),
         'pendiente', e.id, e.creado_por, e.created_at, jsonb_build_object('migrado_de', 'gestiones_cobro')
    from cobranza_evento e join gestiones_cobro g on g.id = e.gestion_legacy_id
   where e.tipo = 'gestion' and e.resultado = 'promesa'
     and coalesce((select min(gf.fecha_pago_promesa_factura) from gestion_facturas gf where gf.gestion_id = g.id), g.fecha_pago_promesa) is not null
     and not exists (select 1 from cobranza_evento p where p.tipo = 'promesa' and p.gestion_id = e.id);
  get diagnostics v_p = row_count;
  select count(*) into v_g from cobranza_evento where gestion_legacy_id is not null;
  return jsonb_build_object('gestiones_migradas', v_g, 'promesas_nuevas', v_p);
end
$fn$;
revoke all on function cobranza_migrar_gestiones_legacy() from public, anon, authenticated;
grant execute on function cobranza_migrar_gestiones_legacy() to service_role;
select cobranza_migrar_gestiones_legacy();

-- ── 7. estado de cobro de una factura (calculado, nunca a mano) ──────────────────────────────────
create or replace function cobranza_estado_factura(p_no_factura text, p_hoy date default current_date)
returns jsonb
language plpgsql stable
as $fn$
declare
  v_fecha date; v_dias integer; v_cliente uuid; v_parcial boolean; v_viva boolean; v_cobrada boolean;
  v_vence date; v_dv integer; v_estado text; v_mods text[] := '{}';
  v_prom_fecha date; v_prom_estado text; v_gest_resultado text;
begin
  select min(f.fecha_emision), max(coalesce(c.dias_credito, 0)), min(f.cliente_id::text)::uuid,
         bool_or(upper(btrim(coalesce(f.estado, ''))) = 'COBRADO PARCIAL'),
         bool_or(upper(btrim(coalesce(f.estado, ''))) not in ('ANULADO', 'ANULADA', 'REFACTURADO', 'REFACTURADA'))
    into v_fecha, v_dias, v_cliente, v_parcial, v_viva
    from facturas_clientes f left join clientes c on c.id = f.cliente_id
   where f.no_factura = p_no_factura;
  if v_fecha is null then return jsonb_build_object('estado', 'desconocida', 'modificadores', '[]'::jsonb); end if;
  if not coalesce(v_viva, false) then return jsonb_build_object('estado', 'anulada', 'modificadores', '[]'::jsonb); end if;
  v_cobrada := facturacion_factura_cobrada(p_no_factura);
  v_vence := v_fecha + v_dias;
  v_dv := p_hoy - v_vence;
  if v_cobrada then v_estado := 'cobrada';
  elsif v_dv > 0 then v_estado := 'vencida';
  elsif v_dv >= -5 then v_estado := 'por_vencer';
  else v_estado := 'al_dia';
  end if;
  if not v_cobrada then
    if coalesce(v_parcial, false) then v_mods := array_append(v_mods, 'cobrada_parcial'); end if;
    -- la última promesa que cubre esta factura (o todo el cliente, si no nombra facturas)
    select fecha_promesa, promesa_estado into v_prom_fecha, v_prom_estado
      from cobranza_evento
     where tipo = 'promesa' and cliente_id = v_cliente and (p_no_factura = any(facturas) or cardinality(facturas) = 0)
     order by fecha desc limit 1;
    if v_prom_estado = 'incumplida' or (v_prom_estado = 'pendiente' and v_prom_fecha < p_hoy) then v_mods := array_append(v_mods, 'promesa_incumplida');
    elsif v_prom_estado = 'pendiente' then v_mods := array_append(v_mods, 'con_promesa');
    end if;
    -- la última gestión manda sobre disputa / documentos / «dice que ya pagó» (una gestión posterior los levanta)
    select resultado into v_gest_resultado
      from cobranza_evento
     where tipo = 'gestion' and cliente_id = v_cliente and (p_no_factura = any(facturas) or cardinality(facturas) = 0)
     order by fecha desc limit 1;
    if v_gest_resultado = 'disputa' then v_mods := array_append(v_mods, 'en_disputa');
    elsif v_gest_resultado = 'pide_documentos' then v_mods := array_append(v_mods, 'pide_documentos');
    elsif v_gest_resultado = 'dice_que_pago' then v_mods := array_append(v_mods, 'dice_que_pago');
    end if;
  end if;
  return jsonb_build_object('estado', v_estado, 'vence', v_vence, 'dias_vencida', v_dv, 'cobrada', v_cobrada,
                            'modificadores', to_jsonb(v_mods), 'promesa_fecha', v_prom_fecha, 'promesa_estado', v_prom_estado);
end
$fn$;
comment on function cobranza_estado_factura(text, date) is '033: estado de cobro calculado: cobrada (026) / vencida / por_vencer (≤ 5 días) / al_dia + modificadores (cobrada_parcial, con_promesa, promesa_incumplida, en_disputa, pide_documentos, dice_que_pago). Espejo TS en src/lib/cobranza/estado.ts.';

-- ── 8. las promesas se cierran solas ─────────────────────────────────────────────────────────────
create or replace function cobranza_cerrar_promesas(p_hoy date default current_date)
returns jsonb
language plpgsql
as $fn$
declare v_c integer; v_i integer;
begin
  update cobranza_evento e set promesa_estado = 'cumplida', promesa_cerrada_en = now()
   where e.tipo = 'promesa' and e.promesa_estado = 'pendiente' and cardinality(e.facturas) > 0
     and not exists (select 1 from unnest(e.facturas) nf where not facturacion_factura_cobrada(nf));
  get diagnostics v_c = row_count;
  update cobranza_evento e set promesa_estado = 'incumplida', promesa_cerrada_en = now()
   where e.tipo = 'promesa' and e.promesa_estado = 'pendiente' and e.fecha_promesa < p_hoy;
  get diagnostics v_i = row_count;
  return jsonb_build_object('cumplidas', v_c, 'incumplidas', v_i);
end
$fn$;

revoke all on function cobranza_estado_factura(text, date) from public, anon, authenticated;
revoke all on function cobranza_cerrar_promesas(date) from public, anon, authenticated;
grant execute on function cobranza_estado_factura(text, date) to service_role;
grant execute on function cobranza_cerrar_promesas(date) to service_role;

-- ── 9. ayuda: «Centro de Cobros» (para la persona de cobros que llega nueva) ─────────────────────
insert into ayuda (airtable_id, titulo, slug, categoria, descripcion_corta, contenido, orden, activo, tags_contextuales)
values ('sbw-ayuda-centro-de-cobros', 'Centro de Cobros — cómo empezar el día, registrar una gestión y leer cada estado', 'centro-de-cobros', 'Cobros y Retenciones',
  'Para la persona de cobros: la bandeja «Hoy», la ficha de cobranza de cada cliente, cómo registrar una gestión y qué significa cada estado.',
  E'## Para quién es\n\nPara quien cobra. Todo lo que pasó con un cliente en cobranza (llamadas, WhatsApp, correos, promesas, facturas emitidas, cobros recibidos, detalles aprobados) está en **un solo lugar**: no hace falta buscar en correos ni preguntarle a nadie.\n\n## Cómo empezar el día\n\nAbrí **Centro de Cobros → Hoy**. La bandeja ya viene ordenada por prioridad:\n\n1. **Seguimientos para hoy o atrasados**: los que vos misma programaste.\n2. **Promesas incumplidas**: dijeron que pagaban y no entró el cobro.\n3. **Promesas que vencen hoy o mañana**: para confirmar.\n4. **Facturas vencidas sin gestión en 7 días**, de la más vieja a la más nueva.\n5. **Por vencer esta semana**.\n6. **«Dice que ya pagó»**: pendientes de verificar en bancos.\n\nCada fila trae el cliente, las facturas, el monto, los días de atraso, el último contacto y el **contacto preferido** con un clic para llamar, abrir WhatsApp o escribir. Por defecto ves **tus clientes** y los que no tienen responsable; admin y contador ven todo.\n\n## Cómo registrar una gestión\n\n*Registrar gestión* (en la bandeja o en la ficha del cliente): canal, con quién hablaste, **resultado** (obligatorio), comentario, facturas involucradas y, si hubo, la **promesa** (monto y fecha). **Toda gestión exige fecha de próximo seguimiento**: si el cliente dice «en 2 semanas», ponela a esa fecha y el sistema te la trae ese día. Podés adjuntar capturas, PDF o correos.\n\n## Qué significa cada estado de una factura\n\n- **Al día**: todavía no vence.\n- **Por vencer**: vence en 5 días o menos.\n- **Vencida**: pasó la fecha (emisión + días de crédito) sin cobro completo.\n- **Cobrada**: todas sus líneas están cobradas.\n\nCon modificadores: **con promesa** (fecha), **promesa incumplida** (pasó la fecha sin cobro; aparece en la bandeja), **en disputa**, **pide documentos**, **dice que ya pagó**, **cobrada parcial**. Las promesas se cierran solas: cumplida cuando entra el cobro, incumplida cuando pasa la fecha.\n\n## La ficha de cobranza del cliente\n\nArriba: saldo, vencido, días de crédito, **condiciones y requisitos para pagar** (orden de compra, contraseña, portal, detalle aprobado, forma de pago, día de pago), responsable y próximo seguimiento. Después: **contactos** (¿con quién hablo?), **facturas abiertas** con su estado y el **historial** completo con filtros y buscador. Un contacto que ya no está se **desactiva**, no se borra: el historial sigue diciendo con quién se habló.\n\n## Lo que el rol cobranza no hace\n\nNo registra ni anula cobros, no emite ni anula facturas y no concilia: eso queda en contador o admin. Si un cliente dice que ya pagó, marcalo así y contador lo verifica en bancos.',
  81, true, 'cobranza, centro-de-cobros, modulo-cobranza, gestion-cobro, promesa, bandeja, cobros')
on conflict (slug) do nothing;
