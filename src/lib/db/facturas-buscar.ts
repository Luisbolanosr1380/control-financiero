/**
 * BUSCAR FACTURAS POR MONTO, RANGO Y ESTADO — en el servidor, sobre TODAS las facturas (no sobre las 50 cargadas
 * ni sobre el mes elegido).
 *
 * Datos: `facturas_clientes` tiene VARIAS filas por factura (una por línea / centro de costo): el monto de la factura
 * es la suma por `no_factura` de sus líneas VIVAS; las anuladas y refacturadas no suman y van como filas aparte (igual
 * que la consolidación del listado). «Pagada» es la regla 026 (`facturaCobrada`, espejo de `facturacion_factura_cobrada`:
 * nunca se compara el texto crudo; «COBRADO » lleva un espacio al final a propósito). Cobrado = cobros ACTIVOS (un cobro
 * anulado no reduce el saldo, F-036); saldo = total − cobrado − NC activas (F-045); fecha de cobro = el último cobro activo.
 */
import { fetchAll } from '@/lib/supabase/client';
import { dataSource } from '@/lib/config/data-source';
import { esLineaInactiva, estadoFacturaCanon, facturaCobrada } from '@/lib/facturacion-agenda/estado-factura';
import { coincideCriterios, montoSegun, ordenarResultados, type CriteriosBusqueda, type EstadoFila, type FacturaBuscable } from '@/lib/facturacion/buscar-monto';

export interface FacturaBuscada extends FacturaBuscable {
  /** id del listado (/facturacion/<id>): la línea principal, como en la consolidación */ id: string;
  clienteId: string | null; iva: number; cobrado: number; ncs: number; fechaCobro: string | null; lineas: number;
  /** diferencia contra el monto buscado (solo con monto exacto) */ diff?: number;
}
export interface ResultadoBusqueda {
  filas: FacturaBuscada[];
  /** sobre TODAS las coincidencias (las filas pueden venir acotadas) */ cantidad: number; suma: number; sumaSaldo: number;
  /** cuántas facturas consolidadas se revisaron */ universo: number;
  limitado: boolean; error?: string;
}
export const TOPE_FILAS_BUSQUEDA = 500;

type FilaFactura = { id: string; airtable_id: string | null; no_factura: string | null; cliente_id: string | null; fecha_emision: string | null; subtotal: number | string | null; iva: number | string | null; total: number | string | null; estado: string | null; cliente: { airtable_id: string | null; razon_social: string | null; nombre_empresa: string | null; nit: string | null; nombre_comercial?: string | null; aliases?: string[] | null } | null };
type FilaCobro = { factura_id: string | null; monto_cobrado: number | string | null; fecha_cobro: string | null; estado_cobro: string | null };
type FilaNc = { factura_id: string | null; monto: number | string | null; estado: string | null };

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const round2 = (v: number) => Math.round(v * 100) / 100;

function estadoDe(estados: string[], cobrada: boolean): EstadoFila {
  if (cobrada) return 'cobrada';
  if (estados.includes('COBRADO PARCIAL')) return 'parcial';
  if (estados.includes('PENDIENTE')) return 'pendiente';
  if (estados.some(e => e === 'EMITIDA' || e === 'EMITIDO')) return 'emitida';
  return 'otro';
}

