/**
 * FACTURACIÓN AGENDA · FECHA DE RESULTADO por prueba (025) — PURO (sin IO).
 *
 * El CFO mide la PRODUCCIÓN por el mes en que cada prueba tuvo resultado, no por el ingreso
 * (un socio entra hoy y termina 15 días después). La fecha se decide en el mismo paso que la
 * `situacion` (024) y solo para pruebas en `cobra` / `no_cobra` (las pendientes quedan en null).
 *
 * Por orden de prioridad (la primera que exista gana):
 *  1. agenda        → el campo de la Agenda de ESA prueba (polígrafo → fechaResultadoPoligrafo;
 *                     socio / virtual / fee → fechaResultadoSocio). Siempre gana: es la fecha real.
 *  2. detectado     → la primera vez que este sistema vio la prueba pasar a cobra / no_cobra: el
 *                     `ocurrido` del aviso que trajo el cambio, o si llegó por sync, el
 *                     `actualizadoEn` del expediente. La base la fija UNA vez (la RPC no la pisa).
 *  3. fecha_entrega → solo backfill histórico y solo si es confiable: expediente terminado,
 *                     fecha_entrega >= fecha_ingreso y el expediente es de UNA sola prueba (en un
 *                     COMPLETO no sirve para el polígrafo). Para otros servicios (INFORNET, MIDOT,
 *                     BACKGROUND, PDA…) vale la del expediente terminado.
 *  4. sin_dato      → nada confiable. Se cuenta aparte; nunca se inventa.
 * Una fecha anterior a `fechaIngreso` no se usa (cae a la siguiente) y se reporta como inconsistencia.
 *
 * Los nombres de los campos de la Agenda son TENTATIVOS hasta que llegue su documento:
 * `CAMPO_FECHA_RESULTADO` es el ÚNICO lugar donde se cambian (el SQL de la 025 solo los usa en el
 * backfill inicial desde `raw`). Si no vienen, todo sigue funcionando con las otras fuentes.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ES_POLIGRAFO, ES_SOCIO, SERVICIO_FEE, type Situacion } from './situacion';
import type { FuenteFechaResultado } from './tipos';

export type { FuenteFechaResultado };

/** Nombres (tentativos) de los campos nuevos de la Agenda por expediente. Cambiar acá y en ningún otro lado. */
export const CAMPO_FECHA_RESULTADO = { poligrafo: 'fechaResultadoPoligrafo', socio: 'fechaResultadoSocio' } as const;

export const ETIQUETA_FUENTE_FECHA: Record<FuenteFechaResultado, string> = {
  agenda: 'fecha real de la Agenda',
  detectado: 'detectada por este sistema al ver el cambio (aviso o sync)',
  fecha_entrega: 'fecha de entrega del expediente (histórico)',
  sin_dato: 'sin dato confiable',
};

const TZ = 'America/Guatemala';

/** ISO válido → el mismo instante en ISO UTC; 'YYYY-MM-DD' → medianoche de Guatemala. null si no parsea. */
export function normalizarFecha(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = fromZonedTime(`${s}T00:00:00`, TZ); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** 'YYYY-MM-DD' en Guatemala de un instante ISO (o ''). */
export const diaGuatemala = (iso: string | null | undefined): string => { const n = normalizarFecha(iso); return n ? formatInTimeZone(new Date(n), TZ, 'yyyy-MM-dd') : ''; };
/** 'YYYY-MM' en Guatemala de un instante ISO (o ''). */
export const mesGuatemala = (iso: string | null | undefined): string => diaGuatemala(iso).slice(0, 7);

/** ¿La prueba toma su fecha de la Agenda del polígrafo, del socio o de ninguno? */
export function campoFechaDe(servicio: string): keyof typeof CAMPO_FECHA_RESULTADO | null {
  if (ES_POLIGRAFO(servicio)) return 'poligrafo';
  if (ES_SOCIO(servicio) || servicio === SERVICIO_FEE) return 'socio';
  return null;
}

export interface EntradaFechaResultado {
  fechaIngreso?: string | null;
  fechaEntrega?: string | null;
  terminado?: boolean | null;
  actualizadoEn?: string | null;
}

/** Las dos fechas de la Agenda tal como vienen en el expediente (por el nombre tentativo), normalizadas a ISO. */
export function fechasResultadoDeAgenda(exp: object): { poligrafo: string | null; socio: string | null } {
  const r = exp as Record<string, unknown>;
  return { poligrafo: normalizarFecha(r[CAMPO_FECHA_RESULTADO.poligrafo]), socio: normalizarFecha(r[CAMPO_FECHA_RESULTADO.socio]) };
}

export interface FechaResultado {
  /** ISO UTC o null (pendiente / sin dato). */
  fecha: string | null;
  /** null solo cuando la prueba está pendiente. */
  fuente: FuenteFechaResultado | null;
  /** Aviso cuando una fecha se descartó por ser anterior al ingreso. */
  inconsistencia: string | null;
}

/**
 * Fecha de resultado candidata de UNA prueba. `unaPrueba` = el expediente cobra un solo servicio;
 * `detectadoEn` = `ocurrido` del aviso que trajo el cambio (si vino por webhook).
 */
export function fechaResultadoDe(exp: EntradaFechaResultado & object, servicio: string, situacion: Situacion, opts: { unaPrueba: boolean; detectadoEn?: string | null }): FechaResultado {
  if (situacion === 'pendiente') return { fecha: null, fuente: null, inconsistencia: null };
  const ingreso = (exp.fechaIngreso ?? '').slice(0, 10);
  const antesDelIngreso = (iso: string) => !!ingreso && diaGuatemala(iso) < ingreso;
  const inconsistencias: string[] = [];
  // 1. agenda
  const campo = campoFechaDe(servicio);
  const agenda = campo ? fechasResultadoDeAgenda(exp)[campo] : null;
  if (agenda) {
    if (!antesDelIngreso(agenda)) return { fecha: agenda, fuente: 'agenda', inconsistencia: null };
    inconsistencias.push(`la Agenda trae ${CAMPO_FECHA_RESULTADO[campo!]} (${diaGuatemala(agenda)}) anterior al ingreso (${ingreso}): no se usa`);
  }
  // 2. detectado
  const detectado = normalizarFecha(opts.detectadoEn) ?? normalizarFecha(exp.actualizadoEn);
  if (detectado && !antesDelIngreso(detectado)) return { fecha: detectado, fuente: 'detectado', inconsistencia: inconsistencias.join(' · ') || null };
  // 3. fecha_entrega confiable
  const entrega = normalizarFecha(exp.fechaEntrega);
  if (entrega && exp.terminado) {
    if (antesDelIngreso(entrega)) inconsistencias.push(`fechaEntrega (${diaGuatemala(entrega)}) anterior al ingreso (${ingreso}): no se usa`);
    else if (opts.unaPrueba || !campo) return { fecha: entrega, fuente: 'fecha_entrega', inconsistencia: inconsistencias.join(' · ') || null };
  }
  // 4. sin dato
  return { fecha: null, fuente: 'sin_dato', inconsistencia: inconsistencias.join(' · ') || null };
}
