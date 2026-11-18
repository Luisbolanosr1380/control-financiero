-- 036 · UN PAQUETE PREPAGADO QUE USAN VARIOS NIT (grupo de empresas) (brief del CFO, 18-nov-2026)
--
-- Por qué: el Colegio Sagrado Corazón compró UN paquete y lo usan DOS razones sociales (SAGRACO, S.A. · 1083171 y
-- ARPE, S.A. · 21076383). Con la 034 `paquete.nit` es uno solo y paquete_aplicar_consumos solo descuenta pruebas con
-- e.nit_resuelto = p.nit: las de ARPE no descontaban del paquete de Sagraco y se iban a Por facturar.
--
-- Qué hace:
--  1. paquete_nit (paquete_id, nit, agregado_por, agregado_en; único por paquete + NIT): los NIT ADICIONALES que también
--     consumen. `paquete.nit` sigue siendo el TITULAR: quien pagó y a quien va la factura del anticipo.
--  2. paquete_nits(p paquete) → text[]: el titular más los adicionales. Se usa en todos los lugares donde la 034 comparaba
--     contra p.nit: paquete_aplicar_consumos (NIT involucrados, bloqueo de líneas por paquete, línea que cubre),
--     paquete_vista_previa (ahora recibe p_nits text[]), paquete_resumen (se encuentra desde el titular o desde un
--     adicional; retro_pendientes considera todos los NIT), paquete_crear / paquete_editar (aceptan nits_adicionales).
--     FIFO igual que en la 034, ahora GLOBAL: entre todas las pruebas de los NIT del paquete, primero la más vieja.
--  3. Quitar un NIT adicional que tiene consumos vigentes NO los revierte solo: paquete_editar exige la decisión
--     (al_quitar_nit = 'mantener' | 'revertir'); sin ella falla con PAQUETE_NIT_CON_CONSUMOS y no cambia nada.
--  4. paquete_resumen / paquete_detalle devuelven los adicionales con su nombre, las usadas por NIT y, por prueba
--     descontada, la empresa y el NIT (columna «Empresa / NIT» y subtotal por NIT en el detalle y el PDF).
--  5. Una línea en la ayuda «Paquetes prepagados».
--
-- No toca: la regla de cobertura (servicio + categoría + territorio), la reversión automática, los vencimientos, la cola,
-- el write-back ni la producción: solo cambia DE QUIÉN pueden ser las pruebas.
-- RLS activado y solo service_role. Idempotente; sin drop de tablas / funciones, sin truncate, begin / commit.
-- La firma vieja paquete_vista_previa(text, …) se conserva como envoltorio de la nueva (la app desplegada sigue andando
-- entre aplicar la 036 y desplegar el código).

-- ── 1. modelo ──────────────────────────────────────────────────────────────────────────────────
create table if not exists paquete_nit (
  paquete_id    uuid not null references paquete(id) on delete cascade,
  nit           text not null check (btrim(nit) <> ''),
  agregado_por  text,
  agregado_en   timestamptz not null default now(),
  constraint paquete_nit_unico unique (paquete_id, nit)
);
comment on table paquete_nit is 'PAQUETE DE VARIOS NIT (036): NIT ADICIONALES que también consumen del paquete (grupo de empresas). El titular (quien pagó; factura del anticipo) sigue en paquete.nit.';
create index if not exists idx_paquete_nit_nit on paquete_nit (nit);

alter table paquete_nit enable row level security;
revoke all on table paquete_nit from public, anon, authenticated;
grant all on table paquete_nit to service_role;

/** Todos los NIT que consumen del paquete: el titular primero y después los adicionales (por orden de alta). */
create or replace function paquete_nits(p paquete)
returns text[]
language sql stable
as $fn$
  select array[p.nit] || coalesce((select array_agg(n.nit order by n.agregado_en, n.nit) from paquete_nit n where n.paquete_id = p.id and n.nit <> p.nit), array[]::text[])
$fn$;

-- ── 2. el corazón: aplicar consumos, ahora por todos los NIT del paquete ───────────────────────────
-- p_nit: los paquetes que usa ese NIT (como titular o adicional) y, con ellos, todos los NIT que comparten esos paquetes
-- (cierre transitivo: si A y B comparten un paquete y B y C otro, los tres se resuelven juntos); null = todos.
create or replace function paquete_aplicar_consumos(p_nit text default null, p_fuente text default 'agenda', p_hoy date default null, p_actor text default 'sistema')
returns jsonb
language plpgsql
as $fn$
declare
  v_hoy        date := coalesce(p_hoy, (now() at time zone 'America/Guatemala')::date);
  v_nits       text[];
  v_paqs       uuid[];
  v_antes      integer;
  r            record;
  v_linea      uuid;
  v_consumidos integer := 0;
  v_revertidos integer := 0;
  v_avisos     jsonb := '[]'::jsonb;
  p            paquete%rowtype;
  l            record;
  v_rem        integer;
  v_total_rem  integer;
  v_etq        text;
