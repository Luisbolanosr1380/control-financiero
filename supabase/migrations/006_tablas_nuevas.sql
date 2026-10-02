-- ============================================================
-- 006 · Tablas nacidas en Supabase (FASE MOLDE)
-- ayuda, uso_auros, analisis_ai, roadmap_items, gestiones_cobro
-- (+ puente gestion_facturas).
--
-- En TODAS estas, airtable_id es NULLABLE (unique): nunca vinieron de
-- Airtable, la app lo llena al insertar, y un seed por SQL sin id no
-- debe romper nada (el bug del roadmap del 2026-08-27). Divergencia
-- deliberada vs Golden: gestiones_cobro allá lo tiene NOT NULL.
-- ============================================================

create table if not exists ayuda (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  titulo text,
  slug text unique,
  categoria text,
  descripcion_corta text,
  contenido text,
  orden integer,
  activo boolean default true,
  tags_contextuales text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists uso_auros (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  email text,
  fecha timestamptz,
  mes_referencia text,
  tipo text,
  tokens_input integer,
  tokens_output integer,
  costo_usd numeric(10,4),
  duracion_seg numeric(10,2),
  query_preview text,
  created_at timestamptz default now()
);

create table if not exists analisis_ai (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  fecha timestamptz,
  texto text,
  modelo text,
  tokens_input integer,
  tokens_output integer,
  duracion_seg numeric(10,2),
  costo_usd numeric(10,4),
  created_at timestamptz default now()
);

create table if not exists roadmap_items (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  titulo text not null,
  descripcion text,
  categoria text not null default 'General',
  estado text not null default 'Idea'
    check (estado in ('Idea','Pendiente','En progreso','Hecho','Pausado','Descartado')),
  prioridad text not null default 'Media'
    check (prioridad in ('Alta','Media','Baja')),
  impacto text,
  orden integer not null default 100,
  fecha_objetivo date,
  fecha_hecho timestamptz,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_roadmap_estado on roadmap_items (estado, orden);
create index if not exists idx_roadmap_categoria on roadmap_items (categoria);

create table if not exists gestiones_cobro (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  cliente_id uuid not null references clientes(id) on delete cascade,
  fecha_gestion date not null default current_date,
  usuario text not null,
  canal text not null default 'Llamada'
    check (canal in ('Llamada','WhatsApp','Email','Visita','Otro')),
  contacto_cliente text,
  comentario text not null,
  fecha_pago_promesa date,
  proximo_seguimiento date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_gestiones_cobro_cliente on gestiones_cobro (cliente_id, fecha_gestion desc);
create index if not exists idx_gestiones_cobro_promesa on gestiones_cobro (fecha_pago_promesa)
  where fecha_pago_promesa is not null;

create table if not exists gestion_facturas (
  gestion_id uuid not null references gestiones_cobro(id) on delete cascade,
  factura_id uuid not null references facturas_clientes(id) on delete cascade,
  fecha_pago_promesa_factura date,
  primary key (gestion_id, factura_id)
);
create index if not exists idx_gestion_facturas_factura on gestion_facturas (factura_id);

alter table ayuda enable row level security;
alter table uso_auros enable row level security;
alter table analisis_ai enable row level security;
alter table roadmap_items enable row level security;
alter table gestiones_cobro enable row level security;
alter table gestion_facturas enable row level security;
