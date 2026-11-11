-- 035 · CENTRO DE COBROS · PR 2: recordatorios y estado de cuenta desde la app (propuestos; la persona aprueba)
--
-- Por qué (brief del CFO, 10-nov-2026): «recordatorios por correo propuestos por el sistema y aprobados por la persona,
-- uno por uno o en lote. Nunca salen solos». Hoy el recordatorio se escribe a mano desde Gmail y no queda en el historial.
--
-- Qué hace:
--  1. cobranza_plantilla: asunto y cuerpo EDITABLES de cada recordatorio, del estado de cuenta y de los «datos para pagar»
--     (variables {{cliente}}, {{facturas}}, {{saldo}}, {{estado_cuenta}}…). Se editan desde la app (admin y contador); la
--     migración solo siembra el texto inicial y NO pisa lo que el CFO ya cambió (on conflict do nothing).
--  2. cobranza_regla_recordatorio: cuándo se propone cada recordatorio, configurable en tabla y no en el código:
--       por vencer → 3 días antes · vencida → día 1 y cada 7 días mientras siga vencida ·
--       promesa incumplida → al día siguiente · confirmación de promesa → 1 día antes.
--  3. cobranza_recordatorio_omision: «omitir hasta» un borrador propuesto (con motivo). No se borra nada.
--  4. El envío queda como evento `correo_enviado` en cobranza_evento (033) con destinatarios, asunto, cuerpo y el
--     resultado de Resend en `datos`; índice parcial para leer los últimos envíos por cliente. No hay cron ni envío
--     automático: nada sale sin que la persona presione «Enviar».
--  5. Artículo de ayuda «Centro de Cobros» actualizado con recordatorios, estado de cuenta y plantillas.
--
-- No toca: facturas, cobros, conciliación, detalle digital, IVA, tarifario ni paquetes (solo se leen). Una prueba cubierta
-- por un paquete nunca es factura, así que nunca genera cobro ni recordatorio. Idempotente; sin drop de tablas / funciones,
-- sin delete / truncate, sin begin / commit.

-- ── 1. plantillas ────────────────────────────────────────────────────────────────────────────────
create table if not exists cobranza_plantilla (
  clave        text primary key check (clave ~ '^[a-z_]{3,40}$'),
  nombre       text not null,
  descripcion  text,
  asunto       text not null default '',
  cuerpo       text not null default '',
  activo       boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_por  text
);
comment on table cobranza_plantilla is '035: asunto y cuerpo de los correos de cobranza (recordatorios, estado de cuenta, datos para pagar). Variables entre llaves dobles; la lista válida vive en src/lib/cobranza/recordatorios.ts (VARIABLES_PLANTILLA).';
alter table cobranza_plantilla enable row level security;
revoke all on table cobranza_plantilla from public, anon, authenticated;
grant all on table cobranza_plantilla to service_role;

