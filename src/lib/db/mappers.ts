import type { FieldSet } from 'airtable';
import type { Invoice, InvoiceLine, LineKey, InvoiceStatus } from '../types';

export const F = {
  FACTURA_ID:       'FACTURA_ID',
  NO_FACTURA:       'NO.FACTURA',
  FECHA_EMISION:    'FECHA_EMISION',
  FECHA_VENCE:      'Fecha vencimiento',
  CLIENTE:          'CLIENTE ',
  RAZON_SOCIAL:     'Razón social (from CLIENTE )',
  CENTRO_COSTO:     'CENTRO_COSTO',
  SUBTOTAL:         'SUBTOTAL',
  IVA:              'IVA',
  TOTAL:            'TOTAL',
  SALDO:            'Saldo_Por_Cobrar',
  MONTO_VENCIDO:    'Monto_Vencido',
  ESTADO:           'ESTADO',
  ESTATUS_COBRANZA: 'Estatus_Cobranza',
  DIAS_VENCIDOS:    'Dias vencidos',
  DIAS_CREDITO:     'Dias_Credito_Num',
  MES_EMITIDA:      'Mes_Emitida',
  MES_COBRO:        'Mes_Cobro',
  QUINCENA_COBRO:   'Quincena_Cobro',
  AGING_BUCKET:     'Calculation',
} as const;

function ccToLineKey(cc: unknown): LineKey {
  const s = String(cc ?? '').toLowerCase();
  if (s.includes('polígraf') || s.includes('poligraf')) return 'poligrafo';
  if (s.includes('socio'))      return 'socio';
  if (s.includes('talent'))     return 'talenttrack';
  if (s.includes('venta'))      return 'ventas';
  return 'poligrafo';
}

function estadoToStatus(estado: unknown, saldo: number): InvoiceStatus {
  const s = String(estado ?? '').toUpperCase().trim();
  if (s === 'ANULADO' || s === 'ANULADA')   return 'anulado';
  if (saldo === 0)                          return 'cobrado';
  if (s.includes('VENCID'))                 return 'vencido';
  if (s === 'CONTABILIZADO')                return 'por_cobrar';
  if (s === 'EMITIDA')                      return 'por_cobrar';
  return 'por_cobrar';
}

interface RawRow {
  recordId: string;
  noFactura: string;
  custId: string;
  total: number;
  balance: number;
  line: LineKey;
  status: InvoiceStatus;
  emisionAgo: number;
  dueAgo: number;
}

function recordToRaw(record: { id: string; fields: FieldSet }): RawRow {
  const f = record.fields;
  const totalRaw    = Number(f[F.TOTAL] ?? 0);
  const saldoRaw    = Number(f[F.SALDO] ?? 0);
  const diasVencido = Number(f[F.DIAS_VENCIDOS] ?? 0);
  const noFactura   = String(f[F.NO_FACTURA] ?? record.id);
  const cc          = ccToLineKey(f[F.CENTRO_COSTO]);

  const fechaEmision = f[F.FECHA_EMISION] ? new Date(String(f[F.FECHA_EMISION])) : new Date();
  const hoy = new Date();
  const diasEmision = Math.floor((hoy.getTime() - fechaEmision.getTime()) / (1000 * 60 * 60 * 24));

  return {
    recordId: record.id,
    noFactura,
    custId:    String((f[F.CLIENTE] as string[] | undefined)?.[0] ?? ''),
    total:     totalRaw,
    balance:   saldoRaw,
    line:      cc,
    status:    estadoToStatus(f[F.ESTADO], saldoRaw),
    emisionAgo: diasEmision,
    dueAgo:     diasVencido,
  };
}

function worstStatus(statuses: InvoiceStatus[]): InvoiceStatus {
  const priority: Record<InvoiceStatus, number> = {
    vencido: 4,
    por_cobrar: 3,
    cobrado: 2,
    emitida: 2,
    contabilizado: 2,
    pendiente: 1,
    anulado: 0,
  };
  return statuses.reduce((acc, s) => priority[s] > priority[acc] ? s : acc, statuses[0]);
}

export function consolidateRecords(records: { id: string; fields: FieldSet }[]): Invoice[] {
  const raw = records.map(recordToRaw);
  const buckets = new Map<string, RawRow[]>();

  for (const r of raw) {
    const key = r.status === 'anulado'
      ? `${r.noFactura}__anulada__${r.recordId}`
      : r.noFactura;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  const invoices: Invoice[] = [];
  for (const [, rows] of buckets) {
    const lineas: InvoiceLine[] = rows.map(r => ({
      line: r.line,
      amount: r.total,
      balance: r.balance,
    }));

    const principal = rows.reduce((a, b) => (b.total > a.total ? b : a));
    const uniqueCCs = new Set(rows.map(r => r.line));

    invoices.push({
      id:              principal.recordId,
      noFactura:       principal.noFactura,
      custId:          principal.custId,
      total:           rows.reduce((s, r) => s + r.total, 0),
      balance:         rows.reduce((s, r) => s + r.balance, 0),
      daysSinceIssued: principal.emisionAgo,
      emisionAgo:      principal.emisionAgo,
      dueAgo:          principal.dueAgo,
      status:          worstStatus(rows.map(r => r.status)),
      lineas,
      line:            principal.line,
      isMixed:         uniqueCCs.size > 1,
    });
  }

  return invoices;
}