/** Consolida las filas crudas en facturas (puro; el validador lo usa con filas sembradas). */
export function consolidarParaBusqueda(filas: FilaFactura[], cobros: FilaCobro[], ncs: FilaNc[]): FacturaBuscada[] {
  const cobradoPorLinea = new Map<string, { monto: number; ultima: string | null }>();
  for (const c of cobros) {
    if (!c.factura_id || estadoFacturaCanon(c.estado_cobro) === 'ANULADO') continue;   // F-036: solo cobros activos
    const prev = cobradoPorLinea.get(c.factura_id) ?? { monto: 0, ultima: null };
    const f = c.fecha_cobro ? String(c.fecha_cobro).slice(0, 10) : null;
    cobradoPorLinea.set(c.factura_id, { monto: prev.monto + n(c.monto_cobrado), ultima: f && (!prev.ultima || f > prev.ultima) ? f : prev.ultima });
  }
  const ncPorLinea = new Map<string, number>();
  for (const x of ncs) { if (!x.factura_id || String(x.estado ?? '').trim() !== 'Activa') continue; ncPorLinea.set(x.factura_id, (ncPorLinea.get(x.factura_id) ?? 0) + n(x.monto)); }   // F-045
  // buckets como la consolidación del listado: líneas vivas por no_factura; anuladas / refacturadas cada una aparte
  const buckets = new Map<string, FilaFactura[]>();
  for (const f of filas) {
    const nf = String(f.no_factura ?? '').trim() || String(f.id);
    const key = esLineaInactiva(f.estado) ? `${nf}__${estadoFacturaCanon(f.estado)}__${f.id}` : nf;
    buckets.set(key, [...(buckets.get(key) ?? []), f]);
  }
  const out: FacturaBuscada[] = [];
  for (const [, lineas] of buckets) {
    const principal = lineas.reduce((a, b) => (n(b.total) > n(a.total) ? b : a));
    const estados = lineas.map(l => estadoFacturaCanon(l.estado));
    const inactiva = esLineaInactiva(principal.estado);
    const cobrada = !inactiva && facturaCobrada(estados);
    const total = round2(lineas.reduce((s, l) => s + n(l.total), 0));
    const subtotal = round2(lineas.reduce((s, l) => s + (l.subtotal != null ? n(l.subtotal) : n(l.total) - n(l.iva)), 0));
    const iva = round2(lineas.reduce((s, l) => s + n(l.iva), 0));
    let cobrado = 0, ncsMonto = 0, fechaCobro: string | null = null;
    for (const l of lineas) { const c = cobradoPorLinea.get(l.id); if (c) { cobrado += c.monto; if (c.ultima && (!fechaCobro || c.ultima > fechaCobro)) fechaCobro = c.ultima; } ncsMonto += ncPorLinea.get(l.id) ?? 0; }
    cobrado = round2(cobrado); ncsMonto = round2(ncsMonto);
    const saldo = inactiva ? 0 : round2(Math.max(0, total - cobrado - ncsMonto));
    const cli = principal.cliente;
    out.push({
      id: String(principal.airtable_id ?? principal.id), noFactura: String(principal.no_factura ?? '').trim(), fechaEmision: String(principal.fecha_emision ?? '').slice(0, 10),
      clienteId: cli?.airtable_id ?? principal.cliente_id ?? null, clienteNombre: String(cli?.nombre_empresa || cli?.razon_social || '').trim(), nit: String(cli?.nit ?? '').trim(),
      clienteNombres: [cli?.razon_social, cli?.nombre_comercial, ...(Array.isArray(cli?.aliases) ? cli!.aliases! : [])].map(x => String(x ?? '').trim()).filter(Boolean),
      total, subtotal, iva, cobrado, ncs: ncsMonto, saldo, cobrada,
      estado: inactiva ? (estadoFacturaCanon(principal.estado).startsWith('REFACTURAD') ? 'refacturada' : 'anulada') : estadoDe(estados, cobrada),
      fechaCobro, lineas: lineas.length,
    });
  }
  return out;
}

/** Aplica los criterios y arma el resultado (puro). */
export function resultadoDe(facturas: FacturaBuscada[], c: CriteriosBusqueda): ResultadoBusqueda {
  const coinciden = ordenarResultados(facturas.filter(f => coincideCriterios(f, c)), c).map(f => (c.monto !== undefined ? { ...f, diff: round2(montoSegun(f, c.sobre) - c.monto) } : f));
  return {
    filas: coinciden.slice(0, TOPE_FILAS_BUSQUEDA), cantidad: coinciden.length,
    suma: round2(coinciden.reduce((s, f) => s + f.total, 0)), sumaSaldo: round2(coinciden.reduce((s, f) => s + f.saldo, 0)),
    universo: facturas.length, limitado: coinciden.length > TOPE_FILAS_BUSQUEDA,
  };
}

/** Todas las facturas consolidadas para la búsqueda (tres lecturas: facturas con cliente, cobros, NC). Solo Supabase. */
export async function facturasParaBusqueda(): Promise<FacturaBuscada[]> {
  const [filas, cobros, ncs] = await Promise.all([
    fetchAll<FilaFactura>('facturas_clientes', { select: 'id, airtable_id, no_factura, cliente_id, fecha_emision, subtotal, iva, total, estado, cliente:clientes(airtable_id, razon_social, nombre_empresa, nit, nombre_comercial, aliases)' }),
    fetchAll<FilaCobro>('cobros_clientes', { select: 'factura_id, monto_cobrado, fecha_cobro, estado_cobro' }),
    fetchAll<FilaNc>('notas_credito', { select: 'factura_id, monto, estado' }).catch(() => [] as FilaNc[]),
  ]);
  return consolidarParaBusqueda(filas, cobros, ncs);
}

export async function buscarFacturas(c: CriteriosBusqueda): Promise<ResultadoBusqueda> {
  if (dataSource('facturas_clientes') !== 'supabase') return { filas: [], cantidad: 0, suma: 0, sumaSaldo: 0, universo: 0, limitado: false, error: 'La búsqueda por monto solo está disponible con las facturas en Supabase.' };
  try { return resultadoDe(await facturasParaBusqueda(), c); }
  catch (e) { console.error('buscarFacturas:', e instanceof Error ? e.message : String(e)); return { filas: [], cantidad: 0, suma: 0, sumaSaldo: 0, universo: 0, limitado: false, error: 'No se pudo buscar: probá de nuevo.' }; }
}
