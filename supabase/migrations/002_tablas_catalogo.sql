-- ============================================================
-- 002 · Tablas de catálogo (FASE MOLDE)
-- cuentas, centros_costo, clientes, proveedores, acreedores,
-- bancos, periodos, empleados, activos_fijos.
--
-- airtable_id: id público de la capa de la app (id-bridge). NULLABLE
-- con unique — la app SIEMPRE lo llena al insertar (fase2_nuevo_id /
-- insertar()); nullable evita el bug de seeds por SQL sin id.
-- ============================================================

create table if not exists cuentas (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  codigo_path text not null unique,
  nombre text not null,
  nivel integer,
  parent_path text,
  parent_id uuid references cuentas(id),
  numero_orden integer,
  naturaleza_bs naturaleza_saldo,
  naturaleza_er naturaleza_saldo,
  tipo_estado text,
  descripcion text,
  observaciones text,
  activo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_cuentas_codigo on cuentas (codigo_path);
create index if not exists idx_cuentas_parent on cuentas (parent_id);

create table if not exists centros_costo (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  nombre text not null,
  codigo_cc text,
  naturaleza text,
  activo boolean default true,
  observaciones text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  etiqueta text,
  nombre_empresa text not null,
  razon_social text,
  nit text,
  email_cobros text,
  correo_cobro text,
  whatsapp_cobros text,
  instrucciones_cobro text,
  periodicidad_factura text,
  fecha_facturacion integer,
  dias_credito integer,
  cuenta_cxc text,
  contexto_comercial text,
  activo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  nombre text not null,
  cuenta_gasto_habitual_id uuid references cuentas(id),
  centro_costo_habitual_id uuid references centros_costo(id),
  nit text,
  contacto text,
  telefono text,
  email text,
  direccion text,
  activo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists acreedores (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  nombre_acreedor text not null,
  nombre_legal text,
  tipo_producto text,
  no_contrato_cuenta text,
  es_parte_relacionada boolean default false,
  tipo_acreedor text,
  impuesto_tipo text,
  meses integer,
  cuenta_contable_id uuid references cuentas(id),
  nit text,
  moneda moneda default 'GTQ',
  estatus text,
  condiciones_pago text,
  email text,
  telefono text,
  total_deuda_inicial numeric(14,2),
  notas text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists bancos (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  nombre_cuenta text not null,
  banco text,
  numero_cuenta text,
  moneda moneda default 'GTQ',
  saldo_inicial numeric(14,2) default 0,
  fecha_saldo_inicial date,
  cuenta_contable_id uuid references cuentas(id),
  activo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists periodos (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  periodo text not null unique,
  fecha_inicio date,
  fecha_fin date,
  estado text,
  notas text,
  aprobado_por text,
  fecha_aprobacion date,
  pagado_por text,
  fecha_cierre date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists empleados (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  nombre text not null,
  no_documento text,
  centro_costo_id uuid references centros_costo(id),
  empresa_empleadora empresa_empleadora default 'Golden Talent',
  status_laborando text,
  fecha_ingreso date,
  fecha_salida date,
  motivo_salida text,
  sede text,
  id_puesto text,
  departamento text,
  banco text,
  cuenta_bancaria text,
  salario_actual numeric(12,2),
  bonificacion numeric(12,2),
  bono_variable numeric(12,2),
  salario_mensual numeric(12,2),
  tipo_contrato text,
  acreedor_vinculado_id uuid references acreedores(id),
  firma_digital_url text,
  firma_digital_nombre text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_empleados_cc on empleados (centro_costo_id);
create index if not exists idx_empleados_empresa on empleados (empresa_empleadora);

create table if not exists activos_fijos (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  nombre_activo text not null,
  categoria text,
  fecha_adquisicion date,
  costo numeric(14,2),
  valor_residual numeric(14,2) default 0,
  vida_util_meses integer,
  centro_costo_id uuid references centros_costo(id),
  cuenta_activo_id uuid references cuentas(id),
  cuenta_depreciacion_id uuid references cuentas(id),
  depreciacion_acumulada numeric(14,2) default 0,
  tasa_fiscal_anual numeric(6,4),
  depreciacion_fiscal_acum numeric(14,2) default 0,
  estado text default 'Activo',
  notas text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS habilitado (igual que Golden): la app entra con service key, que
-- lo salta; sin políticas, el anon key no ve nada — default seguro.
alter table cuentas enable row level security;
alter table centros_costo enable row level security;
alter table clientes enable row level security;
alter table proveedores enable row level security;
alter table acreedores enable row level security;
alter table bancos enable row level security;
alter table periodos enable row level security;
alter table empleados enable row level security;
alter table activos_fijos enable row level security;
