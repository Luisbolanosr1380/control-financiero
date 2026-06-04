// ============================================================
// Tipos del dominio — Control Financiero
// Reflejan las tablas reales de Airtable. Cuando migremos a
// Postgres, estos tipos se mantienen — solo cambia /lib/db.
// ============================================================

export type LineKey = 'poligrafo' | 'socio' | 'talenttrack' | 'administrativo';

export type InvoiceStatus = 'pendiente' | 'emitida' | 'contabilizado' | 'cobrado' | 'por_cobrar' | 'vencido' | 'anulado';

/**
 * Estado bruto (F-032): mapeo 1-a-1 con el ESTADO del singleSelect en
 * FACTURAS_CLIENTES (normalizado, sin espacios). NO depende de fecha.
 * El campo `vencida: boolean` se calcula aparte desde Estatus_Cobranza.
 * `status` (legacy) se mantiene como derivado de estos dos para
 * compatibilidad con código que ya lo usa.
 */
export type InvoiceEstadoBruto = 'emitida' | 'pendiente' | 'cobrado' | 'cobrado_parcial' | 'anulado' | 'refacturado' | 'otro';

export type AgingBucket = 'corriente' | '1-30' | '31-60' | '61-90' | '90+';

export type HealthStatus = 'good' | 'warn' | 'bad';

export type InsightSeverity = 'critical' | 'warning' | 'info';

export interface LineMeta {
  key: LineKey;
  name: string;
  color: string;
  dot: string;
}

export interface Customer {
  id: string;
  name: string;
  short: string;
  nit: string;
  contact: string;
  email: string;
  phone: string;
  credit: number;
  totalBalance: number;
  vencido: number;
  avgPayDays: number;
  onTimeRate: number;
  contextoComercial?: string;   // notas cualitativas sobre la relación con el cliente
}

export interface InvoiceLine {
  line: LineKey;
  amount: number;       // total de la línea (con IVA)
  balance: number;
  iva?: number;         // IVA de la línea (para el desglose en el detalle)
  centroCostoId?: string;  // record id del CENTRO_COSTO (para analítica por servicio real)
  description?: string;
}

export interface Invoice {
  id: string;
  noFactura: string;
  custId: string;
  total: number;
  balance: number;
  daysSinceIssued: number;
  emisionAgo: number;
  dueAgo: number;
  status: InvoiceStatus;
  /** F-032: estado bruto del ESTADO de Airtable (sin combinar con fecha). */
  estadoBruto: InvoiceEstadoBruto;
  /** F-032: true si Estatus_Cobranza='VENCIDA' en alguna línea Y estadoBruto ∈ {emitida, pendiente}. */
  vencida: boolean;
  lineas: InvoiceLine[];
  line: LineKey;
  isMixed: boolean;
  // Campos opcionales para el detalle (no usados por el listado)
  fechaEmision?: string;
  fechaVencimiento?: string;
  adjuntoUrl?: string;
  adjuntoNombre?: string;
  asientoRef?: string;
  /** F-044: email del último editor (campos no-contables). undefined si nunca se editó. */
  editadoPor?: string;
  /** F-044: ISO datetime del último cambio. undefined si nunca se editó. */
  fechaUltimaEdicion?: string;
  /** F-044: texto libre line-by-line con cambios históricos. Para parsear, ver getHistorialEdicionesFactura. */
  historialEdiciones?: string;
}

export interface LineStats {
  line: LineKey;
  name: string;
  count: number;
  facturado: number;
  cobrado: number;
  porCobrar: number;
  tasa: number;
  health: HealthStatus;
}

export interface AgingEntry {
  label: string;
  range: string;
  amount: number;
  count: number;
  cls: string;
}

export interface MonthlyEntry {
  m: string;
  fact: number;
  cob: number;
}

export interface AIInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  actions: string[];
  impact: string;
}

export interface JournalLine {
  cuenta: string;
  debe: number;
  haber: number;
  cc: string;
}

export interface Payment {
  id: string;
  date: string;
  custId: string;
  amount: number;
  method: string;
  bank: string;
  ref: string;
}

export interface Summary {
  facturadoMes: number;
  facturadoPrev: number;
  cobradoMes: number;
  cobradoPrev: number;
  porCobrarTotal: number;
  vencido90: number;
  flujoNeto: number;
  flujoPrev: number;
  margenOperativo: number;
  margenPrev: number;
  totalFacturas: number;
  facturadoTotal: number;
  tasaCobranza: number;
}
