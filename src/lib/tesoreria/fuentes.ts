/**
 * TESORERÍA — fuentes de eventos de caja (server, READ-ONLY).
 *
 * Lee tablas existentes (fetchAll paginado) y produce EventoCaja fechados
 * + el bloque de SUPUESTOS (qué es proyección vs. dato firme). Nada se
 * escribe. Genérico por empresa: la empresa principal del deploy sale del
 * catálogo empresas_relacionadas.
 */
import 'server-only';
import { fetchAll } from '../supabase/client';
import { getFacturasPendientesCobro } from '../db/facturas-pendientes';
import { getDeudas } from '../db/deudas';
import { getEmpleados } from '../db/empleados';
import { getEmpresasRelacionadas } from '../db/empresas-relacionadas';
import { cargarCesiones, TIPO_DOC_FACTORAJE } from '../db/factoraje-cesiones';
import { getObligacionesRecurrentes } from '../flujo/obligaciones';
import { proyectarObligaciones } from '../flujo/proyectar-recurrentes';
import { calcularQuincena } from '../calculos/planilla-calc';
import { EMPRESA_EMPLEADORA_DEFAULT } from '../empleados/empresa';
import {
  fechaEsperadaCobro, fechasQuincena, proyectarDeuda, proyectarFactoraje, r2, sumarDias,
  type EventoCaja, type Marca,
} from './motor';

export const DIAS_CREDITO_DEFAULT = 30;
export const CXP_DIAS_DEFAULT = 30;

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null ? 0 : Number(v));
const numONull = (v: unknown) => (v == null || v === '' ? null : Number(v));

export interface SaldoBanco { nombre: string; moneda: string; saldoInicial: number; fechaSaldoInicial: string | null; movimientos: number; ultimaFechaMovimiento: string | null; saldo: number }

export interface Supuestos {
  saldoInicial: { total: number; fuente: 'movimientos' | 'saldo_registrado' | 'sin_bancos'; bancos: SaldoBanco[]; excluidosUSD: string[] };
  cobros: { facturas: number; monto: number; conDiasDefault: number; montoDiasDefault: number; diasDefault: number };
  cedidas: { facturas: number; monto: number };
  deudas: { conTerminos: number; terminosIncompletos: number; montoTerminosIncompletos: number; partesRelacionadas: number; montoPartesRelacionadas: number; sinFecha: number };
  factoraje: { total: number; capitalExcluidoPorCesiones: number; montoCapitalExcluido: number; sinComisionInteres: number };
  recurrentes: { activas: number; intercompany: number; empresaPrincipal: string };
  planilla: { fuente: 'lineas_y_estimado' | 'estimado_empleados' | 'sin_datos'; lineasPendientes: number; quincenaEstimada: number; empleados: number };
  cxp: { gastos: number; monto: number; sinVencimiento: number };
}

export async function getEventosCaja(hoy: string, hasta: string): Promise<{ eventos: EventoCaja[]; supuestos: Supuestos }> {
  const [saldo, cobros, recurrentes, deudas, planilla, cxp] = await Promise.all([
    saldoInicial(hoy), eventosCobro(), eventosRecurrentes(hoy, hasta), eventosDeuda(hoy, hasta), eventosPlanilla(hoy, hasta), eventosCxp(),
  ]);
  return {
    eventos: [...cobros.eventos, ...recurrentes.eventos, ...deudas.eventos, ...planilla.eventos, ...cxp.eventos],
    supuestos: {
      saldoInicial: saldo, cobros: cobros.sup, cedidas: cobros.cedidas, deudas: deudas.sup, factoraje: deudas.fact,
      recurrentes: recurrentes.sup, planilla: planilla.sup, cxp: cxp.sup,
    },
  };
}

