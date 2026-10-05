-- ============================================================
-- 011 · Presupuesto (Presupuesto vs Real) — brief Presupuesto HIT
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit
-- propio (el runner aporta la transacción) y sin delete/drop.
--
-- El presupuesto se arma sobre las MISMAS líneas del Estado de
-- Resultados (mapeo_er) × centros_costo × mes, para que el comparativo
-- contra el real (motor del ER en vivo) sea línea contra línea.
-- Clave estable de línea entre bases: mapeo_er.orden (los uuid y
-- airtable_id difieren entre HIT y Golden; el orden es el mismo y es lo
-- que usa el motor del ER para sus subtotales). El detalle guarda el
-- uuid de la base (FK); la lógica resuelve uuid ↔ orden al leer.
-- ============================================================

-- CABECERA: un presupuesto por empresa y año (puede haber varios borradores)
create table if not exists presupuesto (
  id            uuid primary key default gen_random_uuid(),
  anio          int  not null check (anio between 2024 and 2100),
  nombre        text,
  estado        text not null default 'Borrador'
                 check (estado in ('Borrador', 'Aprobado', 'Archivado')),
  moneda        text not null default 'GTQ',
  aprobado_por  text,
  aprobado_en   timestamptz,
  nota          text,
  created_at    timestamptz default now(),
  created_by    text,
  updated_at    timestamptz default now()
);

-- UN solo presupuesto aprobado (vigente) por año: la defensa real, a nivel de base.
create unique index if not exists uq_presupuesto_anio_aprobado
  on presupuesto(anio) where estado = 'Aprobado';

-- DETALLE: línea de ER × centro de costo × mes
create table if not exists presupuesto_lineas (
  id              uuid primary key default gen_random_uuid(),
  presupuesto_id  uuid not null references presupuesto(id) on delete cascade,
  mapeo_er_id     uuid not null references mapeo_er(id),
  centro_costo_id uuid not null references centros_costo(id),
  mes             int  not null check (mes between 1 and 12),
  monto           numeric not null default 0,
  created_at      timestamptz default now()
);

create index if not exists idx_preslin_presupuesto on presupuesto_lineas(presupuesto_id);
create index if not exists idx_preslin_mapeo       on presupuesto_lineas(mapeo_er_id);
create index if not exists idx_preslin_centro      on presupuesto_lineas(centro_costo_id);

-- UNA celda por (presupuesto, línea, centro, mes).
create unique index if not exists uq_preslin_celda
  on presupuesto_lineas(presupuesto_id, mapeo_er_id, centro_costo_id, mes);

-- HISTORIAL (auditoría): crear, editar_celda, precargar, aprobar, reabrir, archivar
create table if not exists presupuesto_log (
  id             uuid primary key default gen_random_uuid(),
  presupuesto_id uuid not null references presupuesto(id) on delete cascade,
  accion         text not null,
  detalle        jsonb,
  actor          text,
  created_at     timestamptz default now()
);
create index if not exists idx_preslog_presupuesto on presupuesto_log(presupuesto_id);

-- RLS al patrón de estas bases: activo, sin policies (solo service_role).
alter table presupuesto        enable row level security;
alter table presupuesto_lineas enable row level security;
alter table presupuesto_log    enable row level security;
