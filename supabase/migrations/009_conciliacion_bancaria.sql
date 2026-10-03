-- ============================================================
-- 009 · Conciliación bancaria (brief Conciliación Bancaria HIT)
--
-- Corre en AMBAS bases (HIT y Golden) vía scripts/migrar-todas.ts.
-- SIN begin/commit propio a propósito: el runner envuelve cada
-- archivo en SU transacción (un commit interno cerraría la del
-- runner antes de registrar en _migraciones — le pasó a la 008).
-- En el SQL Editor también corre como una sola transacción
-- implícita (script multi-sentencia).
--
-- CONVENCIÓN DE movimientos_bancarios.monto (la que ya usaba el
-- código: aprobación de gasto de contado guardaba monto>0 + tipo):
--   monto SIEMPRE POSITIVO, la dirección la da tipo:
--     'Ingreso' = entra plata al banco · 'Egreso' = sale plata.
-- Se hace cumplir con CHECKs (la tabla está vacía en ambas bases,
-- verificado en vivo el 2026-10-02).
--
-- PRINCIPIO ANTI-DOBLE-CONTABILIZACIÓN: conciliar un cobro/pago/
-- gasto NUNCA crea asiento — solo lo marca verificado. Los únicos
-- asientos que nacen acá son (a) movimientos SIN documento
-- (comisión, intereses, ND/NC) y (b) la partida de ajuste por la
-- diferencia de un movimiento conciliado; ambos son la porción
-- del movimiento que no tiene documento.
-- ============================================================

-- 1) Flag de conciliación en gastos
alter table gastos add column if not exists es_conciliado boolean default false;

-- 2) movimientos_bancarios: convención + auditoría
alter table movimientos_bancarios
  add column if not exists origen text,                 -- 'manual' | 'csv'
  add column if not exists creado_por text,
  add column if not exists conciliado_por text,
  add column if not exists conciliado_en timestamptz;

do $$ begin
  alter table movimientos_bancarios add constraint movbanc_monto_positivo check (monto > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table movimientos_bancarios add constraint movbanc_tipo_valido check (tipo in ('Ingreso', 'Egreso'));
exception when duplicate_object then null; end $$;
alter table movimientos_bancarios alter column banco_id set not null;   -- vacía en ambas bases; si no, falla y avisa

create index if not exists idx_movbanc_banco_fecha on movimientos_bancarios (banco_id, fecha);
create index if not exists idx_movbanc_dup on movimientos_bancarios (banco_id, fecha, monto, referencia);

-- 3) Tabla puente movimiento <-> documento
create table if not exists conciliacion_items (
  id              uuid primary key default gen_random_uuid(),
  movimiento_id   uuid not null references movimientos_bancarios(id) on delete cascade,
  cobro_id        uuid references cobros_clientes(id)    on delete cascade,
  pago_id         uuid references pagos_proveedores(id)  on delete cascade,
  gasto_id        uuid references gastos(id)             on delete cascade,
  monto_aplicado  numeric not null check (monto_aplicado > 0),
  nota            text,
  created_at      timestamptz default now(),
  created_by      text,
  -- exactamente un documento por item
  constraint un_solo_doc check (num_nonnulls(cobro_id, pago_id, gasto_id) = 1)
);

create index if not exists idx_concitems_mov   on conciliacion_items(movimiento_id);
create index if not exists idx_concitems_cobro on conciliacion_items(cobro_id);
create index if not exists idx_concitems_pago  on conciliacion_items(pago_id);
create index if not exists idx_concitems_gasto on conciliacion_items(gasto_id);

-- 4) LA defensa real contra doble conciliación: un documento puede
--    estar en UNA sola conciliación (depósito agrupado = 1 movimiento
--    con N items, cada documento una vez).
create unique index if not exists uq_concitems_cobro on conciliacion_items(cobro_id) where cobro_id is not null;
create unique index if not exists uq_concitems_pago  on conciliacion_items(pago_id)  where pago_id  is not null;
create unique index if not exists uq_concitems_gasto on conciliacion_items(gasto_id) where gasto_id is not null;

