-- ============================================================
-- SEED · Plan de cuentas base (FASE MOLDE · Pieza 2)
-- Generado por scripts/generar-seed-plan-cuentas.py — NO editar a mano;
-- regenerar desde la base de referencia si el catálogo cambia.
--
-- Contenido: 245 cuentas · 6 centros de costo · 25 líneas ER · 20 líneas BS.
-- Sin datos transaccionales. IDEMPOTENTE: solo siembra si cuentas está vacía.
-- airtable_id determinísticos (la capa de ids de la app los requiere; ver
-- encabezado del generador). Cuentas específicas de Golden marcadas con ⚠.
-- ============================================================

do $seed$
begin
  if exists (select 1 from cuentas limit 1) then
    raise notice 'seed_plan_cuentas_base: la tabla cuentas ya tiene datos — seed omitido';
    return;
  end if;

  -- ── Plan de cuentas (pass 1: filas; parent por codigo_path en pass 2) ──
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1', '1', 'Activo', 1, null, 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1', '1-1', 'Activo Corriente', 2, '1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-1', '1-1-1', 'Caja y Efectivo', 3, '1-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-1-1', '1-1-1-1', '
Caja Chica
', 4, '1-1-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-1-2', '1-1-1-2', '
Caja General
', 4, '1-1-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-2', '1-1-2', 'Bancos', 3, '1-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-2-1', '1-1-2-1', 'BANCO INDUSTRIAL (Q)', 4, '1-1-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-2-2', '1-1-2-2', 'BANCO CUSCATLAN (Q)', 4, '1-1-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-2-3', '1-1-2-3', 'BANCO BANRURAL', 4, '1-1-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3', '1-1-3', 'Cuentas por Cobrar Clientes', 3, '1-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3-1', '1-1-3-1', '
CxC Clientes Nacionales
', 4, '1-1-3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3-2', '1-1-3-2', '
CxC Clientes Internacionales
', 4, '1-1-3', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3-3', '1-1-3-3', 'CxC Partes Relacionadas', 4, '1-1-3', null, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3-3-1', '1-1-3-3-1', 'CxC HIT (High Impact Talent)', 5, '1-1-3-3', null, null, null, null, null, null, false);  -- ⚠ específica de Golden (intercompany): revisar si va en el molde base
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3-3-2', '1-1-3-3-2', 'CxC Poligrafy', 5, '1-1-3-3', null, null, null, null, null, null, false);  -- ⚠ específica de Golden (intercompany): revisar si va en el molde base
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3-3-3', '1-1-3-3-3', 'CxC BYDSA', 5, '1-1-3-3', null, null, null, null, null, null, false);  -- ⚠ específica de Golden (intercompany): revisar si va en el molde base
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-3-9', '1-1-3-9', '
Otras Cuentas por Cobrar
', 4, '1-1-3', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-4', '1-1-4', 'IVA Crédito Fiscal', 3, '1-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-5', '1-1-5', 'Anticipos y Viáticos', 3, '1-1', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-6', '1-1-6', 'Gastos Pagados por Anticipado', 3, '1-1', 60, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-7', '1-1-7', 'Depósitos en Garantía CP', 3, '1-1', 70, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-1-8', '1-1-8', 'Otras Cuentas por Cobrar', 3, '1-1', 80, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2', '1-2', 'Activo No Corriente', 2, '1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-1', '1-2-1', 'Propiedad Planta y Equipo', 3, '1-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-1-1', '1-2-1-1', '
Equipos de Cómputo
', 4, '1-2-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-1-3', '1-2-1-3', '
Unidades de Polígrafo
', 4, '1-2-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-1-5', '1-2-1-5', '
Mejoras en Instalaciones
', 4, '1-2-1', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-1-9', '1-2-1-9', '
Otros PPE
', 4, '1-2-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-2', '1-2-2', 'Depreciación Acumulada', 3, '1-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-2-1', '1-2-2-1', '
Deprec. Acum Equipos de Cómputo
', 4, '1-2-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-2-9', '1-2-2-9', '
Otras Depreciaciones Acumuladas
', 4, '1-2-2', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-3', '1-2-3', 'Intangibles (Software/Licencias)', 3, '1-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-3-1', '1-2-3-1', '
Software
', 4, '1-2-3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-3-2', '1-2-3-2', '
Licencias
', 4, '1-2-3', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-4', '1-2-4', 'Amortización Acumulada', 3, '1-2', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-4-1', '1-2-4-1', '
Amortización Acum Software
', 4, '1-2-4', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-4-2', '1-2-4-2', '
Amortización Acum Licencias
', 4, '1-2-4', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-5', '1-2-5', 'Activo por Derecho de Uso (NIIF 16)', 3, '1-2', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-1-2-6', '1-2-6', 'Depósitos en Garantía LP', 3, '1-2', 60, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2', '2', 'Pasivo', 1, null, 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1', '2-1', 'Pasivo Corriente', 2, '2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-1', '2-1-1', 'Proveedores', 3, '2-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-1-1', '2-1-1-1', '
Proveedores Nacionales
', 4, '2-1-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-1-2', '2-1-1-2', '
Proveedores Internacionales
', 4, '2-1-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-2', '2-1-2', 'Sueldos y Prestaciones por Pagar', 3, '2-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-2-1', '2-1-2-1', '
Sueldos por Pagar
', 4, '2-1-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-2-2', '2-1-2-2', '
Bonificaciones por Pagar
', 4, '2-1-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-2-3', '2-1-2-3', '
Horas Extra por Pagar
', 4, '2-1-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-3', '2-1-3', 'IGSS/IRTRA/INTECAP por Pagar', 3, '2-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-3-1', '2-1-3-1', '
IGSS por Pagar
', 4, '2-1-3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-3-2', '2-1-3-2', '
IRTRA por Pagar
', 4, '2-1-3', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-3-3', '2-1-3-3', '
INTECAP por Pagar
', 4, '2-1-3', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-4', '2-1-4', 'ISR por Pagar', 3, '2-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-5', '2-1-5', 'IVA por Pagar (Débito Fiscal)', 3, '2-1', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-6', '2-1-6', 'Provisiones CP (Bono 14/Aguinaldo/Vacaciones)', 3, '2-1', 60, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-7', '2-1-7', 'Anticipos de Clientes / Ingresos Diferidos CP', 3, '2-1', 70, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-7-1', '2-1-7-1', '
Anticipos de Clientes Nacionales
', 4, '2-1-7', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-7-2', '2-1-7-2', '
Anticipos de Clientes Internacionales
', 4, '2-1-7', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-8', '2-1-8', 'Préstamos CP', 3, '2-1', 80, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-9', '2-1-9', 'Arrendamientos CP', 3, '2-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-1-10', '2-1-10', 'Retenciones por Pagar', 3, '2-1', 100, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-2', '2-2', 'Pasivo No Corriente', 2, '2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-2-1', '2-2-1', 'Préstamos LP', 3, '2-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-2-1-1', '2-2-1-1', '
Préstamos Bancarios LP
', 4, '2-2-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-2-2', '2-2-2', 'Arrendamientos LP', 3, '2-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-2-2-1', '2-2-2-1', '
Pasivo por Arrendamiento LP
', 4, '2-2-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-2-3', '2-2-3', 'Provisiones LP', 3, '2-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-2-4', '2-2-4', 'IGSS/IRTRA/INTECAP por pagar (Convenio LP)', 3, '2-2', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3', '2-3', 'Acreedores', 2, '2', 30, null, null, null, null, 'Cuentas por pagar a terceros distintas a proveedores y obligaciones ya clasificadas (impuestos, nómina, arrendamientos).', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-1', '2-3-1', 'Acreedores diversos CP', 3, '2-3', 10, null, null, null, null, 'Cuentas por pagar a terceros no comerciales (servicios, honorarios, viáticos reembolsables).', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-2', '2-3-2', 'Tarjetas de crédito por pagar CP', 3, '2-3', 20, null, null, null, null, 'Saldos de TDC corporativas a menos de 12 meses.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-3', '2-3-3', 'CxP partes relacionadas CP', 3, '2-3', 30, null, null, null, null, 'Obligaciones con empresas/personas vinculadas (no proveedor comercial).', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-4', '2-3-4', 'Intereses por pagar CP', 3, '2-3', 40, null, null, null, null, 'Intereses devengados no pagados (préstamos/arrendamientos).', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-5', '2-3-5', 'Gastos acumulados por pagar CP', 3, '2-3', 50, null, null, null, null, 'Servicios consumidos y aún no facturados (telco, luz, mantenimiento).', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-6', '2-3-6', 'Depósitos en garantía recibidos CP', 3, '2-3', 60, null, null, null, null, 'Depósitos de clientes/terceros reembolsables en < 12 meses.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-7', '2-3-7', 'Dividendos por pagar CP', 3, '2-3', 70, null, null, null, null, 'Dividendos decretados pendientes de pago.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-2-3-8', '2-3-8', 'Otros acreedores CP', 3, '2-3', 80, null, null, null, null, 'Obligaciones varias no clasificadas en las anteriores.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3', '3', 'Patrimonio de los accionistas', 1, null, 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3-1', '3-1', 'Capital social', 2, '3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3-1-1', '3-1-1', 'Capital Social', 3, '3-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3-1-2', '3-1-2', 'Aportes / Prima en Emisión', 3, '3-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3-2', '3-2', 'Reservas y utilidades', 2, '3', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3-2-1', '3-2-1', 'Reserva Legal', 3, '3-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3-2-2', '3-2-2', 'Resultados Acumulados', 3, '3-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-3-2-3', '3-2-3', 'Resultado del Ejercicio', 3, '3-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4', '4', 'Ingreso y ventas', 1, null, 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1', '4-1', 'Ingresos Operacionales', 2, '4', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1', '4-1-1', 'Outsourcing de Personal', 3, '4-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1', '4-1-1-1', '
Honorarios Outsourcing
', 4, '4-1-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1-1', '4-1-1-1-1', '
Honorarios Outsourcing — Tarifa estándar
', 5, '4-1-1-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1-2', '4-1-1-1-2', '
Honorarios Outsourcing — Tarifa premium
', 5, '4-1-1-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1-3', '4-1-1-1-3', '
Ajustes por horas extra (Outsourcing)
', 5, '4-1-1-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1-4', '4-1-1-1-4', '
Recargos por urgencia (Outsourcing)
', 5, '4-1-1-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1-7', '4-1-1-1-7', '
Descuentos comerciales (Outsourcing) [CONTRA]
', 5, '4-1-1-1', 70, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1-8', '4-1-1-1-8', '
Notas de crédito emitidas (Outsourcing) [CONTRA]
', 5, '4-1-1-1', 80, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-1-1-9', '4-1-1-1-9', '
Otros ingresos de Outsourcing
', 5, '4-1-1-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2', '4-1-2', 'Reclutamiento Especializado', 3, '4-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2-1', '4-1-2-1', '
Honorarios Reclutamiento
', 4, '4-1-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2-1-1', '4-1-2-1-1', '
Fee por colocación (Reclutamiento)
', 5, '4-1-2-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2-1-2', '4-1-2-1-2', '
Success fee (Reclutamiento)
', 5, '4-1-2-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2-1-3', '4-1-2-1-3', '
Retainer / Anticipo (Reclutamiento)
', 5, '4-1-2-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2-1-7', '4-1-2-1-7', '
Descuentos (Reclutamiento) [CONTRA]
', 5, '4-1-2-1', 70, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2-1-8', '4-1-2-1-8', '
Notas de crédito (Reclutamiento) [CONTRA]
', 5, '4-1-2-1', 80, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-2-1-9', '4-1-2-1-9', '
Otros ingresos de Reclutamiento
', 5, '4-1-2-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3', '4-1-3', 'Poligrafía', 3, '4-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3-1', '4-1-3-1', '
Honorarios Poligrafía
', 4, '4-1-3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3-1-1', '4-1-3-1-1', '
Prueba poligráfica estándar
', 5, '4-1-3-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3-1-2', '4-1-3-1-2', '
Prueba poligráfica de seguimiento
', 5, '4-1-3-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3-1-3', '4-1-3-1-3', '
Recargo fin de semana / nocturno (Poligrafía)
', 5, '4-1-3-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3-1-7', '4-1-3-1-7', '
Descuentos (Poligrafía) [CONTRA]
', 5, '4-1-3-1', 70, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3-1-8', '4-1-3-1-8', '
Notas de crédito (Poligrafía) [CONTRA]
', 5, '4-1-3-1', 80, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-3-1-9', '4-1-3-1-9', '
Otros ingresos de Poligrafía
', 5, '4-1-3-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4', '4-1-4', 'Estudios Socioeconómicos', 3, '4-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4-1', '4-1-4-1', '
Honorarios Estudios Socioeconómicos
', 4, '4-1-4', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4-1-1', '4-1-4-1-1', '
Estudio socioeconómico básico
', 5, '4-1-4-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4-1-2', '4-1-4-1-2', '
Estudio socioeconómico extendido
', 5, '4-1-4-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4-1-3', '4-1-4-1-3', '
Servicio urgente / expedito (Socioeconómicos)
', 5, '4-1-4-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4-1-7', '4-1-4-1-7', '
Descuentos (Socioeconómicos) [CONTRA]
', 5, '4-1-4-1', 70, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4-1-8', '4-1-4-1-8', '
Notas de crédito (Socioeconómicos) [CONTRA]
', 5, '4-1-4-1', 80, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-4-1-9', '4-1-4-1-9', '
Otros ingresos de Socioeconómicos
', 5, '4-1-4-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5', '4-1-5', 'Asesorías de RH', 3, '4-1', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1', '4-1-5-1', '
Honorarios Asesorías RH
', 4, '4-1-5', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1-1', '4-1-5-1-1', '
Consultoría RH por hora
', 5, '4-1-5-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1-2', '4-1-5-1-2', '
Consultoría RH por proyecto
', 5, '4-1-5-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1-3', '4-1-5-1-3', '
Talleres in-house
', 5, '4-1-5-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1-4', '4-1-5-1-4', '
Cursos abiertos
', 5, '4-1-5-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1-7', '4-1-5-1-7', '
Descuentos (Asesorías RH) [CONTRA]
', 5, '4-1-5-1', 70, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1-8', '4-1-5-1-8', '
Notas de crédito (Asesorías RH) [CONTRA]
', 5, '4-1-5-1', 80, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-5-1-9', '4-1-5-1-9', '
Otros ingresos de Asesorías RH
', 5, '4-1-5-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-6', '4-1-6', 'Reembolsos / Recuperaciones', 3, '4-1', 60, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-7', '4-1-7', 'Servicios Administrativos a Partes Relacionadas', 3, '4-1', null, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-7-1', '4-1-7-1', 'Servicios Adm. Intercompañía — HIT', 4, '4-1-7', null, null, null, null, null, null, false);  -- ⚠ específica de Golden (intercompany): revisar si va en el molde base
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-7-2', '4-1-7-2', 'Servicios Adm. Intercompañía — Poligrafy', 4, '4-1-7', null, null, null, null, null, null, false);  -- ⚠ específica de Golden (intercompany): revisar si va en el molde base
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-7-3', '4-1-7-3', 'Servicios Adm. Intercompañía — BYDSA', 4, '4-1-7', null, null, null, null, null, null, false);  -- ⚠ específica de Golden (intercompany): revisar si va en el molde base
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-4-1-9', '4-1-9', 'Otros Ingresos Operativos', 3, '4-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5', '5', 'Egresos', 1, null, 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1', '5-1', 'Costos de Servicios', 2, '5', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1', '5-1-1', 'Costos Outsourcing (Sueldos Tercerizados)', 3, '5-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-1', '5-1-1-1', '
Sueldos Tercerizados
', 4, '5-1-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-1-1', '5-1-1-1-1', '
Sueldos tercerizados — Ordinario
', 5, '5-1-1-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-1-2', '5-1-1-1-2', '
Sueldos tercerizados — Horas extra
', 5, '5-1-1-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-1-3', '5-1-1-1-3', '
Sueldos tercerizados — Bonificaciones
', 5, '5-1-1-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-2', '5-1-1-2', '
Cargas Sociales Tercerizados
', 4, '5-1-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-2-1', '5-1-1-2-1', '
IGSS tercerizados
', 5, '5-1-1-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-2-2', '5-1-1-2-2', '
Otras cargas sociales tercerizados
', 5, '5-1-1-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-4', '5-1-1-4', '
Viáticos Directos (Outsourcing)
', 4, '5-1-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-4-1', '5-1-1-4-1', '
Viáticos directos (Outsourcing) — Transporte
', 5, '5-1-1-4', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-4-2', '5-1-1-4-2', '
Viáticos directos (Outsourcing) — Alimentación
', 5, '5-1-1-4', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-4-3', '5-1-1-4-3', '
Viáticos directos (Outsourcing) — Hospedaje
', 5, '5-1-1-4', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-5', '5-1-1-5', '
Subcontratación (Outsourcing)
', 4, '5-1-1', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-5-1', '5-1-1-5-1', '
Subcontratación Outsourcing — Empresas aliadas
', 5, '5-1-1-5', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-1-5-2', '5-1-1-5-2', '
Subcontratación Outsourcing — Profesionales independientes
', 5, '5-1-1-5', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2', '5-1-2', 'Costos Reclutamiento (Bolsas/Test por Cliente)', 3, '5-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-1', '5-1-2-1', '
Bolsas de Empleo
', 4, '5-1-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-1-1', '5-1-2-1-1', '
Plataformas de empleo — A
', 5, '5-1-2-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-1-2', '5-1-2-1-2', '
Plataformas de empleo — B
', 5, '5-1-2-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-1-3', '5-1-2-1-3', '
Plataformas de empleo — C
', 5, '5-1-2-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-2', '5-1-2-2', '
Tests y Evaluaciones
', 4, '5-1-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-2-1', '5-1-2-2-1', '
Tests psicométricos
', 5, '5-1-2-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-2-2', '5-1-2-2-2', '
Tests técnicos
', 5, '5-1-2-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-2-3', '5-1-2-2-3', '
Tests de idiomas
', 5, '5-1-2-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-3', '5-1-2-3', '
Verificaciones y Referencias
', 4, '5-1-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-3-1', '5-1-2-3-1', '
Verificaciones — Antecedentes laborales
', 5, '5-1-2-3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-3-2', '5-1-2-3-2', '
Verificaciones — Académicos
', 5, '5-1-2-3', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-2-3-3', '5-1-2-3-3', '
Verificaciones — Penales/Policíacos
', 5, '5-1-2-3', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3', '5-1-3', 'Costos Poligrafía', 3, '5-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3-1', '5-1-3-1', '
Honorarios Poligrafistas
', 4, '5-1-3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3-1-1', '5-1-3-1-1', '
Honorarios poligrafistas — Internos
', 5, '5-1-3-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3-1-2', '5-1-3-1-2', '
Honorarios poligrafistas — Subcontratados
', 5, '5-1-3-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3-2', '5-1-3-2', '
Insumos y Calibración
', 4, '5-1-3', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3-2-1', '5-1-3-2-1', '
Insumos de polígrafo (consumibles)
', 5, '5-1-3-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3-2-2', '5-1-3-2-2', '
Calibración y mantenimiento equipos
', 5, '5-1-3-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-3-3', '5-1-3-3', 'Nómina Directa Poligrafía', 4, '5-1-3', null, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4', '5-1-4', 'Costos Estudios Socioeconómicos', 3, '5-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-1', '5-1-4-1', '
Honorarios Entrevistadores
', 4, '5-1-4', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-1-1', '5-1-4-1-1', '
Honorarios entrevistadores — Internos
', 5, '5-1-4-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-1-2', '5-1-4-1-2', '
Honorarios entrevistadores — Subcontratados
', 5, '5-1-4-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-2', '5-1-4-2', '
Viáticos Directos (Socioeconómicos)
', 4, '5-1-4', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-2-1', '5-1-4-2-1', '
Viáticos directos (Socioeconómicos) — Transporte
', 5, '5-1-4-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-2-2', '5-1-4-2-2', '
Viáticos directos (Socioeconómicos) — Alimentación
', 5, '5-1-4-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-2-3', '5-1-4-2-3', '
Viáticos directos (Socioeconómicos) — Hospedaje
', 5, '5-1-4-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-4-3', '5-1-4-3', 'Nómina Directa Socioeconómicos', 4, '5-1-4', null, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5', '5-1-5', 'Costos Asesorías RH', 3, '5-1', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-1', '5-1-5-1', '
Consultoría RH Directa
', 4, '5-1-5', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-1-1', '5-1-5-1-1', '
Consultoría RH Directa — Horas Senior
', 5, '5-1-5-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-1-2', '5-1-5-1-2', '
Consultoría RH Directa — Horas Semi-Senior
', 5, '5-1-5-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-1-3', '5-1-5-1-3', '
Consultoría RH Directa — Horas Junior
', 5, '5-1-5-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-2', '5-1-5-2', '
Talleres/Capacitación Directa
', 4, '5-1-5', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-2-1', '5-1-5-2-1', '
Talleres/Capacitación — Materiales y manuales
', 5, '5-1-5-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-2-2', '5-1-5-2-2', '
Talleres/Capacitación — Logística y salas
', 5, '5-1-5-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-5-3', '5-1-5-3', 'Nómina Directa TalentTrack', 4, '5-1-5', null, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-9', '5-1-9', 'Costos Reembolsables', 3, '5-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-9-1', '5-1-9-1', '
Reembolsos a Cliente
', 4, '5-1-9', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-9-1-1', '5-1-9-1-1', '
Reembolsos a cliente — Viáticos
', 5, '5-1-9-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-9-1-2', '5-1-9-1-2', '
Reembolsos a cliente — Materiales
', 5, '5-1-9-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-5-1-9-1-3', '5-1-9-1-3', '
Reembolsos a cliente — Trámites/fees
', 5, '5-1-9-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6', '6', 'Gastos', 1, null, 60, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1', '6-1', 'Gastos de Administración', 2, '6', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-1', '6-1-1', 'Sueldos Administración e IGSS', 3, '6-1', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-1-11', '6-1-1-11', '
Capacitación y Bienestar (Adm)
', 4, '6-1-1', 110, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-1-12', '6-1-1-12', '
Viajes y Viáticos (Adm)
', 4, '6-1-1', 120, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-2', '6-1-2', 'Servicios (Renta  Electricidad Internet)', 3, '6-1', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-3', '6-1-3', 'Mantenimiento y Papelería', 3, '6-1', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-4', '6-1-4', 'Seguros', 3, '6-1', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-5', '6-1-5', 'Viáticos y Combustibles (No directos)', 3, '6-1', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-6', '6-1-6', 'Capacitación y Bienestar', 3, '6-1', 60, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-7', '6-1-7', 'Atención al Personal y Alimentación', 3, '6-1', null, null, null, null, 'Alimentación y atenciones para el equipo interno: almuerzos de equipo, pizza, celebraciones, cumpleaños, agua/café de oficina, snacks. Aplica para cualquier centro de costo (el CC define a qué área se carga). NO usar para atención a clientes — eso va en 6-2-6 Gastos de Representación.', null, true);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-1-9', '6-1-9', 'Otros Gastos Administrativos', 3, '6-1', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2', '6-2', 'Gastos de Ventas y Marketing', 2, '6', 20, null, null, null, null, 'Publicidad, comisiones, ferias, etc.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2-1', '6-2-1', 'Publicidad y Marketing', 3, '6-2', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2-2', '6-2-2', 'Comisiones Comerciales', 3, '6-2', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2-3', '6-2-3', 'Eventos y Ferias', 3, '6-2', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2-4', '6-2-4', 'Viajes y Viáticos de Ventas', 3, '6-2', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2-5', '6-2-5', 'Material POP y Merchandising', 3, '6-2', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2-6', '6-2-6', 'Gastos de Representación (Atención a Clientes)', 3, '6-2', null, null, null, null, 'Atenciones a clientes y prospectos: invitaciones a almorzar/cenar, regalos corporativos, cortesías comerciales. Deducible en Guatemala con límites según Ley de Actualización Tributaria — conservar factura a nombre de la empresa y registrar a qué cliente correspondió (usar REFERENCIA o descripción del gasto). NO usar para comidas del equipo interno — eso va en 6-1-7.', null, true);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-2-9', '6-2-9', 'Otros Gastos de Ventas', 3, '6-2', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3', '6-3', 'Tecnología y SaaS', 2, '6', 30, null, null, null, null, 'Airtable, Make, Google Workspace, Twilio, MiniExtensions, hosting, dominios.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3-1', '6-3-1', 'Airtable', 3, '6-3', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3-2', '6-3-2', 'Make / Zapier', 3, '6-3', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3-3', '6-3-3', 'Google Workspace', 3, '6-3', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3-4', '6-3-4', 'Twilio / WhatsApp', 3, '6-3', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3-5', '6-3-5', 'MiniExtensions', 3, '6-3', 50, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3-6', '6-3-6', 'Hosting y Dominios', 3, '6-3', 60, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-3-9', '6-3-9', 'Otros SaaS / Licencias', 3, '6-3', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-4', '6-4', 'Legal, Cumplimiento y Auditoría', 2, '6', 40, null, null, null, null, 'Honorarios legales, auditorías, certificaciones.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-4-1', '6-4-1', 'Honorarios Legales', 3, '6-4', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-4-2', '6-4-2', 'Auditoría Externa', 3, '6-4', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-4-3', '6-4-3', 'Certificaciones y Permisos', 3, '6-4', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-4-4', '6-4-4', 'Notariado y Registros', 3, '6-4', 40, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-4-9', '6-4-9', 'Otros (Legal/Compliance)', 3, '6-4', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-5', '6-5', 'Gastos Financieros', 2, '6', 50, null, null, null, null, 'Intereses, comisiones bancarias, diferencias cambiarias.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-5-1', '6-5-1', 'Intereses', 3, '6-5', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-5-2', '6-5-2', 'Comisiones Bancarias', 3, '6-5', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-5-3', '6-5-3', 'Diferencias Cambiarias (Pérdidas)', 3, '6-5', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-5-9', '6-5-9', 'Otros Financieros', 3, '6-5', 90, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-6', '6-6', 'Depreciación y Amortización', 2, '6', 60, null, null, null, null, 'Depre PPE, amortización intangibles.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-6-1', '6-6-1', 'Depreciación de PPE', 3, '6-6', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-6-2', '6-6-2', 'Amortización de Intangibles', 3, '6-6', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-6-3', '6-6-3', 'Depreciación Activo por Derecho de Uso', 3, '6-6', 30, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-7', '6-7', 'Impuesto Sobre la Renta (ISR)', 2, '6', 70, null, null, null, null, 'Mejor ver ISR aparte del resto de gastos.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-7-1', '6-7-1', 'ISR del Ejercicio', 3, '6-7', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-7-2', '6-7-2', 'ISR Diferido', 3, '6-7', 20, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-8', '6-8', 'Otros Gastos', 2, '6', 80, null, null, null, null, 'Para partidas no recurrentes/misceláneas.', false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-8-1', '6-8-1', 'Otros Gastos', 3, '6-8', 10, null, null, null, null, null, false);
  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden, naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values ('cta-6-8-2', '6-8-2', 'Gastos No Deducibles', 3, '6-8', 20, null, null, null, null, null, false);

  -- pass 2: resolver la jerarquía
  update cuentas hija set parent_id = padre.id
    from cuentas padre
   where hija.parent_path is not null and padre.codigo_path = hija.parent_path;

  -- ── Centros de costo ──
  -- ⚠ Las líneas de negocio son de Golden (Poligrafía/Socio/TT…): una empresa
  -- nueva probablemente las reemplace — se siembran como punto de partida.
  insert into centros_costo (airtable_id, nombre, codigo_cc, naturaleza, activo, observaciones) values ('cc-administrativo', 'Administrativo', null, 'Por proyecto', true, null);
  insert into centros_costo (airtable_id, nombre, codigo_cc, naturaleza, activo, observaciones) values ('cc-pendiente', 'Pendiente', null, null, false, null);
  insert into centros_costo (airtable_id, nombre, codigo_cc, naturaleza, activo, observaciones) values ('cc-poligrafia', 'Poligrafia', null, 'Recurrente', true, null);
  insert into centros_costo (airtable_id, nombre, codigo_cc, naturaleza, activo, observaciones) values ('cc-poligrafia-xela', 'Poligrafia Xela', null, null, false, null);
  insert into centros_costo (airtable_id, nombre, codigo_cc, naturaleza, activo, observaciones) values ('cc-socioeconomicos', 'Socioeconomicos', null, 'Recurrente', true, null);
  insert into centros_costo (airtable_id, nombre, codigo_cc, naturaleza, activo, observaciones) values ('cc-talenttrackai', 'TalentTrackAI', null, 'Por proyecto', true, null);

  -- ── mapeo_er (estructura del reporte) + puente a cuentas por codigo_path ──
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-10', 'Ingresos Outsourcing', 10, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-10' and c.codigo_path in ('4-1-1');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-20', 'Ingresos Reclutamiento', 20, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-20' and c.codigo_path in ('4-1-2');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-30', 'Ingresos Poligrafía', 30, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-30' and c.codigo_path in ('4-1-3');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-40', 'Ingresos Socioeconómicos', 40, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-40' and c.codigo_path in ('4-1-4');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-50', 'Ingresos Asesorías RH', 50, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-50' and c.codigo_path in ('4-1-5');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-60', 'Otros Ingresos Operativos', 60, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-60' and c.codigo_path in ('4-1-9');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-70', 'Descuentos y NC (todas líneas)', 70, 'Suma cuentas', '–', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-70' and c.codigo_path in ('4-1-1-1-7', '4-1-1-1-8', '4-1-2-1-7', '4-1-2-1-8', '4-1-3-1-7', '4-1-3-1-8', '4-1-4-1-7', '4-1-4-1-8', '4-1-5-1-7', '4-1-5-1-8');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-110', 'Costos Outsourcing', 110, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-110' and c.codigo_path in ('5-1-1');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-120', 'Costos Reclutamiento', 120, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-120' and c.codigo_path in ('5-1-2');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-130', 'Costos Poligrafía', 130, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-130' and c.codigo_path in ('5-1-3');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-140', 'Costos Socioeconómicos', 140, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-140' and c.codigo_path in ('5-1-4');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-150', 'Costos Asesorías RH', 150, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-150' and c.codigo_path in ('5-1-5');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-160', 'Costos Reembolsables', 160, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-160' and c.codigo_path in ('5-1-9');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-210', 'Gastos Administración', 210, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-210' and c.codigo_path in ('6-1-1');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-220', 'Gastos Ventas y Marketing', 220, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-220' and c.codigo_path in ('6-2');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-230', 'Tecnología y SaaS', 230, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-230' and c.codigo_path in ('6-3');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-240', 'Legal/Compliance/Auditoría', 240, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-240' and c.codigo_path in ('6-4');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-250', 'Gastos Financieros', 250, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-250' and c.codigo_path in ('6-5');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-260', 'Depreciación y Amortización', 260, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-260' and c.codigo_path in ('6-6');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-270', 'Impuesto Sobre la Renta', 270, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-270' and c.codigo_path in ('6-7');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-280', 'Otros Gastos', 280, 'Suma cuentas', '+', null);
  insert into mapeo_er_cuentas select m.id, c.id from mapeo_er m, cuentas c where m.airtable_id = 'mer-280' and c.codigo_path in ('6-8');
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-900', 'Utilidad Bruta', 900, 'Calculada', null, null);
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-910', 'EBITDA', 910, 'Calculada', null, null);
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-920', 'Utilidad Operativa', 920, 'Calculada', null, null);
  insert into mapeo_er (airtable_id, linea, orden, tipo, signo, prefijos) values ('mer-930', 'Utilidad Neta', 930, 'Calculada', null, null);

  -- ── mapeo_bs (estructura del reporte) + puente a cuentas por codigo_path ──
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-10', 'Activo Corriente', 10, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-10' and c.codigo_path in ('1-1');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-15', 'Efectivo y Equivalentes', 15, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-15' and c.codigo_path in ('1-1-1', '1-1-2');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-16', 'Cuentas por Cobrar Comerciales', 16, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-16' and c.codigo_path in ('1-1-3');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-17', 'Impuestos por Cobrar (IVA Crédito)', 17, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-17' and c.codigo_path in ('1-1-4');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-18', 'Anticipos y Prepagos', 18, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-18' and c.codigo_path in ('1-1-5', '1-1-6');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-20', 'Activo No Corriente', 20, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-20' and c.codigo_path in ('1-2');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-25', 'Propiedad Planta y Equipo (bruto)', 25, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-25' and c.codigo_path in ('1-2-1');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-26', 'Depreciación Acumulada PPE', 26, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-26' and c.codigo_path in ('1-2-2');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-27', 'Intangibles (bruto)', 27, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-27' and c.codigo_path in ('1-2-3');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-28', 'Amortización Acumulada', 28, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-28' and c.codigo_path in ('1-2-4');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-30', 'Pasivo Corriente', 30, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-30' and c.codigo_path in ('2-1');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-35', 'Pasivos de Nómina por Pagar', 35, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-35' and c.codigo_path in ('2-1-2');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-36', 'Impuestos por Pagar (ISR/IVA)', 36, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-36' and c.codigo_path in ('2-1-4', '2-1-5');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-37', 'Provisiones CP (Bono14/Aguinaldo/Vac.)', 37, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-37' and c.codigo_path in ('2-1-6');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-38', 'Deuda CP / Arrendamientos CP', 38, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-38' and c.codigo_path in ('2-1-8', '2-1-9');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-40', 'Pasivo No Corriente', 40, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-40' and c.codigo_path in ('2-2');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-45', 'Deuda LP / Arrendamientos LP', 45, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-45' and c.codigo_path in ('2-2-1', '2-2-2');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-50', 'Capital Social', 50, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-50' and c.codigo_path in ('3-1');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-60', 'Reservas y Utilidades', 60, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-60' and c.codigo_path in ('3-2');
  insert into mapeo_bs (airtable_id, linea, orden, tipo, signo, prefijos) values ('mbs-65', 'Resultado del Ejercicio', 65, 'Suma cuentas', '+', null);
  insert into mapeo_bs_cuentas select m.id, c.id from mapeo_bs m, cuentas c where m.airtable_id = 'mbs-65' and c.codigo_path in ('3-2-3');

  raise notice 'seed_plan_cuentas_base: catálogo sembrado (% cuentas)', (select count(*) from cuentas);
end $seed$;
