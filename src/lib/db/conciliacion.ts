/**
 * CONCILIACIÓN BANCARIA — capa de datos (Supabase).
 *
 * Reglas:
 *  · Lecturas con fetchAll paginado (nunca .select() suelto: trunca a 1000).
 *  · Embeds SIEMPRE con la FK explícita (tabla!fk): cobros↔facturas tiene
 *    más de una relación para PostgREST (PGRST201) — hallado en el E2E.
 *  · El servidor RECALCULA documentos y montos desde la base para cada
 *    acción; lo que manda el cliente son solo ids/keys.
 *  · Toda escritura con efecto contable o de flags pasa por las RPCs
 *    transaccionales fase2_conciliar / fase2_desconciliar /
 *    fase2_contabilizar_movimiento (migración 009). El índice único
 *    parcial de conciliacion_items es la defensa final contra la doble
 *    conciliación.
 *  · Todo es genérico por empresa: la base del deploy define bancos,
 *    cuentas y documentos.
 */
import 'server-only';
import { fetchAll, supabase } from '../supabase/client';
import { rpc, uuidRequerido } from '../supabase/writes';
import { sbResolverPeriodoContable } from '../gastos/supabase-gastos';
import {
  agruparCobros, calcularCuadre, montoPago, partidasSinDocumento, r2, sugerir,
  type Cuadre, type DocBanco, type Movimiento, type Sugerencia, type TipoMov,
} from '../conciliacion/motor';
import { claveDuplicado, type MovimientoImportado } from '../conciliacion/csv';

export interface BancoConciliacion {
  id: string;                 // uuid
  nombre: string;
  moneda: string;
  saldoInicial: number;
  fechaSaldoInicial: string | null;
  cuentaContableId: string | null;
}

export interface CuentaOpcion { id: string; codigo: string; nombre: string }

export interface DatosConciliacion {
  disponible: boolean;        // false si la migración 009 no está aplicada
  banco: BancoConciliacion | null;
  movimientos: Movimiento[];
  docs: DocBanco[];
  cuadre: Cuadre | null;
  sugerencias: Record<string, Sugerencia[]>;   // movimientoId → sugerencias
  conciliados: Array<{ movimiento: Movimiento; docs: DocBanco[] }>;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null ? 0 : Number(v));

/** ¿Existe la migración 009? (GET real: un HEAD 404 no reporta error en supabase-js) */
export async function conciliacionDisponible(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { error } = await sb.from('conciliacion_items').select('id').limit(1);
  return !error;
}

