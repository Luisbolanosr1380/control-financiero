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