insert into cobranza_plantilla (clave, nombre, descripcion, asunto, cuerpo) values
  ('por_vencer', 'Recordatorio · factura por vencer', 'Se propone unos días antes del vencimiento (regla «por vencer»).',
   'Recordatorio de pago · factura {{facturas}} · {{emisor}}',
   E'Estimado/a {{contacto}}:\n\nLe recordamos que la factura {{facturas}} por {{saldo}} vence el {{fecha_vencimiento}}. Le compartimos el estado de cuenta actualizado:\n\n{{estado_cuenta}}\n\n{{datos_pago}}\n\nSi el pago ya fue programado, le agradecemos indicarnos la fecha para darle seguimiento.\n\nSaludos cordiales,\n{{remitente}}\n{{emisor}}'),
  ('vencida', 'Recordatorio · factura vencida', 'Se propone al día siguiente del vencimiento y se repite cada N días mientras siga vencida (regla «vencida»).',
   'Factura vencida · {{facturas}} · {{emisor}}',
   E'Estimado/a {{contacto}}:\n\nLe escribimos para recordarle que la(s) factura(s) {{facturas}} por {{saldo}} se encuentra(n) vencida(s) desde hace {{dias_vencida}} días. Adjuntamos el estado de cuenta:\n\n{{estado_cuenta}}\n\n{{datos_pago}}\n\nSi el pago ya fue realizado, le agradecemos enviarnos la fecha y el banco para aplicarlo. Si necesita algún documento (factura, contraseña, orden de compra), indíquenoslo y se lo hacemos llegar.\n\nSaludos cordiales,\n{{remitente}}\n{{emisor}}'),
  ('promesa_incumplida', 'Recordatorio · promesa de pago incumplida', 'Se propone al día siguiente de una promesa de pago que no se cumplió.',
   'Pago pendiente · {{facturas}} · {{emisor}}',
   E'Estimado/a {{contacto}}:\n\nEl {{fecha_promesa}} nos indicó que el pago de {{facturas}} ({{monto_promesa}}) se realizaría ese día y a la fecha no lo hemos recibido. Le compartimos el estado de cuenta:\n\n{{estado_cuenta}}\n\n{{datos_pago}}\n\n¿Nos podría confirmar una nueva fecha de pago o, si ya lo realizó, la fecha y el banco?\n\nSaludos cordiales,\n{{remitente}}\n{{emisor}}'),
  ('confirmacion_promesa', 'Confirmación · promesa de pago', 'Se propone un día antes de la fecha prometida, para confirmar.',
   'Confirmación de pago · {{facturas}} · {{emisor}}',
   E'Estimado/a {{contacto}}:\n\nSegún lo conversado, el pago de {{facturas}} ({{monto_promesa}}) está programado para el {{fecha_promesa}}. Le escribimos para confirmarlo y dejarle a mano los datos:\n\n{{datos_pago}}\n\nMuchas gracias por su atención.\n\nSaludos cordiales,\n{{remitente}}\n{{emisor}}'),
  ('estado_cuenta', 'Estado de cuenta', 'Correo que acompaña el estado de cuenta cuando se manda desde la ficha del cliente.',
   'Estado de cuenta al {{fecha}} · {{cliente}} · {{emisor}}',
   E'Estimado/a {{contacto}}:\n\nLe compartimos el estado de cuenta de {{cliente}} al {{fecha}}, con un saldo pendiente de {{saldo}}:\n\n{{estado_cuenta}}\n\n{{datos_pago}}\n\nQuedamos atentos a cualquier consulta.\n\nSaludos cordiales,\n{{remitente}}\n{{emisor}}'),
  ('datos_pago', 'Datos para pagar', 'Bloque que se inserta donde la plantilla diga {{datos_pago}}: cuenta bancaria, a nombre de quién, qué mandar al pagar. Completalo con los datos reales.',
   '',
   E'Datos para pagar: transferencia o depósito a nombre de {{emisor}} (NIT {{nit_emisor}}). Banco y número de cuenta: completar en Plantillas. Al pagar, le agradecemos enviar la boleta a esta misma dirección con el número de factura.')
on conflict (clave) do nothing;

-- ── 2. reglas (cuándo se propone cada recordatorio) ──────────────────────────────────────────────
create table if not exists cobranza_regla_recordatorio (
  clave           text primary key check (clave in ('por_vencer', 'vencida', 'promesa_incumplida', 'confirmacion_promesa')),
  nombre          text not null,
  descripcion     text,
  activo          boolean not null default true,
  dias            integer not null check (dias >= 0),
  cada_dias       integer check (cada_dias is null or cada_dias >= 1),
  plantilla_clave text not null references cobranza_plantilla(clave),
  updated_at      timestamptz not null default now(),
  updated_por     text
);
comment on table cobranza_regla_recordatorio is '035: cuándo se propone cada recordatorio. `dias` = días ANTES (por_vencer, confirmacion_promesa) o DESPUÉS (vencida, promesa_incumplida); `cada_dias` = repetir mientras siga vencida (solo vencida). Se edita desde la app; el código no trae los días.';
alter table cobranza_regla_recordatorio enable row level security;
revoke all on table cobranza_regla_recordatorio from public, anon, authenticated;
grant all on table cobranza_regla_recordatorio to service_role;