begin
  -- NIT involucrados: los adicionales de cada paquete que no esté cerrado cuentan igual que el titular
  if p_nit is null then
    select coalesce(array_agg(distinct t.n), array[]::text[]) into v_nits
      from paquete p2 cross join lateral unnest(paquete_nits(p2)) as t(n) where p2.estado <> 'cerrado';
  else
    v_nits := array[p_nit];
    loop
      v_antes := cardinality(v_nits);
      select coalesce(array_agg(distinct u.n), array[]::text[]) into v_nits
        from (select unnest(v_nits) as n
              union
              select t.n from paquete p2 cross join lateral unnest(paquete_nits(p2)) as t(n)
               where p2.estado <> 'cerrado' and paquete_nits(p2) && v_nits) u;
      exit when cardinality(v_nits) = v_antes;
    end loop;
    if not exists (select 1 from paquete p2 where p2.estado <> 'cerrado' and paquete_nits(p2) && v_nits) then v_nits := array[]::text[]; end if;
  end if;
  if cardinality(v_nits) = 0 then return jsonb_build_object('consumidos', 0, 'revertidos', 0, 'avisos', '[]'::jsonb, 'clientes', 0); end if;
  -- paquetes de esos NIT (también los cerrados: sus consumos se siguen revirtiendo) y bloqueo de sus líneas POR PAQUETE:
  -- dos syncs a la vez se serializan acá aunque entren por NIT distintos del mismo paquete
  select coalesce(array_agg(p2.id), array[]::uuid[]) into v_paqs from paquete p2 where paquete_nits(p2) && v_nits;
  perform 1 from paquete_linea pl where pl.paquete_id = any(v_paqs) order by pl.id for update of pl;

  -- a) reversión: la prueba dejó de cobrarse (la Agenda corrigió el resultado) o el expediente se eliminó → la unidad vuelve al paquete
  with rev as (
    update paquete_consumo x
       set revertido_en = now(),
           motivo_reversion = case when e.eliminado then 'expediente eliminado en la Agenda'
                                   else 'la prueba pasó a ' || c.situacion || coalesce(': ' || nullif(c.motivo, ''), '') end
      from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
     where x.componente_id = c.id and x.revertido_en is null and c.fuente = p_fuente
       and (c.situacion <> 'cobra' or e.eliminado)
       and exists (select 1 from paquete_linea pl2 where pl2.id = x.paquete_linea_id and pl2.paquete_id = any(v_paqs))
    returning 1
  ) select count(*) into v_revertidos from rev;

  -- b) estados por vencimiento antes de descontar (vencido no descuenta; extendido vuelve a activo)
  update paquete set estado = 'vencido', updated_at = now()
   where id = any(v_paqs) and estado in ('activo', 'agotado') and vence_en is not null and vence_en < v_hoy;
  update paquete set estado = 'activo', updated_at = now()
   where id = any(v_paqs) and estado = 'vencido' and (vence_en is null or vence_en >= v_hoy);

  -- c) descuento FIFO GLOBAL: entre todas las pruebas de los NIT del paquete, la más vieja primero (fecha de resultado,
  --    o de ingreso); paquete más antiguo primero
  for r in
    select c.id as componente_id, e.nit_resuelto as nit, c.servicio, c.categoria, c.territorio, c.fecha_resultado,
           coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) as fecha,
           coalesce(c.fecha_resultado, e.fecha_ingreso::timestamptz) as momento
      from facturacion_componente c
      join facturacion_expediente e on e.id = c.expediente_id
     where c.fuente = p_fuente and c.situacion = 'cobra' and c.factura_id is null
       and (c.detalle_id is null or exists (select 1 from detalle_facturacion d where d.id = c.detalle_id and d.estado = 'anulada'))
       and not e.eliminado and e.estado_tarifa <> 'excluido_no_factura'
       and e.nit_resuelto is not null and e.nit_resuelto = any(v_nits)
       and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
       and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)
     order by coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) nulls last, c.fecha_resultado nulls last, c.created_at, c.id
  loop
    if r.fecha is null then continue; end if;
    select l2.id into v_linea
      from paquete_linea l2 join paquete p2 on p2.id = l2.paquete_id
     where p2.id = any(v_paqs) and r.nit = any(paquete_nits(p2)) and p2.estado in ('activo', 'agotado')
       and r.fecha >= p2.fecha_inicio and (p2.vence_en is null or r.fecha <= p2.vence_en)
       and (p2.retroactivo_confirmado or r.momento is null or r.momento >= p2.created_at)
       and paquete_linea_cubre(l2.servicio, l2.categoria, l2.territorio, r.servicio, r.categoria, r.territorio)
       and paquete_remanente(l2.id) > 0
     order by p2.fecha_inicio, p2.created_at, l2.created_at, l2.id
     limit 1;
    if v_linea is null then continue; end if;
    insert into paquete_consumo (paquete_linea_id, componente_id, fecha_resultado, creado_por) values (v_linea, r.componente_id, r.fecha_resultado, p_actor);
    v_consumidos := v_consumidos + 1;
  end loop;

  -- d) estados (agotado ↔ activo) y avisos por línea (eventos cambio_condicion en el historial de cobranza del TITULAR, 033)
  for p in select * from paquete where id = any(v_paqs) and estado in ('activo', 'agotado') order by created_at loop
    v_total_rem := 0;
    for l in select l2.*, paquete_remanente(l2.id) as rem from paquete_linea l2 where l2.paquete_id = p.id order by l2.created_at loop
      v_rem := l.rem; v_total_rem := v_total_rem + v_rem;
      v_etq := initcap(lower(l.servicio)) || case when upper(coalesce(l.categoria, '')) in ('', 'UNICA') then '' else ' ' || lower(l.categoria) end;
      if v_rem = 0 and l.agotado_en is null then
        update paquete_linea set agotado_en = now() where id = l.id;
        if p.cliente_id is not null then
          insert into cobranza_evento (cliente_id, tipo, origen, fecha, comentario, facturas, creado_por, datos)
          values (p.cliente_id, 'cambio_condicion', 'automatico', now(), 'Paquete ' || p.correlativo || ' agotado: ' || v_etq || ' 0 de ' || l.cantidad || ' · las siguientes pruebas se facturan a tarifa',
                  '{}'::text[], p_actor, jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'agotado', 'remanente', 0));
        end if;
        v_avisos := v_avisos || jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'agotado', 'remanente', 0);
      elsif v_rem > 0 and l.agotado_en is not null then
        update paquete_linea set agotado_en = null where id = l.id;
      end if;
      if v_rem > 0 and v_rem <= p.umbral_aviso and l.aviso_umbral_en is null then
        update paquete_linea set aviso_umbral_en = now() where id = l.id;
        if p.cliente_id is not null then
          insert into cobranza_evento (cliente_id, tipo, origen, fecha, comentario, facturas, creado_por, datos)
          values (p.cliente_id, 'cambio_condicion', 'automatico', now(), 'Paquete ' || p.correlativo || ' por agotarse: quedan ' || v_rem || ' de ' || l.cantidad || ' (' || v_etq || ') · ofrecer la renovación',
                  '{}'::text[], p_actor, jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'por_agotarse', 'remanente', v_rem));
        end if;
        v_avisos := v_avisos || jsonb_build_object('paquete_id', p.id, 'correlativo', p.correlativo, 'linea_id', l.id, 'aviso', 'por_agotarse', 'remanente', v_rem);
      elsif v_rem > p.umbral_aviso and l.aviso_umbral_en is not null then
        update paquete_linea set aviso_umbral_en = null where id = l.id;
      end if;
    end loop;
    if v_total_rem = 0 and p.estado = 'activo' then update paquete set estado = 'agotado', updated_at = now() where id = p.id;
    elsif v_total_rem > 0 and p.estado = 'agotado' then update paquete set estado = 'activo', updated_at = now() where id = p.id;
    end if;
  end loop;

  return jsonb_build_object('consumidos', v_consumidos, 'revertidos', v_revertidos, 'avisos', v_avisos, 'clientes', cardinality(v_nits));
