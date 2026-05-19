# Control Financiero — Roadmap de construcción

> Plan paso a paso para convertir el prototipo de Claude Design en una aplicación real conectada a Airtable, con AI integrada, desplegada en Vercel.

**Tiempo total estimado:** 3-4 semanas trabajando enfocado · 6-8 semanas en paralelo a otras cosas

---

## Resumen de fases

| Fase | Qué hacés | Días | Salida |
|---|---|---|---|
| **0** | Setup del entorno y repo | 1 | Proyecto Next.js en GitHub, deploy automático a Vercel |
| **1** | Portar el prototipo a Next.js | 2-3 | App navegable con datos mock funcionando en Vercel |
| **2** | Conectar Airtable (lectura) | 2-3 | Listado de facturas y clientes mostrando datos reales |
| **3** | CRUD operativo (escritura) | 4-6 | Crear/editar facturas, registrar cobros con persistencia real |
| **4** | Capa AI integrada | 4-6 | Panel AI conversacional + insights nocturnos automáticos |
| **5** | Auth, pulido y producción | 2-3 | Multi-usuario, dominio propio, listo para que tu equipo lo use |

---

## FASE 0 — Setup del entorno (1 día)

### Paso 0.1 — Verificar herramientas
Asegúrate de tener instalado:
```bash
node --version    # debe ser ≥ 20
git --version
```
Si no tienes Node 20+, instalalo desde nodejs.org o con nvm.

### Paso 0.2 — Crear repo en GitHub
1. Andá a github.com/new
2. Nombre: `control-financiero`
3. Privado
4. No agregues README (lo creamos nosotros)
5. Copia la URL del repo (ej: `git@github.com:tuusuario/control-financiero.git`)

### Paso 0.3 — Crear proyecto Next.js
En tu terminal, en la carpeta donde guardas proyectos:
```bash
npx create-next-app@latest control-financiero \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-eslint

cd control-financiero
```

### Paso 0.4 — Instalar dependencias core
```bash
# UI y forms
npm install lucide-react clsx tailwind-merge class-variance-authority
npm install react-hook-form zod @hookform/resolvers
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-toast

# Data fetching y backend
npm install @tanstack/react-query airtable
npm install ai @ai-sdk/openai @ai-sdk/google

# Charts
npm install recharts

# Dates
npm install date-fns
```

### Paso 0.5 — Configurar shadcn/ui
```bash
npx shadcn@latest init
```
Cuando te pregunte, respondé:
- Style: **Default**
- Base color: **Stone** (mas cercano a tu crema)
- CSS variables: **Yes**

Después instalá los componentes que vas a usar:
```bash
npx shadcn@latest add button card input label badge \
  table tabs dialog dropdown-menu select textarea \
  tooltip toast skeleton separator avatar sheet
```

### Paso 0.6 — Conectar a GitHub
```bash
git init
git add .
git commit -m "Initial setup: Next.js + Tailwind + shadcn"
git branch -M main
git remote add origin git@github.com:tuusuario/control-financiero.git
git push -u origin main
```

### Paso 0.7 — Conectar a Vercel
1. Andá a vercel.com/new
2. Importá el repo `control-financiero` desde GitHub
3. Framework preset: **Next.js** (auto-detectado)
4. Click **Deploy**
5. Esperá ~2 min. Te va a dar una URL tipo `control-financiero-xxx.vercel.app`

A partir de ahora **cada `git push` despliega automáticamente** a Vercel.

