/**
 * TESORERÍA — motor PURO del flujo de caja proyectado (sin IO).
 *
 * Read-only: no escribe nada ni genera asientos. Recibe eventos de caja
 * fechados (las fuentes viven en fuentes.ts) y arma la foto a futuro:
 * períodos (semana/mes), saldo corrido y alerta de apretón de caja.
 *
 * Honestidad de la proyección (criterio CFO, brief):
 *  · Cobranza VENCIDA: se muestra aparte y NO entra al saldo (no se asume
 *    que lo vencido entra "hoy").
 *  · Pagos VENCIDOS (deuda/planilla/CxP atrasados): SÍ entran, en un
 *    período "Atrasado" antes del primero — son exigibles ya (conservador).
 *  · Pasivos SIN fecha de pago (marca 'sin_fecha'): no hay base para
 *    ubicarlos en un período. Van a un balde aparte, visible, y el usuario
 *    decide si los asume exigibles hoy (`incluirSinFecha`).
 *  · Lo cedido a factoraje no es ingreso propio (lo filtra la fuente).
 *  · Donde faltan términos se proyecta solo capital y se MARCA; nunca se
 *    inventa interés.
 *
 * Convención: `monto` SIEMPRE positivo; el signo lo da `tipo`.
 */

export type TipoCaja = 'ingreso' | 'egreso';
export type FuenteCaja = 'cobro' | 'recurrente' | 'deuda' | 'planilla' | 'cxp' | 'factoraje';
export type Granularidad = 'semana' | 'mes';

export type Marca =
  | 'estimado'              // monto/fecha proyectados, no un documento con fecha firme
  | 'dias_credito_default'  // el cliente no tiene días de crédito: se usó el default
  | 'terminos_incompletos'  // deuda/factoraje sin cuotas/interés cargados: solo capital
  | 'intercompany'          // pago por cuenta de otra empresa del grupo (sale de esta caja)
  | 'sin_fecha'             // pasivo sin fecha de pago: fecha = hoy solo si se decide incluirlo
  | 'vencimiento_estimado'  // CxP sin vencimiento: fecha del documento + días por defecto
  | 'parte_relacionada';    // deuda con socios / partes relacionadas (timing discrecional)

export interface EventoCaja {
  fecha: string;            // YYYY-MM-DD
  tipo: TipoCaja;
  fuente: FuenteCaja;
  monto: number;            // > 0
  descripcion: string;
  marcas: Marca[];
  ref?: { tipo: 'factura' | 'obligacion' | 'deuda' | 'planilla' | 'gasto'; id: string };
}

export interface Periodo {
  clave: string;            // 'atrasado' | 'YYYY-MM-DD' (inicio)
  etiqueta: string;
  inicio: string;
  fin: string;
  ingresos: number;
  egresos: number;
  neto: number;
  saldoInicio: number;
  saldoFin: number;
  negativo: boolean;        // saldoFin < 0 → apretón de caja
  porFuente: Partial<Record<FuenteCaja, { ingresos: number; egresos: number }>>;
  eventos: EventoCaja[];
}

