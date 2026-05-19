# Control Financiero

Sistema operativo de contabilidad con AI integrada. Next.js 15 + TypeScript + Airtable.

Está construido sobre el handoff oficial de Claude Design — código fuente fiel al prototipo, ahora corriendo como una aplicación Next.js real.

---

## Stack

- **Framework**: Next.js 15 (App Router) + TypeScript
- **Estilos**: design tokens del prototipo (CSS variables) + Tailwind para utilidades
- **Backend de datos**: Airtable (con fallback a mock data)
- **AI**: OpenAI GPT-4o (chat) + Google Gemini (insights nocturnos)
- **Charts**: SVG nativo (sin librería pesada)
- **Iconos**: Custom set, estilo Lucide

---

## Setup local (5 minutos)

```bash
# 1. Instalar dependencias
npm install

# 2. Variables de entorno
cp .env.example .env.local
# Editá .env.local con tus keys (Airtable, OpenAI, Gemini)
# Si no las pones, la app corre con mock data automáticamente

# 3. Levantar dev server
npm run dev
```

Abrí http://localhost:3000 — te redirige al Dashboard.

**Atajos:** ⌘K (búsqueda global) · ⌘N (nueva acción) · Esc (cerrar modales)

---

## Deploy a Vercel

```bash
# 1. Push a GitHub
git init && git add . && git commit -m "Initial commit"
git remote add origin git@github.com:TUUSUARIO/control-financiero.git
git push -u origin main

# 2. Importar en vercel.com/new
# 3. Agregar las variables de entorno en Settings → Environment Variables
```

Cada `git push` despliega automáticamente.

---

## Arquitectura

```
src/
├── app/
│   ├── layout.tsx              # Root layout con fonts
│   ├── page.tsx                # Redirect a /dashboard
│   ├── (app)/                  # Grupo de rutas con shell
│   │   ├── layout.tsx          # Sidebar + Topbar + AI Panel + ⌘K
│   │   ├── dashboard/          # Dashboard CFO
│   │   ├── facturacion/        # Listado + detalle
│   │   ├── clientes/           # Listado + cuenta corriente
│   │   ├── cobros/             # Cobros y recibos
│   │   ├── asientos/           # ComingSoon
│   │   ├── estados/            # ComingSoon
│   │   ├── ai/                 # ComingSoon
│   │   └── ...
│   └── api/
│       ├── ai/chat/            # Endpoint streaming GPT-4o (Fase 4)
│       └── cron/insights/      # Cron Gemini (Fase 4)
├── components/
│   ├── shell/                  # Sidebar, Topbar, AI Panel, Command Palette
│   └── common/                 # Icons, ComingSoon, etc.
├── lib/
│   ├── types.ts                # Tipos del dominio
│   ├── utils.ts                # Q(), Qn(), formatDate, cn()
│   ├── mock-data.ts            # Datos del prototipo
│   └── db/                     # ADAPTER — único punto de contacto con Airtable
│       ├── airtable.ts
│       ├── facturas.ts
│       ├── clientes.ts
│       └── cobros.ts
└── hooks/
```

### Adapter pattern para datos

Toda la app lee/escribe datos a través de `src/lib/db/*`. Hoy esas funciones usan Airtable (con fallback a mock). **El día que migres a Postgres/Supabase, solo cambiás esa carpeta — el resto de la app sigue igual.**

```typescript
// Componente UI:
import { getFacturas } from '@/lib/db/facturas';
const facturas = await getFacturas();  // funciona igual con cualquier backend
```

---

## Estado actual (Fase 1 — Portado del prototipo)

### Pantallas funcionales con UI completa
- ✅ **App Shell** (sidebar + topbar + AI panel + command palette)
- ✅ **Dashboard CFO** (KPIs, líneas, alertas, evolución 12m, aging, top deudores)
- ✅ **Listado de Facturas** (tabs, filtros, tabla con aging y estados, bulk selection)
- ✅ **Listado de Clientes** (tabla con cartera y puntualidad)
- ✅ **Cobros** (KPIs + lista de recibos)

### Stubs (Coming Soon)
- ⏳ Detalle de factura
- ⏳ Cuenta corriente de cliente
- ⏳ AI Insights Center
- ⏳ Asientos contables
- ⏳ Estados financieros
- ⏳ Gastos · Bancos · Planilla · Deudas

El código fuente completo de los stubs está en `_prototype-source/screens/` — ahí están las versiones JSX del prototipo originales que podés portar progresivamente.

---

## Roadmap

| Fase | Status | Qué incluye |
|---|---|---|
| **0 Setup** | ✅ Completa | Estructura Next.js, deps, design tokens, fonts |
| **1 Port del prototipo** | 🟡 En curso | Shell completo, Dashboard, Facturas, Cobros, Clientes |
| **2 Airtable real** | ⬜ Pendiente | Reemplazar mock data con queries Airtable |
| **3 CRUD operativo** | ⬜ Pendiente | Crear/editar facturas, registrar cobros, generar asientos |
| **4 AI integrada** | ⬜ Pendiente | Panel AI con GPT-4o streaming + insights nocturnos Gemini |
| **5 Auth + producción** | ⬜ Pendiente | Clerk, roles, dominio propio, logging |

Detalle completo de cada fase en `ROADMAP.md`.

---

## Scripts

```bash
npm run dev       # http://localhost:3000
npm run build     # build de producción
npm run start     # servir build
npm run lint      # ESLint
```

---

## Notas de implementación

### Por qué el CSS está en `globals.css` y no en módulos
El prototipo usa ~80 clases CSS (`.kpi`, `.card`, `.table`, `.aging-seg`, etc.) compartidas entre pantallas. Mantenerlo así nos permite:
1. Portar pantallas del prototipo casi sin tocar markup
2. Refactorizar a CSS Modules o Tailwind progresivamente cuando duela

### Por qué hay `'use client'` en casi todas las pages
Las pantallas tienen state local (filtros, búsqueda, selección). Cuando migremos a Airtable real (Fase 2), vamos a partir cada page en:
- Server Component (data fetching desde `/lib/db`)
- Client Component (interactividad con los datos pre-fetchados)

### Sobre Tailwind
Tailwind está instalado pero la app usa principalmente las clases CSS del prototipo (`globals.css`). Tailwind queda disponible para nuevos componentes. Decisión: cuando agreguemos shadcn/ui en una fase posterior, vamos directo a Sonner para toasts (el `toast` de shadcn está deprecated).

---

## Stark / Equipo

Cualquier cosa que no funcione, abrí un issue o mandame Slack.

**Convención de commits**: `feat: ...`, `fix: ...`, `refactor: ...`, `chore: ...`

**Branch strategy**: feature branches → PR a `main` → merge → deploy automático.
