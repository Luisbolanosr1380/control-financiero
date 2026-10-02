-- ============================================================
-- 001 · Extensiones y enums (FASE MOLDE)
--
-- Schema consolidado desde la base de Golden (introspección
-- 2026-08-30). Divergencia deliberada vs Golden: los defaults de
-- uuid usan gen_random_uuid() (core de Postgres 13+) en lugar de
-- uuid_generate_v4() — no se necesita la extensión uuid-ossp.
-- ============================================================

-- Enums (guardados contra re-ejecución: las migraciones deben poder
-- correrse sobre una base que ya las tenga a medias).
do $$ begin
  create type moneda as enum ('GTQ', 'USD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type naturaleza_saldo as enum ('Deudora', 'Acreedora');
exception when duplicate_object then null; end $$;

-- ⚠ Específico de Golden: los valores son las empresas del grupo.
-- Para el molde genérico, evaluar renombrar/parametrizar (el código de
-- la app hoy asume estos literales — cambiarlos requiere tocar la app).
do $$ begin
  create type empresa_empleadora as enum ('Golden Talent', 'HIT', 'Poligrafy', 'BYDSA', 'Otra');
exception when duplicate_object then null; end $$;
