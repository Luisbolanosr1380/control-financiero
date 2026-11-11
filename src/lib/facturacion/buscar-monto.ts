/**
 * BUSCAR FACTURAS POR MONTO, RANGO Y ESTADO — PURO (sin IO; va al navegador y al servidor).
 *
 * El CFO busca facturas por valor todos los días (identificar depósitos, conciliar): «todas las pagadas de Q8,000»,
 * «entre Q8,000 y Q10,000 de cualquier mes», «a qué factura corresponde un depósito de Q9,450». Acá viven:
 *  - el parser del buscador de texto: `8000`, `8,000`, `Q8000`, `9450.50`, `8 mil`, `8000-10000`, `8000 a 10000`,
 *    `entre 8000 y 10000` → monto o rango; cualquier otra cosa (y un número de más de 7 dígitos sin separador, que
 *    es un número de factura) → texto;
 *  - los criterios combinables y su ida y vuelta con la URL (la búsqueda se comparte y no se pierde al volver);
 *  - el filtro y el orden sobre facturas ya consolidadas (una factura = la suma de sus líneas vivas).
 */

import { coincideCliente, normalizarBusqueda } from '@/lib/clientes/buscar';

export type SobreMonto = 'total' | 'subtotal' | 'saldo';
export type EstadoBusqueda = 'todas' | 'pagadas' | 'pendientes' | 'parcial' | 'anuladas';
export const TOLERANCIA_DEFAULT = 1;   // ±Q1: los depósitos llegan con centavos de diferencia
export const ETIQUETA_SOBRE: Record<SobreMonto, string> = { total: 'total con IVA', subtotal: 'subtotal sin IVA', saldo: 'saldo pendiente' };
export const ETIQUETA_ESTADO_BUSQUEDA: Record<EstadoBusqueda, string> = { todas: 'todas', pagadas: 'pagadas', pendientes: 'pendientes', parcial: 'cobro parcial', anuladas: 'anuladas' };

export interface CriteriosBusqueda {
  /** monto exacto (con tolerancia) */ monto?: number; tol?: number;
  /** rango «de» / «hasta» */ desde?: number; hasta?: number;
  sobre: SobreMonto; estado: EstadoBusqueda;
  /** emisión desde / hasta (YYYY-MM-DD) */ emisionDesde?: string; emisionHasta?: string;
  /** número de factura, cliente o NIT */ texto?: string;
  /** IDENTIFICAR PAGO: la tolerancia viene ampliada para cubrir la retención de IVA esperada (el chip lo avisa) */ aviso?: 'retencion';
}
export const CRITERIOS_VACIOS: CriteriosBusqueda = { sobre: 'total', estado: 'todas' };

export type Interpretacion =
  | { tipo: 'vacio' }
  | { tipo: 'monto'; monto: number }
  | { tipo: 'rango'; desde: number; hasta: number }
  | { tipo: 'texto'; texto: string };

const NUM = String.raw`q?\.?\s*(\d[\d,]*(?:\.\d+)?)\s*(mil)?`;
const RE_MONTO = new RegExp(`^${NUM}$`, 'i');
const RE_RANGO = new RegExp(`^(?:entre\\s+|de\\s+|desde\\s+)?${NUM}\\s*(?:-|–|—|a|hasta|y|al)\\s*${NUM}$`, 'i');

/** Un número de más de 7 dígitos sin separador es un número de factura, no un monto. */
const aNumero = (digitos: string, mil: string | undefined): number | null => {
  const sinComas = digitos.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(sinComas)) return null;
  if (!mil && !digitos.includes(',') && !sinComas.includes('.') && sinComas.length > 7) return null;
  const v = Number(sinComas) * (mil ? 1000 : 1);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
};

export function interpretarBusqueda(entrada: string): Interpretacion {
  const t = String(entrada ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return { tipo: 'vacio' };
  const r = RE_RANGO.exec(t);
  if (r) {
    const a = aNumero(r[1], r[2]), b = aNumero(r[3], r[4]);
    if (a !== null && b !== null) return { tipo: 'rango', desde: Math.min(a, b), hasta: Math.max(a, b) };
  }
  const m = RE_MONTO.exec(t);
  if (m) { const v = aNumero(m[1], m[2]); if (v !== null) return { tipo: 'monto', monto: v }; }
  return { tipo: 'texto', texto: t };
}

/** true si hay algo que buscar en el servidor: monto, rango, estado distinto de todas, fechas o TEXTO (cliente, NIT o número; SEGUIMIENTO DE COBRO: «fogel» con Enter busca en todas las facturas, sin el mes). */
export const hayBusquedaServidor = (c: CriteriosBusqueda): boolean =>
  c.monto !== undefined || c.desde !== undefined || c.hasta !== undefined || c.estado !== 'todas' || !!c.emisionDesde || !!c.emisionHasta || !!c.texto;

const num = (v: string | null | undefined): number | undefined => { const n = Number(String(v ?? '').replace(/,/g, '')); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined; };
const fecha = (v: string | null | undefined): string | undefined => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);

