import type {
  Customer, Invoice, LineStats, AgingEntry, MonthlyEntry,
  AIInsight, JournalLine, Summary, LineMeta, LineKey
} from './types';

// ============================================================
// Mock data — basado en cifras reales del negocio
// Se usa hasta que conectemos Airtable real en Fase 2.
// ============================================================

export const LINES: Record<LineKey, LineMeta> = {
  poligrafo:   { key: 'poligrafo',   name: 'Polígrafo',      color: 'var(--line-poligrafo)',   dot: 'dot-poligrafo' },
  socio:       { key: 'socio',       name: 'Socioeconómico', color: 'var(--line-socio)',       dot: 'dot-socio' },
  talenttrack: { key: 'talenttrack', name: 'TalentTrack',    color: 'var(--line-talenttrack)', dot: 'dot-talenttrack' },
  administrativo: { key: 'administrativo', name: 'Administrativo', color: 'var(--line-ventas)', dot: 'dot-ventas' },
};

export const CUSTOMERS: Customer[] = [
  { id: 'C-001', name: 'FUNDACIÓN GENESIS EMPRESARIAL', short: 'Fund. Genesis Empresarial',
    nit: '5483712-3', contact: 'Lic. Mariela Sandoval', email: 'mariela.sandoval@genesis.gt', phone: '+502 2329-1100',
    credit: 30, totalBalance: 294740, vencido: 246112, avgPayDays: 67, onTimeRate: 4/8 },
  { id: 'C-002', name: 'Banco de Desarrollo Rural, S.A.', short: 'Banrural',
    nit: '1234567-8', contact: 'Sergio Estrada', email: 'sestrada@banrural.com.gt', phone: '+502 2338-4400',
    credit: 45, totalBalance: 184320, vencido: 121080, avgPayDays: 58, onTimeRate: 6/9 },
  { id: 'C-003', name: 'Microfinanciera Génesis, S.A.', short: 'Microfinanciera Génesis',
    nit: '9988772-1', contact: 'Ana Lucía Reyes', email: 'areyes@mfgenesis.gt', phone: '+502 2410-9090',
    credit: 30, totalBalance: 91260, vencido: 67800, avgPayDays: 71, onTimeRate: 3/7 },
  { id: 'C-004', name: 'Banco Cuscatlán de Guatemala', short: 'Cuscatlán',
    nit: '5564423-K', contact: 'Roberto Maldonado', email: 'rmaldonado@cuscatlan.com', phone: '+502 2495-1100',
    credit: 45, totalBalance: 87410, vencido: 41200, avgPayDays: 52, onTimeRate: 7/10 },
  { id: 'C-005', name: 'BAC | Credomatic, S.A.', short: 'BAC Credomatic',
    nit: '3398117-5', contact: 'Diana Hernández', email: 'dhernandez@bac.net', phone: '+502 2378-9000',
    credit: 30, totalBalance: 76180, vencido: 28920, avgPayDays: 41, onTimeRate: 8/10 },
  { id: 'C-006', name: 'Cantata, S.A.', short: 'Cantata',
    nit: '8821094-2', contact: 'Pedro Vásquez', email: 'pvasquez@cantata.gt', phone: '+502 2244-3050',
    credit: 30, totalBalance: 64900, vencido: 19200, avgPayDays: 38, onTimeRate: 5/7 },
  { id: 'C-007', name: 'MPRH Consultores', short: 'MPRH',
    nit: '4471290-8', contact: 'Andrea Mendoza', email: 'amendoza@mprh.com.gt', phone: '+502 2280-1144',
    credit: 30, totalBalance: 48720, vencido: 12400, avgPayDays: 44, onTimeRate: 4/6 },
  { id: 'C-008', name: 'Kerns, S.A.', short: 'Kerns',
    nit: '7732015-4', contact: 'Carlos Argueta', email: 'cargueta@kerns.gt', phone: '+502 2206-9090',
    credit: 30, totalBalance: 41200, vencido: 8800, avgPayDays: 35, onTimeRate: 7/9 },
  { id: 'C-009', name: 'GT Logistics, S.A.', short: 'GTLogistics',
    nit: '5519883-6', contact: 'Marcela Pérez', email: 'mperez@gtlogistics.com', phone: '+502 2331-7700',
    credit: 45, totalBalance: 38600, vencido: 0, avgPayDays: 31, onTimeRate: 8/9 },
  { id: 'C-010', name: 'Procesadora de Tarjetas de Crédito de Centroamérica', short: 'Procesadora de Tarjetas',
    nit: '2299744-9', contact: 'Estuardo Galindo', email: 'egalindo@ptcca.com', phone: '+502 2470-2200',
    credit: 60, totalBalance: 35280, vencido: 0, avgPayDays: 47, onTimeRate: 6/8 },
];

