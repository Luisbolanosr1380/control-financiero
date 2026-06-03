/**
 * F-038 — Períodos y líneas de planilla.
 *
 * - Tabla PERIODOS: una fila por quincena (Q1/Q2 × mes × año), con ESTADO
 *   ('Borrador' | 'Aprobada' | 'En pago' | 'Cerrada') y campos de auditoría
 *   (APROBADO_POR, FECHA_APROBACION, PAGADO_POR, FECHA_CIERRE).
 * - Tabla PLANILLA: una fila por (empleado, período) con los montos calculados
 *   + ESTADO_PAGO ('Pendiente' | 'Pagado' | 'Diferido') + DEUDA_VINCULADA.
 *
 * Diferir un pago: crea una deuda de Salario Pendiente contra el acreedor del
 * empleado (módulo F-037) y la linkea a la línea de planilla.
 *
 * Cuando todas las líneas de un período están en Pagado/Diferido, el período
 * pasa a 'Cerrada' automáticamente (registrando PAGADO_POR + FECHA_CIERRE).
 *
 * NOTA sobre el campo ESTADO de PERIODOS: el schema actual tiene opciones
 * legacy ABIERTO/CERRADO y NO incluye Borrador/Aprobada/En pago/Cerrada.
 * Asumimos que las nuevas opciones se agregarán manualmente antes de usar
 * este módulo en producción. Si Airtable rechaza el write, el caller verá
 * el error y debe agregar las opciones al singleSelect.
 */

import { airtable, USE_MOCK, TABLES } from './airtable';
import { getEmpleados, crearDeudaSalarioPendiente, type Empleado } from './empleados';
import { calcularQuincena, type AjustesQuincena, type QuincenaCalculada } from '../calculos/planilla-calc';

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ============================================================
 * Tipos públicos
 * ============================================================ */

export type EstadoPeriodo = 'Borrador' | 'Aprobada' | 'En pago' | 'Cerrada';
export type EstadoPagoLinea = 'Pendiente' | 'Pagado' | 'Diferido';

export interface Periodo {
  id: string;
  nombre: string;              // 'Q1-junio-2026'
  quincena: 1 | 2;
  mes: number;                 // 1..12
  anio: number;
  fechaInicio: string;         // 'YYYY-MM-DD'
  fechaFin: string;            // 'YYYY-MM-DD'
  estado: EstadoPeriodo;
  aprobadoPor?: string;
  fechaAprobacion?: string;
  pagadoPor?: string;
  fechaCierre?: string;
  cantidadEmpleados: number;
  montoTotal: number;          // suma de NETO_PAGAR de las líneas
}

export interface LineaPlanilla {
  id: string;
  periodoId: string;
  empleadoId: string;
  empleadoNombre: string;
  centroCostoId?: string;

  ordinario: number;
  bonificacion: number;
  extraordinario: number;
  comisiones: number;
  otrosIngresos: number;
  igssLaboral: number;
  isr: number;
  otrosDescuentos: number;
  netoPagar: number;

  estadoPago: EstadoPagoLinea;
  fechaPago?: string;
  notas?: string;
  deudaVinculadaId?: string;
}

export interface KPIsPeriodo {
  cantidadEmpleados: number;
  montoTotal: number;
  pagados: number;
  pendientes: number;
  diferidos: number;
}

/* ============================================================
 * Campos Airtable
 * ============================================================ */

// PERIODOS
const FP = {
  PERIODO:           'PERIODO',
  FECHA_INICIO:      'FECHA_INICIO',
  FECHA_FIN:         'FECHA_FIN',
  ESTADO:            'ESTADO',
  APROBADO_POR:      'APROBADO_POR',
  FECHA_APROBACION:  'FECHA_APROBACION',
  PAGADO_POR:        'PAGADO_POR',
  FECHA_CIERRE:      'FECHA_CIERRE',
} as const;