/* ── Saldo inicial: saldo_inicial + movimientos del banco cargados ── */
async function saldoInicial(hoy: string): Promise<Supuestos['saldoInicial']> {
  try {
    const [bancos, movs] = await Promise.all([
      fetchAll<Row>('bancos', { select: 'id, nombre_cuenta, banco, moneda, saldo_inicial, fecha_saldo_inicial, activo' }),
      fetchAll<Row>('movimientos_bancarios', { select: 'banco_id, fecha, monto, tipo' }).catch(() => [] as Row[]),
    ]);
    const out: SaldoBanco[] = [];
    const excluidosUSD: string[] = [];
    for (const b of bancos) {
      if (b.activo === false) continue;
      const nombre = s(b.nombre_cuenta) || s(b.banco);
      if ((s(b.moneda) || 'GTQ') !== 'GTQ') { excluidosUSD.push(nombre); continue; }
      const ini = s(b.fecha_saldo_inicial) || null;
      const propios = movs.filter(m => s(m.banco_id) === s(b.id) && (!ini || s(m.fecha) > ini) && s(m.fecha) <= hoy);
      const delta = propios.reduce((t, m) => t + (s(m.tipo) === 'Egreso' ? -n(m.monto) : n(m.monto)), 0);
      out.push({
        nombre, moneda: 'GTQ', saldoInicial: r2(n(b.saldo_inicial)), fechaSaldoInicial: ini, movimientos: propios.length,
        ultimaFechaMovimiento: propios.reduce<string | null>((m, x) => (!m || s(x.fecha) > m ? s(x.fecha) : m), null),
        saldo: r2(n(b.saldo_inicial) + delta),
      });
    }
    const total = r2(out.reduce((t, b) => t + b.saldo, 0));
    return { total, bancos: out, excluidosUSD, fuente: out.length === 0 ? 'sin_bancos' : out.some(b => b.movimientos > 0) ? 'movimientos' : 'saldo_registrado' };
  } catch {
    return { total: 0, bancos: [], excluidosUSD: [], fuente: 'sin_bancos' };
  }
}

/* ── Cobros: facturas abiertas (saldo = total − cobros − NC activas), SIN las cedidas ── */
async function eventosCobro(): Promise<{ eventos: EventoCaja[]; sup: Supuestos['cobros']; cedidas: Supuestos['cedidas'] }> {
  const [pend, clientes] = await Promise.all([
    getFacturasPendientesCobro(),
    fetchAll<Row>('clientes', { select: 'airtable_id, dias_credito' }),
  ]);
  const dc = new Map(clientes.map(c => [s(c.airtable_id), numONull(c.dias_credito)]));
  const eventos: EventoCaja[] = [];
  const cedidas = { facturas: 0, monto: 0 };
  let conDefault = 0, montoDefault = 0;
  for (const f of pend.filas) {
    if (f.cedida) { cedidas.facturas++; cedidas.monto = r2(cedidas.monto + f.saldo); continue; }   // no es ingreso propio
    if (!f.fechaEmision) continue;
    const { fecha, usoDefault } = fechaEsperadaCobro(f.fechaEmision, dc.has(f.custId) ? dc.get(f.custId)! : null, DIAS_CREDITO_DEFAULT);
    const marcas: Marca[] = ['estimado'];
    if (usoDefault) { marcas.push('dias_credito_default'); conDefault++; montoDefault += f.saldo; }
    eventos.push({ fecha, tipo: 'ingreso', fuente: 'cobro', monto: r2(f.saldo), descripcion: `Cobro ${f.cliente} · Fact. ${f.noFactura}`, marcas, ref: { tipo: 'factura', id: f.id } });
  }
  return {
    eventos, cedidas,
    sup: { facturas: eventos.length, monto: r2(eventos.reduce((t, e) => t + e.monto, 0)), conDiasDefault: conDefault, montoDiasDefault: r2(montoDefault), diasDefault: DIAS_CREDITO_DEFAULT },
  };
}

/* ── Obligaciones recurrentes (frecuencia + día de pago + vigencia) ── */
async function eventosRecurrentes(hoy: string, hasta: string): Promise<{ eventos: EventoCaja[]; sup: Supuestos['recurrentes'] }> {
  const [obligaciones, empresas] = await Promise.all([getObligacionesRecurrentes(true), getEmpresasRelacionadas().catch(() => [])]);
  const principal = empresas.find(e => e.esPrincipal)?.nombre ?? EMPRESA_EMPLEADORA_DEFAULT;
  const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const propia = (pc: string) => !pc || norm(pc) === norm(principal) || norm(pc) === norm(EMPRESA_EMPLEADORA_DEFAULT);
  const eventos = proyectarObligaciones(obligaciones, hoy, hasta).map<EventoCaja>(e => {
    const ic = !propia(s(e.porCuentaDe));
    return {
      fecha: e.fecha, tipo: e.tipo, fuente: 'recurrente', monto: r2(e.monto),
      descripcion: `${e.descripcion}${ic ? ` · por cuenta de ${e.porCuentaDe}` : ''}`,
      marcas: ['estimado', ...(ic ? ['intercompany' as Marca] : [])], ref: e.linkId ? { tipo: 'obligacion', id: e.linkId } : undefined,
    };
  });
  return { eventos, sup: { activas: obligaciones.length, intercompany: obligaciones.filter(o => !propia(s(o.porCuentaDe))).length, empresaPrincipal: principal } };
}