const inv = (
  id: string, custId: string, line: LineKey,
  total: number, balance: number,
  daysSinceIssued: number, status: Invoice['status'], due: number
): Invoice => ({
  id,
  noFactura: id,
  custId,
  line,
  lineas: [{ line, amount: total, balance }],
  isMixed: false,
  total,
  balance,
  daysSinceIssued,
  status,
  // F-032: derivar estadoBruto + vencida desde el legacy status del mock
  estadoBruto:
    status === 'cobrado' ? 'cobrado'
    : status === 'anulado' ? 'anulado'
    : status === 'pendiente' ? 'pendiente'
    : 'emitida',
  vencida: status === 'vencido' || due > 0,
  emisionAgo: daysSinceIssued,
  dueAgo: due,
});

export const INVOICES: Invoice[] = [
  inv('F-2026-0411', 'C-001', 'socio',       128400, 128400, 132, 'vencido', 102),
  inv('F-2026-0508', 'C-001', 'talenttrack', 117740, 117740,  98, 'vencido',  68),
  inv('F-2026-0612', 'C-001', 'poligrafo',    48600,  48600,  56, 'por_cobrar', 26),
  inv('F-2026-0388', 'C-002', 'socio',        92800,  92800, 118, 'vencido', 73),
  inv('F-2026-0541', 'C-002', 'poligrafo',    63120,  63120,  84, 'vencido', 39),
  inv('F-2026-0671', 'C-002', 'talenttrack',  28400,  28400,  31, 'por_cobrar', -14),
  inv('F-2026-0427', 'C-003', 'socio',        67800,  67800, 124, 'vencido', 94),
  inv('F-2026-0599', 'C-003', 'poligrafo',    23460,  23460,  68, 'por_cobrar', 38),
  inv('F-2026-0489', 'C-004', 'talenttrack',  41200,  41200, 106, 'vencido', 61),
  inv('F-2026-0623', 'C-004', 'socio',        46210,  46210,  54, 'por_cobrar', 9),
  inv('F-2026-0511', 'C-005', 'poligrafo',    28920,  28920,  92, 'vencido', 62),
  inv('F-2026-0644', 'C-005', 'talenttrack',  47260,  47260,  48, 'por_cobrar', 18),
  inv('F-2026-0533', 'C-006', 'socio',        19200,  19200,  88, 'vencido', 58),
  inv('F-2026-0680', 'C-006', 'administrativo',       45700,  45700,  29, 'por_cobrar', -1),
  inv('F-2026-0555', 'C-007', 'poligrafo',    12400,  12400,  76, 'vencido', 46),
  inv('F-2026-0691', 'C-007', 'talenttrack',  36320,  36320,  22, 'por_cobrar', -8),
  inv('F-2026-0567', 'C-008', 'administrativo',        8800,   8800,  72, 'vencido', 42),
  inv('F-2026-0712', 'C-008', 'poligrafo',    32400,  32400,  15, 'por_cobrar', -15),
  inv('F-2026-0716', 'C-009', 'talenttrack',  38600,  38600,  18, 'por_cobrar', -27),
  inv('F-2026-0721', 'C-010', 'socio',        35280,  35280,  11, 'por_cobrar', -49),
  inv('F-2026-0301', 'C-009', 'socio',        24800,      0, 165, 'cobrado', -2),
  inv('F-2026-0344', 'C-005', 'poligrafo',    18900,      0, 152, 'cobrado', -8),
  inv('F-2026-0376', 'C-004', 'talenttrack',  29400,      0, 144, 'cobrado', -3),
  inv('F-2026-0392', 'C-006', 'administrativo',       12600,      0, 138, 'cobrado', -1),
];

