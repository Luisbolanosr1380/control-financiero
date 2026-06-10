/**
 * F-050 — Resuelve el período contable de una fecha respetando devengo.
 *
 * Convención CFO: el asiento va al período de FECHA_EMISION (no al de
 * aprobación). Si ese período está cerrado, se ajusta al período actual
 * abierto y se documenta la nota en la descripción del asiento.
 *
 * Nomenclatura: `resolverPeriodoContable` para no colisionar con
 * `resolverPeriodo` (src/lib/db/periodos.ts) que calcula rangos para AI
 * tools. Semánticas distintas.
 *
 * Sobre los valores del singleSelect ESTADO en PERIODOS: el brief da los
 * field IDs (fldf4hhgArYRTpBmB período / fld3yjofU7JcJbl3Q estado) pero no
 * los valores literales. La función trata como "abierto" cualquier valor
 * que case-insensitive empiece con "abie", "activ" o "open"; todo lo demás
 * lo considera cerrado. Si Stark usa otros literales, basta con extender
 * el `esEstadoAbierto`.
 */

import { airtable, TABLES } from '@/lib/db/airtable';
import { notaAjustePeriodo } from './composer-descripcion';

/**
 * F-050 STUB de coordinación: el codebase ya tiene `TABLES.PERIODOS` para
 * períodos de PLANILLA (quincenas). El brief F-050 habla de períodos
 * CONTABLES (cierre mensual). Posibles escenarios:
 *  a) Stark usa la MISMA tabla — entonces este const queda igual y la
 *     función filtra por nombre "YYYY-MM".
 *  b) Stark tiene tabla separada — entonces hay que pasar el tableId real
 *     acá. Editar 1 línea cuando se confirme.
 * Por defecto apuntamos al `TABLES.PERIODOS` actual; si la lectura no
 * devuelve registros con el nombre esperado, el caller verá el error
 * "No existe período YYYY-MM en la tabla PERIODOS".
 */
const PERIODOS_TABLE_ID = TABLES.PERIODOS;
const PERIODOS_FIELDS = {
  periodo: 'fldf4hhgArYRTpBmB',                 // singleLineText o singleSelect "YYYY-MM"
  estado:  'fld3yjofU7JcJbl3Q',                 // singleSelect Abierto/Cerrado (literales por confirmar)
} as const;

function esEstadoAbierto(valor: string): boolean {
  const s = valor.toLowerCase().trim();
  return s.startsWith('abie') || s.startsWith('activ') || s.startsWith('open');
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
    return { id: r.id, nombre, abierto: esEstadoAbierto(estado) };
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