/* ── Deudas y factoraje ── */
async function eventosDeuda(hoy: string, hasta: string): Promise<{ eventos: EventoCaja[]; sup: Supuestos['deudas']; fact: Supuestos['factoraje'] }> {
  const [deudas, raw, cesiones] = await Promise.all([
    getDeudas(),   // saldo autoritativo (recalculado desde pagos), excluye no_incluir
    fetchAll<Row>('deudas', { select: 'id, airtable_id, dia_pago_fijo, plazo_meses, fecha_primer_cuota, interes_anual_pct, tasa_comision_pct, reserva_pct, con_recurso, fecha_emision' }),
    cargarCesiones().catch(() => []),
  ]);
  const terminos = new Map(raw.map(r => [s(r.airtable_id), r]));
  const uuidDe = new Map(raw.map(r => [s(r.airtable_id), s(r.id)]));
  const cedidoPorDeuda = new Map<string, number>();
  for (const c of cesiones) if (c.estado === 'Cedida') cedidoPorDeuda.set(c.deudaUuid, r2((cedidoPorDeuda.get(c.deudaUuid) ?? 0) + c.montoCedido));

  const eventos: EventoCaja[] = [];
  const sup: Supuestos['deudas'] = { conTerminos: 0, terminosIncompletos: 0, montoTerminosIncompletos: 0, partesRelacionadas: 0, montoPartesRelacionadas: 0, sinFecha: 0 };
  const fact: Supuestos['factoraje'] = { total: 0, capitalExcluidoPorCesiones: 0, montoCapitalExcluido: 0, sinComisionInteres: 0 };
  for (const d of deudas) {
    if (d.saldoPendiente <= 0.01 || /liquidada|anulada|saldada/i.test(d.estadoDeuda)) continue;
    const t = terminos.get(d.id) ?? {};
    const venc = (d.fechaVencimientoReal?.trim() || d.fechaVencimiento?.trim() || '').slice(0, 10) || null;
    const desc = `${d.tipoDocumento || 'Deuda'}: ${d.acreedorCorto || d.acreedorNombre || d.nombreDeuda}`;
    if (d.tipoDocumento === TIPO_DOC_FACTORAJE) {
      fact.total++;
      const cedido = cedidoPorDeuda.get(uuidDe.get(d.id) ?? '') ?? 0;
      const conRecurso = t.con_recurso === true;
      if (!conRecurso && cedido > 0) { fact.capitalExcluidoPorCesiones++; fact.montoCapitalExcluido = r2(fact.montoCapitalExcluido + d.saldoPendiente); }
      if (!(n(t.tasa_comision_pct) > 0) && !(n(t.interes_anual_pct) > 0)) fact.sinComisionInteres++;
      eventos.push(...proyectarFactoraje({
        id: d.id, descripcion: desc, saldo: d.saldoPendiente, conRecurso, fechaVencimiento: venc, fechaEmision: s(t.fecha_emision) || null,
        comisionPct: numONull(t.tasa_comision_pct), interesAnualPct: numONull(t.interes_anual_pct), reservaPct: numONull(t.reserva_pct), montoCedidoActivo: cedido,
      }, hoy));
      continue;
    }
    const parteRel = d.categoriaPasivo !== 'externa';
    const evs = proyectarDeuda({
      id: d.id, descripcion: desc, saldo: d.saldoPendiente, fechaVencimiento: venc,
      diaPagoFijo: numONull(t.dia_pago_fijo), plazoMeses: numONull(t.plazo_meses), fechaPrimerCuota: s(t.fecha_primer_cuota) || null,
      interesAnualPct: numONull(t.interes_anual_pct), parteRelacionada: parteRel,
    }, hoy, hasta);
    if (evs.some(e => e.marcas.includes('terminos_incompletos'))) { sup.terminosIncompletos++; sup.montoTerminosIncompletos = r2(sup.montoTerminosIncompletos + d.saldoPendiente); } else sup.conTerminos++;
    if (parteRel) { sup.partesRelacionadas++; sup.montoPartesRelacionadas = r2(sup.montoPartesRelacionadas + d.saldoPendiente); }
    if (!venc && evs.some(e => e.marcas.includes('sin_fecha'))) sup.sinFecha++;
    eventos.push(...evs);
  }
  return { eventos, sup, fact };
}