export async function getBancosConciliacion(): Promise<BancoConciliacion[]> {
  const rows = await fetchAll<Row>('bancos', { select: 'id, nombre_cuenta, banco, moneda, saldo_inicial, fecha_saldo_inicial, cuenta_contable_id, activo' });
  return rows
    .filter(r => r.activo !== false)
    .map(r => ({
      id: s(r.id),
      nombre: s(r.nombre_cuenta) || s(r.banco),
      moneda: s(r.moneda) || 'GTQ',
      saldoInicial: n(r.saldo_inicial),
      fechaSaldoInicial: s(r.fecha_saldo_inicial) || null,
      cuentaContableId: s(r.cuenta_contable_id) || null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function getCuentasAjuste(): Promise<CuentaOpcion[]> {
  const rows = await fetchAll<Row>('cuentas', { select: 'id, codigo_path, nombre' });
  const codigos = new Set(rows.map(r => s(r.codigo_path)));
  const esHoja = (c: string) => ![...codigos].some(x => x.startsWith(c + '-'));
  return rows
    .map(r => ({ id: s(r.id), codigo: s(r.codigo_path), nombre: s(r.nombre).replace(/\s+/g, ' ').trim() }))
    .filter(c => esHoja(c.codigo))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
}

/* ============================================================
 * Lectura: movimientos + documentos + cuadre + sugerencias
 * ============================================================ */

async function cargarMovimientos(bancoId: string): Promise<Movimiento[]> {
  const [movs, items] = await Promise.all([
    fetchAll<Row>('movimientos_bancarios', { select: 'id, banco_id, fecha, monto, tipo, descripcion, referencia, conciliado, asiento_id, origen', eq: { banco_id: bancoId } }),
    fetchAll<Row>('conciliacion_items', { select: 'id, movimiento_id, monto_aplicado' }),
  ]);
  const aplicado = new Map<string, number>();
  for (const it of items) aplicado.set(s(it.movimiento_id), r2((aplicado.get(s(it.movimiento_id)) ?? 0) + n(it.monto_aplicado)));
  return movs.map(m => ({
    id: s(m.id), bancoId: s(m.banco_id), fecha: s(m.fecha), monto: r2(n(m.monto)),
    tipo: (s(m.tipo) === 'Egreso' ? 'Egreso' : 'Ingreso') as TipoMov,
    descripcion: s(m.descripcion), referencia: s(m.referencia), conciliado: m.conciliado === true,
    asientoId: s(m.asiento_id) || null, origen: s(m.origen) || null, aplicado: aplicado.get(s(m.id)) ?? 0,
  }));
}

async function cargarDocs(banco: BancoConciliacion): Promise<DocBanco[]> {
  const [cobros, pagos, gastos, items] = await Promise.all([
    fetchAll<Row>('cobros_clientes', {
      select: 'id, cobro_grupo_id, fecha_cobro, referencia, metodo, estado_cobro, es_conciliado, monto_cobrado, monto_cobro_gtq, factura:facturas_clientes!cobros_clientes_factura_id_fkey(no_factura, cliente:clientes!facturas_clientes_cliente_id_fkey(razon_social, nombre_empresa))',
      eq: { cuenta_banco_id: banco.id },
    }),
    fetchAll<Row>('pagos_proveedores', {
      select: 'id, fecha_pago, referencia, estado_pago, es_conciliado, monto_pago, monto_interes, monto_mora, monto_comision, tipo_cambio, deuda:deudas!pagos_proveedores_deuda_id_fkey(nombre_deuda, acreedor:acreedores!deudas_acreedor_id_fkey(nombre_acreedor))',
      eq: { cuenta_banco_id: banco.id },
    }),
    fetchAll<Row>('gastos', {
      select: 'id, fecha, monto, referencia_pago, estado, metodo_pago, es_conciliado, descripcion, proveedor:proveedores!gastos_proveedor_id_fkey(nombre)',
      eq: { banco_id: banco.id },
    }),
    fetchAll<Row>('conciliacion_items', { select: 'movimiento_id, cobro_id, pago_id, gasto_id' }),
  ]);
  const movDe = new Map<string, string>();
  for (const it of items) for (const k of ['cobro_id', 'pago_id', 'gasto_id']) if (it[k]) movDe.set(s(it[k]), s(it.movimiento_id));

  const docs: DocBanco[] = agruparCobros(cobros.map(c => {
    const f = c.factura as { no_factura?: string; cliente?: { razon_social?: string; nombre_empresa?: string } } | null;
    const cliente = f?.cliente?.razon_social || f?.cliente?.nombre_empresa || 'Cliente';
    return {
      id: s(c.id), cobro_grupo_id: s(c.cobro_grupo_id) || null, fecha_cobro: s(c.fecha_cobro) || null,
      referencia: s(c.referencia) || null, metodo: s(c.metodo) || null, estado_cobro: s(c.estado_cobro) || null,
      es_conciliado: c.es_conciliado === true, monto_cobrado: c.monto_cobrado as number | null, monto_cobro_gtq: c.monto_cobro_gtq as number | null,
      descripcion: `Cobro ${cliente}${f?.no_factura ? ` · Fact. ${f.no_factura}` : ''}`,
    };
  }), banco.moneda, movDe);

  for (const p of pagos) {
    if (s(p.estado_pago) === 'Anulado') continue;
    const d = p.deuda as { nombre_deuda?: string; acreedor?: { nombre_acreedor?: string } } | null;
    const monto = montoPago(p as Parameters<typeof montoPago>[0], banco.moneda);
    docs.push({
      key: `pago:${s(p.id)}`, tipo: 'pago', registros: [{ id: s(p.id), monto }], fecha: s(p.fecha_pago), monto,
      referencia: s(p.referencia), descripcion: `Pago ${d?.acreedor?.nombre_acreedor || d?.nombre_deuda || 'deuda'}`,
      conciliado: p.es_conciliado === true, movimientoId: movDe.get(s(p.id)) ?? null,
    });
  }
  for (const g of gastos) {
    // Solo gastos que efectivamente salieron de ESTE banco (contado/pagados).
    if (s(g.estado) !== 'Pagado') continue;
    const monto = r2(n(g.monto));
    const prov = (g.proveedor as { nombre?: string } | null)?.nombre;
    docs.push({
      key: `gasto:${s(g.id)}`, tipo: 'gasto', registros: [{ id: s(g.id), monto }], fecha: s(g.fecha), monto,
      referencia: s(g.referencia_pago), descripcion: `Gasto ${prov || ''}${g.descripcion ? ` · ${s(g.descripcion).slice(0, 60)}` : ''}`.trim(),
      conciliado: g.es_conciliado === true, movimientoId: movDe.get(s(g.id)) ?? null,
    });
  }
  return docs.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export async function getDatosConciliacion(bancoId: string | null, desde: string, hasta: string): Promise<DatosConciliacion> {
  const vacio: DatosConciliacion = { disponible: false, banco: null, movimientos: [], docs: [], cuadre: null, sugerencias: {}, conciliados: [] };
  if (!(await conciliacionDisponible())) return vacio;
  const bancos = await getBancosConciliacion();
  const banco = bancos.find(b => b.id === bancoId) ?? bancos[0] ?? null;
  if (!banco) return { ...vacio, disponible: true };

  const [movsTodos, docsTodos] = await Promise.all([cargarMovimientos(banco.id), cargarDocs(banco)]);
  const cuadre = calcularCuadre({
    saldoInicial: banco.saldoInicial, fechaSaldoInicial: banco.fechaSaldoInicial, desde, hasta,
    movimientos: movsTodos, docs: docsTodos,
  });

  const ini = banco.fechaSaldoInicial;
  const visible = (f: string) => (!ini || f > ini) && f <= hasta;
  const movimientos = movsTodos.filter(m => visible(m.fecha)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const docs = docsTodos.filter(d => visible(d.fecha) || (!d.conciliado && d.fecha <= hasta));

  const sugerencias: Record<string, Sugerencia[]> = {};
  for (const m of movimientos) if (!m.conciliado) sugerencias[m.id] = sugerir(m, docsTodos);

  const docsPorMov = new Map<string, DocBanco[]>();
  for (const d of docsTodos) if (d.movimientoId) docsPorMov.set(d.movimientoId, [...(docsPorMov.get(d.movimientoId) ?? []), d]);
  const conciliados = movimientos
    .filter(m => m.conciliado && m.fecha >= desde)
    .map(m => ({ movimiento: m, docs: docsPorMov.get(m.id) ?? [] }));

  return { disponible: true, banco, movimientos, docs, cuadre, sugerencias, conciliados };
}

/* ============================================================
 * Escritura: movimientos (manual / CSV)
 * ============================================================ */

export interface NuevoMovimiento { bancoId: string; fecha: string; monto: number; tipo: TipoMov; descripcion: string; referencia?: string }

function validarMovimiento(m: NuevoMovimiento): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.fecha)) return 'Fecha inválida.';
  if (!(m.monto > 0)) return 'El monto debe ser mayor a 0 (la dirección la da el tipo Ingreso/Egreso).';
  if (m.tipo !== 'Ingreso' && m.tipo !== 'Egreso') return 'Tipo inválido.';
  if (!m.descripcion.trim()) return 'La descripción es requerida.';
  return null;
}

/** banco_id requerido y existente (mismo criterio que uuidRequerido: nunca degradar a null). */
async function bancoRequerido(bancoId: string): Promise<BancoConciliacion> {
  const b = (await getBancosConciliacion()).find(x => x.id === bancoId);
  if (!b) throw new Error('Banco inexistente o inactivo.');
  return b;
}

export async function crearMovimientoManual(m: NuevoMovimiento, usuario: string): Promise<{ id: string }> {
  const err = validarMovimiento(m);
  if (err) throw new Error(err);
  await bancoRequerido(m.bancoId);
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const { data, error } = await sb.from('movimientos_bancarios').insert({
    banco_id: m.bancoId, fecha: m.fecha, monto: r2(m.monto), tipo: m.tipo,
    descripcion: m.descripcion.trim(), referencia: m.referencia?.trim() || null,
    conciliado: false, origen: 'manual', creado_por: usuario, periodo: m.fecha.slice(0, 7),
  }).select('id').single();
  if (error) throw new Error(`movimientos_bancarios: ${error.message}`);
  return { id: s(data.id) };
}

export interface PreviewImportacion {
  nuevos: MovimientoImportado[];
  duplicados: MovimientoImportado[];
  errores: MovimientoImportado[];
}

/**
 * Duplicados por (banco, fecha, monto, tipo, referencia) CONTANDO
 * multiplicidad: si el estado trae 2 transferencias idénticas legítimas
 * y la base ya tiene 1, entra 1. Re-subir el mismo estado → 0 nuevos.
 */
export async function previsualizarImportacion(bancoId: string, filas: MovimientoImportado[]): Promise<PreviewImportacion> {
  await bancoRequerido(bancoId);
  const errores = filas.filter(f => f.error);
  const validas = filas.filter(f => !f.error);
  const existentes = await fetchAll<Row>('movimientos_bancarios', { select: 'fecha, monto, tipo, referencia', eq: { banco_id: bancoId } });
  const cupo = new Map<string, number>();
  for (const e of existentes) {
    const k = claveDuplicado(bancoId, { fecha: s(e.fecha), monto: n(e.monto), referencia: s(e.referencia), tipo: s(e.tipo) as TipoMov });
    cupo.set(k, (cupo.get(k) ?? 0) + 1);
  }
  const nuevos: MovimientoImportado[] = [], duplicados: MovimientoImportado[] = [];
  for (const f of validas) {
    const k = claveDuplicado(bancoId, f);
    const c = cupo.get(k) ?? 0;
    if (c > 0) { duplicados.push(f); cupo.set(k, c - 1); } else nuevos.push(f);
  }
  return { nuevos, duplicados, errores };
}

export async function importarMovimientos(bancoId: string, filas: MovimientoImportado[], usuario: string): Promise<PreviewImportacion> {
  const preview = await previsualizarImportacion(bancoId, filas);   // se recalcula en el servidor
  if (preview.nuevos.length > 0) {
    const sb = supabase();
    if (!sb) throw new Error('Supabase no está configurado.');
    const { error } = await sb.from('movimientos_bancarios').insert(preview.nuevos.map(f => ({
      banco_id: bancoId, fecha: f.fecha, monto: r2(f.monto), tipo: f.tipo,
      descripcion: f.descripcion || '(sin descripción)', referencia: f.referencia || null,
      conciliado: false, origen: 'csv', creado_por: usuario, periodo: f.fecha.slice(0, 7),
    })));   // un solo INSERT = atómico
    if (error) throw new Error(`movimientos_bancarios: ${error.message}`);
  }
  return preview;
}

export async function borrarMovimiento(movimientoId: string): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const { data: m } = await sb.from('movimientos_bancarios').select('id, conciliado, asiento_id').eq('id', movimientoId).maybeSingle();
  if (!m) throw new Error('Movimiento inexistente.');
  if (m.conciliado || m.asiento_id) throw new Error('No se puede borrar un movimiento conciliado o contabilizado: primero deshacé la conciliación.');
  const { error } = await sb.from('movimientos_bancarios').delete().eq('id', movimientoId).eq('conciliado', false).is('asiento_id', null);
  if (error) throw new Error(error.message);
}

/* ============================================================
 * Escritura: conciliar / deshacer / contabilizar (RPCs)
 * ============================================================ */

function traducirError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/uq_concitems_|duplicate key/i.test(msg)) return 'Uno de los documentos ya está conciliado en otro movimiento (la base impide conciliarlo dos veces).';
  const m = msg.match(/(CONCILIACION[A-Z_]*: .*|ASIENTO_[A-Z_]+: .*|El período .*cerrado.*)/);
  return m ? m[1].replace(/^CONCILIACION[A-Z_]*: /, '') : msg;
}

