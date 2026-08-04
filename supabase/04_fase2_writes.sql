-- ═══════════════════════════════════════════════════════════════════
-- 04_fase2_writes.sql — FASE 2: escrituras a Supabase.
-- Correr en el SQL Editor de Supabase (DESPUÉS de 03_fase2_gaps.sql).
--
-- Contiene:
--  1) Columnas que las ESCRITURAS necesitan (gastos, facturas_in,
--     proveedores, pagos, movimientos, planilla, adjuntos).
--  2) Funciones RPC transaccionales — cada función corre en UNA
--     transacción Postgres: si algo falla, NADA se escribe. Esto
--     reemplaza los rollbacks manuales en cascada de F-050/F-056.2.
--
-- Después de correr esto:
--   npx tsx scripts/validate-writes.ts     (staging: crea registros de
--   prueba, valida atomicidad/idempotencia y los limpia)
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1) COLUMNAS
-- ───────────────────────────────────────────────────────────────────

-- GASTOS: el schema 01 era mínimo; el flujo F-050 necesita el detalle.
alter table gastos add column if not exists base numeric(14,2);
alter table gastos add column if not exists iva numeric(14,2) default 0;
alter table gastos add column if not exists metodo_pago text;          -- Contado | Plazo
alter table gastos add column if not exists estado text;               -- Pagado | Por pagar | Anulado
alter table gastos add column if not exists banco_id uuid references bancos(id);
alter table gastos add column if not exists referencia_pago text;
alter table gastos add column if not exists fecha_vencimiento date;
alter table gastos add column if not exists factura_in_id uuid references facturas_in(id);
alter table gastos add column if not exists fecha_aprobacion timestamptz;
alter table gastos add column if not exists aprobado_por text;

-- FACTURAS_IN: bandeja completa de F-049 (el schema 01 solo tenía 4 campos).
alter table facturas_in add column if not exists fuente text;
alter table facturas_in add column if not exists archivo_url text;      -- Supabase Storage
alter table facturas_in add column if not exists archivo_nombre text;
alter table facturas_in add column if not exists file_hash text;
alter table facturas_in add column if not exists doc_key text;
alter table facturas_in add column if not exists proveedor_nombre text;
alter table facturas_in add column if not exists proveedor_nit text;
alter table facturas_in add column if not exists serie text;
alter table facturas_in add column if not exists numero text;
alter table facturas_in add column if not exists moneda_texto text default 'Q';   -- 'Q'|'USD' (texto, no enum)
alter table facturas_in add column if not exists subtotal numeric(14,2);
alter table facturas_in add column if not exists iva numeric(14,2);
alter table facturas_in add column if not exists total numeric(14,2);
alter table facturas_in add column if not exists pais text;
alter table facturas_in add column if not exists tipo_doc text;
alter table facturas_in add column if not exists otros_impuestos numeric(14,2);
alter table facturas_in add column if not exists texto_ocr text;
alter table facturas_in add column if not exists datos_normalizados text;
alter table facturas_in add column if not exists datos_normalizados_ok boolean default false;
alter table facturas_in add column if not exists subido_por text;
alter table facturas_in add column if not exists fecha_subida timestamptz;
alter table facturas_in add column if not exists confianza_extraccion numeric(4,3);
alter table facturas_in add column if not exists gasto_id uuid references gastos(id);
create index if not exists idx_facturas_in_hash on facturas_in(file_hash);
create index if not exists idx_facturas_in_dockey on facturas_in(doc_key);

-- PROVEEDORES: datos de contacto que crea buscarOCrearProveedor.
alter table proveedores add column if not exists nit text;
alter table proveedores add column if not exists contacto text;
alter table proveedores add column if not exists telefono text;
alter table proveedores add column if not exists email text;
alter table proveedores add column if not exists direccion text;
alter table proveedores add column if not exists activo boolean default true;

-- PAGOS_PROVEEDORES: nombre del singleSelect Cuenta_Banco + anulado_por.
alter table pagos_proveedores add column if not exists cuenta_banco_nombre text;
alter table pagos_proveedores add column if not exists anulado_por text;

