-- ============================================================
-- 008 · Etiquetas de documentos (F-ETIQUETAS — modelo confirmado)
-- Correr en el SQL Editor de AMBAS bases (Golden y HIT).
--
-- Etiquetas COMPARTIDAS ("iglesia" es una sola) aplicables a
-- facturas Y gastos vía puente POR TIPO con FK real + cascade
-- (integridad en la base; la generalidad vive en el código).
-- Metadata PURA: cero efecto contable — ningún motor/RPC las lee.
-- airtable_id no existe acá: estas tablas nacen en Supabase y la
-- app las referencia por uuid (lección del roadmap).
-- ============================================================

begin;

create table if not exists etiquetas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  color text,                        -- hex del chip (null = automático)
  created_at timestamptz not null default now()
);

create table if not exists factura_etiquetas (
  factura_id uuid not null references facturas_clientes(id) on delete cascade,
  etiqueta_id uuid not null references etiquetas(id) on delete cascade,
  primary key (factura_id, etiqueta_id)
);
create index if not exists idx_factura_etiquetas_etiqueta on factura_etiquetas (etiqueta_id);

create table if not exists gasto_etiquetas (
  gasto_id uuid not null references gastos(id) on delete cascade,
  etiqueta_id uuid not null references etiquetas(id) on delete cascade,
  primary key (gasto_id, etiqueta_id)
);
create index if not exists idx_gasto_etiquetas_etiqueta on gasto_etiquetas (etiqueta_id);

alter table etiquetas enable row level security;
alter table factura_etiquetas enable row level security;
alter table gasto_etiquetas enable row level security;

commit;
