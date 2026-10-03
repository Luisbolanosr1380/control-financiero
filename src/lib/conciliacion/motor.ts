/**
 * CONCILIACIÓN BANCARIA — motor PURO (sin IO).
 *
 * Convención de movimientos_bancarios.monto: SIEMPRE POSITIVO; la
 * dirección la da `tipo` ('Ingreso' entra plata · 'Egreso' sale). La
 * base lo hace cumplir con CHECKs (migración 009). Acá `signo()`
 * convierte a con-signo solo para sumar saldos.
 *
 * Unidad de conciliación ("documento"):
 *  · cobro: un EVENTO de cobro = registros con el mismo cobro_grupo_id
 *    (una factura multi-línea o multi-forma-de-pago genera N registros).
 *    Las RETENCIONES (IVA/ISR) se excluyen: nunca pasan por el banco.
 *  · pago: un pago a deuda; al banco sale capital + interés + mora + comisión.
 *  · gasto: un gasto PAGADO con banco (contado).
 * El monto de cada documento se expresa en la moneda del banco, con la
 * MISMA regla que la función SQL fase2_conciliacion_monto_doc.
 */

export type TipoMov = 'Ingreso' | 'Egreso';
export type TipoDoc = 'cobro' | 'pago' | 'gasto';

export interface Movimiento {
  id: string;
  bancoId: string;
  fecha: string;            // YYYY-MM-DD
  monto: number;            // > 0
  tipo: TipoMov;
  descripcion: string;
  referencia: string;
  conciliado: boolean;
  asientoId: string | null;
  origen: string | null;
  /** Σ monto_aplicado de sus items (0 si contabilizado sin documento). */
  aplicado: number;
}

export interface DocRegistro { id: string; monto: number }

export interface DocBanco {
  key: string;              // 'cobro:<grupo|id>' · 'pago:<id>' · 'gasto:<id>'
  tipo: TipoDoc;
  registros: DocRegistro[]; // uuids + monto de cada registro (cobros agrupados)
  fecha: string;
  monto: number;            // Σ registros, moneda del banco
  referencia: string;
  descripcion: string;
  conciliado: boolean;
  movimientoId: string | null;
}

export const signo = (tipo: TipoMov, monto: number) => (tipo === 'Ingreso' ? monto : -monto);
export const signoDoc = (d: DocBanco) => (d.tipo === 'cobro' ? d.monto : -d.monto);
export const r2 = (n: number) => Math.round(n * 100) / 100;

/* ============================================================
 * Montos por documento (espejo de fase2_conciliacion_monto_doc)
 * ============================================================ */

export function montoCobro(c: { monto_cobrado: number | null; monto_cobro_gtq: number | null }, monedaBanco: string): number {
  const v = monedaBanco === 'USD' ? (c.monto_cobrado ?? 0) : (c.monto_cobro_gtq ?? c.monto_cobrado ?? 0);
  return r2(Number(v));
}

export function montoPago(p: {
  monto_pago: number | null; monto_interes: number | null; monto_mora: number | null;
  monto_comision: number | null; tipo_cambio: number | null;
}, monedaBanco: string): number {
  const total = Number(p.monto_pago ?? 0) + Number(p.monto_interes ?? 0) + Number(p.monto_mora ?? 0) + Number(p.monto_comision ?? 0);
  return r2(total * (monedaBanco === 'USD' ? 1 : Number(p.tipo_cambio ?? 1)));
}

export const esRetencion = (metodo: string | null | undefined) => /^retenci/i.test(String(metodo ?? '').trim());

/** Agrupa registros de cobro en eventos (cobro_grupo_id), sin retenciones ni anulados. */
export function agruparCobros(rows: Array<{
  id: string; cobro_grupo_id: string | null; fecha_cobro: string | null; referencia: string | null;
  metodo: string | null; estado_cobro: string | null; es_conciliado: boolean | null;
  monto_cobrado: number | null; monto_cobro_gtq: number | null; descripcion: string;
}>, monedaBanco: string, movimientoDe: Map<string, string>): DocBanco[] {
  const grupos = new Map<string, DocBanco>();
  for (const c of rows) {
    if (esRetencion(c.metodo) || String(c.estado_cobro ?? '').trim() === 'Anulado') continue;
    const key = `cobro:${c.cobro_grupo_id || c.id}`;
    let g = grupos.get(key);
    if (!g) {
      g = { key, tipo: 'cobro', registros: [], fecha: c.fecha_cobro ?? '', monto: 0, referencia: '', descripcion: c.descripcion, conciliado: true, movimientoId: null };
      grupos.set(key, g);
    }
    const m = montoCobro(c, monedaBanco);
    g.registros.push({ id: c.id, monto: m });
    g.monto = r2(g.monto + m);
    if (c.referencia && !g.referencia.includes(c.referencia)) g.referencia = g.referencia ? `${g.referencia} / ${c.referencia}` : c.referencia;
    if ((c.fecha_cobro ?? '') > g.fecha) g.fecha = c.fecha_cobro ?? g.fecha;
    g.conciliado = g.conciliado && !!c.es_conciliado;
    g.movimientoId = g.movimientoId ?? movimientoDe.get(c.id) ?? null;
  }
  return [...grupos.values()];
}