end
$fn$;

-- ── 3. RPCs de pantalla ────────────────────────────────────────────────────────────────────────
-- Vista previa: qué pruebas ya terminadas y sin facturar desde fecha_inicio, de CUALQUIERA de los NIT, descontaría cada línea.
-- p_nits: [titular, adicionales…]; p_lineas: [{ servicio, categoria, territorio, cantidad }]. Cada prueba trae su NIT.
create or replace function paquete_vista_previa(p_nits text[], p_fecha_inicio date, p_vence_en date, p_lineas jsonb, p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
with cand as (
  select c.id, c.servicio, c.categoria, c.territorio, c.fecha_resultado, e.persona, e.solicitante, e.id_externo, c.estado_prueba, e.nit_resuelto as nit,
         coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) as fecha
    from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
   where c.fuente = p_fuente and c.situacion = 'cobra' and c.factura_id is null
     and (c.detalle_id is null or exists (select 1 from detalle_facturacion d where d.id = c.detalle_id and d.estado = 'anulada'))
     and not e.eliminado and e.estado_tarifa <> 'excluido_no_factura' and e.nit_resuelto = any(p_nits)
     and facturacion_agenda_cobro_pendiente(e.status_cobro_externo, e.estatus_pago_externo)
     and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)
), lin as (
  select ordinality as n, l->>'servicio' as servicio, l->>'categoria' as categoria, nullif(l->>'territorio', '') as territorio, coalesce((l->>'cantidad')::integer, 0) as cantidad
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) with ordinality as t(l, ordinality)
), por_linea as (
  select lin.n, lin.servicio, lin.categoria, lin.territorio, lin.cantidad,
         (select coalesce(jsonb_agg(jsonb_build_object('componente_id', c.id, 'persona', c.persona, 'solicitante', c.solicitante, 'id_externo', c.id_externo, 'fecha', c.fecha, 'resultado', c.estado_prueba, 'servicio', c.servicio, 'categoria', c.categoria, 'territorio', c.territorio, 'nit', c.nit) order by c.fecha, c.fecha_resultado, c.id), '[]'::jsonb)
            from (select * from cand c where c.fecha is not null and c.fecha >= p_fecha_inicio and (p_vence_en is null or c.fecha <= p_vence_en)
                     and paquete_linea_cubre(lin.servicio, lin.categoria, lin.territorio, c.servicio, c.categoria, c.territorio)
                   order by c.fecha, c.fecha_resultado, c.id limit 200) c) as pruebas,
         (select coalesce(jsonb_object_agg(k.nit, k.n), '{}'::jsonb)
            from (select c.nit, count(*) as n from cand c where c.fecha is not null and c.fecha >= p_fecha_inicio and (p_vence_en is null or c.fecha <= p_vence_en)
                     and paquete_linea_cubre(lin.servicio, lin.categoria, lin.territorio, c.servicio, c.categoria, c.territorio) group by c.nit) k) as por_nit
    from lin
)
select coalesce(jsonb_agg(jsonb_build_object('n', n, 'servicio', servicio, 'categoria', categoria, 'territorio', territorio, 'cantidad', cantidad,
                                             'candidatas', jsonb_array_length(pruebas), 'tomaria', least(jsonb_array_length(pruebas), cantidad), 'pruebas', pruebas, 'por_nit', por_nit) order by n), '[]'::jsonb)
  from por_linea
