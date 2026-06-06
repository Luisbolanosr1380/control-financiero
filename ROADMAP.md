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
- **Módulo de Cuentas por Cobrar históricas / recuperación de cartera** — registrar deudas de clientes que nunca se facturaron (hoy "en la mente", sin registro formal), formalizarlas como CxC y registrar sus abonos/cobros mensuales. **CLAVE: mantenerlo FUERA de los ingresos operativos y del análisis de líneas/churn** — es recuperación de cartera, no recurrencia del negocio (no debe ensuciar tendencias de facturación ni indicadores de fuga de clientes recurrentes). Stark ya tiene una estructura pensada. Pendiente: validar tratamiento fiscal (IVA/ISR de servicio no facturado) con el contador.

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
- **F-049 · Pipeline de captura de facturas (entrada al bloque Gastos)** _(2026-06-05, PARTE B pendiente)_ — Reemplazo nativo del Google Apps Script para captura de facturas PDF (individual o bulk), OCR con Gemini, parseo DTE/genérico y landing en `FACTURAS_IN` con estatus Pendiente. **Principio rector**: AI extrae, humano decide — no se crea GASTO ni se toca ASIENTOS, solo se puebla `FACTURAS_IN` para revisión humana (F-050 cierra el flujo de validación). Field IDs como source of truth (lección F-047.2): `src/lib/airtable/facturas-in-fields.ts` mapea los 23 IDs de la tabla. **Backend** (`src/lib/facturas/`): hashing SHA-256 + dedupe en 2 niveles (file_hash bloquea mismo PDF byte-idéntico, doc_key `NIT|serie|numero|fecha|total` bloquea mismo DTE descargado dos veces). OCR vía Vercel AI SDK (`@ai-sdk/google`, modelo `gemini-2.5-flash`, temperature 0) con PDF como `file` part multimodal; prompt forza transcripción cruda sin interpretación porque el parser custom maneja la lógica. **Server action** `procesarFacturasAction`: 8 pasos en SERIE por archivo (mimetype + magic bytes `%PDF-` → SHA-256 → dedupe hash → OCR → parse → mínimos `total>0 && fecha` → doc_key → dedupe lógico → create record con `typecast:true` → upload PDF fail-soft). Reporta `{creadas, duplicadas, errores}` sin lanzar. **UI** `/gastos`: reemplaza el ComingSoon placeholder. 3 KPIs (pendientes, subidas 7d, operadores). `UploadFacturas` con drag-drop HTML5 nativo (sin react-dropzone — ~30 líneas no justifican otra dep), preview con quitar individual, toast con resumen + modal de detalle si hubo errores/duplicados. `FacturasInList` con filtros (estatus / subido por / search) y modal de detalle (12 campos + texto OCR completo en monospace). Acceso solo `rol === 'admin'` por ahora; permisos granulares en F-046.4. **Auros**: 3 tools READ-ONLY (`facturasInPendientes`, `facturasInPorProveedor`, `estadisticasUploadMes`) + bloque del system prompt que aclara que Auros NO crea/modifica facturas IN. **PARTE B postpuesta**: los parsers TS portados desde `parseGT_DTE.gs`/`codigo.gs`/`utils.gs` quedan como STUB que tira error explícito hasta que el código GAS esté disponible para portar fielmente — implementar a ciegas tendría bugs sutiles en lógica de centavos, fechas en español y casos borde. El selector DTE vs genérico (heurística "Número de DTE" / "Nit Emisor") sí queda implementado, igual que `buildDocKey`. Hasta que PARTE B esté, subir un archivo falla en el paso parse con mensaje explícito y el record NO se crea — comportamiento intencional. PRE-REQUISITO Airtable confirmado vía MCP: los 3 campos nuevos (`archivo_adjunto`, `subido_por`, `fecha_subida`) ya existen. PRE-REQUISITO env: `GOOGLE_GENERATIVE_AI_API_KEY` con quota para Gemini 2.5 Flash multimodal.
- **F-047 · Boletas de pago (generación + descarga + guardado en Airtable)** _(2026-06-04)_ — Cumple la obligación legal Guatemala de comprobante por cada quincena pagada. **Principio CFO**: "pagar" y "generar boleta" son acciones distintas — el pago se registra primero, la boleta se emite después. **Backend** (`src/lib/boletas/`): `generarBoletaPago(lineaId, generadoPor)` arma PDF US Letter con `pdf-lib` (Node-puro sin deps nativas, ok para serverless). 10 secciones: header marca+período, datos empleado en 2 columnas, tablas Ingresos+Descuentos lado a lado (filas en 0 omitidas), bloque Neto destacado en olive grande, info pago, firmas (con firma digital embebida si Empleados.Firma_Digital tiene PNG/JPG — fail-soft), disclaimer legal, metadata generado por. Empresa hardcoded en `src/lib/boletas/empresa.ts`. **Server actions** (`src/app/(app)/planillas/boletas-actions.ts`): `generarBoletaAction` valida estadoPago='Pagado', sube a Airtable vía `uploadAttachment` al field ID `fldmnn1YD8HICzKAg` (PLANILLA.Adjunto), exige `motivoRegeneracion` si ya existe boleta (registra en NOTAS con timestamp+autor). `generarBoletasMasivoAction` itera Pagadas en SERIE para no saturar rate-limits Airtable y reporta generadas/regeneradas/fallidas. `descargarBoletaAction` devuelve PDF en base64 para descarga directa sin side-effect. **UI**: columna Acciones de TablaPagable en `/planillas/[id]` muestra `BoletaAcciones` por línea Pagada — 3 estados (sin boleta → "Generar"; con boleta → "📄✓ Descargar / Re-generar"; re-generar pide motivo inline). Header del período no-Borrador muestra `BoletasBulkButton` "Generar todas las boletas (N)". Sección nueva "Boletas de pago" en `/empleados/[id]` SOLO para admin: tabla con período + fecha pago + neto + indicador PDF + `BoletaAcciones` reusado. **Auros**: 2 tools nuevas (`boletasDelEmpleado`, `boletasDelPeriodo`) + bloque del system prompt. `LineaPlanilla` ahora expone `boletaUrl`/`boletaNombre` (campo `Adjunto` agregado al mapeo). `getBoletasDelEmpleado(empleadoId, anio?)` recorre históricos y filtra Pagadas. **PARTE C (envío por email) POSTPUESTA** a F-047.x porque no hay servicio de email configurado en el proyecto (Resend/SendGrid requieren API key + dominio verificado + plantilla — coordinación separada con Stark). Logo de Golden Talent también pendiente — el PDF usa texto serif grande mientras tanto; cuando exista `/public/logo.png` se cambia 1 condicional en `dibujarHeader`. PARTE D (firma digital): el generador la lee fail-soft del campo `Empleados.Firma_Digital` si existe — UI de upload del campo NO incluida (Stark sube el archivo desde Airtable hasta que valga la pena un uploader). Pre-requisito Airtable: campo `Firma_Digital` (multiple attachments) en EMPLEADOS para activar firma embebida.
- **F-046.1 · Centro de Ayuda (infraestructura)** _(2026-06-04)_ — Sistema de ayuda embebido para que Alejandra/GG/junta directiva no dependan de Stark para entender los flujos. Sin contenido aún (eso es F-046.2). **Backend** (`src/lib/db/ayuda.ts`, tabla nueva `AYUDA` en Airtable): 6 categorías fijas (Facturación, Cobros y Retenciones, Empleados y Planilla, Deudas y Pasivos, Notas de Crédito, Conceptos contables). `getArticulos`, `getArticuloPorSlug`, `getArticulosPorTag`, KPIs en memoria (volumen bajo), correlativo de slug por `generarSlug("Cómo emitir X") → "como-emitir-x"`. 3 mutaciones (crear/editar/desactivar) gateadas por `rol === 'admin'` en server actions; lectura por tag abierta a cualquier usuario autenticado. Fail-soft total: si la tabla no existe, todo devuelve `[]` sin romper. **UI**: hub `/ayuda` con buscador full-text (case+accent insensitive) sobre titulo+descripción+contenido y 6 secciones por categoría que se ocultan si vacías; empty states diferenciados (tabla vacía vs sin matches). Detalle `/ayuda/[slug]` con breadcrumb + meta info (relativa GT) + `react-markdown` + `remark-gfm` (tablas/autolinks/tachado/task lists) + "Artículos relacionados". 404 amigable in-page si el slug no existe. Solo admin ve "Editar" y "Desactivar". Modal CRUD con auto-sugerencia de slug desde el título mientras no se toque manualmente, contadores de caracteres, validaciones espejo del backend (slug solo [a-z0-9-]+, contenido ≥ 50 chars). Estilos `.ayuda-prose` agregados a globals.css para tipografía consistente del markdown renderizado. **HelpButton reusable** (`<HelpButton tag="..."/>`): botón "?" sutil con drawer lateral 480px que muestra el(los) artículo(s) cuyo `Tags_Contextuales` matchea; 3 estados (0/1/N) con empty state apuntando al hub. Aplicado en 6 headers de módulo + 4 acciones de factura-detalle + aprobar-planilla + dar-baja-empleado/deuda-salarial + aprobar-nc/anular-nc. Total ~14 puntos de inserción. **Sidebar**: entry "Centro de Ayuda" en grupo propio "Ayuda" al final (visible para todos). Icono nuevo `I.Help` agregado al set (círculo + "?"). **Auros**: tool `buscarAyuda(query)` que devuelve top 3 matches con url + título + slug, y bloque del system prompt que obliga a llamarla antes de responder "cómo hacer X" para referir al artículo si existe. PRE-REQUISITO Airtable: Stark crea tabla `AYUDA` con 11 campos (Titulo, Slug único, Categoria singleSelect, Descripcion_Corta, Contenido long-text, Orden number, Activo checkbox, Tags_Contextuales texto, Fecha_Creacion + Fecha_Modificacion datetime, Modificado_Por texto). `react-markdown@10` y `remark-gfm@4` instalados.
- **F-045 · Módulo de Notas de Crédito** _(2026-06-04)_ — Documentos legales que reducen el saldo cobrable de una factura SIN modificar su TOTAL original. Principio contable clave: la factura es INMUTABLE; la NC es un evento posterior. "Facturado bruto" = suma de TOTALES; "Facturado neto" = bruto - NCs activas. **Backend** (`src/lib/db/notas-credito.ts`, tabla nueva `NOTAS_CREDITO`): 5 funciones de lectura (lista global, por factura, pendientes aprobación, KPIs anuales con desglose por motivo/cliente, suma activas de una factura), correlativo `NC-YYYY-NNN` por MAX+1, 3 mutaciones (crear / aprobar / anular). Umbral `Q5,000`: NCs ≤ se activan automáticamente, NCs > entran a 'Pendiente Aprobación' y solo admin las activa. Al activar/anular se recalcula `ESTADO` de TODAS las líneas de la factura (`saldo neto = TOTAL - cobros - NCs`): si 0 → COBRADO, si cobros > 0 → COBRADO PARCIAL, sino → EMITIDA. `getSaldoPendiente()` ahora resta también NCs activas (import dinámico para evitar ciclo cobros↔NCs). Fail-soft: si la tabla `NOTAS_CREDITO` aún no existe, todas las lecturas devuelven `[]` y la app sigue funcionando sin el módulo. **UI**: botón "+ Nota de crédito" en detalle de factura (solo si no anulada/refacturada y saldo > 0) con modal en 2 fases — la fase 2 sólo se activa para NCs > Q5K con aviso amber. Sección "Notas de Crédito" en el detalle con cards (badge por estado, acciones aprobar/anular según rol). Pantalla nueva `/notas-credito` con KPIs, tabs (todas/activas/pendientes/anuladas), filtros, tabla con acciones inline, export CSV (no incluye botón "+ Emitir" — siempre se emite desde la factura). Banner amber en `/dashboard` cuando admin tiene NCs pendientes (deep-link a `/notas-credito?estado=pendientes`). Entry "Notas de Crédito" en sidebar bajo grupo Operación con badge "N aprobar" warn solo para admin. Linea informativa en `/facturacion` cuando hay NCs activas del año ("+ Q[X] en NCs activas año reducen el facturado neto"). **Auros**: 3 tools nuevas (`getNotasCreditoFactura`, `getKPIsNotasCredito`, `getNotasCreditoPendientesAprobacion`) + bloque del system prompt que distingue facturado bruto vs neto y obliga a separar activas/pendientes/anuladas al reportar. PRE-REQUISITO Airtable: Stark crea tabla `NOTAS_CREDITO` con 17 campos (incluye linked records a `FACTURAS_CLIENTES` y `CLIENTES`, lookups `NO.FACTURA (from Factura)` y `Razón social (from Cliente)` para evitar queries extra).
- **F-044 · Editar campos no-contables de facturas** _(2026-06-04)_ — Pedido por Alejandra: "si metí mal un número de factura, ¿solo con el sistema anterior puedo corregirlo?". Decisión CFO: editables = NÚMERO, FECHA EMISIÓN, OBSERVACIONES; no editables = monto/cliente/IVA/estado (esos van por anular + refacturar). Backend: `editarFacturaNoContable(facturaId, cambios, usuarioEmail)` con whitelist estricta de campos, validación de duplicados contra otras facturas ACTIVAS (permite reusar números de ANULADAS/REFACTURADAS), UPDATE batch a TODAS las líneas del mismo NO.FACTURA (mantiene la consolidación coherente), y auditoría fail-soft en 2da llamada — si Stark no agregó los 3 campos nuevos en Airtable (Editado_Por / Fecha_Ultima_Edicion / Historial_Ediciones) el cambio funcional igual se aplica y devolvemos `auditoriaPersistida=false`. Modal en 2 fases (edit → confirm con resumen "campo: antes → después"), warning suave si se cambia de mes contable, campos contables visibles pero con candado 🔒, sección "Historial de ediciones" collapsible. Indicador ✏️ en lista de facturas + tooltip con fecha/email del editor; subtítulo del detalle también muestra "✏️ Editada". `Invoice` y `InvoiceLiviano` exponen `editadoPor` y `fechaUltimaEdicion`; el query liviano hace try/catch con fallback a campos base por si los nuevos no existen. Auros: tool `getHistorialEdicionesFactura` y bloque nuevo del prompt que distingue edición vs anulación. Pre-requisito Airtable: Stark debe agregar los 3 campos de auditoría (single line text / datetime / long text) para activar el log.
- **F-043 · Auditoría y fix de badges del sidebar** _(2026-06-04)_ — Stark reportó: "el badge '5 vencidas' de Facturación está quemado, da info errónea". Auditoría confirmó **2 badges hardcoded**: `'5 vencidas'` en Facturación (sidebar.tsx:39) y `'3 alertas'` en AI Insights (sidebar.tsx:64), ambos strings literales sin fuente. Los otros 2 (Pagos pendientes y Deudas) ya eran dinámicos. Fix: nuevo `src/lib/db/sidebar-kpis.ts` con `getSidebarBadges()` como ÚNICA fuente de verdad (4 counts en paralelo, fail-soft a 0 si una fuente falla — nunca a un número falso). Cada count usa exactamente la misma función que la pantalla destino: Facturación → `getFacturasLiviano + predicadoFiltro('vencidas')` (mismo que tab "Vencidas"), Pagos → `getKPIsPagosPendientes.totalEmpleadosPendientes`, Deudas → `getKPIsDeudas.vencidas.cantidad`. AI Insights eliminado por no tener métrica real con sentido (la tabla AI_ANALISIS no modela "alertas"). Layout app router recalcula en cada navegación → los badges quedan en vivo sin polling. Sidebar oculta badges con count=0 para no ensuciar. Aprendizaje: nunca dejar valores hardcoded de fallback en información financiera — peor que no tenerla.
- **F-042 · Vista consolidada de salarios pendientes + Planilla por Centro de Costo** _(2026-06-04)_ — Pedido CFO: "tener bien claro dónde podemos ver qué planillas o salarios están pendientes de pago" + "ver la planilla por centro de negocio, un resumen bonito y chiquito". En `/empleados` se agregaron 3 secciones nuevas entre el hero KPIs y el desglose pasivo laboral: **(B)** Salarios pendientes — 2 cards lado a lado: PENDIENTES (planilla aprobada sin pago, fricción temporal) y DIFERIDOS (deuda formal Tipo_Documento='Salario Pendiente', wine), con bullet de alertas amarillas/naranjas/rojas y links a `/planillas/pendientes` y `/deudas?categoria=empleados`. Cuando totalConsolidado = 0 la sección entera se oculta y se muestra badge "✓ Salarios al día" en el subtitle. **(C)** Planilla por Centro de Costo — grid de cards (auto-fit minmax 220px) ordenadas DESC por costo: cantidad empleados, costo mensual, costo anual proyectado (*12), % del total con barra coloreada. Empleados sin CC asignado → card con borde wine (warning). **(D)** Donut "Composición del costo" con toggle [Por Departamento] [Por Centro de Costo], default CC (vista útil CFO), persistencia en `localStorage` (`fc.empleados.donut-modo`). Implementado con conic-gradient sin dependencia nueva. Layer de datos: `getPlanillaPorCentroCosto` y `getResumenSalariosPendientesConsolidado` en `empleados.ts` (este último usa import dinámico de `./planillas` para romper ciclo). Auros: 2 tools nuevas + 2 bloques nuevos del system prompt que (i) obligan a reportar costo TOTAL de un CC (no solo salario base) porque permite calcular margen real por línea, y (ii) fijan la distinción semántica pendientes vs diferidos. Deep-link habilitado: `/deudas` ahora acepta `?categoria=empleados` con el mismo patrón F-023.
- **F-041 · Normalización zona horaria Guatemala** _(2026-06-04)_ — Toda fecha que se muestra, se compara con "hoy" o se calcula en días pasa por `src/lib/utils/fechas.ts` (date-fns + date-fns-tz, TZ `America/Guatemala` fija UTC-6). Centralizado: `formatearFecha`/`formatearFechaCorta`/`formatearFechaLarga`/`formatearFechaConHora`/`formatearFechaConDia`, `obtenerFechaHoyGuatemala` (reemplaza `new Date().toISOString().slice(0,10)`), `fechaParaAirtable`, `diferenciaDias` (días calendario GT, no horas), `partesFechaHoy` (incluye weekday GT vía ISO `i`), `inputDateAGuatemalaISO`. Los formatters legacy de `lib/utils.ts` (`formatDate`, `formatDateShort`, `formatDateDDMMYYYY`) repuntan al helper, así que el sistema entero quedó GT-correcto sin tocar cada call-site. Propagado a: server libs (planillas/cobros/facturas/deudas/pagos-deudas/analitica/clientes-analisis), modales (registrar-pago, deuda-form, pagar-empleado, nueva-factura, registrar-cobro, deuda-salarial, empleado-form, dar-de-baja), cálculo de antigüedad y provisiones, Auros contexto temporal, CSV export de retenciones, y 7 formatters locales duplicados en componentes. **Bug latente cazado**: `parseISO("YYYY-MM-DD")` da UTC midnight, que al mostrar en GT (-6h) retrocede al día anterior — `aDate` ahora detecta Date-only y aplica `fromZonedTime(GT)`. Reportado por Alejandra: "las fechas estaban en UTC, mostraban 7 horas más".
