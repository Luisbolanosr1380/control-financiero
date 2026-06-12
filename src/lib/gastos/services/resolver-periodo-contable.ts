/**
 * F-050 — Resuelve el período contable mensual de una fecha.
 *
 * Convención CFO: el asiento va al período "YYYY-MM" derivado de
 * FECHA_EMISION (no al de aprobación).
 *
 * F-050.4 — semántica final (reemplaza el comportamiento original de
 * "caer al período actual con nota de ajuste"):
 *
 *   1. Si el período "YYYY-MM" EXISTE y NO está cerrado → usarlo.
 *   2. Si el período EXISTE y está CERRADO → error claro inmediato.
 *      No se redirige a otro período, no se duplica, no se ajusta.
 *      El usuario debe reabrir el período o aprobar el gasto contra
 *      uno abierto si corresponde.
 *   3. Si el período NO EXISTE → se crea automáticamente con estado
 *      "Abierto" (typecast:true), fechas YYYY-MM-01 a último día del
 *      mes, y se usa de inmediato. Mata el "primera factura del mes
 *      siempre falla" — el problema que se repetía cada 1° del mes.
 *
 * Nomenclatura: `resolverPeriodoContable` para no colisionar con
 * `resolverPeriodo` (src/lib/db/periodos.ts) que calcula rangos para
 * AI tools. Semánticas distintas.
 *
 * Semántica RESTRICTIVA del estado: la tabla PERIODOS es la misma que
 * usa planilla; sus estados ("En pago", "Pagado", etc.) son workflow
 * operacional de planilla, NO estado contable. Por eso solo bloqueamos
 * cuando el estado es literalmente "cerrado"/"closed". Cualquier otro
 * valor (vacío, "abierto", "activo", "en pago", "pagado", etc.) permite
 * registrar asientos contables.
 *
 * Concurrencia (caso borde): si dos aprobaciones simultáneas detectan
 * el período como inexistente, ambas intentarían crearlo. Mitigamos
 * con una re-lectura inmediata antes del create (ventana en
 * milisegundos, no segundos). Si aún así se cuela un duplicado por
 * race más estrecho que la latencia de Airtable, queda como cleanup
 * manual — el sistema sigue funcionando porque ambos registros son
 * válidos para escribir asientos.
 */

import { airtable } from '@/lib/db/airtable';

const PERIODOS_TABLE_ID = 'tblag6GLysk6erzlU';
const PERIODOS_FIELDS = {
  periodo:      'fldf4hhgArYRTpBmB',  // primary, ej "2026-06"
  fecha_inicio: 'fldOhtnrlZayciWDx',
  fecha_fin:    'fldVzilClkgkJmQng',
  estado:       'fld3yjofU7JcJbl3Q',
  notas:        'fldzdvleOjjByTEmt',
  asientos:     'fld0fsS2TPAJ5Dwu8',
} as const;

function esEstadoCerrado(valor: string): boolean {
  const s = valor.toLowerCase().trim();
  return s === 'cerrado' || s === 'closed';
}

export interface PeriodoResolucion {
  recordId: string;
  nombrePeriodo: string;
  /**
   * F-050.4: con la nueva semántica este flag siempre es `false` —
   * ya no caemos al período actual con nota de ajuste. Lo conservamos
   * en la interface por compat de los call-sites existentes.
   */
  ajustado: boolean;
  /** F-050.4: nunca se llena con la semántica actual. Se conserva por compat. */
  notaAjuste?: string;
}

/** Extrae el "YYYY-MM" de una fecha YYYY-MM-DD. Comparación de strings, sin Date (F-041). */
function periodoDeFecha(fechaIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fechaIso)) {
    throw new Error(`Fecha inválida: "${fechaIso}" (esperado YYYY-MM-DD).`);
  }
  return fechaIso.slice(0, 7);
}

interface PeriodoRow {
  id: string;
  nombre: string;
  abierto: boolean;
}