-- MOVIMIENTOS_BANCARIOS: tipo (Ingreso/Egreso) + período textual.
alter table movimientos_bancarios add column if not exists tipo text;
alter table movimientos_bancarios add column if not exists periodo text;

-- PLANILLA: vínculo al asiento generado (F-056.2).
alter table planilla add column if not exists asiento_id uuid references asientos(id);

-- ADJUNTOS en Supabase Storage (Fase 2.5).
alter table facturas_clientes add column if not exists adjunto_url text;
alter table facturas_clientes add column if not exists adjunto_nombre text;
alter table planilla add column if not exists boleta_url text;
alter table planilla add column if not exists boleta_nombre text;
alter table cobros_clientes add column if not exists constancia_url text;
alter table cobros_clientes add column if not exists constancia_nombre text;

-- Idempotencia de asientos: un asiento_ref no se repite.
create unique index if not exists uq_asientos_ref
  on asientos(asiento_ref) where asiento_ref is not null;

-- ───────────────────────────────────────────────────────────────────
-- 2) Helper: airtable_id sintético para filas nacidas en Supabase.
--    (las lecturas usan airtable_id como record id de la app)
-- ───────────────────────────────────────────────────────────────────
create or replace function fase2_nuevo_id() returns text
language sql volatile as $$
  select 'sbw' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
$$;

-- ───────────────────────────────────────────────────────────────────
-- 3) RPC · registrar cobro (N líneas de cobro + estado de la factura)
-- ───────────────────────────────────────────────────────────────────
create or replace function fase2_registrar_cobro(
  p_cobros jsonb,          -- [{factura_id, fecha_cobro, monto_cobrado, metodo, moneda, tipo_cambio, referencia, cuenta_banco_id, monto_retencion_iva, monto_retencion_isr, cobro_grupo_id}]
  p_factura_ids uuid[],    -- líneas ACTIVAS de la factura a actualizar
  p_nuevo_estado text      -- 'COBRADO ' | 'COBRADO PARCIAL ' (literal Airtable)
) returns jsonb
language plpgsql as $$
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
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 4) RPC · anular cobros (grupo o legacy) + nuevo estado de factura
-- ───────────────────────────────────────────────────────────────────
create or replace function fase2_anular_cobros(
  p_cobro_airtable_ids text[],
  p_fecha date,
  p_motivo text,
  p_usuario text,
  p_factura_ids uuid[],
  p_nuevo_estado text
) returns jsonb
language plpgsql as $$
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
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 5) RPC · crear asiento + partidas (validación de balance ADENTRO de
--    la transacción; idempotencia por asiento_ref; opcionalmente
--    vincula líneas de PLANILLA)
-- ───────────────────────────────────────────────────────────────────
create or replace function fase2_crear_asiento_con_partidas(
  p_asiento jsonb,      -- {asiento_ref, fecha_asiento, periodo_id, origen, centro_costo_id, proveedor_id, cliente_id, banco_id, descripcion}
  p_partidas jsonb,     -- [{cuenta_id, centro_costo_id, descripcion_linea, debe, haber, moneda, tipo_cambio, periodo, proveedor_id, banco_id, cliente_id}]
  p_planilla_ids uuid[] default null
) returns jsonb
language plpgsql as $$
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
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 6) RPC · aprobar gasto: asiento + partidas + GASTO + update de la
--    FACTURA_IN — todo o nada.
-- ───────────────────────────────────────────────────────────────────
create or replace function fase2_aprobar_gasto(
  p_asiento jsonb,
  p_partidas jsonb,
  p_gasto jsonb,           -- {proveedor_id, cuenta_gasto_id, centro_costo_id, periodo_id, fecha, base, iva, total, metodo_pago, estado, banco_id, referencia_pago, fecha_vencimiento, tipo_operativo, descripcion, fecha_aprobacion, aprobado_por}
  p_factura_in_id uuid default null
) returns jsonb
language plpgsql as $$
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
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 7) RPC · registrar pago a deuda (single insert atómico con id devuelto)
-- ───────────────────────────────────────────────────────────────────
create or replace function fase2_registrar_pago(p_pago jsonb) returns jsonb
language plpgsql as $$
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
end $$;

-- FIN 04_fase2_writes.sql
