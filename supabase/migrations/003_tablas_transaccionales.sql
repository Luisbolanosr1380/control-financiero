-- ============================================================
-- 003 · Tablas transaccionales (FASE MOLDE)
-- facturas_clientes, cobros (+ puente multi-factura), notas de
-- crédito, deudas, pagos, obligaciones recurrentes, facturas_in.
--
-- NOTA: facturas_in.gasto_id se crea acá SIN FK (gastos vive en 004
-- y hay referencia circular gastos.factura_in_id ↔ facturas_in.gasto_id);
-- la FK se agrega en 004 después de crear gastos.
-- ============================================================

create table if not exists facturas_clientes (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  factura_id_legacy text,
  no_factura text,
  cliente_id uuid references clientes(id),
  fecha_emision date,
  subtotal numeric(14,2),
  iva numeric(14,2),
  total numeric(14,2),
  centro_costo_id uuid references centros_costo(id),
  estado text,
  cuenta_cxc text,
  observaciones text,
  editado_por text,
  fecha_ultima_edicion timestamptz,
  historial_ediciones text,
  adjunto_url text,
  adjunto_nombre text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_fact_cliente on facturas_clientes (cliente_id);
create index if not exists idx_fact_cc on facturas_clientes (centro_costo_id);
create index if not exists idx_fact_estado on facturas_clientes (estado);
create index if not exists idx_fact_fecha on facturas_clientes (fecha_emision);

create table if not exists cobros_clientes (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  factura_id uuid references facturas_clientes(id),
  fecha_cobro date,
  monto_cobrado numeric(14,2),
  monto_cobro_gtq numeric(14,2),
  cuenta_banco_id uuid references bancos(id),
  metodo text,
  moneda moneda default 'GTQ',
  tipo_cambio numeric(10,4) default 1,
  referencia text,
  estado text,
  es_conciliado boolean default false,
  monto_retencion_iva numeric(14,2) default 0,
  monto_retencion_isr numeric(14,2) default 0,
  mes_cobro text,
  quincena_cobro text,
  fecha_anulacion date,
  motivo_anulacion text,
  anulado_por text,
  cobro_grupo_id text,
  estado_cobro text,
  constancia_url text,
  constancia_nombre text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_cobros_factura on cobros_clientes (factura_id);
create index if not exists idx_cobros_fecha on cobros_clientes (fecha_cobro);

-- Puente cobro↔facturas (cobros multi-factura). OJO PostgREST: esta
-- tabla crea una SEGUNDA relación cobros↔facturas — todo embed entre
-- ellas necesita hint !fk_name (PGRST201).
create table if not exists cobros_facturas (
  cobro_id uuid not null references cobros_clientes(id) on delete cascade,
  factura_id uuid not null references facturas_clientes(id) on delete cascade,
  primary key (cobro_id, factura_id)
);

create table if not exists notas_credito (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  numero_nc text,
  factura_id uuid references facturas_clientes(id),
  cliente_id uuid references clientes(id),
  razon_social text,
  fecha_emision date,
  monto numeric(14,2),
  motivo text,
  descripcion text,
  estado text,
  emitida_por text,
  fecha_creacion timestamptz,
  aprobada_por text,
  fecha_aprobacion date,
  motivo_anulacion text,
  fecha_anulacion date,
  anulada_por text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists deudas (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  clave_deuda text,
  acreedor_id uuid references acreedores(id),
  nombre_deuda text,
  tipo_documento text,
  estado text,
  estado_deuda text,
  monto_original numeric(14,2),
  fecha_emision date,
  fecha_desembolso date,
  fecha_primer_cuota date,
  plazo_meses integer,
  fecha_vencimiento_real date,
  moneda moneda default 'GTQ',
  tipo_cambio numeric(10,4) default 1,
  iva numeric(14,2) default 0,
  subtotal numeric(14,2),
  monto_gtq numeric(14,2),
  saldo_pendiente numeric(14,2),
  centro_costo_id uuid references centros_costo(id),
  referencia_externa text,
  con_recurso boolean,
  tasa_interes text,
  interes_anual_pct numeric(6,4),
  interes_mora_pct numeric(6,4),
  tasa_comision_pct numeric(6,4),
  reserva_pct numeric(6,4),
  dia_pago_fijo integer,
  no_incluir boolean default false,
  notas text,
  fecha_vencimiento date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_deudas_acreedor on deudas (acreedor_id);
create index if not exists idx_deudas_estado on deudas (estado);

create table if not exists pagos_proveedores (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  deuda_id uuid references deudas(id),
  fecha_pago date,
  cuenta_banco_id uuid references bancos(id),
  moneda moneda default 'GTQ',
  tipo_cambio numeric(10,4) default 1,
  monto_pago numeric(14,2),
  monto_comision numeric(14,2) default 0,
  monto_mora numeric(14,2) default 0,
  monto_interes numeric(14,2) default 0,
  monto_pago_gtq numeric(14,2),
  es_conciliado boolean default false,
  estado text,
  pagado_por text,
  metodo text,
  referencia text,
  notas text,
  fecha_anulacion date,
  motivo_anulacion text,
  estado_pago text,
  cuenta_banco_nombre text,
  anulado_por text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_pagos_deuda on pagos_proveedores (deuda_id);

create table if not exists obligaciones_recurrentes (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  nombre text not null,
  tipo text,
  monto_estimado numeric(14,2),
  dia_pago integer,
  frecuencia text,
  prioridad text,
  por_cuenta_de empresa_empleadora default 'Golden Talent',
  proveedor_id uuid references proveedores(id),
  acreedor_id uuid references acreedores(id),
  centro_costo_id uuid references centros_costo(id),
  cuenta_contable_id uuid references cuentas(id),
  banco_pago_id uuid references bancos(id),
  mes_referencia text,
  fecha_inicio date,
  fecha_fin date,
  activo boolean default true,
  notas text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists facturas_in (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  proveedor_id uuid references proveedores(id),
  fecha_emision date,
  monto numeric(14,2),
  estado text,
  fuente text,
  archivo_url text,
  archivo_nombre text,
  file_hash text,
  doc_key text,
  proveedor_nombre text,
  proveedor_nit text,
  serie text,
  numero text,
  moneda_texto text default 'Q',
  subtotal numeric(14,2),
  iva numeric(14,2),
  total numeric(14,2),
  pais text,
  tipo_doc text,
  otros_impuestos numeric(14,2),
  texto_ocr text,
  datos_normalizados text,
  datos_normalizados_ok boolean default false,
  subido_por text,
  fecha_subida timestamptz,
  confianza_extraccion numeric(4,3),
  gasto_id uuid   -- FK a gastos se agrega en 004 (referencia circular)
);
create index if not exists idx_facturas_in_dockey on facturas_in (doc_key);
create index if not exists idx_facturas_in_hash on facturas_in (file_hash);
-- created_at/updated_at de facturas_in (Golden los tiene en medio de la
-- tabla; el orden de columnas no afecta a la app — PostgREST va por nombre)
alter table facturas_in add column if not exists created_at timestamptz default now();
alter table facturas_in add column if not exists updated_at timestamptz default now();

alter table facturas_clientes enable row level security;
alter table cobros_clientes enable row level security;
alter table cobros_facturas enable row level security;
alter table notas_credito enable row level security;
alter table deudas enable row level security;
alter table pagos_proveedores enable row level security;
alter table obligaciones_recurrentes enable row level security;
alter table facturas_in enable row level security;
