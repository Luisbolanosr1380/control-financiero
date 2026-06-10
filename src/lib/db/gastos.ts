/**
 * F-050 — Lectura de GASTOS para Auros tools y futuras vistas (F-051 CxP).
 *
 * Reglas:
 *  - returnFieldsByFieldId: true en todas las queries.
 *  - Field IDs desde GASTOS_FIELDS (regla F-047.2).
 *  - Volumen esperado bajo (cientos por año) → filtrado en memoria es OK.
 */

import { airtable, USE_MOCK } from './airtable';
import { GASTOS_TABLE_ID, GASTOS_FIELDS, type EstadoGasto, type MetodoPagoGasto } from '@/lib/airtable/gastos-fields';

export interface Gasto {
  id: string;
  fecha: string;                  // YYYY-MM-DD
  proveedorId?: string;
  categoriaGastoId?: string;
  base: number;
  iva: number;
  total: number;
  metodoPago: MetodoPagoGasto | string;
  centroCostoId?: string;
  bancoId?: string;
  estado: EstadoGasto;
  asientoId?: string;
  facturaInOrigenId?: string;
  fechaVencimiento?: string;
  fechaAprobacion?: string;
  aprobadoPor?: string;
}

const arrFirst = (v: unknown): string | undefined => {
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return undefined;
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function mapGasto(rec: { id: string; fields: Record<string, unknown> }): Gasto {
  const f = rec.fields;
  return {
    id: rec.id,
    fecha:               String(f[GASTOS_FIELDS.fecha] ?? '').trim(),
    proveedorId:         arrFirst(f[GASTOS_FIELDS.proveedor]),
    categoriaGastoId:    arrFirst(f[GASTOS_FIELDS.categoria_gasto]),
    base:                num(f[GASTOS_FIELDS.base]),
    iva:                 num(f[GASTOS_FIELDS.iva]),
    total:               num(f[GASTOS_FIELDS.total]),
    metodoPago:          String(f[GASTOS_FIELDS.metodo_pago] ?? '').trim(),
    centroCostoId:       arrFirst(f[GASTOS_FIELDS.centro_costo]),
    bancoId:             arrFirst(f[GASTOS_FIELDS.banco]),
    estado:              String(f[GASTOS_FIELDS.estado] ?? '').trim() as EstadoGasto,
    asientoId:           arrFirst(f[GASTOS_FIELDS.asiento]),
    facturaInOrigenId:   arrFirst(f[GASTOS_FIELDS.factura_in_origen]),
    fechaVencimiento:    String(f[GASTOS_FIELDS.fecha_vencimiento] ?? '').trim() || undefined,
    fechaAprobacion:     String(f[GASTOS_FIELDS.fecha_aprobacion]  ?? '').trim() || undefined,
    aprobadoPor:         String(f[GASTOS_FIELDS.aprobado_por]      ?? '').trim() || undefined,
  };
}

export interface GastosFiltros {
  desde?: string;          // YYYY-MM-DD (sobre fecha del gasto)
  hasta?: string;
  estado?: EstadoGasto;
  centroCostoId?: string;
  proveedorId?: string;
}

export async function getGastos(filtros: GastosFiltros = {}): Promise<Gasto[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(GASTOS_TABLE_ID).select({ returnFieldsByFieldId: true }).all();
    let lista = records.map(r => mapGasto({ id: r.id, fields: r.fields as Record<string, unknown> }));

    if (filtros.estado)        lista = lista.filter(g => g.estado === filtros.estado);
    if (filtros.centroCostoId) lista = lista.filter(g => g.centroCostoId === filtros.centroCostoId);
    if (filtros.proveedorId)   lista = lista.filter(g => g.proveedorId === filtros.proveedorId);
    if (filtros.desde) lista = lista.filter(g => (g.fecha || '').slice(0, 10) >= filtros.desde!);
    if (filtros.hasta) lista = lista.filter(g => (g.fecha || '').slice(0, 10) <= filtros.hasta!);

    lista.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return lista;
  } catch (err) {
    console.warn('F-050 getGastos falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** "YYYY-MM" del mes actual en hora Guatemala (UTC-6 fija). */
function periodoActualGT(): string {
  const ahora = new Date();
  const guate = new Date(ahora.getTime() - 6 * 60 * 60 * 1000);
  const y = guate.getUTCFullYear();
  const m = String(guate.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** "YYYY-MM-DD" hoy en hora Guatemala. */
function hoyGT(): string {
  const ahora = new Date();
  const guate = new Date(ahora.getTime() - 6 * 60 * 60 * 1000);
  const y = guate.getUTCFullYear();
  const m = String(guate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(guate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface GastosDelMesResult {
  anio: number;
  mes: number;
  cantidad: number;
  totalQ: number;
  gastos: Array<{ id: string; fecha: string; proveedorId?: string; total: number; estado: string }>;
}

export async function getGastosDelMes(anio?: number, mes?: number, centroCostoId?: string): Promise<GastosDelMesResult> {
  const periodo = anio && mes
    ? `${anio}-${String(mes).padStart(2, '0')}`
    : periodoActualGT();
  const [y, m] = periodo.split('-').map(Number);
  const lista = await getGastos({ centroCostoId });
  const delMes = lista.filter(g => (g.fecha || '').slice(0, 7) === periodo);
  return {
    anio: y,
    mes: m,
    cantidad: delMes.length,
    totalQ: delMes.reduce((s, g) => s + g.total, 0),
    gastos: delMes.map(g => ({ id: g.id, fecha: g.fecha, proveedorId: g.proveedorId, total: g.total, estado: g.estado })),
  };
}

export interface CxpResumen {
  cantidad: number;
  totalQ: number;
  gastos: Array<{
    id: string;
    fecha: string;
    proveedorId?: string;
    total: number;
    fechaVencimiento?: string;
    diasParaVencer?: number;
  }>;
}

export async function getCxpPendientes(): Promise<CxpResumen> {
  const lista = await getGastos({ estado: 'Por pagar' });
  const hoy = hoyGT();
  const decorada = lista.map(g => {
    let diasParaVencer: number | undefined;
    if (g.fechaVencimiento) {
      const [yV, mV, dV] = g.fechaVencimiento.split('-').map(Number);
      const [yH, mH, dH] = hoy.split('-').map(Number);
      const venc = new Date(yV, mV - 1, dV).getTime();
      const ref  = new Date(yH, mH - 1, dH).getTime();
      diasParaVencer = Math.floor((venc - ref) / 86_400_000);
    }
    return {
      id: g.id,
      fecha: g.fecha,
      proveedorId: g.proveedorId,
      total: g.total,
      fechaVencimiento: g.fechaVencimiento,
      diasParaVencer,
    };
  });
  decorada.sort((a, b) => {
    const dv = (a.diasParaVencer ?? 9999) - (b.diasParaVencer ?? 9999);
    if (dv !== 0) return dv;
    return (a.fecha || '').localeCompare(b.fecha || '');
  });
  return {
    cantidad: decorada.length,
    totalQ: decorada.reduce((s, g) => s + g.total, 0),
    gastos: decorada,
  };
}

export async function getCxpVencidas(): Promise<CxpResumen> {
  const todos = await getCxpPendientes();
  const vencidos = todos.gastos.filter(g => typeof g.diasParaVencer === 'number' && g.diasParaVencer < 0);
  return {
    cantidad: vencidos.length,
    totalQ: vencidos.reduce((s, g) => s + g.total, 0),
    gastos: vencidos,
  };
}

export async function getGastosPorProveedor(proveedorId: string): Promise<{ cantidad: number; totalQ: number; gastos: Gasto[] }> {
  const lista = await getGastos({ proveedorId });
  return {
    cantidad: lista.length,
    totalQ: lista.reduce((s, g) => s + g.total, 0),
    gastos: lista,
  };
}

export async function getGastosPorCC(centroCostoId: string, anio?: number, mes?: number): Promise<GastosDelMesResult> {
  return getGastosDelMes(anio, mes, centroCostoId);
}
