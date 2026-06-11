/**
 * F-050 — Resuelve el período contable de una fecha respetando devengo.
 *
 * Convención CFO: el asiento va al período de FECHA_EMISION (no al de
 * aprobación). Si ese período está EXPLÍCITAMENTE cerrado, se ajusta al
 * período actual y se documenta la nota en la descripción del asiento.
 *
 * Nomenclatura: `resolverPeriodoContable` para no colisionar con
 * `resolverPeriodo` (src/lib/db/periodos.ts) que calcula rangos para AI
 * tools. Semánticas distintas.
 *
 * Semántica RESTRICTIVA del estado: la tabla PERIODOS es la misma que usa
 * planilla; sus estados ("En pago", "Pagado", etc.) son workflow operacional
 * de planilla, NO estado contable. Por eso solo bloqueamos cuando el estado
 * es literalmente "cerrado"/"closed". Cualquier otro valor (vacío, "abierto",
 * "activo", "en pago", "pagado", etc.) permite registrar asientos contables.
 */

import { airtable } from '@/lib/db/airtable';
import { notaAjustePeriodo } from './composer-descripcion';

/**
 * F-050 — la tabla PERIODOS es COMPARTIDA con planilla (no hay separación
 * contable vs. operacional). Hardcodeamos el ID literal para no depender de
 * `TABLES.PERIODOS` y dejar explícito que es la misma tabla.
 */
const PERIODOS_TABLE_ID = 'tblag6GLysk6erzlU';
const PERIODOS_FIELDS = {
  periodo:      'fldf4hhgArYRTpBmB',  // primary, ej "Q1-junio-2026"
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
  ajustado: boolean;
  notaAjuste?: string;
}

/** Extrae el "YYYY-MM" de una fecha YYYY-MM-DD sin shift UTC. */
function periodoDeFecha(fechaIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fechaIso)) {
    throw new Error(`Fecha inválida: "${fechaIso}" (esperado YYYY-MM-DD).`);
  }
  return fechaIso.slice(0, 7);
}

/** Devuelve el "YYYY-MM" del mes actual en hora Guatemala. */
function periodoActualGT(): string {
  // Reusamos obtenerFechaHoyGuatemala via import dinámico para evitar
  // dependencia top-level innecesaria (este servicio es server-only y la
  // función de fechas vive en utils/fechas.ts).
  // Constructor local: cero UTC shift (lección F-041).
  const now = new Date();
  // America/Guatemala = UTC-6 fija. Convertimos restando 6h del epoch y
  // tomando getUTCFullYear/Month sobre ese pivot.
  const guate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const y = guate.getUTCFullYear();
  const m = String(guate.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

interface PeriodoRow {
  id: string;
  nombre: string;
  abierto: boolean;
}

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

export async function resolverPeriodoContable(fechaEmision: string): Promise<PeriodoResolucion> {
  const objetivo = periodoDeFecha(fechaEmision);
  const periodos = await listarPeriodos();
  const byNombre = new Map(periodos.map(p => [p.nombre, p]));

  const original = byNombre.get(objetivo);

  if (original && original.abierto) {
    return { recordId: original.id, nombrePeriodo: original.nombre, ajustado: false };
  }

  // Período de la fecha está cerrado o no existe en la tabla. Caemos al
  // actual abierto y documentamos el ajuste.
  const actualNombre = periodoActualGT();
  const actual = byNombre.get(actualNombre);
  if (!actual) {
    throw new Error(`No existe período "${actualNombre}" en la tabla PERIODOS. Stark debe crearlo antes de aprobar facturas.`);
  }
  if (!actual.abierto) {
    throw new Error(`El período actual "${actualNombre}" está cerrado. No hay dónde devengar la factura.`);
  }
  return {
    recordId: actual.id,
    nombrePeriodo: actual.nombre,
    ajustado: true,
    notaAjuste: notaAjustePeriodo(objetivo, actual.nombre),
  };
}
