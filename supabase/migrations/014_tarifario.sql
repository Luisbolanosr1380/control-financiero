-- ============================================================
-- 014 · Tarifario (precios por cliente, sin IVA)
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit
-- propio y sin delete/drop (el runner aporta la transacción).
--
-- APLICADA POR EL CONECTOR el 2026-10-28 en HIT y Golden y registrada en
-- _migraciones; este archivo reproduce el DDL que quedó en vivo (verificado
-- con information_schema / pg_indexes) para que el repo sea la fuente. El
-- dry-run del runner la ve aplicada (0 pendientes).
--
-- Una fila = el precio pactado con un cliente (NIT) para una prueba
-- (tipo_prueba) en una categoría (PRE EMPLEO / RUTINA / ESPECIFICO…) y un
-- territorio (METROPOLITANA / DEPARTAMENTAL). Candado único sobre esa llave.
-- `monto` va SIN IVA (el 12 % se suma al facturar). Q0 significa "sin
-- tarifa definida", no gratis (lo interpreta el motor de lookup).
-- `aprobado_por` / `aprobado_en`: gobierno del tarifario (quién lo validó).
-- Los datos de Golden (788 tarifas) van en supabase/seeds/014_tarifario_seed.sql
-- (solo Golden; NO es una migración).
-- ============================================================

create table if not exists tarifario (
  id            uuid primary key default gen_random_uuid(),
  nit           text not null,
  razon_social  text,
  tipo_prueba   text not null,
  categoria     text not null,
  territorio    text not null,
  monto         numeric not null,
  anio          text,
  aprobado_por  text,
  aprobado_en   timestamptz,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Candado: una sola tarifa por (NIT, tipo, categoría, territorio).
create unique index if not exists uq_tarifario_llave
  on tarifario (nit, tipo_prueba, categoria, territorio);
create index if not exists idx_tarifario_nit on tarifario (nit);

alter table tarifario enable row level security;
