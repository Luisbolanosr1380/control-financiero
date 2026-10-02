-- ════════════════════════════════════════════════════════════
-- BOOTSTRAP HIT · 01 — Schema completo (migraciones 001→007)
-- Base destino: control-financiero-hit (ainshmieauumuqldibul)
-- Pegar ENTERO en el SQL Editor y correr UNA vez. Todo-o-nada
-- (begin/commit exterior): si algo falla, la base queda vacía.
--
-- Nota pedida: la 001 crea el enum empresa_empleadora y la 007 lo
-- convierte a text y lo elimina — CONFIRMADO que funciona así
-- concatenado; el estado FINAL es columnas text + catálogo
-- empresas_relacionadas. (El rodeo es el precio de un solo camino
-- de migraciones para todas las bases.)
--
-- Incluye al final:
--  · AJUSTES HIT: empresa principal = 'High Impact Talent S.A'
--    (defaults de DB + catálogo con es_principal=true; Golden y
--    hermanas quedan como relacionadas del grupo).
--  · _migraciones marcadas 001..007: si algún día corrés
--    scripts/migrar-todas.ts contra esta base, solo aplicará 008+.
-- Después de esto: correr 02_seed_plan_cuentas_hit.sql.
-- ════════════════════════════════════════════════════════════

begin;

-- ──────────────── 001_extensiones_y_enums.sql ────────────────
-- ============================================================
-- 001 · Extensiones y enums (FASE MOLDE)
--
-- Schema consolidado desde la base de Golden (introspección
-- 2026-08-30). Divergencia deliberada vs Golden: los defaults de
-- uuid usan gen_random_uuid() (core de Postgres 13+) en lugar de
-- uuid_generate_v4() — no se necesita la extensión uuid-ossp.
-- ============================================================