insert into cobranza_regla_recordatorio (clave, nombre, descripcion, dias, cada_dias, plantilla_clave) values
  ('por_vencer', 'Por vencer', 'Factura que vence en N días o menos y todavía no recibió este recordatorio.', 3, null, 'por_vencer'),
  ('vencida', 'Vencida', 'Factura vencida hace N días o más; se vuelve a proponer cada «cada_dias» días mientras siga vencida.', 1, 7, 'vencida'),
  ('promesa_incumplida', 'Promesa incumplida', 'Promesa de pago cuya fecha pasó hace N días o más sin que entrara el cobro.', 1, null, 'promesa_incumplida'),
  ('confirmacion_promesa', 'Confirmación de promesa', 'Promesa de pago que vence en N días o menos: se confirma antes.', 1, null, 'confirmacion_promesa')
on conflict (clave) do nothing;

-- ── 3. omitir un borrador hasta una fecha (con motivo; nada se borra) ─────────────────────────────
create table if not exists cobranza_recordatorio_omision (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references clientes(id) on delete cascade,
  regla       text not null check (regla in ('por_vencer', 'vencida', 'promesa_incumplida', 'confirmacion_promesa')),
  hasta       date not null,
  motivo      text,
  creado_por  text not null,
  created_at  timestamptz not null default now()
);
comment on table cobranza_recordatorio_omision is '035: «omitir hasta» un recordatorio propuesto para un cliente y una regla. Mientras hasta >= hoy el borrador no se propone.';
create index if not exists idx_cobranza_omision_vigente on cobranza_recordatorio_omision (cliente_id, regla, hasta desc);
alter table cobranza_recordatorio_omision enable row level security;
revoke all on table cobranza_recordatorio_omision from public, anon, authenticated;
grant all on table cobranza_recordatorio_omision to service_role;

-- ── 4. envíos: los últimos correos por cliente (el evento ya existe en la 033) ────────────────────
create index if not exists idx_cobranza_evento_correo on cobranza_evento (cliente_id, fecha desc) where tipo = 'correo_enviado';