-- 5) Bitácora (quién y cuándo concilió / deshizo / contabilizó).
--    Los items se BORRAN al deshacer; el historial queda acá.
create table if not exists conciliacion_log (
  id             uuid primary key default gen_random_uuid(),
  movimiento_id  uuid not null references movimientos_bancarios(id) on delete cascade,
  accion         text not null check (accion in ('conciliar', 'deshacer', 'contabilizar')),
  usuario        text not null,
  detalle        jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_conclog_mov on conciliacion_log(movimiento_id);

-- 6) RLS — patrón de TODAS las tablas de estas bases (verificado en
--    vivo: RLS activo y CERO policies; solo la service_role del
--    servidor lee/escribe, anon/authenticated quedan bloqueados).
alter table conciliacion_items enable row level security;
alter table conciliacion_log   enable row level security;

-- ============================================================
-- 7) RPCs transaccionales
-- ============================================================

-- Monto que el documento movió en el banco (moneda del banco).
--   cobro: monto en GTQ si el banco es GTQ, en su moneda si es USD.
--   pago:  capital + interés + mora + comisión (monto_pago es SOLO
--          capital — lo que sale del banco es el total).
--   gasto: monto (= total de la factura).
create or replace function public.fase2_conciliacion_monto_doc(p_tipo text, p_doc_id uuid, p_moneda_banco text)
 returns numeric
 language plpgsql
 stable
as $function$
declare v numeric;
begin
  if p_tipo = 'cobro' then
    select case when p_moneda_banco = 'USD' then monto_cobrado
                else coalesce(monto_cobro_gtq, monto_cobrado) end
      into v from cobros_clientes where id = p_doc_id;
  elsif p_tipo = 'pago' then
    select (coalesce(monto_pago,0) + coalesce(monto_interes,0) + coalesce(monto_mora,0) + coalesce(monto_comision,0))
           * case when p_moneda_banco = 'USD' then 1 else coalesce(tipo_cambio, 1) end
      into v from pagos_proveedores where id = p_doc_id;
  elsif p_tipo = 'gasto' then
    select monto into v from gastos where id = p_doc_id;
  end if;
  return round(coalesce(v, 0), 2);
end $function$;

-- Conciliar: inserta items, valida cuadre (o exige partida de ajuste
-- que lo explique EXACTAMENTE), marca flags. Todo o nada.
--   p_items:    [{ "tipo": "cobro"|"pago"|"gasto", "id": uuid, "monto_aplicado": n, "nota": "..." }]
--   p_asiento / p_partidas: SOLO si hay diferencia (ajuste) — se
--   contabiliza la porción sin documento vía fase2_crear_asiento_con_partidas.
create or replace function public.fase2_conciliar(
  p_movimiento_id uuid,
  p_items jsonb,
  p_usuario text,
  p_asiento jsonb default null,
  p_partidas jsonb default null
)
 returns jsonb
 language plpgsql
as $function$
declare
  m record;
  b record;
  it jsonb;
  v_tipo text;
  v_doc uuid;
  v_aplicado numeric;
  v_total numeric := 0;
  v_dif numeric;
  v_ajuste numeric := 0;
  v_res jsonb;
  v_asiento uuid := null;
  n int := 0;
