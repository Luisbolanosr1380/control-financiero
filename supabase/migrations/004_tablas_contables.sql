-- ============================================================
-- 004 · Tablas contables y de nómina (FASE MOLDE)
-- asientos, partidas, gastos, movimientos bancarios, mapeos ER/BS
-- (+ puentes y snapshots), planilla. Cierra la FK circular
-- facturas_in.gasto_id → gastos.
-- ============================================================

create table if not exists asientos (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  no_asiento text,
  asiento_ref text,
  fecha_asiento date not null,
  periodo_id uuid references periodos(id),
  origen text,
  centro_costo_id uuid references centros_costo(id),
  proveedor_id uuid references proveedores(id),
  cliente_id uuid references clientes(id),
  banco_id uuid references bancos(id),
  descripcion text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_asientos_origen on asientos (origen);
create index if not exists idx_asientos_periodo on asientos (periodo_id);
-- Idempotencia de asientos generados (ASIENTO_DUPLICADO en la RPC).
create unique index if not exists uq_asientos_ref on asientos (asiento_ref) where asiento_ref is not null;

create table if not exists partidas (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  id_linea text,
  asiento_id uuid not null references asientos(id) on delete cascade,
  cuenta_id uuid not null references cuentas(id),
  centro_costo_id uuid references centros_costo(id),
  descripcion_linea text,
  debe numeric(14,2) default 0,
  haber numeric(14,2) default 0,
  moneda moneda default 'GTQ',
  tipo_cambio numeric(10,4) default 1,
  periodo text,
  cliente_id uuid references clientes(id),
  proveedor_id uuid references proveedores(id),
  banco_id uuid references bancos(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_partidas_asiento on partidas (asiento_id);
create index if not exists idx_partidas_cc on partidas (centro_costo_id);
create index if not exists idx_partidas_cuenta on partidas (cuenta_id);
create index if not exists idx_partidas_periodo on partidas (periodo);

create table if not exists gastos (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  proveedor_id uuid references proveedores(id),
  cuenta_gasto_id uuid references cuentas(id),
  centro_costo_id uuid references centros_costo(id),
  asiento_id uuid references asientos(id),
  periodo_id uuid references periodos(id),
  fecha date,
  monto numeric(14,2),
  tipo_operativo text,
  descripcion text,
  base numeric(14,2),
  iva numeric(14,2) default 0,
  metodo_pago text,
  estado text,
  banco_id uuid references bancos(id),
  referencia_pago text,
  fecha_vencimiento date,
  factura_in_id uuid references facturas_in(id),
  fecha_aprobacion timestamptz,
  aprobado_por text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Cierra la circular declarada en 003.
do $$ begin
  alter table facturas_in add constraint facturas_in_gasto_id_fkey
    foreign key (gasto_id) references gastos(id);
exception when duplicate_object then null; end $$;

create table if not exists movimientos_bancarios (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  banco_id uuid references bancos(id),
  fecha date,
  monto numeric(14,2),
  descripcion text,
  referencia text,
  conciliado boolean default false,
  asiento_id uuid references asientos(id),
  tipo text,
  periodo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Mapeos de reportes (estructura del ER y el Balance) ──
create table if not exists mapeo_er (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  linea text not null,
  orden integer,
  tipo text,
  signo text,
  prefijos text,
  created_at timestamptz default now()
);

create table if not exists mapeo_er_cuentas (
  mapeo_er_id uuid not null references mapeo_er(id) on delete cascade,
  cuenta_id uuid not null references cuentas(id) on delete cascade,
  primary key (mapeo_er_id, cuenta_id)
);

create table if not exists mapeo_bs (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  linea text not null,
  orden integer,
  tipo text,
  signo text,
  prefijos text,
  created_at timestamptz default now()
);

create table if not exists mapeo_bs_cuentas (
  mapeo_bs_id uuid not null references mapeo_bs(id) on delete cascade,
  cuenta_id uuid not null references cuentas(id) on delete cascade,
  primary key (mapeo_bs_id, cuenta_id)
);

create table if not exists er_snapshot (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  periodo text not null,
  mapeo_er_id uuid references mapeo_er(id),
  centro_costo_id uuid references centros_costo(id),
  linea text,
  monto_q numeric(14,2),
  orden integer,
  cerrado boolean default false,
  created_at timestamptz default now()
);

create table if not exists bs_snapshot (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  periodo text not null,
  mapeo_bs_id uuid references mapeo_bs(id),
  centro_costo_id uuid references centros_costo(id),
  linea text,
  monto_q numeric(14,2),
  orden integer,
  cerrado boolean default false,
  created_at timestamptz default now()
);

create table if not exists planilla (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  planilla_id_legacy text,
  periodo_id uuid references periodos(id),
  empleado_id uuid references empleados(id),
  centro_costo_id uuid references centros_costo(id),
  fecha_pago date,
  ordinario numeric(12,2) default 0,
  bonificacion numeric(12,2) default 0,
  extraordinario numeric(12,2) default 0,
  comisiones numeric(12,2) default 0,
  otros_ingresos numeric(12,2) default 0,
  igss numeric(12,2) default 0,
  isr numeric(12,2) default 0,
  otros_documentos numeric(12,2) default 0,
  neto_pagar numeric(12,2) default 0,
  estado text,
  estado_pago text,
  notas text,
  fecha_pago_registrada date,
  deuda_vinculada_id uuid references deudas(id),
  fecha_diferimiento date,
  fecha_cancelacion date,
  motivo_cancelacion text,
  asiento_id uuid references asientos(id),
  boleta_url text,
  boleta_nombre text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_planilla_empleado on planilla (empleado_id);
create index if not exists idx_planilla_periodo on planilla (periodo_id);

alter table asientos enable row level security;
alter table partidas enable row level security;
alter table gastos enable row level security;
alter table movimientos_bancarios enable row level security;
alter table mapeo_er enable row level security;
alter table mapeo_er_cuentas enable row level security;
alter table mapeo_bs enable row level security;
alter table mapeo_bs_cuentas enable row level security;
alter table er_snapshot enable row level security;
alter table bs_snapshot enable row level security;
alter table planilla enable row level security;