// PLANILLA. OJO: algunos nombres llevan espacio al final exacto, según el schema real.
const FL = {
  PERIODO:           'PERIODO',
  EMPLEADO:          'EMPLEADO ',          // espacio al final
  ORDINARIO:         'ORDINARIO',
  BONIFICACION:      'BONIFICACIÓN ',      // espacio al final
  EXTRAORDINARIO:    'EXTRAORDINARIO ',    // espacio al final
  COMISIONES:        'COMISIONES ',        // espacio al final
  OTROS_INGRESOS:    'OTROS_INGRESOS',
  IGSS:              'IGSS',
  ISR:               'ISR',
  OTROS_DESCUENTOS:  'OTROS_DOCUMENTOS',   // nombre legacy del campo, no se renombra
  NETO_PAGAR:        'NETO_PAGAR',
  CENTRO_COSTO:      'CENTROS_COSTO',
  FECHA_PAGO:        'FECHA_PAGO',
  ESTADO_PAGO:       'ESTADO_PAGO',
  DEUDA_VINCULADA:   'DEUDA_VINCULADA',
  NOTAS:             'NOTAS',
} as const;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad2 = (n: number) => String(n).padStart(2, '0');

function arrFirst(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? '') : '';
}
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function selectName(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && 'name' in (v as object)) return String((v as { name?: string }).name ?? '');
  return String(v).trim();
}

function estadoPeriodoFromAirtable(v: unknown): EstadoPeriodo {
  const s = selectName(v);
  if (s === 'Borrador' || s === 'Aprobada' || s === 'En pago' || s === 'Cerrada') return s;
  // Mapeo de legacy: ABIERTO ≈ Borrador, CERRADO ≈ Cerrada.
  const up = s.toUpperCase();
  if (up === 'CERRADO' || up === 'CERRADA') return 'Cerrada';
  return 'Borrador';
}

function estadoPagoFromAirtable(v: unknown): EstadoPagoLinea {
  const s = selectName(v);
  if (s === 'Pagado' || s === 'Diferido' || s === 'Pendiente') return s;
  return 'Pendiente';
}

function nombrePeriodo(quincena: 1 | 2, mes: number, anio: number): string {
  return `Q${quincena}-${MESES[mes - 1]}-${anio}`;
}

function ultimoDiaMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

function rangoQuincena(quincena: 1 | 2, mes: number, anio: number): { inicio: string; fin: string } {
  const m = pad2(mes);
  if (quincena === 1) {
    return { inicio: `${anio}-${m}-01`, fin: `${anio}-${m}-15` };
  }
  return { inicio: `${anio}-${m}-16`, fin: `${anio}-${m}-${pad2(ultimoDiaMes(anio, mes))}` };
}

function parsePeriodoNombre(nombre: string): { quincena: 1 | 2; mes: number; anio: number } | null {
  // Esperado: 'Q{1|2}-{mes}-{anio}'. Tolerante con mayúsculas o variantes.
  const m = /^Q\s*([12])\s*[-_ ]\s*([a-záéíóú]+)\s*[-_ ]\s*(\d{4})$/i.exec(nombre.trim());
  if (!m) return null;
  const q = Number(m[1]) === 1 ? 1 : 2;
  const mesIdx = MESES.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
  if (mesIdx < 0) return null;
  return { quincena: q, mes: mesIdx + 1, anio: Number(m[3]) };
}

/* ============================================================
 * Lectura
 * ============================================================ */

function recordToLinea(record: { id: string; fields: Record<string, unknown> }, empleadoNombreById: Map<string, string>): LineaPlanilla {
  const f = record.fields;
  const empleadoId = arrFirst(f[FL.EMPLEADO]);
  const periodoId  = arrFirst(f[FL.PERIODO]);
  return {
    id: record.id,
    periodoId,
    empleadoId,
    empleadoNombre: empleadoNombreById.get(empleadoId) ?? '',
    centroCostoId: arrFirst(f[FL.CENTRO_COSTO]) || undefined,

    ordinario:       num(f[FL.ORDINARIO]),
    bonificacion:    num(f[FL.BONIFICACION]),
    extraordinario:  num(f[FL.EXTRAORDINARIO]),
    comisiones:      num(f[FL.COMISIONES]),
    otrosIngresos:   num(f[FL.OTROS_INGRESOS]),
    igssLaboral:     num(f[FL.IGSS]),
    isr:             num(f[FL.ISR]),
    otrosDescuentos: num(f[FL.OTROS_DESCUENTOS]),
    netoPagar:       num(f[FL.NETO_PAGAR]),

    estadoPago: estadoPagoFromAirtable(f[FL.ESTADO_PAGO]),
    fechaPago:  String(f[FL.FECHA_PAGO] ?? '') || undefined,
    notas:      String(f[FL.NOTAS] ?? '') || undefined,
    deudaVinculadaId: arrFirst(f[FL.DEUDA_VINCULADA]) || undefined,
  };
}

