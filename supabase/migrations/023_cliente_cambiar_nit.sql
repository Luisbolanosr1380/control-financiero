-- ============================================================
-- 023 · "Cambiar NIT" de un cliente con arrastre (corrección de NIT)
--
-- Corre en AMBAS bases. Solo una función (create or replace). Sin begin/commit
-- propio, sin drop/delete, sin tocar datos por sí misma: los mueve la app al
-- llamar la RPC con confirmación del usuario.
--
-- Por qué: el NIT es la LLAVE DE CRUCE entre el cliente, su tarifario (014/015),
-- el mapeo de la Agenda (016), los expedientes resueltos y los detalles de
-- facturación (019). Si se tipea mal un NIT, corregirlo solo en `clientes` deja
-- las tarifas huérfanas en el NIT viejo (pasó con CBC: tarifas en 490695, un
-- NIT sin cliente, y hubo que moverlas a mano a 326070). Esta RPC cambia el NIT
-- en TODO de una sola vez, en una transacción, con guardas:
--
--  · NIT nuevo normalizado con la misma regla del front (`nitComparable`: solo
--    dígitos y letras, mayúsculas); vacío, "0…" y "CF" se rechazan (son
--    placeholders que se repiten legítimamente y no identifican a un cliente).
--  · Choque de llave en el tarifario (nit, tipo, categoría, territorio): si el
--    NIT nuevo ya tiene una tarifa con la misma llave que alguna del viejo, NO
--    se pisa nada → devuelve `codigo = 'tarifa_choque'` con las llaves en
--    conflicto (como el reporte de conflictos del tarifario).
--  · NIT compartido: si el NIT nuevo ya es de OTRO cliente activo, avisa y pide
--    confirmación explícita (`p_forzar`) —puede ser duplicado real o un error.
--  · `p_simular = true` evalúa todo y devuelve cuántas filas se moverían por
--    tabla SIN escribir (el modal muestra "se moverán N tarifas, M expedientes…").
--
-- Objetivo: por cliente (`p_cliente_id` = id de la app / airtable_id, o el uuid)
-- o por NIT (`p_nit_viejo`, para tarifas huérfanas en un NIT sin cliente, el caso
-- CBC). Por NIT con un solo cliente activo en ese NIT también actualiza al
-- cliente; con varios → 'cliente_ambiguo' (hacerlo desde la ficha).
--
-- Arrastre (todas las tablas con NIT de CLIENTE):
--   clientes.nit · tarifario.nit · tarifario_historial.nit · cliente_externo.nit
--   · facturacion_expediente.nit_resuelto · detalle_facturacion.nit
-- Las que tienen cliente_id se mueven solo si son del cliente objetivo (o no
-- tienen cliente_id); tarifario / historial van por NIT. NO se tocan
-- acreedores, proveedores ni facturas_in.proveedor_nit (son de proveedores) ni
-- facturas_clientes (va por cliente_id, sin columna NIT).
--
-- Trazabilidad: fija app.actor / app.motivo en la transacción (el trigger de la
-- bitácora del tarifario los lee; un cambio de NIT solo no genera renglón, pero
-- los renglones existentes siguen al NIT nuevo). Devuelve el detalle por tabla.
-- La re-resolución de la cola la hace la app después (reclasificar por NIT).
-- ============================================================

create or replace function cliente_cambiar_nit(
  p_actor      text,
  p_nit_nuevo  text,
  p_cliente_id text    default null,
  p_nit_viejo  text    default null,
  p_forzar     boolean default false,
  p_simular    boolean default false,
  p_motivo     text    default null
)
returns jsonb
language plpgsql
as $fn$
declare
  v_cli         clientes%rowtype;
  v_nuevo_txt   text := btrim(coalesce(p_nit_nuevo, ''));
  v_nuevo       text := upper(regexp_replace(btrim(coalesce(p_nit_nuevo, '')), '[^0-9A-Za-z]', '', 'g'));
  v_viejo       text;
  v_otros       text;
  v_destino     text;
  v_choques     jsonb;
  v_motivo      text;
  n_cli  integer := 0; n_tar integer := 0; n_his integer := 0; n_ext integer := 0; n_exp integer := 0; n_det integer := 0;
  v_mov  jsonb;
