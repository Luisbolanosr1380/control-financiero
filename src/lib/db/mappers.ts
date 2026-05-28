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
  ADJUNTO:          'ADJUNTO ',                          // con espacio al final; multipleAttachments
  ASIENTO_REF:      'ASIENTO_REF',
  OBSERVACIONES:    'Observaciones:',                    // con dos puntos al final; multilineText
} as const;

// CENTRO_COSTO en Airtable es un linked record → llega como [recordId].
// Mapa de record id de CENTROS_COSTO a nuestra LineKey (base actual).
// Poligrafia Xela (oficina cerrada) → agrupada con Poligrafia (mismo servicio histórico).
// "Pendiente" y "6300" son internos → caen al default (poligrafo) y la analítica los
// agrupa en "Otros" por nombre.
const CC_ID_TO_LINE: Record<string, LineKey> = {
  recta6yzMaZVORniO: 'poligrafo',      // "Poligrafia"
  recNI39e0UgnPAZJc: 'poligrafo',      // "Poligrafia Xela" → mismo servicio
  recBKqaIp3hHmp7FT: 'socio',          // "Socioeconomicos"
  receAuGbyq1yzLRL7: 'talenttrack',    // "TalentTrackAI"
  rec4K7KF4q6qNdMfJ: 'administrativo', // "Administrativo" → línea propia
};

function ccToLineKey(cc: unknown): LineKey {
  const first = Array.isArray(cc) ? cc[0] : cc;

  // CENTRO_COSTO es un linked record (array de ids)
  if (typeof first === 'string' && CC_ID_TO_LINE[first]) return CC_ID_TO_LINE[first];

  // Fallback: si alguna vez llega el nombre como texto
  const s = String(first ?? '').toLowerCase();
  if (s.includes('polígraf') || s.includes('poligraf')) return 'poligrafo';
  if (s.includes('socio'))      return 'socio';
  if (s.includes('talent'))     return 'talenttrack';
  if (s.includes('admin'))      return 'administrativo';
  return 'poligrafo';
}

// Replica la fórmula real del campo Estatus_Cobranza de Airtable.
// El ESTADO manda; Saldo_Por_Cobrar NO es confiable y no se usa para clasificar.
function estadoToStatus(estado: unknown, diasVencidos: number): InvoiceStatus {
  const s = String(estado ?? '').toUpperCase().trim();

  if (s === 'COBRADO' || s === 'COBRADA')         return 'cobrado';
  if (s === 'ANULADO' || s === 'ANULADA')         return 'anulado';
  if (s === 'REFACTURADO' || s === 'REFACTURADA') return 'anulado';
  if (s === 'PENDIENTE')                          return 'pendiente';

  // EMITIDA y cualquier otro estado activo: se evalúa por fecha (como la fórmula)
  if (diasVencidos > 0) return 'vencido';
  return 'por_cobrar';   // incluye "vence hoy" y "por vencer"
}

interface RawRow {
  recordId: string;
  noFactura: string;
  custId: string;
  total: number;
  iva: number;
  balance: number;
  line: LineKey;
  centroCostoId: string;
  status: InvoiceStatus;
  emisionAgo: number;
  dueAgo: number;
  // para el detalle
  fechaEmision: string;
  fechaVencimiento: string;
  adjuntoUrl?: string;
  adjuntoNombre?: string;
  asientoRef: string;
}

function recordToRaw(record: { id: string; fields: FieldSet }): RawRow {
  const f = record.fields;
  const totalRaw    = Number(f[F.TOTAL] ?? 0);
  const ivaRaw      = Number(f[F.IVA] ?? 0);
  const diasVencido = Number(f[F.DIAS_VENCIDOS] ?? 0);
  const noFactura   = String(f[F.NO_FACTURA] ?? record.id);
  const cc          = ccToLineKey(f[F.CENTRO_COSTO]);

  const fechaEmisionStr = f[F.FECHA_EMISION] ? String(f[F.FECHA_EMISION]) : '';
  const fechaVenceStr   = f[F.FECHA_VENCE] ? String(f[F.FECHA_VENCE]) : '';
  const fechaEmision = fechaEmisionStr ? new Date(fechaEmisionStr) : new Date();
  const hoy = new Date();
  const diasEmision = Math.floor((hoy.getTime() - fechaEmision.getTime()) / (1000 * 60 * 60 * 24));

  const status = estadoToStatus(f[F.ESTADO], diasVencido);

  // Saldo_Por_Cobrar está roto: el balance se deriva del estado y el TOTAL.
  // Cobrada/anulada/pendiente → 0; EMITIDA (vencido/por_cobrar) → TOTAL completo.
  const balance = status === 'vencido' || status === 'por_cobrar' ? totalRaw : 0;

  const adjunto = (f[F.ADJUNTO] as Array<{ url?: string; filename?: string }> | undefined)?.[0];
  const ccId = String((f[F.CENTRO_COSTO] as string[] | undefined)?.[0] ?? '');

  return {
    recordId: record.id,
    noFactura,
    custId:    String((f[F.CLIENTE] as string[] | undefined)?.[0] ?? ''),
    total:     totalRaw,
    iva:       ivaRaw,
    balance,
    line:      cc,
    centroCostoId: ccId,
    status,
    emisionAgo: diasEmision,
    dueAgo:     diasVencido,
    fechaEmision: fechaEmisionStr,
    fechaVencimiento: fechaVenceStr,
    adjuntoUrl: adjunto?.url,
    adjuntoNombre: adjunto?.filename,
    asientoRef: String(f[F.ASIENTO_REF] ?? ''),
  };
}

function worstStatus(statuses: InvoiceStatus[]): InvoiceStatus {
  const priority: Record<InvoiceStatus, number> = {
    vencido: 5,
    por_cobrar: 4,
    pendiente: 3,
    cobrado: 2,
    emitida: 2,
    contabilizado: 2,
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
      iva: r.iva,
      centroCostoId: r.centroCostoId || undefined,
    }));

    const principal = rows.reduce((a, b) => (b.total > a.total ? b : a));
    const uniqueCCs = new Set(rows.map(r => r.line));
    // El PDF suele ir en el principal; si no, tomar el primero que tenga adjunto
    const conAdjunto = rows.find(r => r.adjuntoUrl) ?? principal;

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
      fechaEmision:      principal.fechaEmision || undefined,
      fechaVencimiento:  principal.fechaVencimiento || undefined,
      adjuntoUrl:        conAdjunto.adjuntoUrl,
      adjuntoNombre:     conAdjunto.adjuntoNombre,
      asientoRef:        principal.asientoRef || undefined,
    });
  }

  return invoices;
}