async function getLineasPorPeriodo(periodoId: string | null): Promise<LineaPlanilla[]> {
  if (!airtable) return [];
  const empleados = await getEmpleados({ status: 'todos' });
  const empleadoNombreById = new Map(empleados.map(e => [e.id, e.nombre]));

  // F-038.3: NO usar filterByFormula con ARRAYJOIN({PERIODO}) — Airtable
  // devuelve display names (primary field "Q1-junio-2026"), no record IDs,
  // así que FIND("rec...", "Q1-junio-2026") = 0 y se pierden TODAS las
  // líneas. Mismo patrón que pagos-deudas.getPagosPorDeuda: traemos todas
  // y filtramos en JS por periodoId.
  const records = await airtable(TABLES.PLANILLA).select().all();
  const lineas = records.map(r => recordToLinea({ id: r.id, fields: r.fields as Record<string, unknown> }, empleadoNombreById));
  return periodoId ? lineas.filter(l => l.periodoId === periodoId) : lineas;
}

export async function getLineasPlanilla(periodoId: string): Promise<LineaPlanilla[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    return await getLineasPorPeriodo(periodoId);
  } catch (err) {
    console.error('Error leyendo líneas de planilla:', err);
    return [];
  }
}

export async function getPeriodos(filtros: { estado?: EstadoPeriodo | 'todos'; anio?: number } = {}): Promise<Periodo[]> {
  if (USE_MOCK || !airtable) return [];

  try {
    const [periodoRecords, todasLineas] = await Promise.all([
      airtable(TABLES.PERIODOS).select().all(),
      getLineasPorPeriodo(null),
    ]);

    const lineasPorPeriodo = new Map<string, LineaPlanilla[]>();
    for (const l of todasLineas) {
      const list = lineasPorPeriodo.get(l.periodoId) ?? [];
      list.push(l);
      lineasPorPeriodo.set(l.periodoId, list);
    }

    const periodos: Periodo[] = periodoRecords.map(r => {
      const f = r.fields as Record<string, unknown>;
      const nombre = String(f[FP.PERIODO] ?? '').trim();
      const parsed = parsePeriodoNombre(nombre);
      const lineas = lineasPorPeriodo.get(r.id) ?? [];
      return {
        id: r.id,
        nombre,
        quincena: parsed?.quincena ?? 1,
        mes: parsed?.mes ?? 0,
        anio: parsed?.anio ?? 0,
        fechaInicio:      String(f[FP.FECHA_INICIO] ?? ''),
        fechaFin:         String(f[FP.FECHA_FIN] ?? ''),
        estado:           estadoPeriodoFromAirtable(f[FP.ESTADO]),
        aprobadoPor:      String(f[FP.APROBADO_POR] ?? '') || undefined,
        fechaAprobacion:  String(f[FP.FECHA_APROBACION] ?? '') || undefined,
        pagadoPor:        String(f[FP.PAGADO_POR] ?? '') || undefined,
        fechaCierre:      String(f[FP.FECHA_CIERRE] ?? '') || undefined,
        cantidadEmpleados: lineas.length,
        montoTotal:        round2(lineas.reduce((s, l) => s + l.netoPagar, 0)),
      };
    });

    let out = periodos;
    if (filtros.estado && filtros.estado !== 'todos') {
      out = out.filter(p => p.estado === filtros.estado);
    }
    if (typeof filtros.anio === 'number') {
      out = out.filter(p => p.anio === filtros.anio);
    }
    // Más reciente primero
    out.sort((a, b) => {
      if (a.anio !== b.anio) return b.anio - a.anio;
      if (a.mes !== b.mes)   return b.mes - a.mes;
      return b.quincena - a.quincena;
    });
    return out;
  } catch (err) {
    console.error('Error leyendo períodos de planilla:', err);
    return [];
  }
}