async function movimientoYBanco(movimientoId: string): Promise<{ mov: Movimiento; banco: BancoConciliacion }> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const { data } = await sb.from('movimientos_bancarios').select('banco_id').eq('id', movimientoId).maybeSingle();
  if (!data) throw new Error('Movimiento inexistente.');
  const banco = await bancoRequerido(s(data.banco_id));
  const mov = (await cargarMovimientos(banco.id)).find(m => m.id === movimientoId)!;
  return { mov, banco };
}

/**
 * Referencia de asiento única por movimiento y vuelta: CB-<id8>[-AJ]-<k>,
 * k = conciliaciones/contabilizaciones previas + 1 (tras deshacer, el
 * asiento anterior queda revertido pero existe — no se puede reusar su ref).
 * La idempotencia ante doble envío la da el lock del movimiento en la RPC.
 */
async function refAsiento(movimientoId: string, sufijo: string): Promise<string> {
  const sb = supabase();
  const { count } = sb
    ? await sb.from('conciliacion_log').select('id', { count: 'exact', head: false }).eq('movimiento_id', movimientoId).in('accion', ['conciliar', 'contabilizar'])
    : { count: 0 };
  return `CB-${movimientoId.slice(0, 8)}${sufijo}-${(count ?? 0) + 1}`;
}