/** Criterios desde los params de la URL (`monto`, `tol`, `desde`, `hasta`, `sobre`, `estado`, `edesde`, `ehasta`, `q`). Valores inválidos se ignoran. */
export function criteriosDesdeParams(get: (k: string) => string | null | undefined): CriteriosBusqueda {
  const sobre = get('sobre'), estado = get('estado');
  const c: CriteriosBusqueda = {
    monto: num(get('monto')), tol: num(get('tol')), desde: num(get('desde')), hasta: num(get('hasta')),
    sobre: sobre === 'subtotal' || sobre === 'saldo' ? sobre : 'total',
    estado: estado === 'pagadas' || estado === 'pendientes' || estado === 'parcial' || estado === 'anuladas' ? estado : 'todas',
    emisionDesde: fecha(get('edesde')), emisionHasta: fecha(get('ehasta')),
    texto: String(get('q') ?? '').trim().slice(0, 80) || undefined,
    aviso: get('aviso') === 'retencion' ? 'retencion' : undefined,
  };
  if (c.monto !== undefined) { c.desde = undefined; c.hasta = undefined; if (c.tol === undefined) c.tol = TOLERANCIA_DEFAULT; }
  else c.tol = undefined;
  if (c.desde !== undefined && c.hasta !== undefined && c.desde > c.hasta) [c.desde, c.hasta] = [c.hasta, c.desde];
  if (c.emisionDesde && c.emisionHasta && c.emisionDesde > c.emisionHasta) [c.emisionDesde, c.emisionHasta] = [c.emisionHasta, c.emisionDesde];
  return c;
}