export interface Proyeccion {
  hoy: string;
  granularidad: Granularidad;
  saldoInicial: number;
  periodos: Periodo[];      // incluye 'atrasado' primero si hay pagos vencidos
  totalIngresos: number;
  totalEgresos: number;
  saldoFinal: number;
  minimo: { clave: string; etiqueta: string; saldo: number } | null;
  primerNegativo: { clave: string; etiqueta: string; saldo: number } | null;
  cobranzaVencida: EventoCaja[];   // NO entra al saldo
  totalCobranzaVencida: number;
  sinFecha: EventoCaja[];          // pasivos sin fecha excluidos (vacío si incluirSinFecha)
  totalSinFecha: number;
  fueraDeHorizonte: { ingresos: number; egresos: number };
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (n: number) => String(n).padStart(2, '0');

/* ============================================================
 * Fechas (UTC puro sobre YYYY-MM-DD: sin corrimientos de zona)
 * ============================================================ */

const aDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const aIso = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
export const sumarDias = (s: string, n: number) => { const d = aDate(s); d.setUTCDate(d.getUTCDate() + n); return aIso(d); };
export const ultimoDiaMes = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
export function sumarMeses(s: string, n: number, diaFijo?: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total % 12 + 1;
  return `${ny}-${pad2(nm)}-${pad2(Math.min(diaFijo ?? d, ultimoDiaMes(ny, nm)))}`;
}
const lunesDe = (s: string) => { const d = aDate(s); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return aIso(d); };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const corta = (s: string) => `${Number(s.slice(8, 10))} ${MESES[Number(s.slice(5, 7)) - 1]}`;

/** Ventanas del horizonte: semanas (lun-dom) desde la semana de hoy, o meses calendario desde el mes de hoy. */
export function ventanas(hoy: string, granularidad: Granularidad, cantidad: number): Array<{ inicio: string; fin: string; etiqueta: string }> {
  const out: Array<{ inicio: string; fin: string; etiqueta: string }> = [];
  if (granularidad === 'semana') {
    let ini = lunesDe(hoy);
    for (let i = 0; i < cantidad; i++) {
      const fin = sumarDias(ini, 6);
      out.push({ inicio: ini, fin, etiqueta: `${corta(ini)} – ${corta(fin)}` });
      ini = sumarDias(ini, 7);
    }
  } else {
    const [y, m] = hoy.split('-').map(Number);
    for (let i = 0; i < cantidad; i++) {
      const total = y * 12 + (m - 1) + i;
      const yy = Math.floor(total / 12), mm = total % 12 + 1;
      out.push({ inicio: `${yy}-${pad2(mm)}-01`, fin: `${yy}-${pad2(mm)}-${pad2(ultimoDiaMes(yy, mm))}`, etiqueta: `${MESES[mm - 1]} ${yy}` });
    }
  }
  return out;
}

/* ============================================================
 * Proyección
 * ============================================================ */

export function proyectar(args: {
  hoy: string;
  granularidad: Granularidad;
  cantidad: number;           // 13 semanas · 6 meses
  saldoInicial: number;
  eventos: EventoCaja[];      // fechados (pueden caer antes de hoy = vencidos)
  incluirSinFecha?: boolean;  // default true: pasivos sin fecha como exigibles hoy
}): Proyeccion {
  const vs = ventanas(args.hoy, args.granularidad, args.cantidad);
  const hasta = vs[vs.length - 1].fin;

  const cobranzaVencida: EventoCaja[] = [];
  const atrasados: EventoCaja[] = [];
  const enHorizonte: EventoCaja[] = [];
  const sinFecha: EventoCaja[] = [];
  const fuera = { ingresos: 0, egresos: 0 };
  for (const e of args.eventos) {
    if (!(e.monto > 0)) continue;
    if (args.incluirSinFecha === false && e.tipo === 'egreso' && e.marcas.includes('sin_fecha')) { sinFecha.push(e); continue; }
    if (e.fecha < args.hoy) {
      if (e.tipo === 'ingreso') cobranzaVencida.push(e);   // honestidad: no se asume que entra hoy
      else atrasados.push(e);                               // exigible ya: conservador
    } else if (e.fecha > hasta) {
      fuera[e.tipo === 'ingreso' ? 'ingresos' : 'egresos'] = r2(fuera[e.tipo === 'ingreso' ? 'ingresos' : 'egresos'] + e.monto);
    } else enHorizonte.push(e);
  }

  const crear = (clave: string, etiqueta: string, inicio: string, fin: string, evs: EventoCaja[], saldoInicio: number): Periodo => {
    const porFuente: Periodo['porFuente'] = {};
    let ingresos = 0, egresos = 0;
    for (const e of evs) {
      const pf = (porFuente[e.fuente] ??= { ingresos: 0, egresos: 0 });
      if (e.tipo === 'ingreso') { ingresos += e.monto; pf.ingresos = r2(pf.ingresos + e.monto); }
      else { egresos += e.monto; pf.egresos = r2(pf.egresos + e.monto); }
    }
    ingresos = r2(ingresos); egresos = r2(egresos);
    const neto = r2(ingresos - egresos);
    const saldoFin = r2(saldoInicio + neto);
    return {
      clave, etiqueta, inicio, fin, ingresos, egresos, neto, saldoInicio: r2(saldoInicio), saldoFin,
      negativo: saldoFin < 0, porFuente,
      eventos: [...evs].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === b.tipo ? b.monto - a.monto : a.tipo === 'egreso' ? -1 : 1)),
    };
  };

  const periodos: Periodo[] = [];
  let saldo = r2(args.saldoInicial);
  if (atrasados.length) {
    const p = crear('atrasado', 'Atrasado (vencido por pagar)', atrasados.reduce((m, e) => (e.fecha < m ? e.fecha : m), args.hoy), sumarDias(args.hoy, -1), atrasados, saldo);
    periodos.push(p); saldo = p.saldoFin;
  }
  for (const v of vs) {
    const p = crear(v.inicio, v.etiqueta, v.inicio, v.fin, enHorizonte.filter(e => e.fecha >= v.inicio && e.fecha <= v.fin), saldo);
    periodos.push(p); saldo = p.saldoFin;
  }

  const minimoP = periodos.reduce<Periodo | null>((m, p) => (!m || p.saldoFin < m.saldoFin ? p : m), null);
  const primerNeg = periodos.find(p => p.negativo) ?? null;
  return {
    hoy: args.hoy, granularidad: args.granularidad, saldoInicial: r2(args.saldoInicial), periodos,
    totalIngresos: r2(periodos.reduce((s, p) => s + p.ingresos, 0)),
    totalEgresos: r2(periodos.reduce((s, p) => s + p.egresos, 0)),
    saldoFinal: saldo,
    minimo: minimoP ? { clave: minimoP.clave, etiqueta: minimoP.etiqueta, saldo: minimoP.saldoFin } : null,
    primerNegativo: primerNeg ? { clave: primerNeg.clave, etiqueta: primerNeg.etiqueta, saldo: primerNeg.saldoFin } : null,
    cobranzaVencida: cobranzaVencida.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    totalCobranzaVencida: r2(cobranzaVencida.reduce((s, e) => s + e.monto, 0)),
    sinFecha: sinFecha.sort((a, b) => b.monto - a.monto),
    totalSinFecha: r2(sinFecha.reduce((s, e) => s + e.monto, 0)),
    fueraDeHorizonte: fuera,
  };
}