/* ============================================================
 * Sugerencias (match)
 * ============================================================ */

export type Confianza = 'alta' | 'media' | 'baja';

export interface Sugerencia {
  docKeys: string[];        // 1 (simple) o N (depósito agrupado)
  confianza: Confianza;
  score: number;            // 0-100 para ordenar
  motivo: string;
  diferencia: number;       // movimiento − Σ docs
}

export interface OpcionesMatch {
  toleranciaMonto: number;     // absoluta en moneda del banco (ej. comisión)
  toleranciaPct: number;       // relativa (0.02 = 2%)
  ventanaDias: number;         // fecha máxima para considerar candidato
}

export const OPCIONES_DEFAULT: OpcionesMatch = { toleranciaMonto: 50, toleranciaPct: 0.02, ventanaDias: 45 };

const dias = (a: string, b: string) => Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000);
const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * La referencia coincide si una contiene a la otra (≥4 caracteres
 * significativos), o si coinciden sus dígitos (≥4, sin ceros a la
 * izquierda): el banco suele mostrar '00008810' y el sistema 'TRF-8810'.
 */
export function refCoincide(a: string, b: string): boolean {
  const x = normRef(a), y = normRef(b);
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  const dx = x.replace(/\D/g, '').replace(/^0+/, ''), dy = y.replace(/\D/g, '').replace(/^0+/, '');
  return dx.length >= 4 && dy.length >= 4 && (dx.endsWith(dy) || dy.endsWith(dx));
}

export function puntuar(mov: Movimiento, docs: DocBanco[], opc: OpcionesMatch = OPCIONES_DEFAULT): Sugerencia | null {
  const total = r2(docs.reduce((s, d) => s + d.monto, 0));
  const dif = r2(mov.monto - total);
  const exacto = Math.abs(dif) <= 0.01;
  const tol = Math.max(opc.toleranciaMonto, mov.monto * opc.toleranciaPct);
  if (!exacto && Math.abs(dif) > tol) return null;
  const dMax = Math.max(...docs.map(d => dias(mov.fecha, d.fecha)));
  if (dMax > opc.ventanaDias) return null;
  const ref = docs.some(d => d.referencia.split(' / ').some(r => refCoincide(mov.referencia, r) || refCoincide(mov.descripcion, r)));
  const keys = docs.map(d => d.key);
  const agrupado = docs.length > 1 ? ` (depósito agrupado de ${docs.length})` : '';
  if (exacto && ref && dMax <= 3) return { docKeys: keys, confianza: 'alta', score: 95 - dMax, motivo: `Monto exacto + referencia + ${dMax.toFixed(0)} día(s)${agrupado}`, diferencia: dif };
  if (exacto && dMax <= 7) return { docKeys: keys, confianza: 'media', score: 75 - dMax - (docs.length - 1) * 3, motivo: `Monto exacto + ${dMax.toFixed(0)} día(s)${ref ? ' + referencia' : ''}${agrupado}`, diferencia: dif };
  const motivo = exacto ? `Monto exacto pero fecha lejana (${dMax.toFixed(0)} días)` : `Monto aproximado (diferencia ${dif.toFixed(2)}) — ¿comisión?`;
  return { docKeys: keys, confianza: 'baja', score: Math.max(1, 40 - dMax - Math.abs(dif) / Math.max(tol, 1) * 10) + (ref ? 10 : 0), motivo: motivo + agrupado, diferencia: dif };
}

/** Candidatos del mismo sentido y banco, no conciliados. */
export function candidatos(mov: Movimiento, docs: DocBanco[]): DocBanco[] {
  return docs.filter(d => !d.conciliado && (mov.tipo === 'Ingreso' ? d.tipo === 'cobro' : d.tipo !== 'cobro'));
}

/**
 * Sugerencias ordenadas por score. Primero 1:1; si no hay match exacto
 * para un ingreso, busca depósitos agrupados (2-4 cobros que suman el
 * monto exacto dentro de ±7 días). NUNCA confirma: solo sugiere.
 */
