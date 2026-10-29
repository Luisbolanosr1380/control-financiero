/**
 * FACTURACIÓN AGENDA · Resumen por cliente y filtros — PURO (sin IO).
 * La pantalla "Por facturar" agrupa por cliente (NIT mapeado) o, si la
 * empresa de la Agenda no está mapeada, por su empresa.id.
 */
import { conIva, normalizarTexto, round2 } from '@/lib/tarifario/canon';
import { conPrecio, enCola, facturable } from './mapeo';
import { ESTADOS_EXCLUIDOS, type ExpedienteLocal } from './tipos';

export interface GrupoCliente {
  /** `n-<nit>` (mapeado) o `e-<empresa.id>` (sin mapear). */
  clave: string;
  nit: string | null;
  empresaIdExterno: string;
  /** Razón social del cliente de financiero (o el nombre de la Agenda si no está mapeado). */
  nombre: string;
  nombreExterno: string;
  /** Expedientes vigentes (terminados, no cancelados ni eliminados, no psicométricas). */
  expedientes: number;
  /** En cola y con precio resuelto: lo que se puede facturar hoy. */
  listos: number;
  totalSinIva: number;
  totalConIva: number;
  sinTarifa: number;
  sinMapear: number;
  facturados: number;
  writebackPendiente: number;
  conMegapaca: number;
  /** 019: en cola pero ya reservados en un detalle de facturación. */
  enDetalle: number;
  fechaIngresoMasAntigua: string | null;
}

export const claveGrupo = (e: Pick<ExpedienteLocal, 'nitResuelto' | 'empresaIdExterno'>): string => e.nitResuelto ? `n-${e.nitResuelto}` : `e-${e.empresaIdExterno}`;

export function parseClave(clave: string): { tipo: 'nit'; nit: string } | { tipo: 'ext'; empresaId: string } | null {
  if (clave.startsWith('n-') && clave.length > 2) return { tipo: 'nit', nit: clave.slice(2) };
  if (clave.startsWith('e-') && clave.length > 2) return { tipo: 'ext', empresaId: clave.slice(2) };
  return null;
}

/** Vigente para la pantalla: terminado, no cancelado, no eliminado, no psicométrica. */
export const vigente = (e: ExpedienteLocal): boolean => e.terminado && !e.cancelado && !e.eliminado && !ESTADOS_EXCLUIDOS.includes(e.estadoTarifa);

export function agruparPorCliente(expedientes: readonly ExpedienteLocal[], razonPorNit: ReadonlyMap<string, string> = new Map()): GrupoCliente[] {
  const grupos = new Map<string, GrupoCliente>();
  for (const e of expedientes) {
    if (!vigente(e)) continue;
    const clave = claveGrupo(e);
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, nit: e.nitResuelto, empresaIdExterno: e.empresaIdExterno, nombre: (e.nitResuelto && razonPorNit.get(e.nitResuelto)) || e.empresaNombreExterno || e.empresaIdExterno || '—', nombreExterno: e.empresaNombreExterno, expedientes: 0, listos: 0, totalSinIva: 0, totalConIva: 0, sinTarifa: 0, sinMapear: 0, facturados: 0, writebackPendiente: 0, conMegapaca: 0, enDetalle: 0, fechaIngresoMasAntigua: null };
      grupos.set(clave, g);
    }
    g.expedientes++;
    if (e.facturaId) { g.facturados++; if (e.writebackEstado && e.writebackEstado !== 'confirmado' && e.writebackEstado !== 'omitido') g.writebackPendiente++; }
    if (enCola(e)) {
      if (e.estadoTarifa === 'sin_tarifa') g.sinTarifa++;
      if (e.estadoTarifa === 'cliente_sin_mapear') g.sinMapear++;
      if (e.detalleId) g.enDetalle++;
      if (conPrecio(e)) { g.listos++; g.totalSinIva = round2(g.totalSinIva + (e.montoCalculado ?? 0)); }
      if (e.fechaIngreso && (!g.fechaIngresoMasAntigua || e.fechaIngreso < g.fechaIngresoMasAntigua)) g.fechaIngresoMasAntigua = e.fechaIngreso;
    }
    if ((e.cobroMegapaca ?? 0) > 0) g.conMegapaca++;
  }
  const out = [...grupos.values()].map(g => ({ ...g, totalConIva: conIva(g.totalSinIva).total }));
  // Primero lo que requiere acción (sin mapear / sin tarifa), luego por total listo, luego alfabético.
  const peso = (g: GrupoCliente) => (g.sinMapear ? 0 : g.sinTarifa ? 1 : g.listos ? 2 : 3);
  return out.sort((a, b) => peso(a) - peso(b) || b.totalSinIva - a.totalSinIva || a.nombre.localeCompare(b.nombre, 'es'));
}

