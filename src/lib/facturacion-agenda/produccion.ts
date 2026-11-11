/**
 * FACTURACIÓN AGENDA · Producción por mes de terminación (025) — PURO (sin IO).
 *
 * Tipos del reporte que devuelve la RPC facturacion_produccion_mensual (por mes de
 * `fecha_resultado`, zona Guatemala), línea de negocio del CFO por servicio (gemela de
 * facturacion_linea_negocio en SQL), rangos de meses y el CSV exportable.
 */
import { formatInTimeZone } from 'date-fns-tz';
import { ES_POLIGRAFO, ES_SOCIO, SERVICIO_FEE } from './situacion';

export type LineaNegocio = 'poligrafo' | 'socio' | 'otros';
export const ETIQUETA_LINEA: Record<LineaNegocio, string> = { poligrafo: 'Polígrafo', socio: 'Socioeconómico', otros: 'Otros servicios' };

/** Línea de negocio de un servicio canónico (igual que facturacion_linea_negocio en SQL). */
export function lineaNegocio(servicio: string): LineaNegocio {
  const s = String(servicio ?? '').toUpperCase();
  if (ES_POLIGRAFO(s)) return 'poligrafo';
  if (ES_SOCIO(s) || s === 'SOCIOECONOMICO EMPRESARIAL' || s === SERVICIO_FEE || s === 'VISITA DOMICILIAR') return 'socio';
  return 'otros';
}

/** Totales de un mes (o de un mes × línea / mes × cliente). Montos SIN IVA. */
export interface FilaProduccion {
  mes: string;
  terminado_n: number; terminado_q: number; sin_tarifa_n: number;
  facturado_n: number; facturado_q: number;
  cobrado_n: number; cobrado_q: number;
  /** 034: cubiertas por un paquete prepagado (producidas, valoradas a su precio unitario; no son backlog) */
  cubierta_n: number; cubierta_q: number;
  backlog_n: number; backlog_q: number; backlog_dias_prom: number | null; backlog_dias_max: number | null;
  fuera_cola_n: number; fuera_cola_q: number;
  no_cobra_n: number;
}
export interface FilaProduccionLinea extends FilaProduccion { linea: LineaNegocio }
export interface FilaProduccionCliente extends FilaProduccion { nit_resuelto: string | null; empresa: string }

export interface ProduccionMensual {
  desde: string; hasta: string; hoy: string;
  meses: FilaProduccion[];
  por_servicio: FilaProduccionLinea[];
  por_cliente: FilaProduccionCliente[];
  /** Pruebas `cobra` sin fecha de resultado (no entran en ningún mes): qué tan completo es el dato. */
  sin_fecha: { n: number; q: number; sin_factura_n: number };
  por_fuente: { fuente: string; n: number }[];
  /** Pruebas con fecha de resultado anterior al ingreso (no debería haber: la app las descarta). */
  inconsistencias: number;
}

const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const nOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const fila = <T extends Record<string, unknown>>(r: T): FilaProduccion & T => ({
  ...r, mes: String(r.mes ?? ''),
  terminado_n: n(r.terminado_n), terminado_q: n(r.terminado_q), sin_tarifa_n: n(r.sin_tarifa_n),
  facturado_n: n(r.facturado_n), facturado_q: n(r.facturado_q), cobrado_n: n(r.cobrado_n), cobrado_q: n(r.cobrado_q), cubierta_n: n(r.cubierta_n), cubierta_q: n(r.cubierta_q),
  backlog_n: n(r.backlog_n), backlog_q: n(r.backlog_q), backlog_dias_prom: nOrNull(r.backlog_dias_prom), backlog_dias_max: nOrNull(r.backlog_dias_max),
  fuera_cola_n: n(r.fuera_cola_n), fuera_cola_q: n(r.fuera_cola_q), no_cobra_n: n(r.no_cobra_n),
});

/** Normaliza el jsonb de la RPC (numerics llegan como string) a números. */
export function parseProduccion(raw: unknown): ProduccionMensual {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as Record<string, unknown>[]) : []);
  const sf = (r.sin_fecha ?? {}) as Record<string, unknown>;
  return {
    desde: String(r.desde ?? '').slice(0, 10), hasta: String(r.hasta ?? '').slice(0, 10), hoy: String(r.hoy ?? '').slice(0, 10),
    meses: arr('meses').map(fila),
    por_servicio: arr('por_servicio').map(x => ({ ...fila(x), linea: (String(x.linea ?? 'otros') as LineaNegocio) })),
    por_cliente: arr('por_cliente').map(x => ({ ...fila(x), nit_resuelto: x.nit_resuelto ? String(x.nit_resuelto) : null, empresa: String(x.empresa ?? '—') })),
    sin_fecha: { n: n(sf.n), q: n(sf.q), sin_factura_n: n(sf.sin_factura_n) },
    por_fuente: arr('por_fuente').map(x => ({ fuente: String(x.fuente ?? 'sin_fuente'), n: n(x.n) })),
    inconsistencias: n(r.inconsistencias),
  };
}

