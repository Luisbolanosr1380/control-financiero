-- ============================================================
-- 015 · TARIFARIO · histórico de precios (bitácora) + RPCs de escritura
--
-- La tarifa VIGENTE sigue siendo una sola fila en `tarifario` (la que usa
-- el motor para facturar). Cada cambio queda en `tarifario_historial`
-- (bitácora, no versionado): alta, cambio de precio (con variación %),
-- aprobación, desactivación y reactivación.
--
-- Única fuente de la bitácora: el trigger `trg_tarifario_historial`
-- (AFTER INSERT/UPDATE en `tarifario`). Así queda registro aunque alguien
-- edite por fuera de la pantalla (SQL directo → `usuario` null).
--
-- Actor y motivo: el trigger lee los GUCs de transacción `app.actor` y
-- `app.motivo`. La app los fija en la MISMA transacción que el write a
-- través de las RPCs `tarifario_insertar` / `tarifario_actualizar`
-- (set_config(..., true) + write en un solo bloque; mismo patrón que las
-- RPCs transaccionales de la 005). Un `.update()` suelto de supabase-js
-- no comparte transacción con un set_config previo.
--
-- Idempotente: create ... if not exists / create or replace. Sin
-- delete/drop/commit. No toca las tarifas vigentes ni la clave única.
-- ============================================================

create table if not exists tarifario_historial (
  id              uuid primary key default gen_random_uuid(),
  -- orden estable de la línea de tiempo (varios renglones en una misma transacción comparten created_at)
  seq             bigint generated always as identity,
  tarifario_id    uuid not null references tarifario(id) on delete cascade,
  nit             text not null,
  tipo_prueba     text not null,
  categoria       text not null,
  territorio      text not null,
  accion          text not null check (accion in ('alta', 'cambio_precio', 'aprobacion', 'desactivacion', 'reactivacion')),
  monto_anterior  numeric(12,2),
  monto_nuevo     numeric(12,2),
  -- (nuevo − anterior) / anterior × 100, redondeado a 2. Null si el anterior era Q0 (sin tarifa) o no aplica.
  variacion_pct   numeric(10,2),
  usuario         text,
  motivo          text,
  anio            text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_tarifario_historial_tarifa on tarifario_historial (tarifario_id, created_at desc);
create index if not exists idx_tarifario_historial_nit on tarifario_historial (nit, created_at desc);

alter table tarifario_historial enable row level security;

-- ------------------------------------------------------------
-- Trigger: detecta qué cambió (monto / aprobado_en / activo) y escribe el
-- renglón correspondiente. Varias cosas en un mismo UPDATE → varios renglones.
-- ------------------------------------------------------------
create or replace function tarifario_historial_registrar()
returns trigger
language plpgsql
as $fn$
declare
  v_actor  text := nullif(current_setting('app.actor', true), '');
  v_motivo text := nullif(current_setting('app.motivo', true), '');
  v_pct    numeric(10,2);
begin
  if tg_op = 'INSERT' then
    insert into tarifario_historial (tarifario_id, nit, tipo_prueba, categoria, territorio, accion, monto_anterior, monto_nuevo, variacion_pct, usuario, motivo, anio)
    values (new.id, new.nit, new.tipo_prueba, new.categoria, new.territorio, 'alta', null, new.monto, null, v_actor, v_motivo, new.anio);
    return new;
  end if;

  -- cambio de precio
  if new.monto is distinct from old.monto then
    v_pct := case when coalesce(old.monto, 0) > 0 then round((new.monto - old.monto) / old.monto * 100, 2) else null end;
    insert into tarifario_historial (tarifario_id, nit, tipo_prueba, categoria, territorio, accion, monto_anterior, monto_nuevo, variacion_pct, usuario, motivo, anio)
    values (new.id, new.nit, new.tipo_prueba, new.categoria, new.territorio, 'cambio_precio', old.monto, new.monto, v_pct, v_actor, v_motivo, new.anio);
  end if;

  -- aprobación (quedar pendiente otra vez no es una acción: la implica el cambio de precio)
  if new.aprobado_en is not null and new.aprobado_en is distinct from old.aprobado_en then
    insert into tarifario_historial (tarifario_id, nit, tipo_prueba, categoria, territorio, accion, monto_anterior, monto_nuevo, variacion_pct, usuario, motivo, anio)
    values (new.id, new.nit, new.tipo_prueba, new.categoria, new.territorio, 'aprobacion', null, new.monto, null, coalesce(v_actor, new.aprobado_por), v_motivo, new.anio);
  end if;

  -- desactivación / reactivación
  if new.activo is distinct from old.activo then
    insert into tarifario_historial (tarifario_id, nit, tipo_prueba, categoria, territorio, accion, monto_anterior, monto_nuevo, variacion_pct, usuario, motivo, anio)
    values (new.id, new.nit, new.tipo_prueba, new.categoria, new.territorio, case when new.activo then 'reactivacion' else 'desactivacion' end, null, new.monto, null, v_actor, v_motivo, new.anio);
  end if;

  return new;
end
$fn$;

create or replace trigger trg_tarifario_historial
  after insert or update on tarifario
  for each row execute function tarifario_historial_registrar();

-- ------------------------------------------------------------
-- RPCs de escritura (una llamada = una transacción con actor y motivo).
-- La validación de negocio sigue en la app (db/tarifario.ts); acá solo se
-- fija el contexto y se escribe.
-- ------------------------------------------------------------

-- Alta. p_fila: {nit, razon_social, tipo_prueba, categoria, territorio, monto, anio, activo}. Devuelve el id.
create or replace function tarifario_insertar(p_actor text, p_motivo text, p_fila jsonb)
returns uuid
language plpgsql
as $fn$
declare
  v_id uuid;
begin
  perform set_config('app.actor',  coalesce(p_actor, ''),  true);
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);
  insert into tarifario (nit, razon_social, tipo_prueba, categoria, territorio, monto, anio, activo)
  values (
    p_fila->>'nit',
    nullif(p_fila->>'razon_social', ''),
    p_fila->>'tipo_prueba',
    p_fila->>'categoria',
    p_fila->>'territorio',
    coalesce((p_fila->>'monto')::numeric, 0),
    nullif(p_fila->>'anio', ''),
    coalesce((p_fila->>'activo')::boolean, true)
  )
  returning id into v_id;
  return v_id;
