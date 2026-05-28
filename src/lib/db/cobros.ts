import { airtable, USE_MOCK, TABLES } from './airtable';
import { F } from './mappers';
import type { Payment } from '../types';

const MOCK_PAYMENTS: Payment[] = [];

export async function getCobros(): Promise<Payment[]> {
  if (USE_MOCK || !airtable) return MOCK_PAYMENTS;
  // TODO Fase 2 — lectura real
  return MOCK_PAYMENTS;
}

/* ============================================================
 * Registrar cobro contra una factura (F-007)
 * - TODO O NADA: el monto = TOTAL de la factura, sin parciales.
 * - Multi-línea: crea 1 record por línea (Monto_Cobrado = TOTAL de la línea).
 *   La última línea absorbe el residuo de redondeo para que la suma cuadre.
 * - Actualiza ESTADO de TODAS las filas a 'COBRADO ' (con espacio final).
 * ============================================================ */

export type MetodoCobro = 'Transferencia' | 'Cheque' | 'Efectivo' | 'Tarjeta';
export type MonedaCobro = 'GTQ' | 'USD';

// Campos editables de COBROS_CLIENTES
const FC = {
  FECHA:        'Fecha_Cobro',
  FACTURA:      'Factura Cliente',
  MONTO:        'Monto_Cobrado',
  CUENTA_BANCO: 'Cuenta_Banco',
  METODO:       'Método',
  MONEDA:       'Moneda',
  TIPO_CAMBIO:  'Tipo_Cambio',
  ESTADO:       'Estado',
  REFERENCIA:   'Referencia',
} as const;

export interface RegistrarCobroInput {
  noFactura: string;
  fecha: string;            // 'YYYY-MM-DD'
  bancoId: string;          // record id BANCOS
  metodo: MetodoCobro;
  moneda?: MonedaCobro;     // default 'GTQ'
  tipoCambio?: number;      // default 1
  referencia?: string;
}

export interface RegistrarCobroResult {
  ok: boolean;
  noFactura: string;
  totalCobrado: number;
  cobrosCreados: number;
  recordsActualizados: number;
  fallidos?: { cobrosLote?: number[]; estadoIds?: string[] };
  error?: string;
}