$fn$;

-- Firma de la 034 (un solo NIT): envoltorio de la nueva.
create or replace function paquete_vista_previa(p_nit text, p_fecha_inicio date, p_vence_en date, p_lineas jsonb, p_fuente text default 'agenda')
returns jsonb
language sql stable
as $fn$
  select paquete_vista_previa(array[p_nit]::text[], p_fecha_inicio, p_vence_en, p_lineas, p_fuente)
$fn$;

-- Crear: p_paquete { nit (titular), nits_adicionales? [nit…], cliente_id?, nombre, fecha_inicio, vence_en?, umbral_aviso?, no_factura?, notas?, retroactivo_confirmado? }
--        p_lineas [{ servicio, categoria, territorio?, cantidad, precio_unitario }]. Aplica los consumos de todos los NIT del paquete en la misma transacción.
create or replace function paquete_crear(p_actor text, p_paquete jsonb, p_lineas jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_nit       text := upper(btrim(coalesce(p_paquete->>'nit', '')));
  v_nombre    text := btrim(coalesce(p_paquete->>'nombre', ''));
  v_inicio    date := nullif(p_paquete->>'fecha_inicio', '')::date;
  v_vence     date := nullif(p_paquete->>'vence_en', '')::date;
  v_nf        text := nullif(btrim(coalesce(p_paquete->>'no_factura', '')), '');
  v_cliente   uuid := nullif(p_paquete->>'cliente_id', '')::uuid;
  v_factura   uuid;
  v_total     integer := 0;
  v_umbral    integer;
  v_id        uuid;
  l           jsonb;
  v_cant      integer;
  v_res       jsonb;
  v_adic      text;
begin
  if v_nit = '' then raise exception 'PAQUETE_SIN_NIT'; end if;
  if v_nombre = '' then raise exception 'PAQUETE_SIN_NOMBRE'; end if;
  if v_inicio is null then raise exception 'PAQUETE_SIN_FECHA_INICIO'; end if;
  if v_vence is not null and v_vence < v_inicio then raise exception 'PAQUETE_VENCE_ANTES_DE_INICIAR'; end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then raise exception 'PAQUETE_SIN_LINEAS'; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_cant := coalesce((l->>'cantidad')::integer, 0);
    if v_cant <= 0 then raise exception 'PAQUETE_LINEA_SIN_CANTIDAD'; end if;
    if btrim(coalesce(l->>'servicio', '')) = '' then raise exception 'PAQUETE_LINEA_SIN_SERVICIO'; end if;
    if btrim(coalesce(l->>'categoria', '')) = '' then raise exception 'PAQUETE_LINEA_SIN_CATEGORIA'; end if;
    if coalesce((l->>'precio_unitario')::numeric, 0) < 0 then raise exception 'PAQUETE_LINEA_PRECIO_NEGATIVO'; end if;
    v_total := v_total + v_cant;
  end loop;
  if v_cliente is null then select id into v_cliente from clientes where upper(btrim(nit)) = v_nit order by activo desc nulls last, created_at limit 1; end if;
  if v_nf is not null then select id into v_factura from facturas_clientes where btrim(no_factura) = v_nf order by total desc, created_at limit 1; end if;
  -- umbral por defecto: 10 % de la cantidad total o 5, lo que sea mayor
  v_umbral := coalesce(nullif(p_paquete->>'umbral_aviso', '')::integer, greatest(5, ceil(v_total * 0.10)::integer));
  insert into paquete (nit, cliente_id, nombre, fecha_inicio, vence_en, no_factura, factura_id, umbral_aviso, notas, creado_por,
                       retroactivo_confirmado, retroactivo_por, retroactivo_en)
  values (v_nit, v_cliente, v_nombre, v_inicio, v_vence, v_nf, v_factura, v_umbral, nullif(btrim(coalesce(p_paquete->>'notas', '')), ''), p_actor,
          coalesce((p_paquete->>'retroactivo_confirmado')::boolean, false),
          case when coalesce((p_paquete->>'retroactivo_confirmado')::boolean, false) then p_actor end,
          case when coalesce((p_paquete->>'retroactivo_confirmado')::boolean, false) then now() end)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    insert into paquete_linea (paquete_id, servicio, categoria, territorio, cantidad, precio_unitario)
    values (v_id, upper(btrim(l->>'servicio')), upper(btrim(l->>'categoria')), nullif(upper(btrim(coalesce(l->>'territorio', ''))), ''), (l->>'cantidad')::integer, round(coalesce((l->>'precio_unitario')::numeric, 0), 2));
  end loop;
  -- 036: NIT adicionales (el titular no se repite)
  if jsonb_typeof(p_paquete->'nits_adicionales') = 'array' then
    for v_adic in select distinct upper(btrim(t.n)) from jsonb_array_elements_text(p_paquete->'nits_adicionales') as t(n) loop
      if v_adic is null or v_adic = '' or v_adic = v_nit then continue; end if;
      insert into paquete_nit (paquete_id, nit, agregado_por) values (v_id, v_adic, p_actor) on conflict (paquete_id, nit) do nothing;
    end loop;
  end if;
  -- una sola llamada alcanza a todos los NIT del paquete (aplicar resuelve juntos al titular y a los adicionales)
  v_res := paquete_aplicar_consumos(v_nit, 'agenda', null, p_actor);
  return jsonb_build_object('id', v_id, 'correlativo', (select correlativo from paquete where id = v_id), 'aplicado', v_res);
end
$fn$;

-- Editar: nombre, umbral_aviso, no_factura, notas, vence_en (extender un vencido lo reactiva en el próximo aplicar) y
-- 036: nits_adicionales [nit…] = la lista COMPLETA deseada (los que falten se quitan, los nuevos se agregan).
-- Quitar un NIT con pruebas descontadas vigentes exige al_quitar_nit = 'mantener' (siguen descontadas) | 'revertir'
-- (vuelven al paquete y a Por facturar a tarifa); sin la decisión → PAQUETE_NIT_CON_CONSUMOS y no se cambia nada.
create or replace function paquete_editar(p_actor text, p_id uuid, p_cambios jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  p  paquete%rowtype;
  v_nf text;
  v_factura uuid;
  v_nuevos   text[];
  v_quitar   text[] := array[]::text[];
  v_adic     text;
  v_cnt      integer;
  v_decision text := lower(btrim(coalesce(p_cambios->>'al_quitar_nit', '')));
begin
  select * into p from paquete where id = p_id for update;
  if p.id is null then raise exception 'PAQUETE_NO_EXISTE'; end if;
  if p.estado = 'cerrado' then raise exception 'PAQUETE_CERRADO: un paquete cerrado no se edita'; end if;
  if p_cambios ? 'nombre' and btrim(coalesce(p_cambios->>'nombre', '')) <> '' then update paquete set nombre = btrim(p_cambios->>'nombre') where id = p_id; end if;
  if p_cambios ? 'umbral_aviso' then update paquete set umbral_aviso = greatest(0, (p_cambios->>'umbral_aviso')::integer) where id = p_id; end if;
  if p_cambios ? 'notas' then update paquete set notas = nullif(btrim(coalesce(p_cambios->>'notas', '')), '') where id = p_id; end if;
  if p_cambios ? 'vence_en' then
    if nullif(p_cambios->>'vence_en', '') is not null and (p_cambios->>'vence_en')::date < p.fecha_inicio then raise exception 'PAQUETE_VENCE_ANTES_DE_INICIAR'; end if;
    update paquete set vence_en = nullif(p_cambios->>'vence_en', '')::date where id = p_id;
  end if;
  if p_cambios ? 'no_factura' then
    v_nf := nullif(btrim(coalesce(p_cambios->>'no_factura', '')), '');
    v_factura := null;
    if v_nf is not null then select id into v_factura from facturas_clientes where btrim(no_factura) = v_nf order by total desc, created_at limit 1; end if;
    update paquete set no_factura = v_nf, factura_id = v_factura where id = p_id;
  end if;
  -- 036: NIT adicionales
  if jsonb_typeof(p_cambios->'nits_adicionales') = 'array' then
    select coalesce(array_agg(distinct upper(btrim(t.n))) filter (where btrim(t.n) <> '' and upper(btrim(t.n)) <> p.nit), array[]::text[]) into v_nuevos
      from jsonb_array_elements_text(p_cambios->'nits_adicionales') as t(n);
    select coalesce(array_agg(pn.nit order by pn.nit), array[]::text[]) into v_quitar from paquete_nit pn where pn.paquete_id = p_id and pn.nit <> all(v_nuevos);
    perform 1 from paquete_linea pl where pl.paquete_id = p_id order by pl.id for update of pl;
    foreach v_adic in array v_quitar loop
      select count(*) into v_cnt
        from paquete_consumo pc join paquete_linea pl on pl.id = pc.paquete_linea_id
        join facturacion_componente c on c.id = pc.componente_id join facturacion_expediente e on e.id = c.expediente_id
       where pl.paquete_id = p_id and pc.revertido_en is null and e.nit_resuelto = v_adic;
      if v_cnt > 0 and v_decision not in ('mantener', 'revertir') then
        raise exception 'PAQUETE_NIT_CON_CONSUMOS: quedan % pruebas del NIT % descontadas; decidí si mantenerlas o revertirlas', v_cnt, v_adic;
      end if;
      if v_cnt > 0 and v_decision = 'revertir' then
        update paquete_consumo pc
           set revertido_en = now(), motivo_reversion = 'se quitó el NIT ' || v_adic || ' del paquete'
          from paquete_linea pl, facturacion_componente c, facturacion_expediente e
         where pl.id = pc.paquete_linea_id and c.id = pc.componente_id and e.id = c.expediente_id
           and pl.paquete_id = p_id and pc.revertido_en is null and e.nit_resuelto = v_adic;
      end if;
      delete from paquete_nit where paquete_id = p_id and nit = v_adic;
    end loop;
    foreach v_adic in array v_nuevos loop
      insert into paquete_nit (paquete_id, nit, agregado_por) values (p_id, v_adic, p_actor) on conflict (paquete_id, nit) do nothing;
    end loop;
  end if;
  update paquete set updated_at = now() where id = p_id;
  -- aplicar con cada NIT del paquete (una llamada por el titular los alcanza a todos) y con los que salieron
  -- (sus pruebas revertidas pueden caer en otro paquete de ese NIT; si no, vuelven a Por facturar a tarifa)
  perform paquete_aplicar_consumos(p.nit, 'agenda', null, p_actor);
  foreach v_adic in array v_quitar loop
    perform paquete_aplicar_consumos(v_adic, 'agenda', null, p_actor);
  end loop;
  select * into p from paquete where id = p_id;
  return to_jsonb(p);
end
$fn$;

-- Confirmar la aplicación retroactiva y aplicar (a todos los NIT del paquete).
create or replace function paquete_confirmar_retroactivo(p_actor text, p_id uuid)
returns jsonb
language plpgsql
as $fn$
declare
  p paquete%rowtype;
begin
  select * into p from paquete where id = p_id for update;
  if p.id is null then raise exception 'PAQUETE_NO_EXISTE'; end if;
  if p.estado = 'cerrado' then raise exception 'PAQUETE_CERRADO'; end if;
  update paquete set retroactivo_confirmado = true, retroactivo_por = p_actor, retroactivo_en = now(), updated_at = now() where id = p_id;
  return paquete_aplicar_consumos(p.nit, 'agenda', null, p_actor);
end
$fn$;

-- Resumen: paquetes (todos, o los que USA un NIT: como titular o como adicional) con sus líneas, usadas y remanente,
-- los NIT adicionales con su nombre y las usadas por NIT.
create or replace function paquete_resumen(p_nit text default null)
returns jsonb
language sql stable
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'correlativo', p.correlativo, 'nit', p.nit, 'cliente_id', p.cliente_id, 'nombre', p.nombre,
           'fecha_inicio', p.fecha_inicio, 'vence_en', p.vence_en, 'estado', p.estado, 'no_factura', p.no_factura, 'factura_id', p.factura_id,
           'factura_app_id', (select f.airtable_id from facturas_clientes f where f.id = p.factura_id),
           'umbral_aviso', p.umbral_aviso, 'retroactivo_confirmado', p.retroactivo_confirmado, 'notas', p.notas, 'creado_por', p.creado_por, 'created_at', p.created_at, 'updated_at', p.updated_at,
           'cerrado_por', p.cerrado_por, 'cerrado_motivo', p.cerrado_motivo, 'cerrado_en', p.cerrado_en,
           'cliente', (select coalesce(nullif(c.nombre_empresa, ''), c.razon_social) from clientes c where c.id = p.cliente_id),
           'razon_social', (select nullif(btrim(c.razon_social), '') from clientes c where c.id = p.cliente_id),
           -- 036: NIT adicionales (grupo de empresas) con el nombre del cliente de ese NIT, y pruebas vigentes por NIT
           'nits_adicionales', (select coalesce(jsonb_agg(jsonb_build_object('nit', pn.nit, 'nombre', cn.nombre, 'razon_social', cn.razon_social, 'agregado_por', pn.agregado_por, 'agregado_en', pn.agregado_en) order by pn.agregado_en, pn.nit), '[]'::jsonb)
                                  from paquete_nit pn
                                  left join lateral (select coalesce(nullif(c.nombre_empresa, ''), c.razon_social) as nombre, nullif(btrim(c.razon_social), '') as razon_social
                                                       from clientes c where upper(regexp_replace(coalesce(c.nit, ''), '[^0-9A-Za-z]', '', 'g')) = pn.nit
                                                      order by c.activo desc nulls last, c.created_at limit 1) cn on true
                                 where pn.paquete_id = p.id and pn.nit <> p.nit),
           'usadas_por_nit', (select coalesce(jsonb_object_agg(u.nit, u.n), '{}'::jsonb)
                                from (select coalesce(e.nit_resuelto, '') as nit, count(*) as n
                                        from paquete_consumo x join paquete_linea l on l.id = x.paquete_linea_id
                                        join facturacion_componente c on c.id = x.componente_id join facturacion_expediente e on e.id = c.expediente_id
                                       where l.paquete_id = p.id and x.revertido_en is null group by 1) u),
           'lineas', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', l.id, 'servicio', l.servicio, 'categoria', l.categoria, 'territorio', l.territorio, 'cantidad', l.cantidad, 'precio_unitario', l.precio_unitario,
                        'usadas', (select count(*) from paquete_consumo x where x.paquete_linea_id = l.id and x.revertido_en is null),
                        'remanente', paquete_remanente(l.id), 'aviso_umbral_en', l.aviso_umbral_en, 'agotado_en', l.agotado_en) order by l.created_at), '[]'::jsonb)
                        from paquete_linea l where l.paquete_id = p.id),
           -- pruebas terminadas antes de crear el paquete que esperan la confirmación retroactiva (solo informativo): de TODOS los NIT del paquete
           'retro_pendientes', case when p.retroactivo_confirmado or p.estado = 'cerrado' then 0 else
             (select count(*) from facturacion_componente c join facturacion_expediente e on e.id = c.expediente_id
               where c.situacion = 'cobra' and c.factura_id is null and not e.eliminado and e.nit_resuelto = any(paquete_nits(p))
                 and coalesce(c.fecha_resultado, e.fecha_ingreso::timestamptz) < p.created_at
                 and coalesce((c.fecha_resultado at time zone 'America/Guatemala')::date, e.fecha_ingreso) >= p.fecha_inicio
                 and not exists (select 1 from paquete_consumo x where x.componente_id = c.id and x.revertido_en is null)
                 and exists (select 1 from paquete_linea l where l.paquete_id = p.id and paquete_linea_cubre(l.servicio, l.categoria, l.territorio, c.servicio, c.categoria, c.territorio))) end
         ) order by p.created_at desc), '[]'::jsonb)
    from paquete p
   where p_nit is null or p_nit = any(paquete_nits(p))
