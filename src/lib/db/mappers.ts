import type { FieldSet } from 'airtable';
import type { Invoice, InvoiceLine, LineKey, InvoiceStatus, InvoiceEstadoBruto } from '../types';

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
  // F-044 auditoría de edición no-contable. Campos opcionales en Airtable —
  // si todavía no existen, la lectura cae a undefined y la escritura es
  // fail-soft (un update separado). NO bloquear si faltan.
  EDITADO_POR:      'Editado_Por',                       // single line text
  FECHA_ULTIMA_EDIT:'Fecha_Ultima_Edicion',              // datetime
  HISTORIAL_EDIT:   'Historial_Ediciones',               // long text
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

/**
 * F-032: mapeo 1-a-1 del ESTADO singleSelect a InvoiceEstadoBruto.
 * Independiente de fecha. REFACTURADO ya NO se mezcla con anulado.
 */
function estadoToBruto(estado: unknown): InvoiceEstadoBruto {
  const s = String(estado ?? '').toUpperCase().trim();
  if (s === 'COBRADO PARCIAL')                    return 'cobrado_parcial';
  if (s === 'COBRADO' || s === 'COBRADA')         return 'cobrado';
  if (s === 'ANULADO' || s === 'ANULADA')         return 'anulado';
  if (s === 'REFACTURADO' || s === 'REFACTURADA') return 'refacturado';
  if (s === 'PENDIENTE')                          return 'pendiente';
  if (s === 'EMITIDA' || s === 'EMITIDO')         return 'emitida';
  return 'otro';
}