begin
  if coalesce(p_usuario, '') = '' then raise exception 'CONCILIACION: falta usuario'; end if;

  select * into m from movimientos_bancarios where id = p_movimiento_id for update;
  if not found then raise exception 'CONCILIACION: movimiento inexistente'; end if;
  if m.conciliado then raise exception 'CONCILIACION_YA_CONCILIADO: el movimiento ya está conciliado'; end if;
  if m.asiento_id is not null then raise exception 'CONCILIACION: el movimiento ya fue contabilizado sin documento'; end if;
  select * into b from bancos where id = m.banco_id;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'CONCILIACION: sin documentos (para movimientos sin documento usar contabilizar)';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_tipo := it->>'tipo';
    v_doc := (it->>'id')::uuid;
    v_aplicado := round((it->>'monto_aplicado')::numeric, 2);
    if v_aplicado is null or v_aplicado <= 0 then raise exception 'CONCILIACION: monto_aplicado inválido'; end if;

    -- Dirección y banco: el documento tiene que ser del MISMO banco y
    -- del sentido correcto (ingreso ↔ cobros; egreso ↔ pagos/gastos).
    if v_tipo = 'cobro' then
      if m.tipo <> 'Ingreso' then raise exception 'CONCILIACION: un cobro solo concilia contra un ingreso'; end if;
      perform 1 from cobros_clientes
        where id = v_doc and cuenta_banco_id = m.banco_id
          and coalesce(estado_cobro, 'Activo') <> 'Anulado'
          and coalesce(metodo, '') not ilike 'retenci%';
      if not found then raise exception 'CONCILIACION: cobro % no es de este banco, está anulado o es una retención', v_doc; end if;
      insert into conciliacion_items (movimiento_id, cobro_id, monto_aplicado, nota, created_by)
        values (m.id, v_doc, v_aplicado, nullif(it->>'nota', ''), p_usuario);
      update cobros_clientes set es_conciliado = true, updated_at = now() where id = v_doc;
    elsif v_tipo = 'pago' then
      if m.tipo <> 'Egreso' then raise exception 'CONCILIACION: un pago solo concilia contra un egreso'; end if;
      perform 1 from pagos_proveedores
        where id = v_doc and cuenta_banco_id = m.banco_id
          and coalesce(estado_pago, 'Activo') <> 'Anulado';
      if not found then raise exception 'CONCILIACION: pago % no es de este banco o está anulado', v_doc; end if;
      insert into conciliacion_items (movimiento_id, pago_id, monto_aplicado, nota, created_by)
        values (m.id, v_doc, v_aplicado, nullif(it->>'nota', ''), p_usuario);
      update pagos_proveedores set es_conciliado = true, updated_at = now() where id = v_doc;
    elsif v_tipo = 'gasto' then
      if m.tipo <> 'Egreso' then raise exception 'CONCILIACION: un gasto solo concilia contra un egreso'; end if;
      perform 1 from gastos where id = v_doc and banco_id = m.banco_id and coalesce(estado, '') <> 'Anulado';
      if not found then raise exception 'CONCILIACION: gasto % no es de este banco o está anulado', v_doc; end if;
      insert into conciliacion_items (movimiento_id, gasto_id, monto_aplicado, nota, created_by)
        values (m.id, v_doc, v_aplicado, nullif(it->>'nota', ''), p_usuario);
      update gastos set es_conciliado = true, updated_at = now() where id = v_doc;
    else
      raise exception 'CONCILIACION: tipo de documento inválido: %', v_tipo;
    end if;

    -- No se puede aplicar más que lo que el documento movió en el banco.
    if v_aplicado > fase2_conciliacion_monto_doc(v_tipo, v_doc, b.moneda::text) + 0.01 then
      raise exception 'CONCILIACION: se aplica % pero el documento movió %', v_aplicado, fase2_conciliacion_monto_doc(v_tipo, v_doc, b.moneda::text);
    end if;
    v_total := v_total + v_aplicado;
    n := n + 1;
  end loop;

  -- Cuadre: Σ aplicado vs monto del movimiento. Diferencia → ajuste
  -- explícito que la explique EXACTAMENTE, o rechazo.
  v_dif := round(m.monto - v_total, 2);
  if abs(v_dif) > 0.01 then
    if p_partidas is null or jsonb_array_length(p_partidas) = 0 then
      raise exception 'CONCILIACION_DIFERENCIA: el movimiento es % y los documentos suman % (diferencia %). Indicá la partida de ajuste o corregí la selección.', m.monto, v_total, v_dif;
    end if;
    select coalesce(sum((x->>'debe')::numeric), 0) into v_ajuste from jsonb_array_elements(p_partidas) x;
    if abs(round(v_ajuste, 2) - abs(v_dif)) > 0.01 then
      raise exception 'CONCILIACION_AJUSTE: la partida de ajuste (%) no coincide con la diferencia (%)', v_ajuste, abs(v_dif);
    end if;
    v_res := fase2_crear_asiento_con_partidas(p_asiento, p_partidas);
    v_asiento := (v_res->>'asiento_id')::uuid;
  elsif p_partidas is not null and jsonb_array_length(p_partidas) > 0 then
    raise exception 'CONCILIACION: no hay diferencia, no corresponde partida de ajuste';
  end if;

  update movimientos_bancarios
     set conciliado = true, conciliado_por = p_usuario, conciliado_en = now(),
         asiento_id = coalesce(v_asiento, asiento_id), updated_at = now()
   where id = m.id;

  insert into conciliacion_log (movimiento_id, accion, usuario, detalle)
  values (m.id, 'conciliar', p_usuario, jsonb_build_object(
    'items', p_items, 'total_aplicado', v_total, 'diferencia', v_dif, 'asiento_ajuste_id', v_asiento));

  return jsonb_build_object('movimiento_id', m.id, 'items', n, 'total_aplicado', v_total,
                            'diferencia', v_dif, 'asiento_ajuste_id', v_asiento);
