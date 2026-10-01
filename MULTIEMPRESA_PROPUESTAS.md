# MULTI-EMPRESA — Propuestas del Paso 2 (para tu aprobación) · 2026-10-01

El **Paso 1 está construido y validado** (commit `MULTIEMPRESA·P1`):
config central por env vars, line-keys derivadas de la base, branding
de config. Golden sin env vars queda **pixel-idéntica** (validador
15/15, incluido el título del browser y el subtítulo del sidebar con
sus textos históricos exactos).

Este documento presenta las DOS decisiones de arquitectura que pediste
revisar ANTES de que construya nada irreversible. **Nada de esto está
aplicado**; el Paso 3 (selector + Clerk) espera tu aprobación de la
Propuesta 2, y el Paso 4 (aplicar a Golden) es con vos mirando.

---

## Propuesta 1 — enum `empresa_empleadora` → TEXT + tabla catálogo

### El problema
El enum de Postgres hardcodea `('Golden Talent','HIT','Poligrafy',
'BYDSA','Otra')` en la BASE, y el código lo duplica como union type
(`src/lib/empleados/empresa.ts`). Una empresa nueva hereda en su base
los nombres del grupo de Golden, y agregar una empresa hermana exige
`ALTER TYPE` + deploy.

### Opciones

**A. Tabla configurable (RECOMENDADA)** — columnas a `text` + catálogo
`empresas_relacionadas` (nombre, es_principal, activo) del que la app
lee las opciones.
- ✅ Agregar/renombrar una empresa hermana = un INSERT desde la app
  (sin migración ni deploy). Cada empresa define SU grupo.
- ✅ Migración trivial y 100% preservadora (`::text` es cast 1:1);
  el catálogo se siembra con los valores ya usados.
- ✅ El código deja de duplicar el union type: los selects de UI leen
  el catálogo; la semántica "principal vs intercompany" compara contra
  `es_principal` (≈ `empresaConfig().nombre`) en vez del literal
  `'Golden Talent'`.
- ⚠ Se pierde la validación a nivel DB (cualquier texto entra). Se
  mitiga con FK suave: validación en la capa de escritura contra el
  catálogo (como ya hacemos con canal de gestión, estados de roadmap…
  esos usan CHECK, pero acá el set es dinámico por diseño).

**B. Enum por empresa** — mantener enum; el bootstrap de cada empresa
crea SU enum con SUS labels.
- ✅ Validación fuerte en DB.
- ❌ El union type de TypeScript no puede variar por deploy → el código
  tendría que volverse `string` igual (perdés la mitad del beneficio).
- ❌ Cada alta/renombre de hermana = `ALTER TYPE` en la base (migración
  por empresa); los enums de Postgres no permiten QUITAR valores.
- ❌ El molde deja de ser un schema único: cada base diverge.

### Lo que está listo (sin aplicar)
- `supabase/propuestas/007_empresa_empleadora_a_texto.sql` — la
  migración de la opción A, **fuera de `supabase/migrations/`** para
  que el runner no pueda tomarla por accidente. Validada contra una BD
  efímera con datos estilo Golden (valores y defaults preservados,
  catálogo sembrado, alta de una empresa nueva funciona). Evidencia en
  la sección Validación de abajo.
- Si aprobás: la renombro a `migrations/007_…`, ajusto el código (type
  → `string`, selects desde el catálogo, comparaciones contra
  `es_principal`), y la aplicación a Golden queda para el Paso 4 con
  vos mirando.

---

## Propuesta 2 — Permisos usuario→empresas (para el selector)

### Restricción de la arquitectura
Multi-deploy sin base central: no existe un lugar "neutral" nuestro
donde guardar membresías… **salvo Clerk**, que ya es compartido por
decisión tuya. Cualquier tabla de membresías viviría en la base de UNA
empresa (fea asimetría) o exigiría una base extra solo para eso.

### Opciones

**A. Clerk `publicMetadata` (RECOMENDADA)** — en cada usuario de Clerk:
```json
{ "empresas": [
    { "slug": "golden", "nombre": "Golden Talent", "url": "https://cf-golden.vercel.app" },
    { "slug": "hit",    "nombre": "HIT",           "url": "https://cf-hit.vercel.app" }
] }
```
y cada deploy declara quién es con `EMPRESA_SLUG` (env, Bloque 1-A).
- ✅ Un solo lugar, compartido por construcción entre todos los deploys
  (el JWT de Clerk viaja con la sesión — el selector y el guard leen
  del token, sin tocar ninguna base).
- ✅ El selector es trivial: lista `empresas` del metadata; 1 → redirect
  directo a su `url`; 2+ → pantalla de selección; "cambiar de empresa"
  = volver a esa pantalla.