async function periodoDe(fecha: string): Promise<{ uuid: string; nombre: string }> {
  const p = await sbResolverPeriodoContable(fecha);
  return { uuid: await uuidRequerido('periodos', p.recordId, 'conciliacion.periodo'), nombre: p.nombrePeriodo };
}

export type ResultadoConciliacion = { ok: true; mensaje: string } | { ok: false; error: string };

export async function conciliar(args: {
  movimientoId: string;
  docKeys: string[];
  ajuste?: { cuentaId: string; descripcion?: string } | null;
  usuario: string;
}): Promise<ResultadoConciliacion> {
  try {
    const { mov, banco } = await movimientoYBanco(args.movimientoId);
    if (mov.conciliado) return { ok: false, error: 'El movimiento ya está conciliado.' };
    const docs = await cargarDocs(banco);
    const elegidos = args.docKeys.map(k => docs.find(d => d.key === k));
    if (elegidos.some(d => !d)) return { ok: false, error: 'Algún documento ya no existe o no es de este banco.' };
    if (elegidos.some(d => d!.conciliado)) return { ok: false, error: 'Algún documento ya está conciliado.' };

    // Aplicación COMPLETA de cada registro (el cuadre lo asume).
    const items = elegidos.flatMap(d => d!.registros.map(r => ({ tipo: d!.tipo, id: r.id, monto_aplicado: r.monto })));
    const total = r2(items.reduce((acc, i) => acc + i.monto_aplicado, 0));
    const dif = r2(mov.monto - total);

    let pAsiento: Record<string, unknown> | null = null;
    let pPartidas: unknown[] | null = null;
    if (Math.abs(dif) > 0.01) {
      if (!args.ajuste?.cuentaId) {
        return { ok: false, error: `El movimiento es ${mov.monto.toFixed(2)} y los documentos suman ${total.toFixed(2)} (diferencia ${dif.toFixed(2)}). Elegí la cuenta de la partida de ajuste o corregí la selección.` };
      }
      if (!banco.cuentaContableId) return { ok: false, error: 'El banco no tiene cuenta contable asignada (Catálogos → Bancos).' };
      const per = await periodoDe(mov.fecha);
      const desc = args.ajuste.descripcion?.trim() || `Ajuste conciliación ${banco.nombre} ${mov.fecha}`;
      pAsiento = { asiento_ref: await refAsiento(mov.id, '-AJ'), fecha_asiento: mov.fecha, periodo_id: per.uuid, origen: 'CONCILIACION BANCARIA', banco_id: banco.id, descripcion: desc };
      pPartidas = partidasSinDocumento({ tipo: mov.tipo, diferencia: dif, cuentaContrapartidaId: args.ajuste.cuentaId, cuentaBancoId: banco.cuentaContableId, bancoId: banco.id, descripcion: desc, periodo: per.nombre });
    }

    await rpc('fase2_conciliar', {
      p_movimiento_id: mov.id, p_items: items, p_usuario: args.usuario,
      p_asiento: pAsiento, p_partidas: pPartidas,
    }, ['asientos', 'partidas']);
    return { ok: true, mensaje: `Conciliado: ${elegidos.length} documento(s)${Math.abs(dif) > 0.01 ? ` + ajuste de ${Math.abs(dif).toFixed(2)}` : ''}.` };
  } catch (err) {
    return { ok: false, error: traducirError(err) };
  }
}

