# Control Financiero · Roadmap vivo

> Documento de planificación del producto. Se actualiza en cada decisión, no al final. Si una conversación produjo una decisión nueva — incluso pequeña — va acá.

**Última actualización:** 2026-05-20 (F-006 + F-006b done)
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
- **Status:** ✅ Done
- **Tamaño:** L
- **Brief:** Formulario para registrar factura (la emite SAT/FEL; acá se registra). Autocomplete de cliente, editor de líneas multi-CC, IVA incluido extraído del total (modelo Guatemala), validación Zod, escritura en Airtable (una fila por línea, mismo NO.FACTURA). El asiento contable automático queda para después.
- **Dependencias:** F-001
- **Progreso:**
  - ✅ Formulario de registro funcionando (escritura real verificada: TOTAL/IVA/SUBTOTAL cuadran contra SAT). Inputs de monto fluidos (uncontrolled + cálculo en onBlur).
  - ✅ **F-006b — Adjuntar PDF de factura SAT** — Solo respaldo (sin OCR), de a una, PDF, al campo `ADJUNTO ` de Airtable vía Content API. Opcional, máx 5MB; si el upload falla la factura igual se registra.

### F-007 · Registrar cobro contra facturas 🔥 PRIORIDAD MÁXIMA
- **Fase:** 3
- **Status:** 🟡 **EN CURSO** · **🔥 PRIORIDAD MÁXIMA**
- **Tamaño:** L
- **Brief:** Modal que selecciona cliente → muestra sus facturas → checkboxes para aplicar el cobro a una o varias facturas (incluye líneas de una factura multi-línea). Aplicación FIFO automática o manual. Generar asiento Banco/CxC automático.
- **Por qué máxima prioridad:** es la razón de ser del producto. El negocio cobra bien (~91%), pero **no logra registrar los cobros** en Airtable porque aplicarlos a facturas multi-línea es demasiado complejo. Resolver esto reemplaza el dolor central de la contadora.
- **Dependencias:** F-001 (la consolidación multi-línea es lo que habilita aplicar un cobro a las líneas correctas). F-004 ayuda pero no bloquea.
- **Progreso:**
  - ✅ **Parte C — Identificador de cobros por monto (solo lectura)** _(2026-05-20)_ — Conciliación inversa: dado el monto de un depósito, sugiere la factura individual exacta + el cliente cuyas facturas abiertas suman ese monto. Busca contra `total` (TOTAL con IVA), tolerancia ajustable (Exacto / ±Q1 / ±Q10 / ±Q100 / ±1%). En `/cobros/identificar`. No escribe nada.
  - ⬜ **Parte A — Registro directo (escritura)** — aplicar el cobro y persistirlo en Airtable (+ asiento Banco/CxC).
  - ⬜ **Matching de combinaciones** (futuro) — sugerir subconjuntos de facturas que sumen el monto, no solo cliente completo o factura individual.

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
- ~~Investigar los ~Q384K en saldos negativos~~ **(OBSOLETO — ya no usamos `Saldo_Por_Cobrar`)**
- ~~Alinear tasa de cobranza global del Dashboard (neto vs bruto)~~ **(OBSOLETO — tasa real ~91% por `ESTADO`)**
- **Mini-indicador opcional de anulaciones** (Q286K · 81 facturas) como control de proceso en el Dashboard
- **Backfill histórico de los ~445 cobros no registrados** en `COBROS_CLIENTES` (opcional, datos pasados). Habilita conciliación y reportes históricos, pero no bloquea la operación diaria
- **Auto-extracción de datos del PDF/XML** para pre-llenar el form de registro (OCR/parseo del FEL) — el salto grande de productividad sobre F-006b
- **Adjuntar PDF a facturas ya existentes** — desde el detalle de factura (cuando se construya F-005)

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
| 2026-05-19 | ~~El SALDO real (`Saldo_Por_Cobrar`) manda sobre el campo `ESTADO`~~ **(REVERTIDA — ver decisión FINAL abajo)** | Se creyó que ESTADO no era confiable porque 483 COBRADO tenían saldo > 0. Resultó al revés: el `Saldo_Por_Cobrar` está roto y ESTADO es la verdad |
| 2026-05-19 | ~~Dashboard reporta cartera BRUTA (Q1.99M, saldos > 0); negativos ~Q384K aparte~~ **(REVERTIDA — ya no se usa `Saldo_Por_Cobrar`)** | Dependía del saldo roto; sin efecto tras la decisión final |
| 2026-05-19 | "Facturado" excluye ANULADO y REFACTURADO: facturación válida = EMITIDA + PENDIENTE + COBRADO = Q2.76M. El bruto con anuladas (Q3.04M) NO se reporta como facturación | Las facturas anuladas/refacturadas no son ingreso válido; reportarlas inflaría la facturación |
| 2026-05-19 | Los KPIs de cartera usan TOTAL con IVA (no el subtotal) | La cartera por cobrar real incluye el IVA que el cliente debe pagar |
| 2026-05-19 | **DECISIÓN FINAL: el `ESTADO` es la fuente de verdad** (replica la fórmula de `Estatus_Cobranza`). `COBRADO` = dinero recibido. `Saldo_Por_Cobrar` NO se usa para clasificar. Balance de EMITIDA = su TOTAL completo | Stark confirmó los `COBRADO` contra el banco: el dinero entró. Los cobros no están en `COBROS_CLIENTES` porque aplicarlos en Airtable con facturas multi-línea es demasiado complejo — por eso el saldo quedó desactualizado, no porque no se haya cobrado |