end
$fn$;

-- Edición / aprobación (individual o en lote) / desactivar / reactivar.
-- p_patch: solo las columnas presentes se tocan; un valor null las deja en null
-- (ej. {"aprobado_por": null, "aprobado_en": null} al volver a pendiente).
-- Devuelve cuántas filas se actualizaron.
create or replace function tarifario_actualizar(p_actor text, p_motivo text, p_ids uuid[], p_patch jsonb)
returns integer
language plpgsql
as $fn$
declare
  n integer;
begin
  perform set_config('app.actor',  coalesce(p_actor, ''),  true);
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);
  update tarifario set
    monto        = case when p_patch ? 'monto'        then (p_patch->>'monto')::numeric        else monto        end,
    anio         = case when p_patch ? 'anio'         then nullif(p_patch->>'anio', '')        else anio         end,
    razon_social = case when p_patch ? 'razon_social' then nullif(p_patch->>'razon_social', '') else razon_social end,
    aprobado_por = case when p_patch ? 'aprobado_por' then p_patch->>'aprobado_por'            else aprobado_por end,
    aprobado_en  = case when p_patch ? 'aprobado_en'  then (p_patch->>'aprobado_en')::timestamptz else aprobado_en end,
    activo       = case when p_patch ? 'activo'       then (p_patch->>'activo')::boolean       else activo       end,
    updated_at   = now()
  where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end
$fn$;
