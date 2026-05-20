# Control Financiero · Roadmap vivo

> Documento de planificación del producto. Se actualiza en cada decisión, no al final. Si una conversación produjo una decisión nueva — incluso pequeña — va acá.

**Última actualización:** 2026-05-19
**Mantenedor:** Stark
**Estado global:** Fase 1 ✅ · Fase 2 🟡 en curso

---

## 🎯 Visión

Sistema operativo de contabilidad con AI integrada, que reemplaza a Airtable como cockpit diario del negocio. Multi-línea (Polígrafo, Socioeconómico, TalentTrack, Ventas), en quetzales, español 100%. La diferencia con cualquier ERP genérico es la **capa de AI**: un asistente que detecta problemas, sugiere acciones y proyecta el futuro del negocio.

## 👥 Usuarios

- **Stark (CFO)** — toma decisiones diarias sobre cobranza, gastos, planilla, deuda
- **Cobranza** — persigue clientes morosos
- **Contabilidad** — genera asientos, concilia bancos, cierra periodos
- **CEO / Junta** — consume dashboards mensuales

---

## 📍 Fases del proyecto

| # | Fase | Estado | Resultado |
|---|---|---|---|
| 0 | Setup técnico | ✅ Done | Next.js 15 + TS + Tailwind, repo GitHub, deploy Vercel |
| 1 | Port del prototipo | ✅ Done | Shell + Dashboard + Facturación + Cobros + Clientes navegables |
| 2 | Conexión Airtable | 🟡 In progress | Listado de facturación leyendo datos reales (consolidación multi-línea OK) |
| 3 | CRUD operativo | ⬜ Pendiente | Crear/editar facturas, registrar cobros, generar asientos automáticos |
| 4 | Capa AI | ⬜ Pendiente | Chat GPT-4o streaming + insights nocturnos Gemini + what-if |
| 5 | Auth y producción | ⬜ Pendiente | Clerk + roles + dominio propio + logging |

Detalle por fase abajo en la sección **Features**.

---

## 🟢 Features priorizadas (qué viene)

Cada feature tiene **brief, fase, status, tamaño, dependencias**. Cuando una entra en construcción, sube su status. Cuando se termina, se mueve a la sección **Completadas** abajo.

### F-001 · Consolidar facturas multi-línea
- **Fase:** 2
- **Status:** ✅ Done
- **Tamaño:** S
- **Brief:** Una factura física puede tener múltiples líneas con distintos centros de costo. Airtable las modela como filas duplicadas con el mismo NO.FACTURA. Consolidar en una sola Invoice con `lineas: InvoiceLine[]`. Indicador visual en el listado cuando es mixta.
- **Resultado:** El listado muestra facturas reales (no filas técnicas). Tab "Todas" debe dar < 854.

### F-002 · Dashboard CFO con datos reales
- **Fase:** 2
- **Status:** ✅ Done
- **Tamaño:** M
- **Brief:** Hoy el Dashboard renderiza mock-data. Reemplazar por queries reales a Airtable: KPIs del mes (facturado, cobrado, por cobrar, vencido +90, flujo neto, margen), evolución 12 meses, top 5 deudores, distribución por línea, aging real. Calcular agregados en el server para que cargue rápido.
- **Dependencias:** F-001

### F-003 · Cuenta corriente del cliente (detalle)
- **Fase:** 2
- **Status:** ⬜ Pendiente
- **Tamaño:** M
- **Brief:** Página de detalle del cliente con sus facturas abiertas, cobros aplicados, saldo histórico, aging propio y promedio de días de pago. Portar el componente `CustomerDetail` del `_prototype-source/`.
- **Dependencias:** F-001

### F-004 · Cobros con datos reales
- **Fase:** 2
- **Status:** ⬜ Pendiente
- **Tamaño:** S
- **Brief:** Listado de cobros leyendo COBROS_CLIENTES de Airtable, con relación a las facturas a las que aplica. KPIs del mes: cobrado total, recibos del mes, conciliación pendiente.

### F-005 · Detalle de factura con líneas y asiento
- **Fase:** 2
- **Status:** ⬜ Pendiente
- **Tamaño:** M
- **Brief:** Portar la pantalla `InvoiceDetail` del prototipo. Mostrar timeline (Emitida → Contabilizada → Cobrada), las líneas con sus centros de costo y montos, el asiento contable generado (cuentas debe/haber), cobros aplicados, AI tip contextual.

### F-006 · Nueva factura con editor de líneas
- **Fase:** 3
- **Status:** ⬜ Pendiente
- **Tamaño:** L
- **Brief:** Formulario para crear factura con autocomplete de cliente y editor de líneas multi-CC (NO más duplicación manual). Validación con Zod. Al guardar: escribir múltiples filas en Airtable (una por línea) o consolidar en una si Airtable lo permite con un campo MultiSelect. Generar asiento contable automático.
- **Dependencias:** F-001, F-005