### Paso 0.8 — Variables de entorno
Creá un archivo `.env.local` en la raíz del proyecto:
```bash
# Airtable
AIRTABLE_API_KEY=patXXXXXXXXXXXX
AIRTABLE_BASE_ID=appXXXXXXXXXXXX

# OpenAI (chat asistente)
OPENAI_API_KEY=sk-XXXXXXXXXXXX

# Google Gemini (insights nocturnos)
GOOGLE_GENERATIVE_AI_API_KEY=AIzaXXXXXXXX

# Clerk (auth — lo configuramos en Fase 5)
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
# CLERK_SECRET_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Para obtener:
- **Airtable token**: airtable.com/create/tokens → "Personal access token" con scopes `data.records:read` y `data.records:write` y acceso a tu base
- **Airtable base ID**: andá a airtable.com/api, seleccioná tu base, el ID empieza con `app...`
- **OpenAI key**: platform.openai.com/api-keys
- **Gemini key**: aistudio.google.com/apikey

**Importante:** después agregá las mismas variables en Vercel (Settings → Environment Variables) para que funcionen en producción.

### Paso 0.9 — Estructura inicial de carpetas
Creá esta estructura dentro de `src/`:
```
src/
├── app/
│   ├── (app)/                  # rutas con shell
│   │   ├── layout.tsx          # sidebar + topbar
│   │   ├── dashboard/page.tsx
│   │   ├── facturacion/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── cobros/page.tsx
│   │   └── clientes/page.tsx
│   ├── api/
│   │   ├── ai/
│   │   │   └── chat/route.ts
│   │   └── cron/
│   │       └── insights/route.ts
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── ui/                     # shadcn primitives (auto)
│   ├── shell/
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx
│   │   └── ai-panel.tsx
│   ├── facturas/
│   ├── cobros/
│   └── clientes/
├── lib/
│   ├── db/                     # ADAPTER — capa de datos
│   │   ├── airtable.ts         # cliente Airtable
│   │   ├── facturas.ts         # CRUD facturas
│   │   ├── cobros.ts
│   │   ├── clientes.ts
│   │   └── types.ts            # TypeScript types
│   ├── ai/
│   │   ├── openai.ts
│   │   ├── gemini.ts
│   │   └── prompts.ts
│   └── utils.ts                # formatters: Q(), formatDate, etc.
└── hooks/
    ├── use-facturas.ts
    └── use-cobros.ts
```

**Al terminar la Fase 0 tenés:** repo en GitHub, app desplegada en Vercel (página default por ahora), entorno listo para empezar a desarrollar.

---

## FASE 1 — Portar el prototipo a Next.js (2-3 días)

### Paso 1.1 — Extraer el código del prototipo
El archivo `Control_Financiero__offline_.html` que generó Claude Design es un bundle. Pídele al asistente Claude Code en VS Code:

> "Tengo este HTML bundleado de Claude Artifacts. Extrae cada componente React (Dashboard, Sidebar, Invoice list, etc.) y guárdalos como archivos .tsx separados en `src/components/`. Convierte el CSS global del template a `globals.css`. Mantén las CSS variables tal cual."

O alternativamente, ya tienes los componentes extraídos (te los puedo pasar limpios si me los pedís).

### Paso 1.2 — Configurar tipografía
En `src/app/layout.tsx`:
```tsx
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-serif" });
const inter = Inter_Tight({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
```
Y aplicá las variables al body.

### Paso 1.3 — Migrar CSS variables a Tailwind
En `tailwind.config.ts` extendé el theme con los colores del prototipo:
```typescript
colors: {
  cream: { DEFAULT: '#F4EFE3', 2: '#EDE6D5', paper: '#FBF7EC' },
  ink: { DEFAULT: '#0E2A24', 2: '#1A3B33', 3: '#4A5A53', 4: '#7A857F' },
  accent: { DEFAULT: '#0E2A24', hover: '#163B33' },
  amber: { DEFAULT: '#B8801C', bg: '#F2E2BD' },
  wine: { DEFAULT: '#8A2A2A', bg: '#EDD0CC' },
  olive: { DEFAULT: '#5A6A2E', bg: '#DCE2C5' },
}
```

### Paso 1.4 — Crear shell layout
`src/app/(app)/layout.tsx` debe renderizar Sidebar + Topbar + main + AI Panel.

### Paso 1.5 — Portar cada pantalla
Una por una:
1. Dashboard → `src/app/(app)/dashboard/page.tsx`
2. Listado facturas → `src/app/(app)/facturacion/page.tsx`
3. Nueva factura (modal) → componente reusable
4. Clientes → `src/app/(app)/clientes/page.tsx`
5. Cobros → `src/app/(app)/cobros/page.tsx`
6. Command palette → componente global con `cmdk` library

### Paso 1.6 — Mock data temporal
Mantené el mock data del prototipo en `src/lib/mock-data.ts` por ahora. Lo reemplazamos por Airtable en Fase 2.

### Paso 1.7 — Test local y deploy
```bash
npm run dev          # probá en localhost:3000
git add . && git commit -m "Port prototype to Next.js"
git push             # Vercel despliega automáticamente
```

**Al terminar Fase 1 tenés:** la app del prototipo funcionando en Vercel con datos mock pero ya con la arquitectura real de Next.js.

---

## FASE 2 — Conectar Airtable (lectura) (2-3 días)

### Paso 2.1 — Setup del cliente Airtable
Creá `src/lib/db/airtable.ts`:
```typescript
import Airtable from 'airtable';

export const airtable = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY!
}).base(process.env.AIRTABLE_BASE_ID!);