// Replica la fórmula real del campo Estatus_Cobranza de Airtable.
// El ESTADO manda; Saldo_Por_Cobrar NO es confiable y no se usa para clasificar.
// LEGACY (status): se mantiene como derivado de estadoBruto + vencida para
// que el resto del código que ya usa `status` siga compilando. Los tabs y
// el dashboard pasan a usar estadoBruto + vencida (ver F-032).
function estadoToStatus(estado: unknown, diasVencidos: number): InvoiceStatus {
  const s = String(estado ?? '').toUpperCase().trim();

  if (s === 'COBRADO' || s === 'COBRADA')         return 'cobrado';
  if (s === 'ANULADO' || s === 'ANULADA')         return 'anulado';
  if (s === 'REFACTURADO' || s === 'REFACTURADA') return 'anulado';   // legacy: lo seguimos colapsando aquí
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
  estadoBruto: InvoiceEstadoBruto;   // F-032
  vencida: boolean;                  // F-032
  emisionAgo: number;
  dueAgo: number;
  // para el detalle
  fechaEmision: string;
  fechaVencimiento: string;
  adjuntoUrl?: string;
  adjuntoNombre?: string;
  asientoRef: string;
  // F-044 auditoría (opcional)
  editadoPor?: string;
  fechaUltimaEdicion?: string;
  historialEdiciones?: string;
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
  const estadoBruto = estadoToBruto(f[F.ESTADO]);
  // Vencida: usa el campo Estatus_Cobranza (fórmula de Airtable). Solo aplica
  // a estados ACTIVOS (emitida/pendiente). Cobradas/anuladas/refacturadas no
  // tienen "vencida" relevante.
  const estatusCobranza = String(f[F.ESTATUS_COBRANZA] ?? '').toUpperCase().trim();
  const vencida = (estadoBruto === 'emitida' || estadoBruto === 'pendiente') && estatusCobranza === 'VENCIDA';

  // F-035: balance derivado del estado.
  // - EMITIDA/PENDIENTE: sin cobros → balance = TOTAL.
  // - COBRADO PARCIAL: hubo cobros previos → balance = Saldo_Por_Cobrar de Airtable
  //   (fórmula = TOTAL - sum(Monto_Cobro_GTQ from COBROS_CLIENTES)).
  // - COBRADO/ANULADO/REFACTURADO: 0.
  // El campo Saldo_Por_Cobrar antes era buggy para emitidas/pendientes, por eso
  // se ignoraba globalmente. Para COBRADO PARCIAL la fórmula es la única fuente
  // de verdad disponible al mapear; el detalle puede confirmar con getSaldoPendiente.
  const saldoLookup = Number(f[F.SALDO] ?? 0);
  const balance =
    estadoBruto === 'emitida' || estadoBruto === 'pendiente'  ? totalRaw
  : estadoBruto === 'cobrado_parcial'                         ? (saldoLookup > 0 ? saldoLookup : totalRaw)
  : 0;

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
    estadoBruto,
    vencida,
    emisionAgo: diasEmision,
    dueAgo:     diasVencido,
    fechaEmision: fechaEmisionStr,
    fechaVencimiento: fechaVenceStr,
    adjuntoUrl: adjunto?.url,
    adjuntoNombre: adjunto?.filename,
    asientoRef: String(f[F.ASIENTO_REF] ?? ''),
    editadoPor:         f[F.EDITADO_POR]       ? String(f[F.EDITADO_POR])       : undefined,
    fechaUltimaEdicion: f[F.FECHA_ULTIMA_EDIT] ? String(f[F.FECHA_ULTIMA_EDIT]) : undefined,
    historialEdiciones: f[F.HISTORIAL_EDIT]    ? String(f[F.HISTORIAL_EDIT])    : undefined,
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

/**
 * F-032: consolidación del estadoBruto cuando una factura tiene múltiples
 * líneas con ESTADO distinto. Prioridad: pendiente > emitida > cobrado >
 * anulado > refacturado > otro. (Pendiente arriba porque queremos que el
 * tab "Pendientes" capture TODA factura con alguna línea PENDIENTE.)
 */
function dominanteBruto(brutos: InvoiceEstadoBruto[]): InvoiceEstadoBruto {
  // F-035: COBRADO PARCIAL gana sobre cobrado completo (es el subset activo) y
  // sobre emitida/pendiente cuando ya hubo movimiento parcial en alguna línea.
  const prio: Record<InvoiceEstadoBruto, number> = {
    cobrado_parcial: 6,
    pendiente: 5,
    emitida: 4,
    cobrado: 3,
    anulado: 1,
    refacturado: 0,
    otro: 0,
  };
  return brutos.reduce((acc, b) => prio[b] > prio[acc] ? b : acc, brutos[0]);
}

export function consolidateRecords(records: { id: string; fields: FieldSet }[]): Invoice[] {
  const raw = records.map(recordToRaw);
  const buckets = new Map<string, RawRow[]>();

  for (const r of raw) {
    // Anuladas y refacturadas se mantienen como rows separadas (no se
    // consolidan con las activas, son históricas).
    const key = r.estadoBruto === 'anulado' || r.estadoBruto === 'refacturado'
      ? `${r.noFactura}__${r.estadoBruto}__${r.recordId}`
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

    const brutoDominante = dominanteBruto(rows.map(r => r.estadoBruto));
    const vencidaConsolidada = (brutoDominante === 'emitida' || brutoDominante === 'pendiente')
      && rows.some(r => r.vencida);

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
      estadoBruto:     brutoDominante,
      vencida:         vencidaConsolidada,
      lineas,
      line:            principal.line,
      isMixed:         uniqueCCs.size > 1,
      fechaEmision:      principal.fechaEmision || undefined,
      fechaVencimiento:  principal.fechaVencimiento || undefined,
      adjuntoUrl:        conAdjunto.adjuntoUrl,
      adjuntoNombre:     conAdjunto.adjuntoNombre,
      asientoRef:        principal.asientoRef || undefined,
      editadoPor:         principal.editadoPor,
      fechaUltimaEdicion: principal.fechaUltimaEdicion,
      historialEdiciones: principal.historialEdiciones,
    });
  }

  return invoices;
}