/* ── Planilla: líneas pendientes generadas + quincenas futuras estimadas ── */
async function eventosPlanilla(hoy: string, hasta: string): Promise<{ eventos: EventoCaja[]; sup: Supuestos['planilla'] }> {
  const [lineas, periodos, empleados] = await Promise.all([
    fetchAll<Row>('planilla', { select: 'id, airtable_id, periodo_id, empleado:empleados!planilla_empleado_id_fkey(airtable_id), fecha_pago, neto_pagar, estado_pago' }).catch(() => [] as Row[]),
    fetchAll<Row>('periodos', { select: 'id, periodo, fecha_fin' }).catch(() => [] as Row[]),
    getEmpleados({ status: 'todos' }).catch(() => []),
  ]);
  // los de otras empresas del grupo van como recurrente intercompany
  const deEstaEmpresa = empleados.filter(e => e.empresaEmpleadora === EMPRESA_EMPLEADORA_DEFAULT);
  const igssPorEmpleado = new Map(deEstaEmpresa.map(e => [e.id, e.esHonorarios ? 0 : r2(e.igssPatronal / 2)]));
  // Líneas pendientes: cualquier empleado de esta empresa (un finiquito pendiente es caja real);
  // estimado de quincenas futuras: solo activos.
  const propios = deEstaEmpresa.filter(e => e.status === 'ACTIVO');
  const eventos: EventoCaja[] = [];
  const periodoFin = new Map(periodos.map(p => [s(p.id), s(p.fecha_fin)]));
  const cubiertas = new Set<string>();
  let pendientes = 0;
  for (const l of lineas) {
    const empId = s((l.empleado as { airtable_id?: string } | null)?.airtable_id);
    const fin = periodoFin.get(s(l.periodo_id));
    if (fin) cubiertas.add(fin);
    if (s(l.estado_pago) !== 'Pendiente') continue;
    if (!igssPorEmpleado.has(empId) && deEstaEmpresa.length) continue;   // solo empleados de esta empresa
    const fecha = s(l.fecha_pago) || fin || hoy;
    const monto = r2(n(l.neto_pagar) + (igssPorEmpleado.get(empId) ?? 0));
    if (!(monto > 0)) continue;
    pendientes++;
    eventos.push({ fecha, tipo: 'egreso', fuente: 'planilla', monto, descripcion: `Planilla pendiente ${s((periodos.find(p => s(p.id) === s(l.periodo_id)) ?? {}).periodo) || ''} (neto + IGSS patronal)`.replace('  ', ' '), marcas: [], ref: { tipo: 'planilla', id: s(l.airtable_id) } });
  }
  // Quincenas futuras SIN período generado: estimado desde empleados activos de esta empresa.
  const quincena = r2(propios.reduce((t, e) => t + calcularQuincena({ empleado: { id: e.id, nombre: e.nombre, salarioBase: e.salarioBase, tipoContrato: e.tipoContrato } }).netoPagar + (igssPorEmpleado.get(e.id) ?? 0), 0));
  if (quincena > 0) {
    for (const f of fechasQuincena(hoy, hasta)) {
      if (cubiertas.has(f)) continue;
      eventos.push({ fecha: f, tipo: 'egreso', fuente: 'planilla', monto: quincena, descripcion: `Planilla Q${Number(f.slice(8)) === 15 ? '1' : '2'} ${f.slice(0, 7)} (estimado: ${propios.length} empleados)`, marcas: ['estimado'] });
    }
  }
  return { eventos, sup: { fuente: quincena > 0 || pendientes ? (pendientes ? 'lineas_y_estimado' : 'estimado_empleados') : 'sin_datos', lineasPendientes: pendientes, quincenaEstimada: quincena, empleados: propios.length } };
}

/* ── Cuentas por pagar: gastos aprobados no pagados (Supabase directo; getGastos es legacy) ── */
async function eventosCxp(): Promise<{ eventos: EventoCaja[]; sup: Supuestos['cxp'] }> {
  const gastos = await fetchAll<Row>('gastos', { select: 'airtable_id, fecha, fecha_vencimiento, monto, estado, descripcion, proveedor:proveedores!gastos_proveedor_id_fkey(nombre)' }).catch(() => [] as Row[]);
  const eventos: EventoCaja[] = [];
  let sinVenc = 0;
  for (const g of gastos) {
    if (/^(pagado|anulado)$/i.test(s(g.estado).trim()) || !(n(g.monto) > 0)) continue;
    let fecha = s(g.fecha_vencimiento);
    const marcas: Marca[] = [];
    if (!fecha) { if (!s(g.fecha)) continue; fecha = sumarDias(s(g.fecha), CXP_DIAS_DEFAULT); marcas.push('vencimiento_estimado', 'estimado'); sinVenc++; }
    const prov = (g.proveedor as { nombre?: string } | null)?.nombre;
    eventos.push({ fecha, tipo: 'egreso', fuente: 'cxp', monto: r2(n(g.monto)), descripcion: `CxP ${prov ?? ''}${g.descripcion ? ` · ${s(g.descripcion).slice(0, 50)}` : ''}`.trim(), marcas, ref: { tipo: 'gasto', id: s(g.airtable_id) } });
  }
  return { eventos, sup: { gastos: eventos.length, monto: r2(eventos.reduce((t, e) => t + e.monto, 0)), sinVencimiento: sinVenc } };
}
