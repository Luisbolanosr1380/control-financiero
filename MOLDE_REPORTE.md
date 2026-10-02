# MOLDE_REPORTE — Fase Molde (Piezas 1, 2, 4) · 2026-08-31

Trabajo autónomo nocturno en la rama `feature/molde-multiempresa` (sin push).

## ✅ Confirmación de seguridad

- **Golden NO fue modificada en ninguna forma.** Todo acceso a la base
  `control-financiero` (nuggrsbykivfkzvarobr) fue SOLO LECTURA:
  introspección del schema (`pg_catalog`/`information_schema` vía SELECT)
  y lectura del catálogo contable para el seed (SELECTs paginados).
- No hubo push, no se tocó Vercel, no se creó infraestructura, no se
  ejecutó nada contra ninguna base real. La única base donde SÍ se
  ejecutaron las migraciones fue un **Postgres 17 efímero en Docker
  local** (contenedor `cf-molde-validacion`), creado y destruido en la
  validación — ver sección Validación.

## Qué construí

### Pieza 1 — Migraciones versionadas (`supabase/migrations/`)

| Archivo | Contenido |
|---|---|
| `001_extensiones_y_enums.sql` | 3 enums (`moneda`, `naturaleza_saldo`, `empresa_empleadora`) con guards de re-ejecución |
| `002_tablas_catalogo.sql` | cuentas, centros_costo, clientes, proveedores, acreedores, bancos, periodos, empleados, activos_fijos |
| `003_tablas_transaccionales.sql` | facturas_clientes, cobros (+puente multi-factura), notas_credito, deudas, pagos_proveedores, obligaciones, facturas_in |
| `004_tablas_contables.sql` | asientos (+`uq_asientos_ref`), partidas, gastos, movimientos_bancarios, mapeos ER/BS (+puentes, snapshots), planilla; cierra la FK circular `facturas_in.gasto_id` |
| `005_rpcs_transaccionales.sql` | Las 6 funciones `fase2_*` VERBATIM de la base (pg_get_functiondef) |
| `006_tablas_nuevas.sql` | ayuda, uso_auros, analisis_ai, roadmap_items, gestiones_cobro (+puente) |

Fuente: **introspección directa de Golden** (34 tablas, constraints,
29 índices, RLS, funciones) — no los archivos viejos del repo, que ya
tenían drift (p. ej. tu tabla de roadmap difiere de mi 06_roadmap.sql).
RLS queda habilitado en todas las tablas, como en Golden.

**Runner**: `scripts/migrar-todas.ts` — corre las migraciones PENDIENTES
(tabla `_migraciones` por base) sobre la lista de `scripts/empresas.json`
(hoy placeholder) o una `--db <url>` puntual. **Dry-run por default**;
`--aplicar` para ejecutar; transacción por archivo con rollback y corte.
Acepta `--seed <archivo>` para encadenar el seed. Dependencia nueva:
`pg` (devDependency).

### Pieza 2 — Seed del plan de cuentas (`supabase/seeds/seed_plan_cuentas_base.sql`)

245 cuentas (jerarquía en 2 pasadas por `codigo_path`), 6 centros de
costo, 25 líneas ER + 20 BS con sus puentes a cuentas (resueltos por
`codigo_path`, no por uuid). **Idempotente**: DO block que solo siembra
si `cuentas` está vacía. Cero datos transaccionales. Regenerable con
`scripts/generar-seed-plan-cuentas.py` (solo lectura).

### Pieza 4 — Bootstrap "nueva empresa"

- `scripts/bootstrap-empresa.md`: checklist completo de 5 pasos
  (Supabase manual → migraciones → seed → Vercel env vars → pase de
  verificación en navegador), con la tabla de variables y qué cambiar.
- `scripts/bootstrap-empresa.ts`: scaffold que automatiza SOLO
  migraciones+seed+verificación de conteos sobre una URL que le pasás
  explícitamente, con **guard de base vacía** (si la base tiene tablas,
  se niega — imposible apuntarlo a Golden por error). No crea infra.

## Validación — ✅ ejecutada contra un Postgres 17 EFÍMERO local

Contenedor Docker `postgres:17-alpine` (misma major que Golden),
levantado y **destruido** al final — Golden jamás participó. La
validación usó exactamente las herramientas del molde (no SQL a mano):

1. **Dry-run del runner**: lista las 6 migraciones sin tocar nada. ✓
2. **`migrar-todas --aplicar --seed`**: 6/6 migraciones ✓ + seed ✓.
3. **Fidelidad del schema**: 34 tablas (= Golden), 6 funciones, 3 enums,
   RLS habilitado en 34/34.
