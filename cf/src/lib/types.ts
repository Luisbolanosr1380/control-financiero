// ============================================================
// Tipos del dominio — Control Financiero
// Reflejan las tablas reales de Airtable. Cuando migremos a
// Postgres, estos tipos se mantienen — solo cambia /lib/db.
// ============================================================

export type LineKey = 'poligrafo' | 'socio' | 'talenttrack' | 'ventas';

export type InvoiceStatus = 'pendiente' | 'emitida' | 'contabilizado' | 'cobrado' | 'por_cobrar' | 'vencido' | 'anulado';

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
}

export interface Invoice {
  id: string;
  custId: string;
  line: LineKey;
  total: number;
  balance: number;
  daysSinceIssued: number;
  emisionAgo: number;
  dueAgo: number;
  status: InvoiceStatus;
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