export interface KpisPorFacturar { listos: number; totalSinIva: number; totalConIva: number; sinTarifa: number; sinMapear: number; /** psicométricas vigentes */ excluidos: number; /** 018: expedientes de empresas marcadas "no se factura" */ excluidosNoFactura: number; facturados: number; writebackPendiente: number; clientes: number; clientesSinMapear: number }

export function kpisPorFacturar(expedientes: readonly ExpedienteLocal[]): KpisPorFacturar {
  const k: KpisPorFacturar = { listos: 0, totalSinIva: 0, totalConIva: 0, sinTarifa: 0, sinMapear: 0, excluidos: 0, excluidosNoFactura: 0, facturados: 0, writebackPendiente: 0, clientes: 0, clientesSinMapear: 0 };
  const clientes = new Set<string>(); const sinMapear = new Set<string>();
  for (const e of expedientes) {
    if (e.estadoTarifa === 'excluido_psicometrica' && e.terminado && !e.cancelado && !e.eliminado) { k.excluidos++; continue; }
    if (e.estadoTarifa === 'excluido_no_factura' && e.terminado && !e.cancelado && !e.eliminado) { k.excluidosNoFactura++; continue; }
    if (!vigente(e)) continue;
    clientes.add(claveGrupo(e));
    if (e.facturaId) { k.facturados++; if (e.writebackEstado && !['confirmado', 'omitido'].includes(e.writebackEstado)) k.writebackPendiente++; }
    if (!enCola(e)) continue;
    if (e.estadoTarifa === 'sin_tarifa') k.sinTarifa++;
    if (e.estadoTarifa === 'cliente_sin_mapear') { k.sinMapear++; sinMapear.add(claveGrupo(e)); }
    if (conPrecio(e)) { k.listos++; k.totalSinIva = round2(k.totalSinIva + (e.montoCalculado ?? 0)); }
  }
  k.totalConIva = conIva(k.totalSinIva).total;
  k.clientes = clientes.size; k.clientesSinMapear = sinMapear.size;
  return k;
}

export function filtrarGrupos(grupos: readonly GrupoCliente[], q: string, soloConAccion = false): GrupoCliente[] {
  const n = normalizarTexto(q);
  return grupos.filter(g => (!soloConAccion || g.sinMapear > 0 || g.sinTarifa > 0) && (!n || normalizarTexto(g.nombre).includes(n) || normalizarTexto(g.nombreExterno).includes(n) || (g.nit ?? '').includes(n.replace(/[^0-9A-Z]/g, ''))));
}

/** 'YYYY-MM' de una fecha 'YYYY-MM-DD' (o ''). */
export const mesDe = (fecha: string | null | undefined): string => (fecha ?? '').slice(0, 7);

export type FiltroCobro = 'por_facturar' | 'facturados' | 'todos';

export function filtrarExpedientes(exps: readonly ExpedienteLocal[], f: { mes?: string; cobro?: FiltroCobro; soloListos?: boolean }): ExpedienteLocal[] {
  return exps.filter(e => {
    if (!vigente(e)) return false;
    if (f.mes && mesDe(e.fechaIngreso) !== f.mes) return false;
    const cobro = f.cobro ?? 'por_facturar';
    if (cobro === 'por_facturar' && !enCola(e)) return false;
    if (cobro === 'facturados' && !(e.facturaId || !enCola(e))) return false;
    if (f.soloListos && !facturable(e)) return false;
    return true;
  });
}

/** Meses (YYYY-MM) presentes, del más reciente al más viejo. */
export function mesesDisponibles(exps: readonly ExpedienteLocal[]): string[] {
  return [...new Set(exps.filter(vigente).map(e => mesDe(e.fechaIngreso)).filter(Boolean))].sort().reverse();
}
