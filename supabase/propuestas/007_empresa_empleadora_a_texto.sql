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
-- MULTIEMPRESA_PROPUESTAS.md). Idempotente razonable: re-ejecutarla
-- sobre una base ya migrada falla limpio en el primer ALTER (columna
-- ya text) sin tocar datos.
-- ============================================================

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
