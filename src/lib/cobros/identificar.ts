/**
 * IDENTIFICAR PAGO — PURO (sin IO; va al navegador, al servidor y a los validadores).
 *
 * El CFO recibe un depósito y quiere saber qué factura lo pagó. Antes se comparaba solo contra el TOTAL; pero hay
 * clientes que RETIENEN IVA (agentes de retención): la factura es de Q450, el IVA es Q48.21, retienen el 15 % (Q7.23)
 * y depositan Q442.77. Acá viven:
 *  - el PERFIL DE RETENCIÓN de cada cliente, derivado de su historial de cobros (la tasa más frecuente sobre el IVA de
 *    la factura: 15 %, 30 % u 80 %; ISR soportado aunque hoy nadie lo retenga). Nada se persiste: sale de los cobros;
 *  - los TRES MONTOS ESPERADOS por factura abierta: total, saldo (el del #51: total − cobros activos − NC activas; la
 *    retención ya registrada ES un cobro activo con su monto, así que ya está descontada y no se resta dos veces) y
 *    neto con retención (saldo − retención esperada sobre lo pendiente);
 *  - la BASE de búsqueda («Buscar sobre»: automático / total / saldo / neto) y su ida y vuelta con la URL;
 *  - las coincidencias por factura y por cliente (suma de facturas abiertas), con la etiqueta «Calza por», la diferencia
 *    contra el monto con el que calzó y el orden: diferencia 0 primero, luego el tipo (total o saldo → retención del
 *    perfil → retención general «posible»), al final por días vencida;
 *  - el enlace prellenado para registrar el cobro (monto + retención + factura) y el atajo a la búsqueda del #51.
 */

export const TASA_GENERAL_IVA = 0.15;        // tasa general de los agentes de retención de IVA (el cliente nunca retuvo → «posible»)
export const TASA_MAX_IVA = 0.8;             // la mayor vista (agentes especiales): acota la tolerancia del atajo al #51
export const FACTOR_IVA = 1 - 1 / 1.12;      // porción de IVA dentro de un monto con IVA (12 %)
/** El cliente redondea su retención por línea y a su manera (Q95.625 → Q95.62 o Q95.63): un centavo por línea de holgura en el neto, aun con tolerancia «Exacto». */
export const REDONDEO_RETENCION = 0.01;
const EPS = 0.005;
const round2 = (v: number) => Math.round(v * 100) / 100;

/* ───────────── perfil de retención del cliente ───────────── */

/** Un cobro con retención, ya unido a su línea de factura: la tasa es retención / IVA de la línea (ISR: / subtotal). */
export interface RegistroRetencion { clienteId: string; retIva: number; retIsr: number; ivaLinea: number; subtotalLinea: number }

export interface PerfilRetencion {
  /** tasa más frecuente sobre el IVA (0.15 / 0.3 / 0.8); null si nunca retuvo IVA */ tasaIva: number | null;
  /** cuántos cobros con retención de IVA respaldan la tasa */ nIva: number;
  /** tasa más frecuente de ISR sobre el subtotal; null si nunca retuvo ISR */ tasaIsr: number | null;
  nIsr: number;
}