end $function$;

-- Deshacer: borra items, apaga flags. Si el movimiento tenía asiento
-- (ajuste o contabilización sin documento) genera el CONTRA-ASIENTO
-- (no se borran asientos: rastro contable completo).
create or replace function public.fase2_desconciliar(p_movimiento_id uuid, p_usuario text, p_motivo text default null)
 returns jsonb
 language plpgsql
as $function$
declare
  m record;
  a record;
  v_items jsonb;
  v_partidas jsonb;
  v_res jsonb;
  v_rev uuid := null;
  v_n int;
begin
  if coalesce(p_usuario, '') = '' then raise exception 'CONCILIACION: falta usuario'; end if;
  select * into m from movimientos_bancarios where id = p_movimiento_id for update;
  if not found then raise exception 'CONCILIACION: movimiento inexistente'; end if;
  if not m.conciliado then raise exception 'CONCILIACION_NO_CONCILIADO: el movimiento no está conciliado'; end if;

  select coalesce(jsonb_agg(to_jsonb(ci)), '[]'::jsonb) into v_items from conciliacion_items ci where ci.movimiento_id = m.id;

  update cobros_clientes set es_conciliado = false, updated_at = now()
   where id in (select cobro_id from conciliacion_items where movimiento_id = m.id and cobro_id is not null);
  update pagos_proveedores set es_conciliado = false, updated_at = now()
   where id in (select pago_id from conciliacion_items where movimiento_id = m.id and pago_id is not null);
  update gastos set es_conciliado = false, updated_at = now()
   where id in (select gasto_id from conciliacion_items where movimiento_id = m.id and gasto_id is not null);
  delete from conciliacion_items where movimiento_id = m.id;

  if m.asiento_id is not null then
    select * into a from asientos where id = m.asiento_id;
    select jsonb_agg(jsonb_build_object(
             'cuenta_id', p.cuenta_id, 'centro_costo_id', p.centro_costo_id,
             'descripcion_linea', 'Reverso: ' || coalesce(p.descripcion_linea, ''),
             'debe', p.haber, 'haber', p.debe,
             'moneda', p.moneda, 'tipo_cambio', p.tipo_cambio, 'periodo', p.periodo,
             'banco_id', p.banco_id))
      into v_partidas from partidas p where p.asiento_id = m.asiento_id;
    select count(*) into v_n from asientos where asiento_ref like coalesce(a.asiento_ref, 'CB-' || m.id::text) || '-REV%';
    v_res := fase2_crear_asiento_con_partidas(
      jsonb_build_object(
        'asiento_ref', coalesce(a.asiento_ref, 'CB-' || left(m.id::text, 8)) || '-REV' || (v_n + 1),
        'fecha_asiento', current_date,
        'periodo_id', a.periodo_id,
        'origen', 'CONCILIACION BANCARIA',
        'banco_id', m.banco_id,
        'descripcion', 'Reverso conciliación: ' || coalesce(a.descripcion, '') || coalesce(' — ' || p_motivo, '')),
      v_partidas);
    v_rev := (v_res->>'asiento_id')::uuid;
  end if;

  update movimientos_bancarios
     set conciliado = false, conciliado_por = null, conciliado_en = null,
         asiento_id = null, updated_at = now()
   where id = m.id;

  insert into conciliacion_log (movimiento_id, accion, usuario, detalle)
  values (m.id, 'deshacer', p_usuario, jsonb_build_object(
    'motivo', p_motivo, 'items_borrados', v_items, 'asiento_revertido_id', m.asiento_id, 'contra_asiento_id', v_rev));

  return jsonb_build_object('movimiento_id', m.id, 'items_borrados', jsonb_array_length(v_items), 'contra_asiento_id', v_rev);