/** Suma de las filas por mes (totales del rango). */
export function totalProduccion(filas: readonly FilaProduccion[]): FilaProduccion {
  const t = fila({ mes: 'total' });
  for (const f of filas) {
    t.terminado_n += f.terminado_n; t.terminado_q += f.terminado_q; t.sin_tarifa_n += f.sin_tarifa_n;
    t.facturado_n += f.facturado_n; t.facturado_q += f.facturado_q; t.cobrado_n += f.cobrado_n; t.cobrado_q += f.cobrado_q; t.cubierta_n += f.cubierta_n; t.cubierta_q += f.cubierta_q;
    t.backlog_n += f.backlog_n; t.backlog_q += f.backlog_q; t.fuera_cola_n += f.fuera_cola_n; t.fuera_cola_q += f.fuera_cola_q; t.no_cobra_n += f.no_cobra_n;
    t.backlog_dias_max = Math.max(t.backlog_dias_max ?? 0, f.backlog_dias_max ?? 0) || null;
  }
  for (const k of ['terminado_q', 'facturado_q', 'cobrado_q', 'cubierta_q', 'backlog_q', 'fuera_cola_q'] as const) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

// ── Rangos de meses ──────────────────────────────────────────────────────────

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 'YYYY-MM' válido o null. */
export const mesValido = (s: string | null | undefined): string | null => (s && MES_RE.test(s) ? s : null);
/** Mes actual en Guatemala ('YYYY-MM'). */
export const mesActual = (ahora: Date = new Date()): string => formatInTimeZone(ahora, 'America/Guatemala', 'yyyy-MM');
/** Suma n meses a 'YYYY-MM' (n puede ser negativo). */
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** Primer día del mes y último día del mes ('YYYY-MM-DD'). */
export const primerDia = (mes: string): string => `${mes}-01`;
export function ultimoDia(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
/** Lista de meses entre dos 'YYYY-MM' inclusive (ordenada; vacía si el rango está al revés). */
export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let m = desde; m <= hasta && out.length < 120; m = sumarMeses(m, 1)) out.push(m);
  return out;
}
/** Rango por defecto: los últimos `n` meses hasta el actual. */
export function rangoPorDefecto(n = 6, ahora: Date = new Date()): { desde: string; hasta: string } {
  const hasta = mesActual(ahora);
  return { desde: sumarMeses(hasta, -(n - 1)), hasta };
}

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** 'sep 2026' de '2026-09'. */
export function etiquetaMes(mes: string): string {
  const m = mesValido(mes); if (!m) return mes || '—';
  const [y, mm] = m.split('-');
  return `${MESES_ES[Number(mm) - 1]} ${y}`;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const celda = (v: unknown): string => { const s = v === null || v === undefined ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * CSV del reporte: una sección por mes (totales), por servicio y por cliente, con las mismas
 * columnas. Separador coma, decimales con punto, UTF-8 (con BOM para Excel).
 */
export function csvProduccion(p: ProduccionMensual): string {
  const cab = ['seccion', 'mes', 'linea', 'nit', 'cliente', 'terminado_n', 'terminado_q_sin_iva', 'sin_tarifa_n', 'facturado_n', 'facturado_q_sin_iva', 'cobrado_n', 'cobrado_q_sin_iva', 'cubierta_n', 'cubierta_q_sin_iva', 'backlog_n', 'backlog_q_sin_iva', 'backlog_dias_prom', 'backlog_dias_max', 'fuera_cola_n', 'fuera_cola_q_sin_iva', 'no_cobra_n'];
  const fila = (seccion: string, f: FilaProduccion, linea = '', nit = '', cliente = '') => [seccion, f.mes, linea, nit, cliente, f.terminado_n, f.terminado_q, f.sin_tarifa_n, f.facturado_n, f.facturado_q, f.cobrado_n, f.cobrado_q, f.cubierta_n, f.cubierta_q, f.backlog_n, f.backlog_q, f.backlog_dias_prom ?? '', f.backlog_dias_max ?? '', f.fuera_cola_n, f.fuera_cola_q, f.no_cobra_n].map(celda).join(',');
  const lineas = [cab.join(',')];
  for (const m of p.meses) lineas.push(fila('mes', m));
  lineas.push(fila('total', totalProduccion(p.meses)));
  for (const s of p.por_servicio) lineas.push(fila('servicio', s, ETIQUETA_LINEA[s.linea] ?? s.linea));
  for (const c of p.por_cliente) lineas.push(fila('cliente', c, '', c.nit_resuelto ?? '', c.empresa));
  lineas.push(['sin_fecha', '', '', '', `pruebas cobrables sin fecha de resultado: ${p.sin_fecha.n} (Q${p.sin_fecha.q} sin IVA; ${p.sin_fecha.sin_factura_n} sin factura)`].map(celda).join(','));
  return `﻿${lineas.join('\n')}\n`;
}