const estadoCanon = (e: unknown) => String(e ?? '').toUpperCase().trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function registrarCobro(input: RegistrarCobroInput): Promise<RegistrarCobroResult> {
  if (!airtable) throw new Error('Airtable no está configurado.');

  const nf = (input.noFactura ?? '').trim();
  if (!nf)               return fail(nf, 'NO.FACTURA es requerido.');
  if (!input.bancoId)    return fail(nf, 'Cuenta de banco es requerida.');
  if (!input.metodo)     return fail(nf, 'Método de cobro es requerido.');
  if (!input.fecha)      return fail(nf, 'Fecha del cobro es requerida.');

  const moneda     = input.moneda     ?? 'GTQ';
  const tipoCambio = input.tipoCambio ?? 1;

  try {
    // 1) Filas de la factura (excluye ANULADAS/REFACTURADAS — esas no se cobran)
    const esc = nf.replace(/"/g, '\\"');
    const records = await airtable(TABLES.FACTURAS)
      .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
      .all();
    if (records.length === 0) {
      return fail(nf, `No se encontró la factura ${nf}.`);
    }

    const activas = records.filter(r => {
      const e = estadoCanon(r.fields[F.ESTADO]);
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
    if (activas.length === 0) {
      return fail(nf, `La factura ${nf} está completamente anulada o refacturada. No se puede cobrar.`);
    }

    // 2) Validar ESTADO: solo EMITIDA o PENDIENTE pueden cobrarse
    const noCobrables: string[] = [];
    for (const r of activas) {
      const e = estadoCanon(r.fields[F.ESTADO]);
      if (e !== 'EMITIDA' && e !== 'PENDIENTE') noCobrables.push(e || '(vacío)');
    }
    if (noCobrables.length > 0) {
      const u = [...new Set(noCobrables)].join(', ');
      return fail(nf, `La factura no se puede cobrar — alguna línea está en estado "${u}". Solo EMITIDA o PENDIENTE son cobrables.`);
    }

    // 3) TOTAL de la factura y 4) distribución proporcional con residuo en la última
    const lineas = activas.map(r => ({
      id:    r.id,
      total: Number(r.fields[F.TOTAL] ?? 0),
    }));
    const totalFactura = round2(lineas.reduce((s, l) => s + l.total, 0));
    if (totalFactura <= 0) {
      return fail(nf, `La factura tiene TOTAL cero — no hay nada que cobrar.`);
    }

    let asignado = 0;
    const cobrosPlan = lineas.map((l, i) => {
      let monto: number;
      if (i === lineas.length - 1) {
        // Última: residuo exacto para que la suma sea = totalFactura
        monto = round2(totalFactura - asignado);
      } else {
        monto = round2(l.total);
        asignado += monto;
      }
      return { facturaId: l.id, monto };
    });

    // 5) Crear N records en COBROS_CLIENTES (batch 10)
    const cobroFields = (facturaId: string, monto: number) => ({
      fields: {
        [FC.FECHA]:        input.fecha,
        [FC.FACTURA]:      [facturaId],
        [FC.MONTO]:        monto,
        [FC.CUENTA_BANCO]: [input.bancoId],
        [FC.METODO]:       input.metodo,
        [FC.MONEDA]:       moneda,
        [FC.TIPO_CAMBIO]:  tipoCambio,
        [FC.ESTADO]:       'Pendiente',
        ...(input.referencia ? { [FC.REFERENCIA]: input.referencia.trim() } : {}),
      },
    });

    const payloadCobros = cobrosPlan.map(p => cobroFields(p.facturaId, p.monto));
    const cobrosCreados: string[] = [];
    const lotesFallidos: number[] = [];
    for (let i = 0; i < payloadCobros.length; i += 10) {
      const lote = payloadCobros.slice(i, i + 10);
      try {
        const res = await airtable(TABLES.COBROS).create(lote);
        cobrosCreados.push(...res.map(r => r.id));
      } catch (err) {
        console.error('Error creando lote de cobros:', err);
        lotesFallidos.push(i);
      }
    }

    if (cobrosCreados.length === 0) {
      return fail(nf, 'No se pudo crear ningún record de cobro en COBROS_CLIENTES. La factura NO se marcó como cobrada.');
    }

    // 6) Actualizar ESTADO de las filas activas a 'COBRADO ' (CON ESPACIO FINAL)
    const updates = activas.map(r => ({
      id: r.id,
      fields: { [F.ESTADO]: 'COBRADO ' },   // exacto del singleSelect
    }));
    const estadoActualizados: string[] = [];
    const estadoFallidos: string[] = [];
    for (let i = 0; i < updates.length; i += 10) {
      const lote = updates.slice(i, i + 10);
      try {
        const res = await airtable(TABLES.FACTURAS).update(lote);
        estadoActualizados.push(...res.map(r => r.id));
      } catch (err) {
        console.error('Error actualizando ESTADO a COBRADO:', err);
        estadoFallidos.push(...lote.map(p => p.id));
      }
    }

    const ok = lotesFallidos.length === 0 && estadoFallidos.length === 0;
    return {
      ok,
      noFactura: nf,
      totalCobrado: totalFactura,
      cobrosCreados: cobrosCreados.length,
      recordsActualizados: estadoActualizados.length,
      fallidos: ok ? undefined : {
        cobrosLote: lotesFallidos.length > 0 ? lotesFallidos : undefined,
        estadoIds:  estadoFallidos.length > 0 ? estadoFallidos : undefined,
      },
      error: ok ? undefined : `Cobro parcial: ${cobrosCreados.length} cobro(s) creado(s), ${estadoActualizados.length}/${activas.length} líneas en COBRADO. Revisá Airtable.`,
    };
  } catch (err) {
    return fail(nf, err instanceof Error ? err.message : String(err));
  }
}

function fail(noFactura: string, error: string): RegistrarCobroResult {
  return { ok: false, noFactura, totalCobrado: 0, cobrosCreados: 0, recordsActualizados: 0, error };
}