-- ── 5. ayuda: «Centro de Cobros» con recordatorios, estado de cuenta y plantillas ────────────────
insert into ayuda (airtable_id, titulo, slug, categoria, descripcion_corta, contenido, orden, activo, tags_contextuales)
values ('sbw-ayuda-centro-de-cobros', 'Centro de Cobros — cómo empezar el día, registrar una gestión, leer cada estado y mandar recordatorios', 'centro-de-cobros', 'Cobros y Retenciones',
  'Para la persona de cobros: la bandeja «Hoy», la ficha de cobranza, cómo registrar una gestión, qué significa cada estado, y los recordatorios y el estado de cuenta que se mandan desde la app.',
  E'## Para quién es\n\nPara quien cobra. Todo lo que pasó con un cliente en cobranza (llamadas, WhatsApp, correos, promesas, facturas emitidas, cobros recibidos, detalles aprobados) está en **un solo lugar**: no hace falta buscar en correos ni preguntarle a nadie.\n\n## Cómo empezar el día\n\nAbrí **Centro de Cobros → Hoy**. La bandeja ya viene ordenada por prioridad:\n\n1. **Seguimientos para hoy o atrasados**: los que vos misma programaste.\n2. **Promesas incumplidas**: dijeron que pagaban y no entró el cobro.\n3. **Promesas que vencen hoy o mañana**: para confirmar.\n4. **Facturas vencidas sin gestión en 7 días**, de la más vieja a la más nueva.\n5. **Por vencer esta semana**.\n6. **«Dice que ya pagó»**: pendientes de verificar en bancos.\n\nCada fila trae el cliente, las facturas, el monto, los días de atraso, el último contacto y el **contacto preferido** con un clic para llamar, abrir WhatsApp o escribir. Por defecto ves **tus clientes** y los que no tienen responsable; admin y contador ven todo.\n\nArriba de la bandeja verás cuántos **recordatorios propuestos** hay para hoy: abrilos desde ahí.\n\n## Cómo registrar una gestión\n\n*Registrar gestión* (en la bandeja o en la ficha del cliente): canal, con quién hablaste, **resultado** (obligatorio), comentario, facturas involucradas y, si hubo, la **promesa** (monto y fecha). **Toda gestión exige fecha de próximo seguimiento**: si el cliente dice «en 2 semanas», ponela a esa fecha y el sistema te la trae ese día. Podés adjuntar capturas, PDF o correos.\n\n## Qué significa cada estado de una factura\n\n- **Al día**: todavía no vence.\n- **Por vencer**: vence en 5 días o menos.\n- **Vencida**: pasó la fecha (emisión + días de crédito) sin cobro completo.\n- **Cobrada**: todas sus líneas están cobradas.\n\nCon modificadores: **con promesa** (fecha), **promesa incumplida** (pasó la fecha sin cobro; aparece en la bandeja), **en disputa**, **pide documentos**, **dice que ya pagó**, **cobrada parcial**. Las promesas se cierran solas: cumplida cuando entra el cobro, incumplida cuando pasa la fecha.\n\n## Recordatorios propuestos (nada sale solo)\n\nEn **Centro de Cobros → Recordatorios** el sistema arma cada mañana los **borradores** según las reglas: factura **por vencer** (unos días antes), **vencida** (al día siguiente y luego cada semana mientras siga vencida), **promesa incumplida** (al día siguiente) y **confirmación de promesa** (un día antes). Cada borrador trae el destinatario (el contacto preferido o el de pagos), copia a la persona responsable, el asunto y el cuerpo de la plantilla con el **estado de cuenta** del cliente. Podés corregir el texto, cambiar el destinatario y presionar **Enviar**, o marcar varios y **Enviar seleccionados**. **Nada se manda sin que vos presiones Enviar.** Cada envío queda en el historial del cliente como «Correo enviado», con el texto y el resultado.\n\nSi el cliente tiene una **disputa abierta** o una **promesa de pago vigente**, el recordatorio aparece **bloqueado**: el sistema avisa y solo se manda si escribís el motivo. También podés **omitir** un borrador hasta una fecha (con motivo) si no corresponde mandarlo.\n\nUna prueba **cubierta por un paquete prepagado** no es factura ni genera cobro: nunca aparece en un recordatorio ni en el estado de cuenta (el remanente del paquete sí se informa).\n\n## Estado de cuenta\n\nDesde la ficha del cliente: **Estado de cuenta (PDF)** para descargarlo o imprimirlo con el logo, y **Enviar estado de cuenta** para mandarlo por correo. Lista las facturas abiertas con su antigüedad, el **saldo real** de cada una (total menos cobros y notas de crédito), los totales y los **datos para pagar**. El envío también queda en el historial.\n\n## Plantillas y reglas\n\nEn **Centro de Cobros → Plantillas** (admin y contador) se editan el asunto y el cuerpo de cada recordatorio, el bloque **«Datos para pagar»** (cuenta bancaria, a nombre de quién) y los días de cada regla. Las variables van entre llaves dobles: cliente, contacto, facturas, saldo, fecha de vencimiento, días vencida, fecha y monto de la promesa, emisor, remitente, estado de cuenta y datos para pagar.\n\n## La ficha de cobranza del cliente\n\nArriba: saldo, vencido, días de crédito, **condiciones y requisitos para pagar** (orden de compra, contraseña, portal, detalle aprobado, forma de pago, día de pago), responsable y próximo seguimiento. Después: **contactos** (¿con quién hablo?), **facturas abiertas** con su estado y el **historial** completo con filtros y buscador. Un contacto que ya no está se **desactiva**, no se borra: el historial sigue diciendo con quién se habló.\n\n## Lo que el rol cobranza no hace\n\nNo registra ni anula cobros, no emite ni anula facturas, no concilia y no edita plantillas ni reglas: eso queda en contador o admin. Si un cliente dice que ya pagó, marcalo así y contador lo verifica en bancos.',
  81, true, 'cobranza, centro-de-cobros, modulo-cobranza, gestion-cobro, promesa, bandeja, cobros, recordatorios, estado-de-cuenta, plantillas')
on conflict (slug) do update set titulo = excluded.titulo, descripcion_corta = excluded.descripcion_corta, contenido = excluded.contenido, tags_contextuales = excluded.tags_contextuales, updated_at = now();
