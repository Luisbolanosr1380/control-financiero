-- ============================================================
-- 010 · Factoraje — puente factura ↔ factoraje (brief Factoraje HIT)
--
-- Corre en AMBAS bases vía scripts/migrar-todas.ts. SIN begin/commit
-- propio: el runner aporta la transacción (lección de la 008).
--
-- Un factoraje = una `deuda` con tipo_documento = 'Factoraje' (convención
-- verificada en vivo en Golden: 21 deudas, Q910K) y su `acreedor` es el
-- financiador (tipo_producto 'Factoraje', tipo_acreedor Banco/Financiera).
-- Los términos (con_recurso, reserva_pct, tasa_comision_pct,
-- interes_anual_pct, fecha_vencimiento) YA viven en `deudas` — no se crea
-- tabla paralela. Lo único nuevo es qué facturas están comprometidas.
-- ============================================================

create table if not exists factoraje_facturas (
  id            uuid primary key default gen_random_uuid(),
  deuda_id      uuid not null references deudas(id) on delete cascade,          -- el factoraje
  factura_id    uuid not null references facturas_clientes(id) on delete cascade,
  monto_cedido  numeric not null check (monto_cedido > 0),
  fecha_cesion  date not null default current_date,
  estado        text not null default 'Cedida' check (estado in ('Cedida', 'Liberada', 'Recomprada', 'Pagada')),
  nota          text,
  created_at    timestamptz default now(),
  created_by    text,
  -- auditoría del cambio de estado (quién liberó / recompró / marcó pagada)
  estado_en     timestamptz,
  estado_por    text
);

create index if not exists idx_factfact_deuda   on factoraje_facturas(deuda_id);
create index if not exists idx_factfact_factura on factoraje_facturas(factura_id);

-- ANTI-DOBLE-CESIÓN: la defensa real, a nivel de base. Una factura solo
-- puede estar en UN factoraje activo ('Cedida') a la vez; al liberarla,
-- recomprarla o pagarse, el candado se abre y puede cederse de nuevo.
create unique index if not exists uq_factfact_factura_activa
  on factoraje_facturas(factura_id) where estado = 'Cedida';

-- RLS al patrón de estas bases: activo, sin policies (solo service_role).
alter table factoraje_facturas enable row level security;