- ✅ Aislamiento (H): layout del deploy valida
  `metadata.empresas.some(e => e.slug === EMPRESA_SLUG)` → si no,
  pantalla "sin acceso a esta empresa". **Defensa en profundidad**: el
  allowlist actual por deploy (`ALLOWED_EMAILS`) se mantiene como
  segunda capa — hoy ya aísla, no lo quitamos.
- ⚠ Administrar permisos = editar metadata en el dashboard de Clerk
  (manual). Suficiente para <10 usuarios; si crece, una pantalla
  admin que escriba metadata vía API de Clerk (fase posterior).

**B. Tabla de membresías en una base** — ❌ requiere elegir una base
"madre" o crear infra nueva; todos los deploys necesitarían llaves de
esa base (rompe el aislamiento "una llave por deploy").

**C. Solo config por deploy (`ALLOWED_EMAILS`)** — es el statu quo;
✅ simple, pero ❌ el selector no puede saber las OTRAS empresas del
usuario sin consultar N deploys. No alcanza para el requisito G.

### Diseño del selector (Paso 3, se construye tras tu OK)
- Ruta `/empresas` en CADA deploy (misma app): lee el metadata de la
  sesión Clerk; 0 empresas → "sin acceso"; 1 → redirect a su url (si es
  ESTE deploy, pasa directo al dashboard); 2+ → tarjetas con nombre y
  logo. Ítem "Cambiar de empresa" en el menú del sidebar → `/empresas`.
- Al aterrizar en el deploy destino, Clerk comparte la sesión (misma
  instancia, dominios en su allowlist) → **sin re-login**.
- Guard en `(app)/layout.tsx`: la validación H descrita arriba.

### Qué necesita de Clerk real (Paso 4, con vos)
- Agregar los dominios de los deploys nuevos a la instancia de Clerk
  (satellite domains) y cargar `publicMetadata.empresas` a los usuarios.
  Nada de esto se toca hasta entonces.

---

## Validación de la migración 007 (BD efímera)

Ejecutada el 2026-10-01 contra `postgres:17-alpine` efímero (creado y
destruido en la corrida), con el enum y datos estilo Golden (5
empleados en 4 empresas + 3 obligaciones):

- ✓ 007 aplica sin error; columnas quedan `text`.
- ✓ **Datos 100% preservados** (Ana=Golden Talent, Beto=HIT,
  Caro=Poligrafy, Dani=default→Golden Talent, Eli=Otra; las 3
  obligaciones igual).
- ✓ Default de DB conservado (`'Golden Talent'::text`) — un insert sin
  empresa sigue cayendo a Golden Talent, como hoy.
- ✓ Enum eliminado sin dependientes.
- ✓ Catálogo sembrado: BYDSA, **Golden Talent★**(principal), HIT,
  Otra, Poligrafy.
- ✓ La ganancia en vivo: alta de empresa nueva (**Insight360**) con un
  INSERT al catálogo + empleado asignado a ella — sin `ALTER TYPE`,
  sin migración, sin deploy.

---

## ✅ Paso 3 CONSTRUIDO (propuestas aprobadas el 2026-10-01)

Commits `MULTIEMPRESA·P3a/P3b/P3c`. Probado con usuarios simulados
(20/20) — sin Clerk real, sin tocar Golden:

- **Catálogo** (`db/empresas-relacionadas.ts`): el código del enum lee
  de `empresas_relacionadas` con fallback a los labels legacy mientras
  la 007 no esté aplicada (verificado contra Golden real: tabla
  inexistente → los 4 históricos, Golden Talent principal). Tipo
  `EmpresaEmpleadora` → string; `esGolden()`/default = empresa
  principal de la config; selects de UI con opciones por props;
  literales 'Golden Talent' de la lógica intercompany reemplazados.
- **Permisos + guard** (`auth/empresas-acceso.ts` + guard en el
  layout): metadata ausente → modo compat (allowlist decide — Golden
  intacta); presente sin el slug del deploy → fuera (⛔ validado:
  usuario solo-HIT no ve datos de golden). `EMPRESA_SLUG` en config.
- **Selector** (`/empresas`): 1 empresa → directo (local o deploy
  externo, sin re-login); 2+ → tarjetas; 0 → sin acceso. Ítem
  "Cambiar de empresa" en el sidebar solo con 2+ empresas.

## Paso 4 — lo hacés vos despierto (nada de esto se tocó)

1. Revisar la 007 conmigo → moverla a `migrations/` → aplicarla a
   Golden.
2. Clerk real: dominios de los deploys nuevos en la instancia (satellite
   domains) + cargar `publicMetadata.empresas` a los usuarios.
3. Deploys por empresa (bootstrap-empresa.md) con `EMPRESA_SLUG` y las
   env `EMPRESA_*`.