4. **Seed correcto**: 245 cuentas, jerarquía 100% resuelta (239 con
   parent_id + 6 raíces, 0 sin resolver), 6 CC, mapeo ER 25 líneas/30
   puentes y BS 20/25 — **idénticos a los conteos de Golden**.
5. **RPCs vivas (humo)**: asiento balanceado se crea y devuelve
   totales ✓; `ASIENTO_DUPLICADO` rechazado ✓; `ASIENTO_NO_BALANCEADO`
   rechazado ✓ (la atomicidad de Fase 2 funciona en la base nueva).
6. **Idempotencia**: re-correr el runner → "6 aplicadas, 0 pendientes";
   re-correr el seed → no duplica (245 se mantiene). ✓
7. **Guard del bootstrap**: apuntado a la base ya poblada se NIEGA
   ("la base ya tiene 35 tablas") — la protección anti-base-viva
   funciona. ✓

`tsc` verde en el repo con los scripts nuevos.

## Decisiones que tomé (revisables)

1. **`gen_random_uuid()` en vez de `uuid_generate_v4()`** en todos los
   defaults — es core de Postgres, elimina la extensión uuid-ossp. Los
   uuids generados son equivalentes (v4).
2. **`airtable_id` se mantiene en TODAS las tablas, NULLABLE + unique.**
   El brief pedía "nullable o que no exista" en las tablas nuevas; no
   puede no existir porque es el id público de la capa de la app
   (id-bridge, pseudo-records, RPCs `fase2_nuevo_id`). Nullable cumple
   el objetivo: un seed por SQL sin id no rompe nada. En Golden ya era
   nullable en casi todas (gestiones_cobro era la excepción — divergí).
3. **El seed SÍ pone airtable_id** (determinísticos: `cta-1-1-1-2`,
   `cc-poligrafia`, `mer-10`…): sin ellos, la UI no puede editar esas
   filas (el bug exacto del roadmap del 27/8). Divergencia consciente
   con la letra del brief, fiel a su intención.
4. **Orden de columnas ≠ Golden en 2 tablas** (facturas_in, deudas
   tienen columnas "al final" por ALTERs históricos): irrelevante para
   la app (PostgREST va por nombre); los CREATE del molde las ordenan
   lógicamente.
5. RPCs tomadas de la BASE (no del archivo 04 del repo) — la base es la
   verdad tras el drift observado.

## ⚠ Específico de Golden detectado (decidís vos, nada se quitó)

- **6 cuentas intercompany** marcadas con ⚠ en el seed:
  `1-1-3-3-1/2/3` (CxC HIT/Poligrafy/BYDSA) y `4-1-7-1/2/3` (Servicios
  Adm. Intercompañía — HIT/Poligrafy/BYDSA).
- **Enum `empresa_empleadora`** = ('Golden Talent','HIT','Poligrafy',
  'BYDSA','Otra') — hardcodeado también en el código de la app.
- **Centros de costo** = las líneas de Golden (Poligrafía, Socio, TT…).
- **Branding y line-keys en código**: `ccToLineKey`/planilla-config
  mapean rec-ids de Golden; una empresa nueva cae al fallback de línea.
  Es el trabajo de la fase "multi-empresa en la app" (config por
  empresa: nombre, logo, líneas, códigos de nómina).

## Pendiente que requiere TU confirmación (despierto)

1. **Crear las bases reales** (HIT/Poligrafy/BYDSA…): manual en
   supabase.com — `bootstrap-empresa.md` paso 1.
2. **Correr migraciones+seed contra esas bases**: `npx tsx
   scripts/bootstrap-empresa.ts --db '<url>'` (o el runner a mano).
3. **Deploys en Vercel** por empresa (paso 4 del checklist).
4. Decidir: cuentas ⚠, enum de empresas, Clerk compartido vs por
   empresa, y la config de branding/líneas en la app.
5. `scripts/empresas.json` con las URLs reales (local, sin commitear
   credenciales).

## Dudas que me surgieron

- El molde asume **una base por empresa** (multi-deploy puro), como
  pide el brief. Si más adelante quisieras consolidado del grupo, ese
  reporte necesitará leer N bases — anotado en el roadmap como pieza
  aparte ("Consolidado del grupo").
- `empresa_empleadora`/`por_cuenta_de` en una empresa hermana: ¿"HIT"
  abre su base con el enum que la nombra a ella misma como hermana?
  Funciona, pero es semánticamente raro — candidato a generalizarse
  cuando toquemos la app.