/* ============================================================
 * Proyecciones puras por fuente (testeables)
 * ============================================================ */

/** Fecha esperada de cobro = emisión + días de crédito (default marcado si el cliente no tiene). */
export function fechaEsperadaCobro(fechaEmision: string, diasCredito: number | null, defaultDias: number): { fecha: string; usoDefault: boolean } {
  const usoDefault = diasCredito == null;
  return { fecha: sumarDias(fechaEmision, usoDefault ? defaultDias : diasCredito), usoDefault };
}

export interface DeudaTerminos {
  id: string;
  descripcion: string;
  saldo: number;
  fechaVencimiento: string | null;
  diaPagoFijo: number | null;
  plazoMeses: number | null;
  fechaPrimerCuota: string | null;
  interesAnualPct: number | null;     // 0-1
  parteRelacionada: boolean;
}

/**
 * Servicio de deuda.
 *  · Con plazo + primera cuota: cuotas mensuales sobre el saldo en las
 *    cuotas restantes (día fijo si existe); con interés → cuota francesa,
 *    sin interés → capital lineal.
 *  · Sin esos términos: SOLO capital en el vencimiento (o atrasado), marcado
 *    'terminos_incompletos'. Nunca se inventa interés.
 */
export function proyectarDeuda(d: DeudaTerminos, hoy: string, hasta: string): EventoCaja[] {
  if (!(d.saldo > 0.01)) return [];
  const base: Marca[] = d.parteRelacionada ? ['parte_relacionada'] : [];
  const ref = { tipo: 'deuda' as const, id: d.id };
  if (d.plazoMeses && d.plazoMeses > 0 && d.fechaPrimerCuota) {
    const cuotas: string[] = [];
    for (let k = 0; k < d.plazoMeses; k++) cuotas.push(sumarMeses(d.fechaPrimerCuota, k, d.diaPagoFijo ?? undefined));
    const restantes = cuotas.filter(f => f >= hoy);
    if (restantes.length === 0) {
      return [{ fecha: cuotas[cuotas.length - 1], tipo: 'egreso', fuente: 'deuda', monto: r2(d.saldo), descripcion: `${d.descripcion} (plazo cumplido, saldo pendiente)`, marcas: base, ref }];
    }
    const n = restantes.length;
    const i = (d.interesAnualPct ?? 0) / 12;
    const cuota = i > 0 ? r2(d.saldo * i / (1 - Math.pow(1 + i, -n))) : r2(d.saldo / n);
    return restantes.filter(f => f <= hasta).map((f, k) => ({
      fecha: f, tipo: 'egreso' as const, fuente: 'deuda' as const,
      monto: k === n - 1 && i === 0 ? r2(d.saldo - cuota * (n - 1)) : cuota,
      descripcion: `${d.descripcion} · cuota ${cuotas.indexOf(f) + 1}/${d.plazoMeses}${i > 0 ? ' (capital + interés)' : ''}`,
      marcas: [...base, 'estimado'], ref,
    }));
  }
  return [{
    fecha: d.fechaVencimiento || hoy, tipo: 'egreso', fuente: 'deuda', monto: r2(d.saldo),
    descripcion: `${d.descripcion} (solo capital)`,
    marcas: [...base, 'terminos_incompletos', ...(d.fechaVencimiento ? [] : ['sin_fecha' as Marca])], ref,
  }];
}