export const TABLES = {
  FACTURAS: 'FACTURAS_CLIENTES',
  COBROS: 'COBROS_CLIENTES',
  CLIENTES: 'CLIENTES',
  CENTROS_COSTO: 'CENTROS_COSTO',
  ASIENTOS: 'ASIENTOS',
  PARTIDAS: 'PARTIDAS',
  // ... resto de tablas
} as const;
```

### Paso 2.2 — Definir tipos TypeScript
Creá `src/lib/db/types.ts` con interfaces que reflejen tus tablas reales (FACTURA_ID, FECHA_EMISION, etc.).

### Paso 2.3 — Crear las funciones de lectura
Una por tabla. Ejemplo `src/lib/db/facturas.ts`:
```typescript
import { airtable, TABLES } from './airtable';
import type { Factura } from './types';

export async function getFacturas(filters?: {
  estado?: string;
  centroCosto?: string;
  mes?: string;
}): Promise<Factura[]> {
  const records = await airtable(TABLES.FACTURAS)
    .select({ /* filtros */ })
    .all();
  return records.map(r => mapAirtableToFactura(r));
}

export async function getFactura(id: string): Promise<Factura | null> {
  // ...
}
```

### Paso 2.4 — Server Actions / Route Handlers
Como Next.js App Router, podés usar Server Components o Route Handlers. Para data fetching simple en páginas, usá Server Components directamente (más performante).

`src/app/(app)/facturacion/page.tsx`:
```tsx
import { getFacturas } from '@/lib/db/facturas';
import { FacturasList } from '@/components/facturas/list';

export default async function Page() {
  const facturas = await getFacturas();
  return <FacturasList facturas={facturas} />;
}
```

### Paso 2.5 — Reemplazar mock data progresivamente
Lista de pantallas a migrar (en orden):
1. ✅ Listado de facturas
2. ✅ Detalle de factura
3. ✅ Listado de clientes
4. ✅ Cuenta corriente de cliente
5. ✅ Listado de cobros
6. ✅ Dashboard (KPIs agregados)

### Paso 2.6 — Cache y revalidation
Usá `revalidate` o `unstable_cache` de Next.js para no machacar la API de Airtable.

**Al terminar Fase 2 tenés:** todas tus pantallas mostrando datos reales de Airtable. Aún no podés crear/editar — solo leer.

---

## FASE 3 — CRUD operativo (4-6 días)

### Paso 3.1 — Server Actions para mutaciones
Creá funciones de escritura en `src/lib/db/facturas.ts`:
```typescript
'use server';

export async function createFactura(data: NewFacturaInput) {
  // validación con Zod
  // escribir a Airtable
  // generar asiento contable automáticamente
  // revalidar paths
  return { success: true, id: ... };
}
```

### Paso 3.2 — Formulario "Nueva factura" conectado
Usá React Hook Form + Zod para validación. Submit llama la Server Action.

### Paso 3.3 — Optimistic updates con TanStack Query
Para que las mutaciones se sientan instantáneas, configura TanStack Query con optimistic updates.

### Paso 3.4 — Registrar cobro
Pantalla con selector de cliente → muestra facturas con saldo → checkboxes para aplicar pago.

### Paso 3.5 — Anular factura
Soft delete (cambiar ESTADO a "ANULADO"), no hard delete.

### Paso 3.6 — Generación automática de asientos
Cuando una factura pasa a CONTABILIZADO, generar automáticamente el asiento en tablas ASIENTOS + PARTIDAS según la lógica de tu MD:
- Débito: 1-1-3-1 CxC Clientes Nacionales
- Crédito: cuenta ingresos del centro de costo
- Crédito: 2-1-5 IVA por Pagar

**Al terminar Fase 3 tenés:** sistema operativo completo. Tu equipo puede dejar de usar Airtable directamente y empezar a usar tu app.

---

## FASE 4 — Capa AI integrada (4-6 días)

### Paso 4.1 — Panel AI conversacional
Usá Vercel AI SDK con OpenAI GPT-4o. Streaming nativo.

`src/app/api/ai/chat/route.ts`:
```typescript
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export async function POST(req: Request) {
  const { messages, context } = await req.json();
  
  const result = streamText({
    model: openai('gpt-4o'),
    system: `Sos el asistente CFO de Stark. Contexto: ${context}`,
    messages,
    tools: {
      getFacturas: { /* function calling */ },
      getCobros: { /* */ },
      simulateScenario: { /* */ },
    }
  });
  
  return result.toDataStreamResponse();
}
```

### Paso 4.2 — Function calling tools
El AI debe poder consultar datos reales:
- `get_facturas(estado, cliente, fecha)`
- `get_cobros(periodo)`
- `get_kpis(periodo)`
- `get_aging()`
- `simulate_scenario(cambios)` — qué pasa si despido N personas
- `generate_report(tipo, periodo)` — genera artifact

### Paso 4.3 — Insights nocturnos con Gemini
Cron job de Vercel que corre cada noche y genera 3-5 insights priorizados.

`src/app/api/cron/insights/route.ts`:
```typescript
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';