export async function deshacerConciliacion(movimientoId: string, usuario: string, motivo: string): Promise<ResultadoConciliacion> {
  try {
    const r = await rpc<{ items_borrados: number; contra_asiento_id: string | null }>('fase2_desconciliar', {
      p_movimiento_id: movimientoId, p_usuario: usuario, p_motivo: motivo || null,
    }, ['asientos', 'partidas']);
    return { ok: true, mensaje: `Conciliación deshecha (${r.items_borrados} documento(s) liberados${r.contra_asiento_id ? ', contra-asiento generado' : ''}).` };
  } catch (err) {
    return { ok: false, error: traducirError(err) };
  }
}

export async function contabilizarMovimiento(args: { movimientoId: string; cuentaId: string; descripcion?: string; usuario: string }): Promise<ResultadoConciliacion> {
  try {
    const { mov, banco } = await movimientoYBanco(args.movimientoId);
    if (mov.conciliado || mov.asientoId) return { ok: false, error: 'El movimiento ya está conciliado o contabilizado.' };
    if (!banco.cuentaContableId) return { ok: false, error: 'El banco no tiene cuenta contable asignada (Catálogos → Bancos).' };
    const per = await periodoDe(mov.fecha);
    const desc = args.descripcion?.trim() || mov.descripcion || `Movimiento bancario ${mov.fecha}`;
    const ref = await refAsiento(mov.id, '');
    await rpc('fase2_contabilizar_movimiento', {
      p_movimiento_id: mov.id,
      p_asiento: { asiento_ref: ref, fecha_asiento: mov.fecha, periodo_id: per.uuid, origen: 'CONCILIACION BANCARIA', banco_id: banco.id, descripcion: desc },
      p_partidas: partidasSinDocumento({ tipo: mov.tipo, diferencia: mov.monto, cuentaContrapartidaId: args.cuentaId, cuentaBancoId: banco.cuentaContableId, bancoId: banco.id, descripcion: desc, periodo: per.nombre }),
      p_usuario: args.usuario,
    }, ['asientos', 'partidas']);
    return { ok: true, mensaje: `Movimiento contabilizado (asiento ${ref}).` };
  } catch (err) {
    return { ok: false, error: traducirError(err) };
  }
}
