-- ============================================================
-- F-ROADMAP: Control de Roadmap (solo admin).
-- Correr en el SQL Editor de Supabase (el service key no hace DDL).
--
-- Tablero personal del dueño: qué está hecho, qué sigue y en qué
-- orden. Coherente con "no se borra": descartar = estado Descartado.
-- ============================================================

create table if not exists roadmap_items (
  id             uuid primary key default gen_random_uuid(),
  airtable_id    text not null unique,   -- id de app (patrón Fase 3: 'sbw…')
  titulo         text not null,
  descripcion    text,
  categoria      text not null default 'General',
  estado         text not null default 'Idea'
                 check (estado in ('Idea','Pendiente','En progreso','Hecho','Pausado','Descartado')),
  prioridad      text not null default 'Media'
                 check (prioridad in ('Alta','Media','Baja')),
  impacto        text,                   -- por qué importa
  orden          int not null default 100,
  fecha_objetivo date,
  fecha_hecho    timestamptz,            -- se sella al marcar Hecho
  notas          text,                   -- bitácora libre del ítem
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_roadmap_estado on roadmap_items (estado, orden);
create index if not exists idx_roadmap_categoria on roadmap_items (categoria);
