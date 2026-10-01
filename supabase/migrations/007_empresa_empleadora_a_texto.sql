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

begin;

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

commit;
