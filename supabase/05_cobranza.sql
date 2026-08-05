-- ============================================================
-- F-COBRANZA: Bitácora de gestión de cobro (reemplaza el Excel).
-- Correr en el SQL Editor de Supabase (el service key no hace DDL).
--
-- gestiones_cobro: una fila por contacto de cobranza (llamada,
-- WhatsApp, email…) con quién, cuándo, qué se dijo y qué fecha de
-- pago prometió el cliente. La gestión es POR CLIENTE; la tabla
-- puente gestion_facturas referencia factura(s) específicas y
-- permite fecha de promesa por factura ("la 1053 el 15, la 1067
-- el 20" en una sola gestión).
-- ============================================================

create table if not exists gestiones_cobro (
  id                  uuid primary key default gen_random_uuid(),
  -- id de app (patrón Fase 3: filas nacidas en Supabase usan 'sbw…')
  airtable_id         text not null unique,
  cliente_id          uuid not null references clientes(id) on delete cascade,
  fecha_gestion       date not null default current_date,
  usuario             text not null,          -- email del usuario logueado
  canal               text not null default 'Llamada'
                      check (canal in ('Llamada','WhatsApp','Email','Visita','Otro')),
  contacto_cliente    text,                   -- con quién se habló del lado del cliente
  comentario          text not null,          -- qué dijo — el corazón de la bitácora
  fecha_pago_promesa  date,                   -- fecha general prometida (opcional)
  proximo_seguimiento date,                   -- cuándo volver a contactar (opcional)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_gestiones_cobro_cliente on gestiones_cobro (cliente_id, fecha_gestion desc);
create index if not exists idx_gestiones_cobro_promesa on gestiones_cobro (fecha_pago_promesa)
  where fecha_pago_promesa is not null;

create table if not exists gestion_facturas (
  gestion_id                  uuid not null references gestiones_cobro(id) on delete cascade,
  factura_id                  uuid not null references facturas_clientes(id) on delete cascade,
  fecha_pago_promesa_factura  date,           -- promesa específica de ESTA factura (opcional)
  primary key (gestion_id, factura_id)
);

create index if not exists idx_gestion_facturas_factura on gestion_facturas (factura_id);