const moda = (tasas: number[]): number | null => {
  if (tasas.length === 0) return null;
  const c = new Map<number, number>();
  for (const t of tasas) c.set(t, (c.get(t) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
};

/** Perfil por cliente a partir de sus cobros con retención (activos). Tasas redondeadas a 2 decimales. */
export function perfilesRetencion(regs: RegistroRetencion[]): Record<string, PerfilRetencion> {
  const porCliente = new Map<string, { iva: number[]; isr: number[] }>();
  for (const r of regs) {
    if (!r.clienteId) continue;
    const p = porCliente.get(r.clienteId) ?? { iva: [], isr: [] };
    if (r.retIva > EPS && r.ivaLinea > EPS) p.iva.push(round2(r.retIva / r.ivaLinea));
    if (r.retIsr > EPS && r.subtotalLinea > EPS) p.isr.push(round2(r.retIsr / r.subtotalLinea));
    porCliente.set(r.clienteId, p);
  }
  const out: Record<string, PerfilRetencion> = {};
  for (const [id, p] of porCliente) out[id] = { tasaIva: moda(p.iva), nIva: p.iva.length, tasaIsr: moda(p.isr), nIsr: p.isr.length };
  return out;
}

/* ───────────── montos esperados ───────────── */

export type EstadoAbierta = 'emitida' | 'pendiente' | 'parcial' | 'otro';

/** Una factura abierta (viva y no cobrada según la 026) tal como la consolida el #51. */
export interface FacturaIdentificable {
  /** id del listado (/facturacion/<id>) */ id: string; noFactura: string;
  clienteId: string; cliente: string; nit: string;
  fechaEmision: string; fechaVencimiento: string; diasVencida: number;
  total: number; iva: number; cobrado: number; ncs: number; saldo: number;
  /** líneas vivas que suman la factura (cada una redondea su retención) */ lineas: number;
  estado: EstadoAbierta;
}

/** Holgura de redondeo de la retención: un centavo por línea. */
export const holguraNeto = (f: Pick<FacturaIdentificable, 'lineas'>): number => REDONDEO_RETENCION * Math.max(1, f.lineas || 1);
export const esNeto = (t: TipoCoincidencia): boolean => t === 'neto' || t === 'neto_general';

export interface MontosEsperados {
  total: number; saldo: number; neto: number;
  /** retención de IVA esperada sobre lo pendiente */ retIva: number; tasaIva: number;
  /** retención de ISR esperada (solo si el cliente la tiene en su historial) */ retIsr: number; tasaIsr: number | null;
  /** true = el cliente nunca retuvo IVA: se probó la tasa general del 15 % */ general: boolean;
}

/** IVA que queda por cobrar: el IVA de la factura si no hubo cobros (ni NC); si no, la porción de IVA del saldo. */
export const ivaPendienteDe = (f: Pick<FacturaIdentificable, 'iva' | 'saldo' | 'cobrado' | 'ncs' | 'total'>): number =>
  f.cobrado <= EPS && f.ncs <= EPS && f.iva > EPS && Math.abs(f.saldo - f.total) <= EPS ? round2(f.iva) : round2(f.saldo - f.saldo / 1.12);

export function montosEsperados(f: FacturaIdentificable, perfil: PerfilRetencion | undefined): MontosEsperados {
  const general = !(perfil && perfil.tasaIva != null);
  const tasaIva = general ? TASA_GENERAL_IVA : perfil!.tasaIva!;
  const tasaIsr = perfil?.tasaIsr ?? null;
  const ivaPend = ivaPendienteDe(f);
  const retIva = round2(ivaPend * tasaIva);
  const retIsr = tasaIsr ? round2(Math.max(0, f.saldo - ivaPend) * tasaIsr) : 0;
  return { total: round2(f.total), saldo: round2(f.saldo), neto: round2(Math.max(0, f.saldo - retIva - retIsr)), retIva, tasaIva, retIsr, tasaIsr, general };
}

/* ───────────── base de búsqueda y tolerancia (URL) ───────────── */

export type BaseBusqueda = 'auto' | 'total' | 'saldo' | 'neto';
export const BASES: readonly BaseBusqueda[] = ['auto', 'total', 'saldo', 'neto'];
export const ETIQUETA_BASE: Record<BaseBusqueda, string> = { auto: 'Automático', total: 'Total', saldo: 'Saldo', neto: 'Neto con retención' };
export const esBase = (v: unknown): v is BaseBusqueda => typeof v === 'string' && (BASES as readonly string[]).includes(v);

export type PresetTolerancia = 'exacto' | 'q1' | 'q10' | 'q100' | 'pct1';
export const PRESETS_TOLERANCIA: { key: PresetTolerancia; label: string }[] = [
  { key: 'exacto', label: 'Exacto' }, { key: 'q1', label: '±Q1' }, { key: 'q10', label: '±Q10' }, { key: 'q100', label: '±Q100' }, { key: 'pct1', label: '±1%' },
];
export const esPreset = (v: unknown): v is PresetTolerancia => typeof v === 'string' && PRESETS_TOLERANCIA.some(p => p.key === v);
export function toleranciaDe(preset: PresetTolerancia, monto: number): number {
  switch (preset) {
    case 'exacto': return 0;
    case 'q1': return 1;
    case 'q10': return 10;
    case 'q100': return 100;
    case 'pct1': return monto * 0.01;
  }
}

export interface EstadoIdentificar { monto: number; preset: PresetTolerancia; base: BaseBusqueda }
/** Monto escrito → número (acepta «Q 442.77», «1,064»). 0 si no es un monto. */
export const parseMonto = (raw: string): number => { const n = parseFloat(String(raw ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
/** Estado desde la URL (`m`, `tol`, `sobre`); valores inválidos → por defecto. */
export function estadoDesdeParams(get: (k: string) => string | null | undefined): EstadoIdentificar {
  const preset = get('tol'), base = get('sobre');
  return { monto: parseMonto(get('m') ?? ''), preset: esPreset(preset) ? preset : 'exacto', base: esBase(base) ? base : 'auto' };
}
/** URL desde el estado (sin los valores por defecto). */
export function paramsDeEstado(e: EstadoIdentificar): string {
  const p = new URLSearchParams();
  if (e.monto > 0) p.set('m', String(round2(e.monto)));
  if (e.preset !== 'exacto') p.set('tol', e.preset);
  if (e.base !== 'auto') p.set('sobre', e.base);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/* ───────────── coincidencias ───────────── */

export type TipoCoincidencia = 'total' | 'saldo' | 'neto' | 'neto_general';
/** orden por tipo: total o saldo primero, luego retención del perfil del cliente, al final la retención general «posible» */
export const RANGO_TIPO: Record<TipoCoincidencia, number> = { total: 0, saldo: 0, neto: 1, neto_general: 2 };

export interface Coincidencia {
  factura: FacturaIdentificable; montos: MontosEsperados;
  tipo: TipoCoincidencia;
  /** el monto con el que calzó */ esperado: number;
  /** esperado − depósito */ diff: number;
  /** diferencia 0 (en el neto, dentro del centavo de redondeo por línea) */ exacta: boolean;
  etiqueta: string; posible: boolean;
}

const pct = (t: number) => `${Math.round(t * 1000) / 10} %`;
const Qf = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** «Total exacto» / «Total» / «Saldo» / «Neto con retención IVA 15 % (−Q7.23)» / «Posible: retención general 15 % (−Q7.23)». */
export function etiquetaCoincidencia(tipo: TipoCoincidencia, m: MontosEsperados, diff: number): string {
  const exacto = Math.abs(diff) <= EPS;
  if (tipo === 'total') return exacto ? 'Total exacto' : 'Total';
  // en el neto la diferencia puede ser el centavo de redondeo del cliente: la etiqueta no cambia
  if (tipo === 'saldo') return 'Saldo';
  const partes = [`IVA ${pct(m.tasaIva)} (−${Qf(m.retIva)})`];
  if (m.retIsr > EPS && m.tasaIsr) partes.push(`ISR ${pct(m.tasaIsr)} (−${Qf(m.retIsr)})`);
  return tipo === 'neto_general' ? `Posible: retención general ${partes.join(' · ')}` : `Neto con retención ${partes.join(' · ')}`;
}

/** Los montos contra los que se compara según la base; sin repetir (saldo = total cuando no hubo cobros → solo total; neto = saldo sin IVA → nada). */
export function candidatos(m: MontosEsperados, base: BaseBusqueda): Array<{ tipo: TipoCoincidencia; monto: number }> {
  const out: Array<{ tipo: TipoCoincidencia; monto: number }> = [];
  const tipoNeto: TipoCoincidencia = m.general ? 'neto_general' : 'neto';
  if (base === 'auto' || base === 'total') out.push({ tipo: 'total', monto: m.total });
  if ((base === 'auto' || base === 'saldo') && Math.abs(m.saldo - m.total) > EPS) out.push({ tipo: 'saldo', monto: m.saldo });
  if ((base === 'auto' || base === 'neto') && m.retIva + m.retIsr > EPS) out.push({ tipo: tipoNeto, monto: m.neto });
  if (base === 'saldo' && out.length === 0) out.push({ tipo: 'saldo', monto: m.saldo });   // base saldo sin cobros: el saldo igual se compara
  return out;
}

const mejor = <T extends { diff: number; tipo: TipoCoincidencia; exacta: boolean }>(a: T, b: T): T => {
  const ea = a.exacta, eb = b.exacta;
  if (ea !== eb) return ea ? a : b;
  if (RANGO_TIPO[a.tipo] !== RANGO_TIPO[b.tipo]) return RANGO_TIPO[a.tipo] < RANGO_TIPO[b.tipo] ? a : b;
  return Math.abs(a.diff) <= Math.abs(b.diff) ? a : b;
};

/** Orden: diferencia 0 primero; luego por tipo (total o saldo → perfil → general); al final por días vencida (la más vieja primero). */
export const compararCoincidencias = (a: { diff: number; exacta: boolean; tipo: TipoCoincidencia; dias: number; clave: string }, b: { diff: number; exacta: boolean; tipo: TipoCoincidencia; dias: number; clave: string }): number =>
  (a.exacta ? 0 : 1) - (b.exacta ? 0 : 1) || RANGO_TIPO[a.tipo] - RANGO_TIPO[b.tipo] || b.dias - a.dias || Math.abs(a.diff) - Math.abs(b.diff) || a.clave.localeCompare(b.clave);

/** Un candidato dentro de la tolerancia (el neto suma la holgura de redondeo) → con su diferencia y si es exacta; null si queda fuera. */
function evaluar(c: { tipo: TipoCoincidencia; monto: number }, deposito: number, tol: number, holgura: number): { tipo: TipoCoincidencia; monto: number; diff: number; exacta: boolean } | null {
  const diff = round2(c.monto - deposito);
  const margen = esNeto(c.tipo) ? holgura : 0;
  if (Math.abs(diff) > tol + margen + EPS) return null;
  return { ...c, diff, exacta: Math.abs(diff) <= margen + EPS };
}

/** Facturas que calzan con el depósito: una fila por factura, con el mejor monto esperado dentro de la tolerancia. */
export function calzarFacturas(facturas: FacturaIdentificable[], perfiles: Record<string, PerfilRetencion>, monto: number, tol: number, base: BaseBusqueda): Coincidencia[] {
  if (!(monto > 0)) return [];
  const out: Coincidencia[] = [];
  for (const f of facturas) {
    const m = montosEsperados(f, perfiles[f.clienteId]);
    let elegido: { tipo: TipoCoincidencia; monto: number; diff: number; exacta: boolean } | null = null;
    for (const c of candidatos(m, base)) {
      const cand = evaluar(c, monto, tol, holguraNeto(f));
      if (cand) elegido = elegido ? mejor(elegido, cand) : cand;
    }
    if (!elegido) continue;
    out.push({ factura: f, montos: m, tipo: elegido.tipo, esperado: elegido.monto, diff: elegido.diff, exacta: elegido.exacta, etiqueta: etiquetaCoincidencia(elegido.tipo, m, elegido.diff), posible: elegido.tipo === 'neto_general' });
  }
  return out.sort((a, b) => compararCoincidencias({ diff: a.diff, exacta: a.exacta, tipo: a.tipo, dias: a.factura.diasVencida, clave: a.factura.noFactura }, { diff: b.diff, exacta: b.exacta, tipo: b.tipo, dias: b.factura.diasVencida, clave: b.factura.noFactura }));
}

export interface CoincidenciaCliente {
  clienteId: string; cliente: string;
  facturas: Array<{ factura: FacturaIdentificable; montos: MontosEsperados }>;
  tipo: TipoCoincidencia; suma: number; diff: number; exacta: boolean; etiqueta: string; posible: boolean;
  /** retención de IVA esperada sumada (solo neto) */ retIva: number;
}

/** Clientes cuya SUMA de facturas abiertas (totales, saldos o netos con retención) calza con el depósito. Solo con dos o más facturas: una sola ya aparece arriba. */
export function calzarClientes(facturas: FacturaIdentificable[], perfiles: Record<string, PerfilRetencion>, monto: number, tol: number, base: BaseBusqueda): CoincidenciaCliente[] {
  if (!(monto > 0)) return [];
  const grupos = new Map<string, FacturaIdentificable[]>();
  for (const f of facturas) grupos.set(f.clienteId, [...(grupos.get(f.clienteId) ?? []), f]);
  const out: CoincidenciaCliente[] = [];
  for (const [clienteId, fs] of grupos) {
    if (fs.length < 2) continue;
    const perfil = perfiles[clienteId];
    const conMontos = fs.map(f => ({ factura: f, montos: montosEsperados(f, perfil) })).sort((a, b) => b.factura.diasVencida - a.factura.diasVencida);
    const suma = (k: 'total' | 'saldo' | 'neto') => round2(conMontos.reduce((s, x) => s + x.montos[k], 0));
    const retIva = round2(conMontos.reduce((s, x) => s + x.montos.retIva, 0));
    const retIsr = round2(conMontos.reduce((s, x) => s + x.montos.retIsr, 0));
    const general = conMontos.every(x => x.montos.general);
    const agregado: MontosEsperados = { total: suma('total'), saldo: suma('saldo'), neto: suma('neto'), retIva, tasaIva: perfil?.tasaIva ?? TASA_GENERAL_IVA, retIsr, tasaIsr: perfil?.tasaIsr ?? null, general };
    const holgura = fs.reduce((s, f) => s + holguraNeto(f), 0);
    let elegido: { tipo: TipoCoincidencia; monto: number; diff: number; exacta: boolean } | null = null;
    for (const c of candidatos(agregado, base)) {
      const cand = evaluar(c, monto, tol, holgura);
      if (cand) elegido = elegido ? mejor(elegido, cand) : cand;
    }
    if (!elegido) continue;
    const etiqueta = elegido.tipo === 'total' ? 'Suma de totales' : elegido.tipo === 'saldo' ? 'Suma de saldos' : `Suma de netos · ${etiquetaCoincidencia(elegido.tipo, agregado, elegido.diff)}`;
    out.push({ clienteId, cliente: fs[0].cliente, facturas: conMontos, tipo: elegido.tipo, suma: elegido.monto, diff: elegido.diff, exacta: elegido.exacta, etiqueta, posible: elegido.tipo === 'neto_general', retIva: esNeto(elegido.tipo) ? retIva : 0 });
  }
  return out.sort((a, b) => compararCoincidencias({ diff: a.diff, exacta: a.exacta, tipo: a.tipo, dias: Math.max(...a.facturas.map(x => x.factura.diasVencida)), clave: a.cliente }, { diff: b.diff, exacta: b.exacta, tipo: b.tipo, dias: Math.max(...b.facturas.map(x => x.factura.diasVencida)), clave: b.cliente }));
}

/* ───────────── enlaces ───────────── */

/** Lo que llega prellenado al modal «Registrar cobro» de la factura: el depósito como cobro y la retención calculada. */
export interface PrellenadoCobro { monto: number; retIva: number; retIsr: number }

/** /facturacion/<id>?cobro=442.77&retiva=7.23 — abre la factura con el modal de cobro prellenado (null sin id de factura). */
export function enlaceRegistrarCobro(c: Coincidencia, deposito: number): string | null {
  if (!c.factura.id) return null;
  const p = new URLSearchParams({ cobro: String(round2(deposito)) });
  if (c.tipo === 'neto' || c.tipo === 'neto_general') {
    if (c.montos.retIva > EPS) p.set('retiva', String(c.montos.retIva));
    if (c.montos.retIsr > EPS) p.set('retisr', String(c.montos.retIsr));
  }
  return `/facturacion/${encodeURIComponent(c.factura.id)}?${p.toString()}`;
}

/** Lee `cobro`, `retiva`, `retisr` de la URL de la factura (null si no vienen o no son montos). */
export function prellenadoDesdeParams(get: (k: string) => string | null | undefined): PrellenadoCobro | null {
  const n = (k: string) => { const v = Number(String(get(k) ?? '').replace(/,/g, '')); return Number.isFinite(v) && v > 0 ? round2(v) : 0; };
  const monto = n('cobro'), retIva = n('retiva'), retIsr = n('retisr');
  return monto > 0 ? { monto, retIva, retIsr } : null;
}

/**
 * Tolerancia para el atajo «Buscar facturas por este monto» (#51) cuando la base es NETO: ahí no existe el neto, así que
 * se busca por SALDO con una tolerancia que cubra la retención esperada hasta la tasa máxima vista (80 % del IVA): si el
 * depósito n es saldo − t·FACTOR·saldo, la retención es n·t·FACTOR/(1 − t·FACTOR); más Q1 de centavos.
 */
export const toleranciaNetoParaBusqueda = (monto: number): number => round2(monto * (TASA_MAX_IVA * FACTOR_IVA) / (1 - TASA_MAX_IVA * FACTOR_IVA) + 1);

/** Atajo a /facturacion (#51) con la base elegida: total → total; saldo → saldo; neto → saldo con la tolerancia ampliada y aviso; automático → total (como antes). */
export function enlaceBusquedaFacturas(monto: number, base: BaseBusqueda): string {
  const p = new URLSearchParams({ monto: String(round2(monto)) });
  if (base === 'saldo') p.set('sobre', 'saldo');
  if (base === 'neto') { p.set('sobre', 'saldo'); p.set('tol', String(toleranciaNetoParaBusqueda(monto))); p.set('aviso', 'retencion'); }
  p.set('estado', 'pendientes');
  return `/facturacion?${p.toString()}`;
}