begin
  -- 1. NIT nuevo: misma regla que el front; placeholders y formato
  if v_nuevo = '' or v_nuevo ~ '^0+$' or v_nuevo = 'CF' then
    return jsonb_build_object('ok', false, 'codigo', 'nit_placeholder', 'error', 'El NIT nuevo no puede ser vacío, 0 ni CF: tiene que identificar al cliente.');
  end if;
  if v_nuevo !~ '^[0-9]{2,12}[0-9K]$' then
    return jsonb_build_object('ok', false, 'codigo', 'nit_invalido', 'error', format('"%s" no parece un NIT de Guatemala (dígitos + verificador, ej. 1234567-8).', v_nuevo_txt));
  end if;

  -- 2. Objetivo: cliente (id de la app o uuid) o NIT viejo
  if coalesce(btrim(p_cliente_id), '') <> '' then
    select * into v_cli from clientes c where c.airtable_id = p_cliente_id or c.id::text = p_cliente_id limit 1;
    if v_cli.id is null then
      return jsonb_build_object('ok', false, 'codigo', 'cliente_no_existe', 'error', 'El cliente no existe.');
    end if;
    v_viejo := upper(regexp_replace(coalesce(v_cli.nit, ''), '[^0-9A-Za-z]', '', 'g'));
  else
    v_viejo := upper(regexp_replace(coalesce(p_nit_viejo, ''), '[^0-9A-Za-z]', '', 'g'));
    if v_viejo = '' or v_viejo ~ '^0+$' or v_viejo = 'CF' then
      return jsonb_build_object('ok', false, 'codigo', 'nit_viejo_placeholder', 'error', 'Indicá el cliente o un NIT viejo real (no vacío, 0 ni CF).');
    end if;
    -- un solo cliente activo en ese NIT → también se le cambia; varios → ambiguo; ninguno → solo las tablas por NIT
    if (select count(*) from clientes c where c.activo is distinct from false and upper(regexp_replace(coalesce(c.nit, ''), '[^0-9A-Za-z]', '', 'g')) = v_viejo) > 1 then
      return jsonb_build_object('ok', false, 'codigo', 'cliente_ambiguo', 'error', format('Hay varios clientes activos con el NIT %s: cambiá el NIT desde la ficha del cliente correcto.', v_viejo));
    end if;
    select * into v_cli from clientes c where c.activo is distinct from false and upper(regexp_replace(coalesce(c.nit, ''), '[^0-9A-Za-z]', '', 'g')) = v_viejo limit 1;
  end if;

  if v_viejo = v_nuevo then
    return jsonb_build_object('ok', false, 'codigo', 'nit_igual', 'error', format('El NIT ya es %s: no hay nada que cambiar.', v_nuevo));
  end if;

  -- 3. Clientes que ya tienen el NIT nuevo (destino). Con cliente objetivo: es un NIT compartido → confirmación.
  select string_agg(c.nombre_empresa, ', ' order by c.nombre_empresa) into v_destino
    from clientes c
   where c.activo is distinct from false and (v_cli.id is null or c.id <> v_cli.id)
     and upper(regexp_replace(coalesce(c.nit, ''), '[^0-9A-Za-z]', '', 'g')) = v_nuevo;
  v_otros := case when v_cli.id is not null then v_destino end;

  -- 4. Choque de llave en el tarifario: nunca pisar
  if v_viejo <> '' then
    select jsonb_agg(jsonb_build_object('tipo_prueba', a.tipo_prueba, 'categoria', a.categoria, 'territorio', a.territorio, 'monto_viejo', a.monto, 'monto_nuevo', b.monto) order by a.tipo_prueba, a.categoria, a.territorio)
      into v_choques
      from tarifario a
      join tarifario b on b.tipo_prueba = a.tipo_prueba and b.categoria = a.categoria and b.territorio = a.territorio
                      and upper(regexp_replace(b.nit, '[^0-9A-Za-z]', '', 'g')) = v_nuevo
     where upper(regexp_replace(a.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo;
  end if;

  -- 5. Conteo de lo que se movería (también es la respuesta de la simulación)
  if v_cli.id is not null then n_cli := 1; end if;
  if v_viejo <> '' then
    select count(*) into n_tar from tarifario t where upper(regexp_replace(t.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo;
    select count(*) into n_his from tarifario_historial h where upper(regexp_replace(h.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo;
    select count(*) into n_ext from cliente_externo m where upper(regexp_replace(m.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo and (m.cliente_id is null or v_cli.id is null or m.cliente_id = v_cli.id);
    select count(*) into n_exp from facturacion_expediente e where upper(regexp_replace(coalesce(e.nit_resuelto, ''), '[^0-9A-Za-z]', '', 'g')) = v_viejo and (e.cliente_id is null or v_cli.id is null or e.cliente_id = v_cli.id);
    select count(*) into n_det from detalle_facturacion d where upper(regexp_replace(d.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo and (d.cliente_id is null or v_cli.id is null or d.cliente_id = v_cli.id);
  end if;
  v_mov := jsonb_build_object('clientes', n_cli, 'tarifario', n_tar, 'tarifario_historial', n_his, 'cliente_externo', n_ext, 'facturacion_expediente', n_exp, 'detalle_facturacion', n_det);

  if v_choques is not null then
    return jsonb_build_object('ok', false, 'codigo', 'tarifa_choque', 'nit_viejo', v_viejo, 'nit_nuevo', v_nuevo, 'choques', v_choques, 'movera', v_mov, 'destino', v_destino,
      'error', format('El NIT %s ya tiene %s tarifa(s) con la misma llave (tipo · categoría · territorio) que las de %s: no se movió nada. Resolvé el choque en el tarifario (dejá una sola fila por llave) y volvé a intentar.', v_nuevo, jsonb_array_length(v_choques), v_viejo));
  end if;
  if v_otros is not null and not p_forzar then
    return jsonb_build_object('ok', false, 'codigo', 'nit_compartido', 'nit_viejo', v_viejo, 'nit_nuevo', v_nuevo, 'compartido_con', v_otros, 'movera', v_mov, 'destino', v_destino,
      'error', format('El NIT %s ya es de otro cliente: %s. Confirmá explícitamente para compartirlo (puede ser el mismo cliente cargado dos veces, o un error).', v_nuevo, v_otros));
  end if;
  if p_simular then
    return jsonb_build_object('ok', true, 'simulado', true, 'nit_viejo', v_viejo, 'nit_nuevo', v_nuevo, 'cliente_id', v_cli.airtable_id, 'cliente_nombre', v_cli.nombre_empresa, 'compartido_con', v_otros, 'destino', v_destino, 'movera', v_mov);
  end if;

  -- 6. Aplicar: actor y motivo en la transacción + las 6 referencias
  v_motivo := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), format('cambio de NIT %s → %s', case when v_viejo = '' then '(sin NIT)' else v_viejo end, v_nuevo));
  perform set_config('app.actor',  coalesce(p_actor, ''), true);
  perform set_config('app.motivo', v_motivo, true);

  if v_cli.id is not null then
    update clientes set nit = v_nuevo_txt, updated_at = now() where id = v_cli.id;
    get diagnostics n_cli = row_count;
  end if;
  if v_viejo <> '' then
    update tarifario t set nit = v_nuevo, updated_at = now() where upper(regexp_replace(t.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo;
    get diagnostics n_tar = row_count;
    update tarifario_historial h set nit = v_nuevo where upper(regexp_replace(h.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo;
    get diagnostics n_his = row_count;
    update cliente_externo m set nit = v_nuevo, updated_at = now()
     where upper(regexp_replace(m.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo and (m.cliente_id is null or v_cli.id is null or m.cliente_id = v_cli.id);
    get diagnostics n_ext = row_count;
    update facturacion_expediente e set nit_resuelto = v_nuevo, updated_at = now()
     where upper(regexp_replace(coalesce(e.nit_resuelto, ''), '[^0-9A-Za-z]', '', 'g')) = v_viejo and (e.cliente_id is null or v_cli.id is null or e.cliente_id = v_cli.id);
    get diagnostics n_exp = row_count;
    update detalle_facturacion d set nit = v_nuevo, updated_at = now()
     where upper(regexp_replace(d.nit, '[^0-9A-Za-z]', '', 'g')) = v_viejo and (d.cliente_id is null or v_cli.id is null or d.cliente_id = v_cli.id);
    get diagnostics n_det = row_count;
  end if;

  return jsonb_build_object(
    'ok', true, 'simulado', false, 'nit_viejo', v_viejo, 'nit_nuevo', v_nuevo,
    'cliente_id', v_cli.airtable_id, 'cliente_nombre', v_cli.nombre_empresa, 'compartido_con', v_otros, 'destino', v_destino, 'motivo', v_motivo,
    'movidas', jsonb_build_object('clientes', n_cli, 'tarifario', n_tar, 'tarifario_historial', n_his, 'cliente_externo', n_ext, 'facturacion_expediente', n_exp, 'detalle_facturacion', n_det)
  );
end
$fn$;

comment on function cliente_cambiar_nit(text, text, text, text, boolean, boolean, text) is
  'Cambia el NIT de un cliente en todas las tablas que cruzan por NIT de cliente (clientes, tarifario, tarifario_historial, cliente_externo, facturacion_expediente.nit_resuelto, detalle_facturacion) en una transacción. Guardas: placeholder/CF, choque de llave del tarifario (no pisa), NIT compartido (p_forzar). p_simular = solo cuenta.';