export const LINE_STATS: LineStats[] = [
  { line: 'poligrafo',   name: 'Polígrafo',       count: 434, facturado: 1067200, cobrado: 527200, porCobrar: 540000, tasa: 49.4, health: 'good' },
  { line: 'socio',       name: 'Socioeconómico',  count: 259, facturado: 1289000, cobrado: 381000, porCobrar: 908000, tasa: 29.6, health: 'bad'  },
  { line: 'talenttrack', name: 'TalentTrack',     count:  74, facturado:  859496, cobrado: 0,      porCobrar: 859496, tasa:  0.0, health: 'warn' },
  { line: 'administrativo', name: 'Administrativo', count: 6, facturado: 105000, cobrado: 93000, porCobrar: 12000, tasa: 88.6, health: 'good' },
];

export const AGING: AgingEntry[] = [
  { label: 'Corriente', range: '0 días',  amount: 502310,  count: 132, cls: 'aging-current' },
  { label: '1–30 d',    range: '1–30',    amount: 412600,  count: 178, cls: 'aging-1-30' },
  { label: '31–60 d',   range: '31–60',   amount: 188450,  count: 89,  cls: 'aging-31-60' },
  { label: '61–90 d',   range: '61–90',   amount: 113840,  count: 57,  cls: 'aging-61-90' },
  { label: '+90 d',     range: '+90',     amount: 1110000, count: 317, cls: 'aging-90' },
];

export const MONTHLY: MonthlyEntry[] = [
  { m: "Jun '25", fact: 198000, cob: 142000 },
  { m: "Jul '25", fact: 211000, cob: 165000 },
  { m: "Ago '25", fact: 224000, cob: 158000 },
  { m: "Sep '25", fact: 235000, cob: 172000 },
  { m: "Oct '25", fact: 242000, cob: 168000 },
  { m: "Nov '25", fact: 251000, cob: 188000 },
  { m: "Dic '25", fact: 268000, cob: 174000 },
  { m: "Ene '26", fact: 247000, cob: 195000 },
  { m: "Feb '26", fact: 261000, cob: 211000 },
  { m: "Mar '26", fact: 274000, cob: 224000 },
  { m: "Abr '26", fact: 269000, cob: 198000 },
  { m: "May '26", fact: 281000, cob: 184000 },
];

export const AI_INSIGHTS: AIInsight[] = [
  {
    id: 'ai-1',
    severity: 'critical',
    title: 'FUNDACIÓN GENESIS concentra 18.3% del aging crítico',
    body: '3 facturas vencidas por Q294,740, de las cuales Q246K ya pasaron los 90 días. El contacto del cliente no responde correos desde el 12 de abril.',
    actions: ['Iniciar gestión legal', 'Generar carta de cobro', 'Llamar a Mariela'],
    impact: 'Q246,112',
  },
  {
    id: 'ai-2',
    severity: 'warning',
    title: 'TalentTrack: 0% de cobranza en 4 meses',
    body: '74 facturas emitidas (Q859K) sin un solo cobro registrado. Posible problema de facturación o términos con clientes nuevos.',
    actions: ['Revisar plantilla', 'Auditar términos', 'Hablar con Sales Ops'],
    impact: 'Q859,496',
  },
  {
    id: 'ai-3',
    severity: 'info',
    title: 'Polígrafo lidera salud con 49.4% de cobranza',
    body: 'La línea más madura está performando 8 puntos arriba del promedio. Modelo replicable a TalentTrack.',
    actions: ['Ver playbook', 'Reunión de aprendizaje'],
    impact: '+Q527K',
  },
];

export const JOURNAL_SAMPLE: JournalLine[] = [
  { cuenta: '1101.02 — Clientes por cobrar',   debe: 128400, haber: 0,      cc: 'Socioeconómico' },
  { cuenta: '4101.01 — Ingresos por servicios', debe: 0,      haber: 114643, cc: 'Socioeconómico' },
  { cuenta: '2102.01 — IVA por pagar',          debe: 0,      haber: 13757,  cc: '—' },
];

export const SUMMARY: Summary = {
  facturadoMes:    281200, facturadoPrev:    269000,
  cobradoMes:      184000, cobradoPrev:      198000,
  porCobrarTotal: 1614094,
  vencido90:      1110000,
  flujoNeto:       142800, flujoPrev:        178200,
  margenOperativo:    23.4, margenPrev:          26.1,
  totalFacturas:      773,
  facturadoTotal:  2760696,
  tasaCobranza:       41.5,
};