export function sugerir(mov: Movimiento, docs: DocBanco[], opc: OpcionesMatch = OPCIONES_DEFAULT, max = 8): Sugerencia[] {
  const cands = candidatos(mov, docs);
  const out: Sugerencia[] = [];
  for (const d of cands) {
    const s = puntuar(mov, [d], opc);
    if (s) out.push(s);
  }
  const hayExacto = out.some(s => Math.abs(s.diferencia) <= 0.01);
  if (!hayExacto && mov.tipo === 'Ingreso') {
    const cerca = cands
      .filter(d => dias(mov.fecha, d.fecha) <= 7 && d.monto < mov.monto)
      .sort((a, b) => dias(mov.fecha, a.fecha) - dias(mov.fecha, b.fecha))
      .slice(0, 22);
    const objetivo = Math.round(mov.monto * 100);
    const cents = cerca.map(d => Math.round(d.monto * 100));
    const combos: number[][] = [];
    const buscar = (inicio: number, k: number, suma: number, sel: number[]) => {
      if (combos.length >= 5) return;
      if (sel.length >= 2 && suma === objetivo) { combos.push([...sel]); return; }
      if (sel.length === k || suma >= objetivo) return;
      for (let i = inicio; i < cents.length; i++) { sel.push(i); buscar(i + 1, k, suma + cents[i], sel); sel.pop(); }
    };
    buscar(0, 4, 0, []);
    for (const c of combos) {
      const s = puntuar(mov, c.map(i => cerca[i]), opc);
      if (s) out.push(s);
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/* ============================================================
 * Cuadre por banco y período
 * ============================================================ */

export interface Cuadre {
  desde: string;
  hasta: string;
  saldoInicial: number;
  fechaSaldoInicial: string | null;
  movimientosPeriodo: number;      // Σ con signo, (fechaSaldoInicial, hasta]
  saldoBanco: number;
  docsPeriodo: number;             // Σ con signo de documentos
  sinDocumentoContabilizado: number; // porción sin documento de movimientos conciliados (ajustes + contabilizados)
  saldoLibros: number;
  diferencia: number;              // banco − libros
  movimientosPendientes: Movimiento[];
  documentosPendientes: DocBanco[];
  explicado: number;               // Σ mov pendientes − Σ docs pendientes
  noExplicado: number;             // diferencia − explicado (cruces de período / aplicaciones parciales)
  estado: 'cuadrado' | 'pendientes' | 'descuadrado';
}

export function calcularCuadre(args: {
  saldoInicial: number;
  fechaSaldoInicial: string | null;
  desde: string;
  hasta: string;
  movimientos: Movimiento[];
  docs: DocBanco[];
}): Cuadre {
  const ini = args.fechaSaldoInicial;
  const enRango = (f: string) => (!ini || f > ini) && f <= args.hasta;
  const movs = args.movimientos.filter(m => enRango(m.fecha));
  const docs = args.docs.filter(d => enRango(d.fecha));

  const movimientosPeriodo = r2(movs.reduce((s, m) => s + signo(m.tipo, m.monto), 0));
  const docsPeriodo = r2(docs.reduce((s, d) => s + signoDoc(d), 0));
  const sinDoc = r2(movs.filter(m => m.conciliado).reduce((s, m) => s + signo(m.tipo, r2(m.monto - m.aplicado)), 0));
  const saldoBanco = r2(args.saldoInicial + movimientosPeriodo);
  const saldoLibros = r2(args.saldoInicial + docsPeriodo + sinDoc);
  const diferencia = r2(saldoBanco - saldoLibros);

  const movimientosPendientes = movs.filter(m => !m.conciliado);
  const documentosPendientes = docs.filter(d => !d.conciliado);
  const explicado = r2(movimientosPendientes.reduce((s, m) => s + signo(m.tipo, m.monto), 0) - documentosPendientes.reduce((s, d) => s + signoDoc(d), 0));
  const noExplicado = r2(diferencia - explicado);
  const hayPend = movimientosPendientes.length + documentosPendientes.length > 0;
  const estado: Cuadre['estado'] = Math.abs(diferencia) <= 0.01 && !hayPend ? 'cuadrado'
    : Math.abs(diferencia) <= 0.01 ? 'pendientes' : 'descuadrado';

  return {
    desde: args.desde, hasta: args.hasta, saldoInicial: args.saldoInicial, fechaSaldoInicial: ini,
    movimientosPeriodo, saldoBanco, docsPeriodo, sinDocumentoContabilizado: sinDoc, saldoLibros, diferencia,
    movimientosPendientes, documentosPendientes, explicado, noExplicado, estado,
  };
}

/* ============================================================
 * Partida de ajuste / contabilización (dirección contable)
 * ============================================================ */

/**
 * Partidas para la porción sin documento de un movimiento.
 * `monto` es la porción (positiva). Si SALE plata extra del banco
 * (egreso por comisión, o ingreso menor a lo cobrado) → Dr cuenta / Cr banco;
 * si ENTRA plata extra → Dr banco / Cr cuenta.
 */
export function partidasSinDocumento(args: {
  tipo: TipoMov;
  diferencia: number;          // movimiento − Σ docs (con su signo); para contabilizar = monto
  cuentaContrapartidaId: string;
  cuentaBancoId: string;
  bancoId: string;
  descripcion: string;
  periodo: string;
}) {
  const monto = r2(Math.abs(args.diferencia));
  const saleDelBanco = (args.tipo === 'Egreso' && args.diferencia > 0) || (args.tipo === 'Ingreso' && args.diferencia < 0);
  const lineaCuenta = { cuenta_id: args.cuentaContrapartidaId, descripcion_linea: args.descripcion, periodo: args.periodo };
  const lineaBanco = { cuenta_id: args.cuentaBancoId, descripcion_linea: args.descripcion, periodo: args.periodo, banco_id: args.bancoId };
  return saleDelBanco
    ? [{ ...lineaCuenta, debe: monto, haber: 0 }, { ...lineaBanco, debe: 0, haber: monto }]
    : [{ ...lineaBanco, debe: monto, haber: 0 }, { ...lineaCuenta, debe: 0, haber: monto }];
}