$fn$;

-- Detalle de un paquete: líneas con sus pruebas descontadas; 036: cada prueba trae la empresa y el NIT al que pertenece.
create or replace function paquete_detalle(p_id uuid)
returns jsonb
language sql stable
as $fn$
  select jsonb_build_object(
    'paquete', (select t.v from jsonb_array_elements(paquete_resumen((select nit from paquete where id = p_id))) as t(v) where (t.v->>'id')::uuid = p_id),
    'consumos', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', pc.id, 'linea_id', pc.paquete_linea_id, 'componente_id', pc.componente_id, 'fecha', pc.fecha, 'revertido_en', pc.revertido_en, 'motivo_reversion', pc.motivo_reversion,
                   'fecha_resultado', c.fecha_resultado, 'servicio', c.servicio, 'categoria', c.categoria, 'territorio', c.territorio, 'estado_prueba', c.estado_prueba, 'situacion', c.situacion,
                   'persona', e.persona, 'solicitante', e.solicitante, 'puesto', e.puesto, 'id_externo', e.id_externo, 'expediente_id', e.id,
                   'nit', e.nit_resuelto,
                   'empresa', (select coalesce(nullif(btrim(k.razon_social), ''), k.nombre_empresa) from clientes k
                                where upper(regexp_replace(coalesce(k.nit, ''), '[^0-9A-Za-z]', '', 'g')) = e.nit_resuelto order by k.activo desc nulls last, k.created_at limit 1),
                   'detalle_id', c.detalle_id, 'no_factura', c.no_factura) order by pc.revertido_en nulls first, coalesce(c.fecha_resultado, pc.fecha), pc.id), '[]'::jsonb)
                   from paquete_consumo pc join paquete_linea l on l.id = pc.paquete_linea_id
                   join facturacion_componente c on c.id = pc.componente_id join facturacion_expediente e on e.id = c.expediente_id
                  where l.paquete_id = p_id)
  )