/** Params de la URL a partir de los criterios (sin los vacíos ni los valores por defecto). Conserva otros params (tab, mes). */
export function paramsDeCriterios(c: CriteriosBusqueda, base?: URLSearchParams): string {
  const p = new URLSearchParams(base ?? '');
  for (const k of ['monto', 'tol', 'desde', 'hasta', 'sobre', 'estado', 'edesde', 'ehasta', 'q', 'aviso']) p.delete(k);
  if (c.monto !== undefined) { p.set('monto', String(c.monto)); if (c.tol !== undefined && c.tol !== TOLERANCIA_DEFAULT) p.set('tol', String(c.tol)); }
  else { if (c.desde !== undefined) p.set('desde', String(c.desde)); if (c.hasta !== undefined) p.set('hasta', String(c.hasta)); }
  if (c.sobre !== 'total') p.set('sobre', c.sobre);
  if (c.estado !== 'todas') p.set('estado', c.estado);
  if (c.emisionDesde) p.set('edesde', c.emisionDesde);
  if (c.emisionHasta) p.set('ehasta', c.emisionHasta);
  if (c.texto) p.set('q', c.texto);
  if (c.aviso) p.set('aviso', c.aviso);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

const Qf = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** «Monto entre Q8,000 y Q10,000 · todas» / «Monto Q9,450 ±Q1 · pendientes · sobre saldo pendiente · emitidas desde …». */
export function describirCriterios(c: CriteriosBusqueda): string {
  const partes: string[] = [];
  if (c.monto !== undefined) partes.push(`Monto ${Qf(c.monto)}${c.tol ? ` ±${Qf(c.tol)}` : ' exacto'}`);
  else if (c.desde !== undefined && c.hasta !== undefined) partes.push(`Monto entre ${Qf(c.desde)} y ${Qf(c.hasta)}`);
  else if (c.desde !== undefined) partes.push(`Monto desde ${Qf(c.desde)}`);
  else if (c.hasta !== undefined) partes.push(`Monto hasta ${Qf(c.hasta)}`);
  partes.push(ETIQUETA_ESTADO_BUSQUEDA[c.estado]);
  if (c.sobre !== 'total') partes.push(`sobre ${ETIQUETA_SOBRE[c.sobre]}`);
  if (c.emisionDesde && c.emisionHasta) partes.push(`emitidas del ${fechaCorta(c.emisionDesde)} al ${fechaCorta(c.emisionHasta)}`);
  else if (c.emisionDesde) partes.push(`emitidas desde ${fechaCorta(c.emisionDesde)}`);
  else if (c.emisionHasta) partes.push(`emitidas hasta ${fechaCorta(c.emisionHasta)}`);
  if (c.texto) partes.push(`«${c.texto}»`);
  if (c.aviso === 'retencion') partes.push('tolerancia que cubre la retención de IVA');
  return partes.join(' · ');
}

/* ───────────── filtro y orden sobre facturas consolidadas ───────────── */

export type EstadoFila = 'cobrada' | 'parcial' | 'pendiente' | 'emitida' | 'anulada' | 'refacturada' | 'otro';

/** Lo mínimo que necesita el filtro: una factura ya consolidada (suma de líneas vivas; las anuladas / refacturadas son filas aparte). */
export interface FacturaBuscable {
  noFactura: string; fechaEmision: string; clienteNombre: string; nit: string;
  total: number; subtotal: number; saldo: number;
  /** regla 026 (facturacion_factura_cobrada): todas las líneas vivas cobradas */ cobrada: boolean;
  estado: EstadoFila;
  /** otros nombres del cliente (razón social, nombre comercial, aliases): la búsqueda por texto los mira todos */ clienteNombres?: string[];
}

export const montoSegun = (f: Pick<FacturaBuscable, 'total' | 'subtotal' | 'saldo'>, sobre: SobreMonto): number => sobre === 'subtotal' ? f.subtotal : sobre === 'saldo' ? f.saldo : f.total;

const EPS = 0.005;

/** Texto contra número de factura, NIT y TODOS los nombres del cliente (nombre, razón social, nombre comercial, aliases), sin tildes ni mayúsculas (src/lib/clientes/buscar.ts). */
export const coincideTexto = (f: Pick<FacturaBuscable, 'noFactura' | 'clienteNombre' | 'nit' | 'clienteNombres'>, texto: string): boolean => {
  const t = normalizarBusqueda(texto);
  if (!t) return true;
  if (normalizarBusqueda(f.noFactura).includes(t)) return true;
  return coincideCliente({ id: f.noFactura, name: f.clienteNombre, nit: f.nit, aliases: f.clienteNombres ?? null }, texto);
};

export function coincideCriterios(f: FacturaBuscable, c: CriteriosBusqueda): boolean {
  const esAnulada = f.estado === 'anulada' || f.estado === 'refacturada';
  switch (c.estado) {
    case 'anuladas': if (!esAnulada) return false; break;
    case 'pagadas': if (esAnulada || !f.cobrada) return false; break;
    case 'parcial': if (esAnulada || f.estado !== 'parcial') return false; break;
    case 'pendientes': if (esAnulada || f.cobrada || f.estado === 'parcial') return false; break;
    default: if (esAnulada) return false;   // todas = sin anuladas ni refacturadas, salvo que se pidan
  }
  const m = montoSegun(f, c.sobre);
  if (c.monto !== undefined && Math.abs(m - c.monto) > (c.tol ?? TOLERANCIA_DEFAULT) + EPS) return false;
  if (c.desde !== undefined && m < c.desde - EPS) return false;
  if (c.hasta !== undefined && m > c.hasta + EPS) return false;
  if (c.emisionDesde && f.fechaEmision < c.emisionDesde) return false;
  if (c.emisionHasta && f.fechaEmision > c.emisionHasta) return false;
  if (c.texto && !coincideTexto(f, c.texto)) return false;
  return true;
}

/** Por cercanía al monto buscado cuando es monto exacto (empate: fecha desc); por fecha desc en los demás casos. */
export function ordenarResultados<T extends FacturaBuscable>(filas: T[], c: CriteriosBusqueda): T[] {
  const out = [...filas];
  if (c.monto !== undefined) {
    const d = (f: T) => Math.abs(montoSegun(f, c.sobre) - c.monto!);
    out.sort((a, b) => d(a) - d(b) || b.fechaEmision.localeCompare(a.fechaEmision) || a.noFactura.localeCompare(b.noFactura));
  } else out.sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision) || a.noFactura.localeCompare(b.noFactura));
  return out;
}