export interface FactorajeTerminos {
  id: string;
  descripcion: string;
  saldo: number;
  conRecurso: boolean;
  fechaVencimiento: string | null;
  fechaEmision: string | null;
  comisionPct: number | null;          // 0-1
  interesAnualPct: number | null;      // 0-1
  reservaPct: number | null;           // 0-1
  montoCedidoActivo: number;           // Σ cesiones 'Cedida'
}

/**
 * Factoraje — par del "cedido no es ingreso propio":
 *  · SIN recurso con facturas cedidas: el financiador cobra al cliente; el
 *    capital NO sale de esta caja (no se proyecta). Sí: comisión + interés
 *    (si están cargados) y la reserva que regresa (ingreso) al vencimiento.
 *  · Con recurso, o sin cesiones registradas: capital al vencimiento, marcado.
 *  · Sin comisión/interés cargados → no se inventan: 'terminos_incompletos'.
 */
export function proyectarFactoraje(f: FactorajeTerminos, hoy: string): EventoCaja[] {
  const ref = { tipo: 'deuda' as const, id: f.id };
  const fecha = f.fechaVencimiento || hoy;
  const sinFecha: Marca[] = f.fechaVencimiento ? [] : ['sin_fecha'];
  const out: EventoCaja[] = [];
  const respaldadoPorCesiones = !f.conRecurso && f.montoCedidoActivo > 0;
  if (!respaldadoPorCesiones && f.saldo > 0.01) {
    out.push({ fecha, tipo: 'egreso', fuente: 'factoraje', monto: r2(f.saldo), descripcion: `${f.descripcion} · capital${f.conRecurso ? ' (con recurso)' : ' (sin cesiones registradas)'}`, marcas: ['terminos_incompletos', ...sinFecha], ref });
  }
  const terminosCargados = (f.comisionPct ?? 0) > 0 || (f.interesAnualPct ?? 0) > 0;
  const baseCalc = f.montoCedidoActivo > 0 ? f.montoCedidoActivo : f.saldo;
  if (terminosCargados && baseCalc > 0) {
    const dias = f.fechaEmision && f.fechaVencimiento ? Math.max(0, (aDate(f.fechaVencimiento).getTime() - aDate(f.fechaEmision).getTime()) / 86_400_000) : 0;
    const costo = r2(baseCalc * (f.comisionPct ?? 0) + baseCalc * (f.interesAnualPct ?? 0) * dias / 365);
    if (costo > 0) out.push({ fecha, tipo: 'egreso', fuente: 'factoraje', monto: costo, descripcion: `${f.descripcion} · comisión + interés`, marcas: ['estimado', ...sinFecha], ref });
  }
  if (respaldadoPorCesiones && (f.reservaPct ?? 0) > 0) {
    out.push({ fecha, tipo: 'ingreso', fuente: 'factoraje', monto: r2(f.montoCedidoActivo * (f.reservaPct ?? 0)), descripcion: `${f.descripcion} · devolución de reserva`, marcas: ['estimado', ...sinFecha], ref });
  }
  return out;
}

/** Fechas de quincena (15 y último día) entre dos fechas, inclusive. */
export function fechasQuincena(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let [y, m] = desde.split('-').map(Number);
  const [yh, mh] = hasta.split('-').map(Number);
  while (y < yh || (y === yh && m <= mh)) {
    for (const d of [15, ultimoDiaMes(y, m)]) {
      const f = `${y}-${pad2(m)}-${pad2(d)}`;
      if (f >= desde && f <= hasta) out.push(f);
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