### F-007 · Registrar cobro contra facturas
- **Fase:** 3
- **Status:** ⬜ Pendiente
- **Tamaño:** L
- **Brief:** Modal que selecciona cliente → muestra sus facturas con saldo → checkboxes para aplicar el cobro a una o varias facturas. Aplicación FIFO automática o manual. Generar asiento Banco/CxC automático.
- **Dependencias:** F-004

### F-008 · AI Chat conversacional con function calling
- **Fase:** 4
- **Status:** ⬜ Pendiente
- **Tamaño:** L
- **Brief:** Panel AI lateral conectado a GPT-4o streaming via Vercel AI SDK. Tools: get_facturas, get_cobros, get_kpis, get_aging, simulate_scenario, generate_report. Context-aware según pantalla activa.

### F-009 · Insights nocturnos con Gemini
- **Fase:** 4
- **Status:** ⬜ Pendiente
- **Tamaño:** M
- **Brief:** Cron job Vercel a las 23:00 GT. Gemini 2.0 analiza KPIs del día y genera 3-5 insights priorizados con severidad (critical/warning/info), narrativa y acción sugerida. Se guardan en tabla AI_INSIGHTS de Airtable y aparecen como badges en sidebar + cards en dashboard.

### F-010 · What-if / Proyecciones
- **Fase:** 4
- **Status:** ⬜ Pendiente
- **Tamaño:** M
- **Brief:** Pantalla con sliders interactivos: "¿Qué pasa si despido 3 personas?", "¿Qué pasa si subo precios 10%?", "¿Qué pasa si cobro X% más rápido?". Forecast de cash flow 30/60/90 días basado en facturas vivas + deudas + planilla.

### F-011 · Auth con Clerk + roles
- **Fase:** 5
- **Status:** ⬜ Pendiente
- **Tamaño:** M
- **Brief:** Login con Clerk. Roles: CFO (todo), cobranza (solo facturación/cobros), contabilidad (asientos/estados), viewer (read-only). Auditoría de mutaciones (quién hizo qué cuándo).

### F-012 · Deploy a producción con dominio propio
- **Fase:** 5
- **Status:** ⬜ Pendiente
- **Tamaño:** S
- **Brief:** Cuando el sistema esté maduro (después de F-006 mínimo). Decidir entre Vercel Pro / Cloudflare Pages. Dominio propio. Variables de producción en env vars.

---

## 💡 Ideas / Backlog (sin priorizar)

Cosas que se han mencionado y queremos no olvidar. Suben a Features priorizadas cuando decidimos abordarlas.

- **Conciliación bancaria** — match automático de cobros vs movimientos bancarios
- **Estados financieros automáticos** — P&L, Balance General, Flujo de Caja desde asientos
- **Recordatorios automáticos** de cobranza por email/WhatsApp a clientes vencidos
- **Bot de Telegram** para CFO (alertas, consultas rápidas)
- **Generación de PDF** de facturas y estados de cuenta
- **Carga masiva de gastos** desde CSV / OCR de facturas
- **Módulo de planilla** completo (32 colaboradores)
- **Módulo de deudas** con calendario de pagos
- **App móvil** (React Native o Expo)
- **Integración bancaria** vía API (Banrural, BAC)
- **Webhooks SAT** para factura electrónica
- **Reportes ejecutivos** mensuales auto-generados para junta
- **Multi-empresa** si llega a haber otra entidad
- **Dark mode**
- **Investigar los ~Q384K en saldos negativos** — distinguir sobrepagos vs notas de crédito vs errores de captura en Airtable
- **Alinear tasa de cobranza global del Dashboard** — hoy 41.5% (neto); decidir si pasa a ~28% (bruto) para coherencia con la cartera bruta. PENDIENTE de decisión de Stark
- **Mini-indicador opcional de anulaciones** (Q286K · 81 facturas) como control de proceso en el Dashboard

---

## 📝 Decisiones técnicas tomadas

Bitácora de decisiones de arquitectura. Cuando se toma una decisión nueva, se agrega acá con fecha.