export async function GET() {
  // 1. Pull data de Airtable
  const kpis = await getCurrentKPIs();
  
  // 2. Generar insights con Gemini
  const { object: insights } = await generateObject({
    model: google('gemini-2.0-flash-exp'),
    schema: z.object({
      insights: z.array(z.object({
        severity: z.enum(['critical', 'warning', 'info']),
        title: z.string(),
        narrative: z.string(),
        suggestedAction: z.string(),
      }))
    }),
    prompt: `Analizá estos KPIs y generá 3-5 insights priorizados: ${JSON.stringify(kpis)}`,
  });
  
  // 3. Guardar en Airtable tabla INSIGHTS (creala)
  await saveInsights(insights);
  
  return Response.json({ ok: true, count: insights.length });
}
```

Configurar `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/insights",
    "schedule": "0 23 * * *"
  }]
}
```

### Paso 4.4 — Mostrar insights en la UI
- Badge rojo en sidebar si hay insights críticos sin leer
- Cards en Dashboard con los 3 más recientes
- Pantalla AI Insights Center con todos

### Paso 4.5 — Proyecciones / What-if
Pantalla dedicada con sliders interactivos. Cada cambio invoca al AI para calcular impacto en cash flow.

**Al terminar Fase 4 tenés:** la app con su diferenciador real — un CFO virtual integrado que detecta problemas, contesta preguntas y simula escenarios.

---

## FASE 5 — Auth, pulido y producción (2-3 días)

### Paso 5.1 — Autenticación con Clerk
```bash
npm install @clerk/nextjs
```
Configurar middleware, login page, protected routes.

### Paso 5.2 — Roles básicos
Permisos por rol (CFO, cobranza, contador, viewer). Almacenar en metadata de Clerk.

### Paso 5.3 — Logging y auditoría
Cada mutación (crear factura, anular, registrar cobro) guarda quién y cuándo.

### Paso 5.4 — Dominio propio
Comprar dominio (controlfinanciero.com.gt o similar). Conectar en Vercel.

### Paso 5.5 — Onboarding
Pantalla de bienvenida la primera vez. Tutorial corto opcional.

### Paso 5.6 — Documentación
README con cómo correr local, deploy, troubleshooting.

**Al terminar Fase 5 tenés:** una aplicación SaaS interna lista para uso productivo de tu equipo, con auditoría, multi-usuario, dominio propio.

---

## Después de la Fase 5

### Optimizaciones futuras
- Migrar de Airtable a Supabase (cuando crezca el volumen)
- App móvil (React Native o expo)
- Integraciones: bot Telegram para alertas, webhooks SAT, integración bancos
- Estados financieros automáticos (P&L, Balance General)
- Modulo de planilla completo
- Modulo de deudas con calendario de pagos

---

## Reglas de oro durante el desarrollo

1. **Commit frecuente, push diario.** Cada feature funcional = 1 commit. Cada día termina con un push exitoso.
2. **Adapter pattern en /lib/db.** Toda lectura/escritura pasa por ahí. Cuando migres de Airtable a Supabase, solo tocas esa carpeta.
3. **Server Components por default.** Solo usá Client Components cuando necesites interactividad o hooks.
4. **TypeScript estricto.** No uses `any`. Si algo no tiene tipo, créalo.
5. **Validación con Zod en toda entrada de usuario.** Sin excepciones.
6. **Mock data sigue existiendo en desarrollo.** Para no depender de internet siempre.
7. **Errores explícitos al usuario.** Si Airtable falla, decile qué pasó y cómo intentarlo de nuevo.
8. **Cada Server Action debe revalidar el path correcto** o la UI se queda stale.

---

## Comandos útiles para tener a mano

```bash
# Desarrollo
npm run dev                # localhost:3000

# Calidad
npm run build              # verifica que compila sin errores
npm run lint

# Git
git status
git add . && git commit -m "..." && git push

# Vercel
vercel logs                # ver logs de producción
vercel env pull            # bajar env vars de Vercel a local

# shadcn — agregar componente
npx shadcn@latest add <nombre>
```

---

**Versión:** 1.0  
**Próxima revisión:** al terminar Fase 1