$fn$;

-- solo service_role
revoke all on function paquete_nits(paquete), paquete_aplicar_consumos(text, text, date, text), paquete_vista_previa(text[], date, date, jsonb, text),
  paquete_vista_previa(text, date, date, jsonb, text), paquete_crear(text, jsonb, jsonb), paquete_editar(text, uuid, jsonb),
  paquete_confirmar_retroactivo(text, uuid), paquete_resumen(text), paquete_detalle(uuid)
  from public, anon, authenticated;
grant execute on function paquete_nits(paquete), paquete_aplicar_consumos(text, text, date, text), paquete_vista_previa(text[], date, date, jsonb, text),
  paquete_vista_previa(text, date, date, jsonb, text), paquete_crear(text, jsonb, jsonb), paquete_editar(text, uuid, jsonb),
  paquete_confirmar_retroactivo(text, uuid), paquete_resumen(text), paquete_detalle(uuid)
  to service_role;

-- ── 4. ayuda: una línea en «Paquetes prepagados» ────────────────────────────────────────────────
update ayuda
   set contenido = contenido || E'\n\n## Un paquete para varias empresas\n\nUn paquete lo pueden usar varias empresas del mismo grupo: agregalas en "También lo usan". El paquete sigue teniendo un **titular** (quien pagó y a quien va la factura del anticipo); las pruebas de las demás empresas también descuentan, en el mismo orden (la más vieja primero, sea de la empresa que sea). El paquete aparece en el tarifario y en *Por facturar* de todas, con la etiqueta **«Compartido»**, y el detalle y el PDF muestran de qué empresa es cada prueba y un subtotal por NIT. Si quitás una empresa que ya tiene pruebas descontadas, el sistema te pregunta si esas pruebas se **mantienen** descontadas o se **revierten** (vuelven a *Por facturar* a tarifa).',
       updated_at = now()
 where slug = 'paquetes-prepagados' and contenido not like '%También lo usan%';