/**
 * Lee TODOS los períodos por field ID (regla F-050.2: nunca
 * filterByFormula con field IDs — devuelve 0 records silencioso).
 * Filtramos en JS por nombre exacto.
 */
async function listarPeriodos(): Promise<PeriodoRow[]> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const records = await airtable(PERIODOS_TABLE_ID)
    .select({ returnFieldsByFieldId: true })
    .all();
  return records.map(r => {
    const fields = r.fields as Record<string, unknown>;
    const nombreRaw = fields[PERIODOS_FIELDS.periodo];
    const estadoRaw = fields[PERIODOS_FIELDS.estado];
    const nombre = String(Array.isArray(nombreRaw) ? nombreRaw[0] : (nombreRaw ?? '')).trim();
    const estado = String(Array.isArray(estadoRaw) ? estadoRaw[0] : (estadoRaw ?? '')).trim();
    return { id: r.id, nombre, abierto: !esEstadoCerrado(estado) };
  });
}

/**
 * F-050.4: crea un período "Abierto" para el mes "YYYY-MM" dado.
 *
 * Fechas: constructor local `new Date(y, m, 0)` = día 0 del mes
 * siguiente = último día del mes actual. Sin shift UTC (F-041).
 *
 * typecast:true: la tabla PERIODOS la comparte planilla — su set de
 * opciones del singleSelect puede no incluir "Abierto". typecast
 * la auto-crea sin romper.
 */
async function crearPeriodoAbierto(nombre: string): Promise<PeriodoRow> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const [y, m] = nombre.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    throw new Error(`Nombre de período inválido: "${nombre}" (esperado YYYY-MM).`);
  }
  const ultimoDia = new Date(y, m, 0).getDate();
  const fechaInicio = `${nombre}-01`;
  const fechaFin    = `${nombre}-${String(ultimoDia).padStart(2, '0')}`;

  type AField = string | number | boolean | undefined;
  const fields: Record<string, AField> = {
    [PERIODOS_FIELDS.periodo]:      nombre,
    [PERIODOS_FIELDS.fecha_inicio]: fechaInicio,
    [PERIODOS_FIELDS.fecha_fin]:    fechaFin,
    [PERIODOS_FIELDS.estado]:       'Abierto',
    [PERIODOS_FIELDS.notas]:        'Creado automáticamente por el sistema (F-050.4)',
  };

  const created = (await (airtable(PERIODOS_TABLE_ID).create as unknown as (
    records: Array<{ fields: Record<string, AField> }>,
    opts: { typecast: boolean },
  ) => Promise<Array<{ id: string }>>)([{ fields }], { typecast: true }));

  return { id: created[0].id, nombre, abierto: true };
}

export async function resolverPeriodoContable(fechaEmision: string): Promise<PeriodoResolucion> {
  const objetivo = periodoDeFecha(fechaEmision);

  // 1) Primer intento de lectura.
  const periodos = await listarPeriodos();
  const existente = periodos.find(p => p.nombre === objetivo);

  if (existente) {
    if (!existente.abierto) {
      throw new Error(
        `El período ${objetivo} está cerrado — no se pueden registrar gastos en él.`,
      );
    }
    return { recordId: existente.id, nombrePeriodo: existente.nombre, ajustado: false };
  }

  // 2) No existe — re-leer inmediatamente antes de crear para mitigar la
  //    ventana de race entre dos aprobaciones simultáneas. Si la otra
  //    request lo creó en este ínterin, lo reutilizamos.
  const periodos2 = await listarPeriodos();
  const reaparecido = periodos2.find(p => p.nombre === objetivo);
  if (reaparecido) {
    if (!reaparecido.abierto) {
      throw new Error(
        `El período ${objetivo} está cerrado — no se pueden registrar gastos en él.`,
      );
    }
    return { recordId: reaparecido.id, nombrePeriodo: reaparecido.nombre, ajustado: false };
  }

  // 3) Crear el período abierto y usarlo de inmediato.
  const creado = await crearPeriodoAbierto(objetivo);
  return { recordId: creado.id, nombrePeriodo: creado.nombre, ajustado: false };
}
