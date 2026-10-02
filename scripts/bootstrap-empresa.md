# Bootstrap "nueva empresa" — procedimiento guiado (FASE MOLDE · Pieza 4)

Cómo abrir una empresa nueva con finanzas SEPARADAS: su propia base
Supabase + su propio deploy en Vercel, compartiendo este código.
**Ningún paso corre solo — cada uno lo ejecutás vos, consciente.**

> Tiempo estimado: ~30 min. Prerrequisitos: acceso a supabase.com y
> vercel.com de la organización, y este repo actualizado en `main`.

---

## Paso 1 — Crear la base Supabase (manual, ~5 min)

1. En [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
   - Organización: la del grupo. Nombre: `cf-<empresa>` (ej. `cf-hit`).
   - Región: `us-west-2` (la de Golden) u otra cercana. Guardá el **database password**.
2. Del proyecto nuevo anotá:
   - `SUPABASE_URL` → Settings → API → Project URL.
   - `SUPABASE_SERVICE_KEY` → Settings → API → `service_role` (¡secreto!).
   - **Connection string directa** → Settings → Database → Connection string
     (URI, puerto 5432) — la necesita el runner de migraciones.
3. **Storage**: creá el bucket `adjuntos` como **público** (Storage → New
   bucket). Las carpetas (`facturas/`, `boletas/`, `constancias/`,
   `firmas/`, `facturas-in/`) se crean solas al primer upload.

## Paso 2 — Migraciones (runner, ~2 min)

```bash
# dry-run primero (no toca nada, lista lo que haría):
npx tsx scripts/migrar-todas.ts --db 'postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'

# aplicar de verdad:
npx tsx scripts/migrar-todas.ts --db '<misma url>' --aplicar
```

Esperado: `✓ 001…006` (6 migraciones). El runner lleva registro en
`_migraciones` — re-correrlo dice "0 pendientes".

## Paso 3 — Seed del plan de cuentas (~1 min)

```bash
npx tsx scripts/migrar-todas.ts --db '<misma url>' --aplicar \
  --seed supabase/seeds/seed_plan_cuentas_base.sql
```

Esperado: 245 cuentas, 6 centros de costo, mapeos ER/BS. Es idempotente:
si `cuentas` ya tiene datos, avisa y no toca nada.

⚠ **Revisar después del seed** (decisiones por empresa):
- Las 6 cuentas marcadas ⚠ en el seed (intercompany HIT/Poligrafy/BYDSA
  y similares) — ¿aplican a esta empresa? Desactivarlas (`activo=false`)
  o renombrarlas desde el creador de cuentas.
- Los centros de costo son las líneas de Golden — crear las líneas
  reales de la empresa en `/admin/catalogos` y desactivar las que sobren.

## Paso 4 — Deploy en Vercel (manual, ~10 min)

1. Vercel → **Add New → Project** → importar este mismo repo GitHub.
   - Nombre del proyecto: `cf-<empresa>`.
2. **Environment Variables** (copiar de Golden y cambiar lo marcado):

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | 🔁 la del proyecto nuevo (paso 1) |
   | `SUPABASE_SERVICE_KEY` | 🔁 la del proyecto nuevo |
   | `NEXT_PUBLIC_APP_URL` | 🔁 `https://cf-<empresa>.vercel.app` (o dominio propio) |
   | `GOOGLE_GENERATIVE_AI_API_KEY` | igual que Golden (o key propia para separar costos de Auros) |
   | `OPENAI_API_KEY` | igual que Golden (OCR de facturas) |
   | `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_*` | ⚠ decidir: mismo tenant Clerk (mismos usuarios en todas) o app Clerk nueva por empresa |
   | `ALLOWED_EMAILS` / `ALLOWED_DOMAIN` | 🔁 quiénes entran a ESTA empresa |
   | `CRON_SECRET` | generar uno nuevo (`openssl rand -hex 24`) |

3. Deploy. Identidad de la empresa (construida en la fase multi-empresa):
   `NEXT_PUBLIC_EMPRESA_NOMBRE` (nombre — PUBLIC: los componentes cliente
   lo necesitan), `EMPRESA_SLUG` (permisos del selector), y las server-only
   `EMPRESA_NOMBRE_LEGAL`, `EMPRESA_NIT`, `EMPRESA_DIRECCION`,
   `EMPRESA_DESCRIPCION`, `EMPRESA_DUENO`, `EMPRESA_ES_GRUPO`,
   `EMPRESA_LOGO_URL`. Sin estas vars el deploy se viste de Golden.

## Paso 5 — Verificaciones de que quedó lista (~5 min)

- [ ] `/<app>/dashboard` abre sin errores (vacío es lo esperado).
- [ ] `/admin/catalogos` muestra 245 cuentas y el creador de cuentas navega el árbol.
- [ ] `/reportes/estado-resultados` abre y dice "contabilidad arrancando" (sin datos, sin crash).
- [ ] Crear un cliente de prueba en `/clientes` → aparece como "Nuevo".
- [ ] Emitirle una factura de prueba → aparece en `/facturacion` y en pendientes de cobro.
- [ ] Registrar el cobro de esa factura (con constancia PDF de prueba → verifica el bucket `adjuntos`).
- [ ] Anular la factura de prueba (histórico limpio; "no se borra, se anula").
- [ ] Auros responde "¿cuánto facturamos este mes?" con el dato de la prueba.

## Registrar la empresa en el runner

Agregar la base a `scripts/empresas.json` (en local, sin commitear
credenciales) para que los futuros cambios de schema lleguen con:

```bash
npx tsx scripts/migrar-todas.ts --aplicar
```
