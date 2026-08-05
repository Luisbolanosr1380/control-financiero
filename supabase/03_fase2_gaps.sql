-- ═══════════════════════════════════════════════════════════════════
-- 03_fase2_gaps.sql — Columnas que el schema 01 no contempló.
-- Correr en el SQL Editor de Supabase (el service key no puede hacer DDL).
--
-- Después de correr esto:
--   python3 ~/Downloads/05_full_resync_api.py     (repuebla los campos)
--   npx tsx scripts/diff-datasource.ts deudas obligaciones_recurrentes
-- y si el diff sale limpio, flipear esas tablas en
-- src/lib/config/data-source.ts.
-- ═══════════════════════════════════════════════════════════════════

-- 1) DEUDAS.Fecha_Vencimiento es un campo REAL (input) en Airtable con 41
--    valores vivos; el schema solo guardó fecha_vencimiento_real (fórmula).
alter table deudas add column if not exists fecha_vencimiento date;

-- 2) OBLIGACIONES_RECURRENTES.POR_CUENTA_DE tiene la opción 'Otra' (2 filas)
--    que el enum no contempló — hoy están guardadas como 'Golden Talent'.
alter type empresa_empleadora add value if not exists 'Otra';
-- (después del resync quedan con su valor real)

-- 3) Campos de flujo F-035/F-036/F-044/F-038.4 vacíos hoy en Airtable pero
--    que las ESCRITURAS de Fase 2 van a necesitar:
alter table cobros_clientes add column if not exists cobro_grupo_id text;
alter table cobros_clientes add column if not exists estado_cobro  text;
alter table pagos_proveedores add column if not exists estado_pago text;
alter table facturas_clientes add column if not exists historial_ediciones text;
alter table planilla add column if not exists deuda_vinculada_id uuid references deudas(id);
alter table planilla add column if not exists fecha_diferimiento date;
alter table planilla add column if not exists fecha_cancelacion date;
alter table planilla add column if not exists motivo_cancelacion text;
alter table notas_credito add column if not exists fecha_creacion timestamptz;
alter table notas_credito add column if not exists aprobada_por text;
alter table notas_credito add column if not exists fecha_aprobacion date;
alter table notas_credito add column if not exists motivo_anulacion text;
alter table notas_credito add column if not exists fecha_anulacion date;
alter table notas_credito add column if not exists anulada_por text;

-- 4) Cobros vinculados a VARIAS facturas (74 históricos): hoy solo se guarda
--    la primera. Para Fase 2 conviene una tabla puente:
create table if not exists cobros_facturas (
    cobro_id   uuid references cobros_clientes(id) on delete cascade,
    factura_id uuid references facturas_clientes(id) on delete cascade,
    primary key (cobro_id, factura_id)
);

-- NOTA adjuntos (ADJUNTO de facturas ~1022 PDFs, boletas de planilla,
-- constancias de retención): las URLs de Airtable expiran — la migración
-- real es descargarlos a Supabase Storage (Fase 2). facturas_clientes se
-- queda leyendo de Airtable hasta entonces para no perder el link al PDF.

-- ═══ FASE 3 (auditoría de escrituras): tabla ANALISIS_AI faltante ═══
-- El log del análisis semanal/manual de Auros era el ÚNICO writer vivo a
-- Airtable que quedaba. Crear la tabla y el código escribe acá.
create table if not exists analisis_ai (
    id            uuid primary key default uuid_generate_v4(),
    airtable_id   text unique,
    fecha         timestamptz,
    texto         text,
    modelo        text,
    tokens_input  int,
    tokens_output int,
    duracion_seg  numeric(10,2),
    costo_usd     numeric(10,4),
    created_at    timestamptz default now()
);

-- ═══ FIX-FIRMA: firma digital del empleado (comprobante legal en boletas) ═══
-- Vivía como attachment en EMPLEADOS de Airtable (URLs que expiran).
alter table empleados add column if not exists firma_digital_url text;
alter table empleados add column if not exists firma_digital_nombre text;