end $function$;

-- Contabilizar un movimiento SIN documento (comisión, intereses,
-- ND/NC del banco): ÚNICA vía en que la conciliación crea asiento
-- por el total del movimiento. Idempotente por asiento_ref.
create or replace function public.fase2_contabilizar_movimiento(p_movimiento_id uuid, p_asiento jsonb, p_partidas jsonb, p_usuario text)
 returns jsonb
 language plpgsql
as $function$
declare
  m record;
  v_debe numeric;
  v_res jsonb;
begin
  if coalesce(p_usuario, '') = '' then raise exception 'CONCILIACION: falta usuario'; end if;
  select * into m from movimientos_bancarios where id = p_movimiento_id for update;
  if not found then raise exception 'CONCILIACION: movimiento inexistente'; end if;
  if m.conciliado or m.asiento_id is not null then raise exception 'CONCILIACION_YA_CONCILIADO: el movimiento ya está conciliado o contabilizado'; end if;
  if exists (select 1 from conciliacion_items where movimiento_id = m.id) then
    raise exception 'CONCILIACION: el movimiento tiene documentos — usar conciliar';
  end if;
  select coalesce(sum((x->>'debe')::numeric), 0) into v_debe from jsonb_array_elements(p_partidas) x;
  if abs(round(v_debe, 2) - m.monto) > 0.01 then
    raise exception 'CONCILIACION: el asiento (%) no coincide con el monto del movimiento (%)', v_debe, m.monto;
  end if;

  v_res := fase2_crear_asiento_con_partidas(p_asiento, p_partidas);

  update movimientos_bancarios
     set asiento_id = (v_res->>'asiento_id')::uuid, conciliado = true,
         conciliado_por = p_usuario, conciliado_en = now(), updated_at = now()
   where id = m.id;

  insert into conciliacion_log (movimiento_id, accion, usuario, detalle)
  values (m.id, 'contabilizar', p_usuario, jsonb_build_object('asiento_id', v_res->>'asiento_id', 'asiento_ref', p_asiento->>'asiento_ref'));

  return v_res || jsonb_build_object('movimiento_id', m.id);
end $function$;

-- ============================================================
-- 8) Higiene de _migraciones
-- ============================================================
-- Golden nunca tuvo _migraciones (su esquema nació de la migración de
-- Airtable): el runner la crea antes de correr esto; el if-not-exists
-- cubre la ejecución manual en el SQL Editor.
create table if not exists _migraciones (
  nombre text primary key,
  aplicada_en timestamptz not null default now()
);
alter table _migraciones enable row level security;   -- mismo patrón: sin policies, solo service_role

-- Back-fill de la 008 con su NOMBRE DE ARCHIVO REAL (el runner compara
-- por nombre; '008_etiquetas.sql' no lo reconocería).
insert into _migraciones (nombre, aplicada_en)
select '008_etiquetas_documentos.sql', now()
where exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'etiquetas')
on conflict (nombre) do nothing;