export async function getPeriodoPorId(id: string): Promise<{ periodo: Periodo; lineas: LineaPlanilla[] } | null> {
  if (USE_MOCK || !airtable) return null;
  try {
    const todos = await getPeriodos({ estado: 'todos' });
    const periodo = todos.find(p => p.id === id);
    if (!periodo) return null;
    const lineas = await getLineasPlanilla(id);
    return { periodo, lineas };
  } catch (err) {
    console.error('Error leyendo período:', err);
    return null;
  }
}

/* ============================================================
 * Mutaciones
 * ============================================================ */

export type PlanillaMutationResult =
  | { ok: true; mensaje: string; periodoId?: string; lineaId?: string }
  | { ok: false; error: string };

export interface CrearPeriodoInput {
  quincena: 1 | 2;
  mes: number;
  anio: number;
}

export async function crearPeriodo(input: CrearPeriodoInput): Promise<PlanillaMutationResult & { periodoId?: string }> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (input.quincena !== 1 && input.quincena !== 2) return { ok: false, error: 'Quincena debe ser 1 o 2.' };
  if (!(input.mes >= 1 && input.mes <= 12))         return { ok: false, error: 'Mes inválido.' };
  if (!(input.anio >= 2024 && input.anio <= 2099))  return { ok: false, error: 'Año fuera de rango.' };

  try {
    const nombre = nombrePeriodo(input.quincena, input.mes, input.anio);
    // Unicidad: buscamos por texto del campo PERIODO
    const existentes = await airtable(TABLES.PERIODOS)
      .select({ filterByFormula: `{${FP.PERIODO}} = "${nombre}"`, maxRecords: 1 })
      .all();
    if (existentes.length > 0) {
      return { ok: false, error: `Ya existe el período ${nombre}.` };
    }

    const { inicio, fin } = rangoQuincena(input.quincena, input.mes, input.anio);
    type AField = string | number | string[] | undefined;
    const fields: Record<string, AField> = {
      [FP.PERIODO]:       nombre,
      [FP.FECHA_INICIO]:  inicio,
      [FP.FECHA_FIN]:     fin,
      [FP.ESTADO]:        'Borrador',
    };
    const created = await airtable(TABLES.PERIODOS).create(fields);
    return { ok: true, periodoId: created.id, mensaje: `Período ${nombre} creado en Borrador.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface GenerarPlanillaResult {
  ok: boolean;
  cantidadEmpleados: number;
  montoTotalProyectado: number;
  error?: string;
}

export async function generarPlanilla(periodoId: string): Promise<GenerarPlanillaResult> {
  if (!airtable) return { ok: false, cantidadEmpleados: 0, montoTotalProyectado: 0, error: 'Airtable no está configurado.' };
  try {
    const datos = await getPeriodoPorId(periodoId);
    if (!datos) return { ok: false, cantidadEmpleados: 0, montoTotalProyectado: 0, error: 'Período no encontrado.' };
    if (datos.periodo.estado !== 'Borrador') {
      return { ok: false, cantidadEmpleados: 0, montoTotalProyectado: 0, error: `El período está en estado ${datos.periodo.estado} — solo se puede generar en Borrador.` };
    }
    if (datos.lineas.length > 0) {
      return { ok: false, cantidadEmpleados: 0, montoTotalProyectado: 0, error: 'El período ya tiene líneas generadas.' };
    }

    const empleados = await getEmpleados({ status: 'ACTIVO' });
    if (empleados.length === 0) {
      return { ok: false, cantidadEmpleados: 0, montoTotalProyectado: 0, error: 'No hay empleados activos.' };
    }

    type AField = string | number | string[] | undefined;
    type CreatePayload = { fields: Record<string, AField> };
    const payloads: CreatePayload[] = [];
    let montoTotal = 0;
    for (const emp of empleados) {
      const calc = calcularQuincena({
        empleado: { id: emp.id, nombre: emp.nombre, salarioBase: emp.salarioBase },
      });
      montoTotal += calc.netoPagar;
      const fields: Record<string, AField> = {
        [FL.PERIODO]:         [periodoId],
        [FL.EMPLEADO]:        [emp.id],
        [FL.ORDINARIO]:       calc.ordinario,
        [FL.BONIFICACION]:    calc.bonificacion,
        [FL.EXTRAORDINARIO]:  calc.extraordinario,
        [FL.COMISIONES]:      calc.comisiones,
        [FL.OTROS_INGRESOS]:  calc.otrosIngresos,
        [FL.IGSS]:            calc.igssLaboral,
        [FL.ISR]:             calc.isr,
        [FL.OTROS_DESCUENTOS]: calc.otrosDescuentos,
        [FL.NETO_PAGAR]:      calc.netoPagar,
        [FL.ESTADO_PAGO]:     'Pendiente',
      };
      if (emp.centroCostoId) fields[FL.CENTRO_COSTO] = [emp.centroCostoId];
      payloads.push({ fields });
    }

    let creadas = 0;
    for (let i = 0; i < payloads.length; i += 10) {
      const lote = payloads.slice(i, i + 10);
      try {
        const res = await airtable(TABLES.PLANILLA).create(lote);
        creadas += res.length;
      } catch (err) {
        console.error('Error creando lote de planilla:', err);
      }
    }

    if (creadas === 0) {
      return { ok: false, cantidadEmpleados: 0, montoTotalProyectado: 0, error: 'No se pudo crear ninguna línea de planilla.' };
    }

    return { ok: true, cantidadEmpleados: creadas, montoTotalProyectado: round2(montoTotal) };
  } catch (err) {
    return { ok: false, cantidadEmpleados: 0, montoTotalProyectado: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function periodoDeLinea(lineaId: string): Promise<{ periodo: Periodo; lineas: LineaPlanilla[] } | null> {
  if (!airtable) return null;
  const rec = await airtable(TABLES.PLANILLA).find(lineaId);
  const periodoId = arrFirst((rec.fields as Record<string, unknown>)[FL.PERIODO]);
  if (!periodoId) return null;
  return getPeriodoPorId(periodoId);
}

export async function ajustarLineaPlanilla(lineaId: string, ajustes: AjustesQuincena): Promise<PlanillaMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  try {
    const datos = await periodoDeLinea(lineaId);
    if (!datos) return { ok: false, error: 'No se pudo localizar el período de la línea.' };
    if (datos.periodo.estado !== 'Borrador') {
      return { ok: false, error: `El período está ${datos.periodo.estado} — solo se editan líneas en Borrador.` };
    }

    const linea = datos.lineas.find(l => l.id === lineaId);
    if (!linea) return { ok: false, error: 'Línea no encontrada en el período.' };

    // Necesitamos el salarioBase del empleado para recalcular IGSS/ISR.
    const empleados = await getEmpleados({ status: 'todos' });
    const emp = empleados.find(e => e.id === linea.empleadoId);
    if (!emp) return { ok: false, error: 'Empleado de la línea no encontrado.' };

    const calc = calcularQuincena({
      empleado: { id: emp.id, nombre: emp.nombre, salarioBase: emp.salarioBase },
      ajustes,
    });

    type AField = string | number | string[] | undefined;
    const fields: Record<string, AField> = {
      [FL.ORDINARIO]:       calc.ordinario,
      [FL.BONIFICACION]:    calc.bonificacion,
      [FL.EXTRAORDINARIO]:  calc.extraordinario,
      [FL.COMISIONES]:      calc.comisiones,
      [FL.OTROS_INGRESOS]:  calc.otrosIngresos,
      [FL.IGSS]:            calc.igssLaboral,
      [FL.ISR]:             calc.isr,
      [FL.OTROS_DESCUENTOS]: calc.otrosDescuentos,
      [FL.NETO_PAGAR]:      calc.netoPagar,
    };

    // Si hay descuentos, los anexamos como nota legible para trazabilidad.
    if (ajustes.descuentos && ajustes.descuentos.length > 0) {
      const detalle = ajustes.descuentos.map(d => `${d.tipo} Q${(d.monto || 0).toFixed(2)}${d.descripcion ? ` (${d.descripcion})` : ''}`).join('; ');
      fields[FL.NOTAS] = `Descuentos: ${detalle}`;
    }

    await airtable(TABLES.PLANILLA).update([{ id: lineaId, fields }]);
    return { ok: true, lineaId, mensaje: `Línea actualizada — neto Q${calc.netoPagar.toFixed(2)}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function aprobarPeriodo(periodoId: string, usuarioEmail: string): Promise<PlanillaMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!usuarioEmail?.trim()) return { ok: false, error: 'Usuario requerido para aprobar.' };
  try {
    const datos = await getPeriodoPorId(periodoId);
    if (!datos) return { ok: false, error: 'Período no encontrado.' };
    if (datos.periodo.estado !== 'Borrador') {
      return { ok: false, error: `El período ya está ${datos.periodo.estado} — solo se aprueba desde Borrador.` };
    }
    if (datos.lineas.length === 0) {
      return { ok: false, error: 'No hay líneas que aprobar — generá la planilla primero.' };
    }

    const hoy = new Date().toISOString().slice(0, 10);
    await airtable(TABLES.PERIODOS).update([{
      id: periodoId,
      fields: {
        [FP.ESTADO]:           'Aprobada',
        [FP.APROBADO_POR]:     usuarioEmail.trim(),
        [FP.FECHA_APROBACION]: hoy,
      },
    }]);
    return { ok: true, periodoId, mensaje: `Período aprobado por ${usuarioEmail}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Recalcula el estado del período según las líneas:
 *  - Si todas Pagado o Diferido → Cerrada (registra PAGADO_POR y FECHA_CIERRE).
 *  - Si al menos una Pagada/Diferida pero faltan → En pago.
 *  - Si todas Pendientes → no cambia (queda en Aprobada).
 */
async function recalcularEstadoPeriodo(periodoId: string, usuarioEmail: string): Promise<void> {
  if (!airtable) return;
  const datos = await getPeriodoPorId(periodoId);
  if (!datos) return;
  const total = datos.lineas.length;
  if (total === 0) return;

  const pagadas    = datos.lineas.filter(l => l.estadoPago === 'Pagado').length;
  const diferidas  = datos.lineas.filter(l => l.estadoPago === 'Diferido').length;
  const concluidas = pagadas + diferidas;

  const hoy = new Date().toISOString().slice(0, 10);
  type AField = string | number | string[] | undefined;

  if (concluidas === total) {
    // Cerrada
    if (datos.periodo.estado !== 'Cerrada') {
      const fields: Record<string, AField> = {
        [FP.ESTADO]:       'Cerrada',
        [FP.PAGADO_POR]:   usuarioEmail.trim() || 'sistema',
        [FP.FECHA_CIERRE]: hoy,
      };
      await airtable(TABLES.PERIODOS).update([{ id: periodoId, fields }]);
    }
  } else if (concluidas > 0) {
    if (datos.periodo.estado !== 'En pago') {
      await airtable(TABLES.PERIODOS).update([{
        id: periodoId,
        fields: { [FP.ESTADO]: 'En pago' },
      }]);
    }
  }
}

export interface RegistrarPagoEmpleadoInput {
  lineaId: string;
  fechaPago: string;
  bancoId: string;
  referencia?: string;
  usuarioEmail: string;
}

export async function registrarPagoEmpleado(input: RegistrarPagoEmpleadoInput): Promise<PlanillaMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!input.fechaPago) return { ok: false, error: 'Fecha de pago requerida.' };
  if (!input.bancoId)   return { ok: false, error: 'Banco requerido.' };

  try {
    const datos = await periodoDeLinea(input.lineaId);
    if (!datos) return { ok: false, error: 'Período de la línea no encontrado.' };
    if (datos.periodo.estado !== 'Aprobada' && datos.periodo.estado !== 'En pago') {
      return { ok: false, error: `El período está ${datos.periodo.estado} — solo se paga en Aprobada o En pago.` };
    }
    const linea = datos.lineas.find(l => l.id === input.lineaId);
    if (!linea) return { ok: false, error: 'Línea no encontrada en el período.' };
    if (linea.estadoPago !== 'Pendiente') {
      return { ok: false, error: `La línea ya está ${linea.estadoPago}.` };
    }

    const notaActual = linea.notas ?? '';
    const sufijo = `Pago ${input.fechaPago}${input.referencia ? ` ref ${input.referencia}` : ''} (${input.usuarioEmail || 'sistema'})`;
    const notaNueva = notaActual ? `${notaActual} · ${sufijo}` : sufijo;

    type AField = string | number | string[] | undefined;
    const fields: Record<string, AField> = {
      [FL.ESTADO_PAGO]: 'Pagado',
      [FL.FECHA_PAGO]:  input.fechaPago,
      [FL.NOTAS]:       notaNueva,
    };
    await airtable(TABLES.PLANILLA).update([{ id: input.lineaId, fields }]);

    await recalcularEstadoPeriodo(datos.periodo.id, input.usuarioEmail);
    return { ok: true, lineaId: input.lineaId, mensaje: `Pago registrado para ${linea.empleadoNombre}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DiferirPagoEmpleadoInput {
  lineaId: string;
  motivo: string;
  usuarioEmail: string;
}

export async function diferirPagoEmpleado(input: DiferirPagoEmpleadoInput): Promise<PlanillaMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!input.motivo?.trim()) return { ok: false, error: 'Motivo requerido para diferir.' };

  try {
    const datos = await periodoDeLinea(input.lineaId);
    if (!datos) return { ok: false, error: 'Período de la línea no encontrado.' };
    if (datos.periodo.estado !== 'Aprobada' && datos.periodo.estado !== 'En pago') {
      return { ok: false, error: `El período está ${datos.periodo.estado} — solo se difiere en Aprobada o En pago.` };
    }
    const linea = datos.lineas.find(l => l.id === input.lineaId);
    if (!linea) return { ok: false, error: 'Línea no encontrada en el período.' };
    if (linea.estadoPago !== 'Pendiente') {
      return { ok: false, error: `La línea ya está ${linea.estadoPago}.` };
    }

    // Fecha de la quincena = fechaFin del período.
    const fechaQuincena = datos.periodo.fechaFin || new Date().toISOString().slice(0, 10);
    const motivo = `Diferido: ${input.motivo.trim()}`;

    const deudaRes = await crearDeudaSalarioPendiente(linea.empleadoId, linea.netoPagar, fechaQuincena, motivo);
    if (!deudaRes.ok || !deudaRes.deudaId) {
      return { ok: false, error: deudaRes.error ?? 'No se pudo crear la deuda salarial.' };
    }

    const notaActual = linea.notas ?? '';
    const sufijo = `Diferido por ${input.usuarioEmail || 'sistema'}: ${input.motivo.trim()}`;
    const notaNueva = notaActual ? `${notaActual} · ${sufijo}` : sufijo;

    type AField = string | number | string[] | undefined;
    const fields: Record<string, AField> = {
      [FL.ESTADO_PAGO]:     'Diferido',
      [FL.DEUDA_VINCULADA]: [deudaRes.deudaId],
      [FL.NOTAS]:           notaNueva,
    };
    await airtable(TABLES.PLANILLA).update([{ id: input.lineaId, fields }]);

    await recalcularEstadoPeriodo(datos.periodo.id, input.usuarioEmail);
    return { ok: true, lineaId: input.lineaId, mensaje: `Pago diferido — deuda Q${linea.netoPagar.toFixed(2)} creada.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ============================================================
 * Helper: empleados activos + monto estimado para modal de generar
 * ============================================================ */

export interface PreviewGeneracion {
  cantidadEmpleados: number;
  montoEstimado: number;
  empleados: Array<Pick<Empleado, 'id' | 'nombre' | 'salarioBase'> & { netoEstimado: number }>;
}

export async function previewGeneracion(): Promise<PreviewGeneracion> {
  const empleados = await getEmpleados({ status: 'ACTIVO' });
  let monto = 0;
  const detalle = empleados.map(emp => {
    const calc = calcularQuincena({ empleado: { id: emp.id, nombre: emp.nombre, salarioBase: emp.salarioBase } });
    monto += calc.netoPagar;
    return { id: emp.id, nombre: emp.nombre, salarioBase: emp.salarioBase, netoEstimado: calc.netoPagar };
  });
  return {
    cantidadEmpleados: empleados.length,
    montoEstimado: round2(monto),
    empleados: detalle,
  };
}