| Fecha | Decisión | Por qué |
|---|---|---|
| 2026-05-19 | Stack: Next.js 15 + App Router + TS + Tailwind | Necesitamos Server Actions para AI APIs, deploy Vercel nativo, cron jobs |
| 2026-05-19 | Airtable como backend temporal | Stark ya tiene 854 facturas, 178 cobros y catálogos ahí. Migrar más adelante a Postgres/Supabase |
| 2026-05-19 | Adapter pattern en `/lib/db` | Cuando migremos backend, solo cambiamos esa carpeta |
| 2026-05-19 | OpenAI GPT-4o para chat, Gemini 2.0 para insights | GPT-4o tiene mejor function calling para chat; Gemini es más barato + contexto enorme para análisis de tablas |
| 2026-05-19 | Sonner para toasts (no `toast` de shadcn) | shadcn deprecó `toast` |
| 2026-05-19 | No usar shadcn/ui por ahora | El prototipo trae sus propios design tokens; agregamos shadcn solo cuando necesitemos componentes complejos |
| 2026-05-19 | Pausar deploy a Vercel hasta tener Airtable + Auth | El Hobby de Vercel tiene Deployment Protection que da problemas; mejor deployar cuando esté maduro |
| 2026-05-19 | Modelo: factura tiene `lineas[]` (multi-línea) | Resolver duplicados de NO.FACTURA causados por necesidad de separar centros de costo |
| 2026-05-19 | El SALDO real (`Saldo_Por_Cobrar`) manda sobre el campo `ESTADO` para clasificar cartera | El campo ESTADO no es confiable: 483 facturas con ESTADO=COBRADO tenían saldo > 0. Solo se respetan estados administrativos (ANULADO, REFACTURADO, PENDIENTE) |
| 2026-05-19 | Dashboard reporta cartera BRUTA (Q1.99M, saldos > 0) como "Por cobrar"; los saldos negativos (~Q384K) se muestran aparte como pasivo (saldos a favor de clientes), NO se netean | El neteo escondería tanto la cartera real por cobrar como el pasivo con clientes; mostrarlos separados refleja mejor la realidad financiera |
| 2026-05-19 | "Facturado" excluye ANULADO y REFACTURADO: facturación válida = EMITIDA + PENDIENTE + COBRADO = Q2.76M. El bruto con anuladas (Q3.04M) NO se reporta como facturación | Las facturas anuladas/refacturadas no son ingreso válido; reportarlas inflaría la facturación |
| 2026-05-19 | Los KPIs de cartera usan TOTAL con IVA (no el subtotal) | La cartera por cobrar real incluye el IVA que el cliente debe pagar |

---

## 🎓 Aprendizajes / Cosas que sabemos del negocio

Contexto del dominio que va saliendo en conversaciones y no queremos perder.

- Las facturas pueden ser multi-línea para distribuir entre centros de costo. Tu contadora actualmente lo hace duplicando el NO.FACTURA en Airtable — esto se resuelve en F-001/F-006.
- TalentTrack: el dato de "0% de cobranza" venía del mapeo viejo por campo `ESTADO` y era falso. Con saldo real su tasa es **~39%** (Q858,966 facturado / Q335,357 cobrado, 74 líneas). Sigue por debajo de Polígrafo (45.8%) pero no está en cero.
- Polígrafo lidera salud con 49.4% de cobranza — replicable a TalentTrack.
- Top deudor: FUNDACION GENESIS EMPRESARIAL concentra Q294K, de los cuales Q246K +90 días. El contacto no responde correos desde abril.
- 5 clientes concentran Q733K en aging +90 días.
- Centros de costo en Airtable: "Polígrafo", "Socioeconómico", "TalentTrackAI", "Ventas" (verificar mapeo exacto).
- Cobranza de mayo va 18% por debajo de marzo.
- La cartera real del negocio es **Q1.99M en 592 facturas con saldo > 0**. El diagnóstico inicial era correcto; el mapeo por campo `ESTADO` la había enmascarado (clasificaba 483 facturas como cobradas pese a tener saldo pendiente).
- Existen **~Q384K en saldos negativos** (saldos a favor de clientes / sobrepagos). Se reportan como pasivo aparte, no se netean contra la cartera por cobrar. Pendiente investigar su origen (ver Backlog).
- **434 facturas vencidas reales** (no 37, como sugería el mapeo viejo por campo `ESTADO`). Al clasificar por saldo + días vencidos, la cartera vencida real saltó de 37 a 434. El diagnóstico inicial era correcto.

---

## 🔀 Cómo usar este documento

1. **Antes de cada sesión:** abrir este archivo, ver qué feature está activa, qué brief seguir.
2. **Cuando aparece una idea:** sumala al **Backlog**. No la implementes ahí mismo si no estaba planificada.
3. **Cuando se toma una decisión técnica:** anotala en **Decisiones técnicas** con fecha.
4. **Cuando se descubre algo del negocio:** sumalo a **Aprendizajes**.
5. **Cuando una feature pasa de status:** actualizá su estado y la fecha de "Última actualización" del documento.
6. **Cuando una feature se completa:** moverla a una sección "✅ Completadas" al final (no la borres — sirve de bitácora).

---

## ✅ Completadas

_Acá se mueven las features cuando llegan a Done. Sirve para tener una bitácora de qué se construyó cuándo._

- **F-001 · Consolidar facturas multi-línea** _(2026-05-19)_ — Resuelto duplicados por NO.FACTURA agrupando en `Invoice.lineas[]`.
- **Calibración de cartera** _(2026-05-19)_ — `Saldo_Por_Cobrar` manda sobre el campo `ESTADO` para clasificar cartera. Cartera real Q1.98M / 434 vencidas. Tab "Pendientes" agregado al listado. Endpoints temporales de diagnóstico removidos.
- **F-002 · Dashboard CFO con datos reales** _(2026-05-19)_ — Validado contra Airtable: Facturado Q2,759,846 (excluye anuladas/refacturadas), Por cobrar Q1,984,152, 434 facturas vencidas. Reconciliación exacta confirmada.