-- Enums (guardados contra re-ejecución: las migraciones deben poder
-- correrse sobre una base que ya las tenga a medias).
do $$ begin
  create type moneda as enum ('GTQ', 'USD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type naturaleza_saldo as enum ('Deudora', 'Acreedora');
exception when duplicate_object then null; end $$;

-- ⚠ Específico de Golden: los valores son las empresas del grupo.
-- Para el molde genérico, evaluar renombrar/parametrizar (el código de
-- la app hoy asume estos literales — cambiarlos requiere tocar la app).
do $$ begin
  create type empresa_empleadora as enum ('Golden Talent', 'HIT', 'Poligrafy', 'BYDSA', 'Otra');
exception when duplicate_object then null; end $$;

-- ──────────────── 002_tablas_catalogo.sql ────────────────
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

-- ──────────────── 003_tablas_transaccionales.sql ────────────────
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

-- ──────────────── 004_tablas_contables.sql ────────────────
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

-- ──────────────── 005_rpcs_transaccionales.sql ────────────────
-- ============================================================
-- 005 · RPCs transaccionales (FASE MOLDE)
-- Las 6 funciones de Fase 2, extraídas VERBATIM de la base de
-- Golden (pg_get_functiondef, 2026-08-30). Cada RPC es una
-- transacción: si algo falla adentro, no queda nada escrito.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fase2_nuevo_id()
 RETURNS text
 LANGUAGE sql
AS $function$
  select 'sbw' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
$function$;

CREATE OR REPLACE FUNCTION public.fase2_anular_cobros(p_cobro_airtable_ids text[], p_fecha date, p_motivo text, p_usuario text, p_factura_ids uuid[], p_nuevo_estado text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  n int;
begin
  update cobros_clientes
     set estado_cobro = 'Anulado',
         fecha_anulacion = p_fecha,
         motivo_anulacion = p_motivo,
         anulado_por = p_usuario,
         updated_at = now()
   where airtable_id = any(p_cobro_airtable_ids)
     and coalesce(estado_cobro, 'Activo') <> 'Anulado';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'fase2_anular_cobros: ningún cobro activo con esos ids';
  end if;
  if p_factura_ids is not null and array_length(p_factura_ids, 1) > 0 then
    update facturas_clientes
       set estado = p_nuevo_estado, updated_at = now()
     where id = any(p_factura_ids);
  end if;
  return jsonb_build_object('cobros_anulados', n);
end $function$;

CREATE OR REPLACE FUNCTION public.fase2_crear_asiento_con_partidas(p_asiento jsonb, p_partidas jsonb, p_planilla_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_asiento_id uuid;
  v_asiento_at text := fase2_nuevo_id();
  p jsonb;
  ids text[] := '{}';
  v_debe numeric := 0;
  v_haber numeric := 0;
  v_ref text := nullif(p_asiento->>'asiento_ref', '');
begin
  if p_partidas is null or jsonb_array_length(p_partidas) = 0 then
    raise exception 'fase2_crear_asiento_con_partidas: sin partidas';
  end if;

  -- Balance: se valida DENTRO de la transacción.
  select coalesce(sum((x->>'debe')::numeric), 0), coalesce(sum((x->>'haber')::numeric), 0)
    into v_debe, v_haber
    from jsonb_array_elements(p_partidas) x;
  if abs(v_debe - v_haber) > 0.01 then
    raise exception 'ASIENTO_NO_BALANCEADO: debe=% haber=%', v_debe, v_haber;
  end if;

  -- Idempotencia por referencia (además del unique index).
  if v_ref is not null and exists (select 1 from asientos where asiento_ref = v_ref) then
    raise exception 'ASIENTO_DUPLICADO: ya existe un asiento con ref %', v_ref;
  end if;

  insert into asientos (
    airtable_id, asiento_ref, fecha_asiento, periodo_id, origen,
    centro_costo_id, proveedor_id, cliente_id, banco_id, descripcion
  ) values (
    v_asiento_at,
    v_ref,
    (p_asiento->>'fecha_asiento')::date,
    nullif(p_asiento->>'periodo_id','')::uuid,
    nullif(p_asiento->>'origen',''),
    nullif(p_asiento->>'centro_costo_id','')::uuid,
    nullif(p_asiento->>'proveedor_id','')::uuid,
    nullif(p_asiento->>'cliente_id','')::uuid,
    nullif(p_asiento->>'banco_id','')::uuid,
    nullif(p_asiento->>'descripcion','')
  ) returning id into v_asiento_id;

  for p in select * from jsonb_array_elements(p_partidas) loop
    declare v_at text := fase2_nuevo_id();
    begin
      insert into partidas (
        airtable_id, asiento_id, cuenta_id, centro_costo_id,
        descripcion_linea, debe, haber, moneda, tipo_cambio, periodo,
        cliente_id, proveedor_id, banco_id
      ) values (
        v_at,
        v_asiento_id,
        (p->>'cuenta_id')::uuid,
        nullif(p->>'centro_costo_id','')::uuid,
        nullif(p->>'descripcion_linea',''),
        coalesce((p->>'debe')::numeric, 0),
        coalesce((p->>'haber')::numeric, 0),
        coalesce(nullif(p->>'moneda',''), 'GTQ')::moneda,
        coalesce((p->>'tipo_cambio')::numeric, 1),
        nullif(p->>'periodo',''),
        nullif(p->>'cliente_id','')::uuid,
        nullif(p->>'proveedor_id','')::uuid,
        nullif(p->>'banco_id','')::uuid
      );
      ids := ids || v_at;
    end;
  end loop;

  if p_planilla_ids is not null and array_length(p_planilla_ids, 1) > 0 then
    update planilla set asiento_id = v_asiento_id, updated_at = now()
     where id = any(p_planilla_ids);
  end if;

  return jsonb_build_object(
    'asiento_id', v_asiento_id,
    'asiento_airtable_id', v_asiento_at,
    'partidas_airtable_ids', to_jsonb(ids),
    'total_debe', v_debe,
    'total_haber', v_haber
  );
end $function$;

CREATE OR REPLACE FUNCTION public.fase2_aprobar_gasto(p_asiento jsonb, p_partidas jsonb, p_gasto jsonb, p_factura_in_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_res jsonb;
  v_gasto_id uuid;
  v_gasto_at text := fase2_nuevo_id();
begin
  v_res := fase2_crear_asiento_con_partidas(p_asiento, p_partidas);

  insert into gastos (
    airtable_id, proveedor_id, cuenta_gasto_id, centro_costo_id,
    asiento_id, periodo_id, fecha, monto, base, iva,
    metodo_pago, estado, banco_id, referencia_pago, fecha_vencimiento,
    tipo_operativo, descripcion, factura_in_id, fecha_aprobacion, aprobado_por
  ) values (
    v_gasto_at,
    nullif(p_gasto->>'proveedor_id','')::uuid,
    nullif(p_gasto->>'cuenta_gasto_id','')::uuid,
    nullif(p_gasto->>'centro_costo_id','')::uuid,
    (v_res->>'asiento_id')::uuid,
    nullif(p_gasto->>'periodo_id','')::uuid,
    (p_gasto->>'fecha')::date,
    (p_gasto->>'total')::numeric,
    (p_gasto->>'base')::numeric,
    coalesce((p_gasto->>'iva')::numeric, 0),
    nullif(p_gasto->>'metodo_pago',''),
    nullif(p_gasto->>'estado',''),
    nullif(p_gasto->>'banco_id','')::uuid,
    nullif(p_gasto->>'referencia_pago',''),
    nullif(p_gasto->>'fecha_vencimiento','')::date,
    nullif(p_gasto->>'tipo_operativo',''),
    nullif(p_gasto->>'descripcion',''),
    p_factura_in_id,
    nullif(p_gasto->>'fecha_aprobacion','')::timestamptz,
    nullif(p_gasto->>'aprobado_por','')
  ) returning id into v_gasto_id;

  if p_factura_in_id is not null then
    update facturas_in
       set estado = 'Aprobada', gasto_id = v_gasto_id, updated_at = now()
     where id = p_factura_in_id;
  end if;

  return v_res || jsonb_build_object('gasto_id', v_gasto_id, 'gasto_airtable_id', v_gasto_at);
end $function$;

CREATE OR REPLACE FUNCTION public.fase2_registrar_cobro(p_cobros jsonb, p_factura_ids uuid[], p_nuevo_estado text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  c jsonb;
  ids text[] := '{}';
  nuevo text;
begin
  if p_cobros is null or jsonb_array_length(p_cobros) = 0 then
    raise exception 'fase2_registrar_cobro: sin cobros';
  end if;
  for c in select * from jsonb_array_elements(p_cobros) loop
    nuevo := fase2_nuevo_id();
    insert into cobros_clientes (
      airtable_id, factura_id, fecha_cobro, monto_cobrado, monto_cobro_gtq,
      cuenta_banco_id, metodo, moneda, tipo_cambio, referencia, estado,
      es_conciliado, monto_retencion_iva, monto_retencion_isr,
      cobro_grupo_id, estado_cobro
    ) values (
      nuevo,
      (c->>'factura_id')::uuid,
      (c->>'fecha_cobro')::date,
      (c->>'monto_cobrado')::numeric,
      round((c->>'monto_cobrado')::numeric * coalesce((c->>'tipo_cambio')::numeric, 1), 2),
      nullif(c->>'cuenta_banco_id','')::uuid,
      c->>'metodo',
      coalesce(nullif(c->>'moneda',''), 'GTQ')::moneda,
      coalesce((c->>'tipo_cambio')::numeric, 1),
      nullif(c->>'referencia',''),
      coalesce(nullif(c->>'estado',''), 'Pendiente'),
      false,
      coalesce((c->>'monto_retencion_iva')::numeric, 0),
      coalesce((c->>'monto_retencion_isr')::numeric, 0),
      nullif(c->>'cobro_grupo_id',''),
      'Activo'
    );
    ids := ids || nuevo;
  end loop;
  update facturas_clientes
     set estado = p_nuevo_estado, updated_at = now()
   where id = any(p_factura_ids);
  return jsonb_build_object(
    'cobros_airtable_ids', to_jsonb(ids),
    'facturas_actualizadas', coalesce(array_length(p_factura_ids, 1), 0)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.fase2_registrar_pago(p_pago jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_at text := fase2_nuevo_id();
  v_id uuid;
begin
  insert into pagos_proveedores (
    airtable_id, deuda_id, fecha_pago, monto_pago, monto_interes,
    monto_mora, monto_comision, monto_pago_gtq, metodo, referencia,
    cuenta_banco_id, cuenta_banco_nombre, moneda, tipo_cambio, estado,
    estado_pago, notas
  ) values (
    v_at,
    (p_pago->>'deuda_id')::uuid,
    (p_pago->>'fecha_pago')::date,
    (p_pago->>'monto_pago')::numeric,
    coalesce((p_pago->>'monto_interes')::numeric, 0),
    coalesce((p_pago->>'monto_mora')::numeric, 0),
    coalesce((p_pago->>'monto_comision')::numeric, 0),
    round((p_pago->>'monto_pago')::numeric * coalesce((p_pago->>'tipo_cambio')::numeric, 1), 2),
    nullif(p_pago->>'metodo',''),
    nullif(p_pago->>'referencia',''),
    nullif(p_pago->>'cuenta_banco_id','')::uuid,
    nullif(p_pago->>'cuenta_banco_nombre',''),
    coalesce(nullif(p_pago->>'moneda',''), 'GTQ')::moneda,
    coalesce((p_pago->>'tipo_cambio')::numeric, 1),
    coalesce(nullif(p_pago->>'estado',''), 'Pendiente'),
    'Activo',
    nullif(p_pago->>'notas','')
  ) returning id into v_id;
  return jsonb_build_object('pago_id', v_id, 'pago_airtable_id', v_at);
end $function$;

-- ──────────────── 006_tablas_nuevas.sql ────────────────
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

-- ──────────────── 007_empresa_empleadora_a_texto.sql ────────────────
-- ============================================================
-- PROPUESTA 007 · enum empresa_empleadora → text + catálogo
-- (MULTI-EMPRESA · Bloque 1-B — NO APLICAR SIN APROBACIÓN)
--
-- Vive en supabase/propuestas/ a propósito: el runner migrar-todas
-- SOLO toma supabase/migrations/, así este draft no puede llegar a
-- ninguna base por accidente. Tras la aprobación del usuario se
-- renombra a supabase/migrations/007_... y se aplica con el runner.
--
-- QUÉ HACE (preservando el 100% de los datos):
--   1. empleados.empresa_empleadora y obligaciones_recurrentes.
--      por_cuenta_de pasan de enum a TEXT (cast 1:1, cero pérdida).
--   2. El default de DB se conserva ('Golden Talent') — en el deploy
--      de una empresa nueva, el bootstrap lo ajusta a su nombre.
--   3. Se crea el catálogo empresas_relacionadas (configurable por
--      empresa) sembrado con los valores REALMENTE usados + los
--      labels del enum histórico.
--   4. Se elimina el tipo enum (ya sin dependientes).
--
-- Validada contra una base efímera con datos estilo Golden (ver
-- MULTIEMPRESA_PROPUESTAS.md). IDEMPOTENTE: re-ejecutarla sobre una
-- base ya migrada pasa limpio sin alterar datos (text→text es cast
-- válido, drop/create llevan IF EXISTS, el insert ON CONFLICT).
--
-- DEPENDENCIAS DEL TIPO — verificadas contra Golden (solo lectura,
-- 2026-10-01, pg_attribute/pg_proc/pg_constraint/pg_rewrite/pg_attrdef):
--   · Columnas: SOLO las 2 que migra este script (más el índice
--     idx_empleados_empresa sobre empleados.empresa_empleadora, que
--     Postgres reconstruye automáticamente con el ALTER TYPE).
--   · Funciones/RPCs: NINGUNA lo recibe ni lo devuelve.
--   · Dominios, constraints, vistas: ninguno.
--   · Defaults: los 2 que este script repone como texto.
-- → el DROP TYPE del final no deja nada colgando.
--
-- TRANSACCIÓN: todo-o-nada — si cualquier paso falla, Golden queda
-- exactamente como estaba. (Si se aplica vía migrar-todas, que ya
-- envuelve cada archivo en su transacción, este BEGIN/COMMIT interno
-- es redundante pero inofensivo; está para la aplicación manual en el
-- SQL Editor, que es el plan del Paso 4.)
-- ============================================================

-- (begin interno omitido: transacción exterior del bootstrap)

-- 1-2. enum → text, conservando los defaults actuales
alter table empleados alter column empresa_empleadora drop default;
alter table empleados alter column empresa_empleadora type text
  using empresa_empleadora::text;
alter table empleados alter column empresa_empleadora set default 'Golden Talent';

alter table obligaciones_recurrentes alter column por_cuenta_de drop default;
alter table obligaciones_recurrentes alter column por_cuenta_de type text
  using por_cuenta_de::text;
alter table obligaciones_recurrentes alter column por_cuenta_de set default 'Golden Talent';

-- 4. el tipo queda sin dependientes
drop type if exists empresa_empleadora;

-- 3. catálogo configurable (la app lee las opciones de acá, no de un union type)
create table if not exists empresas_relacionadas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  es_principal boolean not null default false,   -- la empresa de ESTE deploy
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table empresas_relacionadas enable row level security;

-- Semilla: labels históricos + cualquier valor ya usado en datos.
insert into empresas_relacionadas (nombre, es_principal)
select v.nombre, v.nombre = 'Golden Talent'
from (
  values ('Golden Talent'), ('HIT'), ('Poligrafy'), ('BYDSA'), ('Otra')
  union
  select distinct empresa_empleadora from empleados where empresa_empleadora is not null
  union
  select distinct por_cuenta_de from obligaciones_recurrentes where por_cuenta_de is not null
) as v(nombre)
on conflict (nombre) do nothing;

-- (commit interno omitido)

-- ──────────────── AJUSTES HIT (empresa principal) ────────────────

-- Defaults de DB: lo no especificado cae a la empresa de ESTE deploy.
alter table empleados alter column empresa_empleadora set default 'High Impact Talent S.A';
alter table obligaciones_recurrentes alter column por_cuenta_de set default 'High Impact Talent S.A';

-- Catálogo: HIT principal; Golden y hermanas quedan como relacionadas
-- del grupo (la 007 sembró los 5 labels históricos con Golden★ — acá
-- se corrige). El label corto 'HIT' histórico se desactiva para no
-- duplicar la identidad (los datos nuevos usan el nombre legal).
insert into empresas_relacionadas (nombre, es_principal)
values ('High Impact Talent S.A', true)
on conflict (nombre) do update set es_principal = true, activo = true;
update empresas_relacionadas set es_principal = false where nombre <> 'High Impact Talent S.A';
update empresas_relacionadas set activo = false where nombre = 'HIT';

-- Registro de migraciones: el runner (migrar-todas.ts) verá 001..007
-- aplicadas y solo correrá las futuras 008+.
create table if not exists _migraciones (
  nombre text primary key,
  aplicada_en timestamptz not null default now()
);
insert into _migraciones (nombre) values
  ('001_extensiones_y_enums.sql'),
  ('002_tablas_catalogo.sql'),
  ('003_tablas_transaccionales.sql'),
  ('004_tablas_contables.sql'),
  ('005_rpcs_transaccionales.sql'),
  ('006_tablas_nuevas.sql'),
  ('007_empresa_empleadora_a_texto.sql')
on conflict (nombre) do nothing;

commit;

-- ──────────────── VERIFICACIÓN (el editor muestra este resultado) ────────────────
select 'tablas' as check, count(*)::text as valor from pg_tables where schemaname = 'public'
union all
select 'funciones fase2', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'fase2%'
union all
select 'enum eliminado (true)', (not exists(select 1 from pg_type where typname = 'empresa_empleadora'))::text
union all
select 'columna empleados = text', (select data_type from information_schema.columns
  where table_name = 'empleados' and column_name = 'empresa_empleadora')
union all
select 'catálogo (principal★)', string_agg(nombre || case when es_principal then '★' else '' end, ', ' order by nombre)
  from empresas_relacionadas where activo
union all
select 'default empleados', (select column_default from information_schema.columns
  where table_name = 'empleados' and column_name = 'empresa_empleadora')
union all
select '_migraciones', count(*)::text from _migraciones
order by 1;
-- Esperado: 36 tablas (34 + empresas_relacionadas + _migraciones) ·
-- 6 funciones fase2 · enum eliminado true · columna text · catálogo
-- con High Impact Talent S.A★ + Golden Talent, Poligrafy, BYDSA, Otra ·
-- default 'High Impact Talent S.A'::text · 7 migraciones.
