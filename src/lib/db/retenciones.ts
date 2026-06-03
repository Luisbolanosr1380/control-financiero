/**
 * F-035 PARTE E — Retenciones (IVA + ISR) acumuladas.
 *
 * Lee TODOS los records de COBROS_CLIENTES que tengan Monto_Retencion_IVA o
 * Monto_Retencion_ISR > 0. Cada record de retención cuenta como 1 retención
 * individual (un componente del evento de cobro). Para reportería contable
 * eso es exactamente lo que la contadora necesita: una fila por constancia.
 */

import { airtable, USE_MOCK, TABLES } from './airtable';
import { getClientes } from './clientes';
import type { Customer } from '../types';

export type TipoRetencion = 'IVA' | 'ISR';

export interface RetencionRecord {
  recordId: string;
  fecha: string;             // YYYY-MM-DD
  noFactura: string;
  custId: string;
  clienteNombre: string;
  tipo: TipoRetencion;
  monto: number;
  numConstancia: string;     // del campo Referencia del cobro
  constanciaUrl?: string;
  constanciaNombre?: string;
  grupoId: string;
}

export interface RetencionesAgregadas {
  anio: number;
  totalIVA: number;
  totalISR: number;
  totalGeneral: number;
  numIVA: number;
  numISR: number;
  porMes: Array<{ mes: number; nombre: string; iva: number; isr: number }>;
  porCliente: Array<{ custId: string; clienteNombre: string; iva: number; isr: number; total: number; numRetenciones: number }>;
  records: RetencionRecord[];
}

const FCR = {
  FECHA:     'Fecha_Cobro',
  NO_FAC:    'NO.FACTURA (from Factura Cliente)',
  CLIENTE:   'CLIENTE  (from Factura Cliente)',
  RET_IVA:   'Monto_Retencion_IVA',
  RET_ISR:   'Monto_Retencion_ISR',
  CONST:     'Constancia_Retencion',
  REF:       'Referencia',
  GRUPO_ID:  'Cobro_Grupo_ID',
  ESTADO_COBRO: 'Estado_Cobro',   // F-036
} as const;

const MES_NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function arrFirst(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? '') : '';
}

/**
 * Trae todas las retenciones del año pedido (o del año actual por default).
 * Filtra a nivel server: solo records con Monto_Retencion_IVA > 0 OR Monto_Retencion_ISR > 0.
 */
export async function getRetencionesAgregadas(anio?: number): Promise<RetencionesAgregadas> {
  const year = anio ?? new Date().getFullYear();
  const vacio: RetencionesAgregadas = {
    anio: year,
    totalIVA: 0, totalISR: 0, totalGeneral: 0,
    numIVA: 0, numISR: 0,
    porMes: MES_NOMBRES.map((nombre, idx) => ({ mes: idx + 1, nombre, iva: 0, isr: 0 })),
    porCliente: [],
    records: [],
  };

  if (USE_MOCK || !airtable) return vacio;

  try {
    // F-036: excluir cobros anulados (Estado_Cobro != 'Anulado'; vacío = Activo
    // por compat). Las retenciones anuladas NO cuentan como crédito fiscal.
    const filterByFormula = `AND(YEAR({${FCR.FECHA}})=${year},OR({${FCR.RET_IVA}}>0,{${FCR.RET_ISR}}>0),OR({${FCR.ESTADO_COBRO}}='',{${FCR.ESTADO_COBRO}}='Activo'))`;
    const [records, clientes] = await Promise.all([
      airtable(TABLES.COBROS).select({ filterByFormula, sort: [{ field: FCR.FECHA, direction: 'desc' }] }).all(),
      getClientes(),
    ]);
    const nombreCliente = new Map<string, string>(clientes.map((c: Customer) => [c.id, c.name]));

    // Cada record genera UNA o DOS entradas (puede tener IVA Y ISR en el mismo,
    // aunque en práctica F-035 los separa en records distintos).
    const list: RetencionRecord[] = [];
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const fecha = String(f[FCR.FECHA] ?? '');
      const noFactura = arrFirst(f[FCR.NO_FAC]);
      const custId = arrFirst(f[FCR.CLIENTE]);
      const ref = String(f[FCR.REF] ?? '');
      const attach = Array.isArray(f[FCR.CONST])
        ? (f[FCR.CONST] as Array<{ url?: string; filename?: string }>)[0]
        : undefined;
      const grupoId = String(f[FCR.GRUPO_ID] ?? '');
      const iva = Number(f[FCR.RET_IVA] ?? 0);
      const isr = Number(f[FCR.RET_ISR] ?? 0);
      const base = {
        fecha, noFactura, custId,
        clienteNombre: nombreCliente.get(custId) || custId || '—',
        numConstancia: ref, grupoId,
        constanciaUrl: attach?.url, constanciaNombre: attach?.filename,
      };
      if (iva > 0) list.push({ recordId: r.id, ...base, tipo: 'IVA', monto: iva });
      if (isr > 0) list.push({ recordId: r.id, ...base, tipo: 'ISR', monto: isr });
    }

    const porMes = MES_NOMBRES.map((nombre, idx) => ({ mes: idx + 1, nombre, iva: 0, isr: 0 }));
    let totalIVA = 0, totalISR = 0, numIVA = 0, numISR = 0;
    const porClienteMap = new Map<string, { custId: string; clienteNombre: string; iva: number; isr: number; total: number; numRetenciones: number }>();

    for (const rec of list) {
      const mesIdx = rec.fecha ? Math.max(0, Math.min(11, Number(rec.fecha.slice(5, 7)) - 1)) : 0;
      if (rec.tipo === 'IVA') {
        porMes[mesIdx].iva += rec.monto;
        totalIVA += rec.monto;
        numIVA += 1;
      } else {
        porMes[mesIdx].isr += rec.monto;
        totalISR += rec.monto;
        numISR += 1;
      }
      const agg = porClienteMap.get(rec.custId) ?? {
        custId: rec.custId, clienteNombre: rec.clienteNombre,
        iva: 0, isr: 0, total: 0, numRetenciones: 0,
      };
      if (rec.tipo === 'IVA') agg.iva += rec.monto;
      else                    agg.isr += rec.monto;
      agg.total += rec.monto;
      agg.numRetenciones += 1;
      porClienteMap.set(rec.custId, agg);
    }

    const porCliente = [...porClienteMap.values()].sort((a, b) => b.total - a.total);

    return {
      anio: year,
      totalIVA, totalISR, totalGeneral: totalIVA + totalISR,
      numIVA, numISR,
      porMes,
      porCliente,
      records: list,
    };
  } catch (err) {
    console.error('Error leyendo retenciones:', err);
    return vacio;
  }
}