---

## 🎓 Aprendizajes / Cosas que sabemos del negocio

Contexto del dominio que va saliendo en conversaciones y no queremos perder.

- Las facturas pueden ser multi-línea para distribuir entre centros de costo. Tu contadora actualmente lo hace duplicando el NO.FACTURA en Airtable — esto se resuelve en F-001/F-006.
- TalentTrack NO está en 0% de cobranza (ese dato era ruido del campo). Por `ESTADO` (la verdad), la cobranza global del negocio es **~91%**. (La cifra intermedia de "~39%" venía del `Saldo_Por_Cobrar` roto — descartada.)
- Polígrafo lidera salud con 49.4% de cobranza — replicable a TalentTrack.
- Top deudor: FUNDACION GENESIS EMPRESARIAL concentra Q294K, de los cuales Q246K +90 días. El contacto no responde correos desde abril.
- 5 clientes concentran Q733K en aging +90 días.
- Centros de costo en Airtable: "Polígrafo", "Socioeconómico", "TalentTrackAI", "Ventas" (verificar mapeo exacto).
- Cobranza de mayo va 18% por debajo de marzo.
- La cartera real por cobrar es **Q252,684** (37 vencidas + 51 por cobrar), clasificando por `ESTADO`. La cifra previa de "Q1.99M / 592 facturas / 434 vencidas" venía del `Saldo_Por_Cobrar` roto y quedó **descartada**. La tasa de cobranza real es ~91%.
- El `Saldo_Por_Cobrar` de Airtable está desactualizado y NO se usa (ni para clasificar ni para montos). El balance de una factura EMITIDA se toma como su TOTAL completo. (Esto archiva la duda previa de los "~Q384K en saldos negativos": era un artefacto del campo roto.)
- **APRENDIZAJE CRÍTICO — la razón de ser de la plataforma:** el problema del negocio NO es la cobranza (~91% real, el dinero entra). El problema es el **REGISTRO de cobros**: aplicar cobros en Airtable con facturas multi-línea es tan complejo que la contadora dejó de hacerlo, y por eso el saldo quedó roto. Es un problema de herramienta, no de cobranza. Resolver el registro fácil de cobros es el core del producto.

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
- **Calibración de cartera** _(2026-05-19)_ — Iteramos varias fórmulas de clasificación. **Conclusión final: el `ESTADO` manda** (replica `Estatus_Cobranza`); el `Saldo_Por_Cobrar` está roto y se descartó. Cartera real **Q252,684 / 37 vencidas**, cobranza ~91%. Tab "Pendientes" agregado al listado.
- **F-002 · Dashboard CFO con datos reales** _(2026-05-19)_ — Datos reales de Airtable. Cifras finales (por `ESTADO`): Facturado Q2,759,846 (excluye anuladas/refacturadas), Cobrado Q2,507,161, Por cobrar Q252,684, 37 vencidas, tasa de cobranza 90.8%.
- **F-006 · Registrar factura** _(2026-05-20)_ — Primera feature de ESCRITURA. Formulario multi-línea, IVA incluido extraído del total (modelo Guatemala), inputs de monto fluidos (uncontrolled + onBlur), aviso en vivo si el NO.FACTURA ya existe (query puntual), escritura por línea con mismo NO.FACTURA (consolidateRecords las junta al leer). Verificado contra SAT.
- **F-006b · Adjuntar PDF de factura SAT** _(2026-05-20)_ — Respaldo PDF (sin OCR) al campo `ADJUNTO ` del record principal vía Airtable Content API. Opcional, máx 5MB, con drag-and-drop además de click; no rompe el registro si el upload falla.
