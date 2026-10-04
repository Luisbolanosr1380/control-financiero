/**
 * FACTORAJE — capa de datos (Supabase).
 *
 * Modelo (brief, verificado en vivo en Golden): un factoraje ES una
 * `deuda` con tipo_documento = 'Factoraje' cuyo acreedor es el financiador.
 * Los términos (con_recurso, reserva_pct, tasa_comision_pct,
 * interes_anual_pct, fecha_vencimiento, monto_original) viven en `deudas`
 * — acá se leen directo porque la interfaz `Deuda` de la app no los expone.
 * Lo único propio del módulo es el puente `factoraje_facturas` (migración
 * 010): qué facturas están comprometidas, por cuánto y en qué estado.
 *
 * Reglas:
 *  · fetchAll paginado; embeds SIEMPRE con FK explícita (PGRST201).
 *  · El servidor recalcula saldos y candados; el cliente manda solo ids.
 *  · ANTI-DOBLE-CESIÓN: la app valida, pero la defensa real es el índice
 *    único parcial uq_factfact_factura_activa (un INSERT masivo = atómico:
 *    si una factura ya está cedida, no entra ninguna).
 *  · Sin efecto contable: el asiento está parametrizado y APAGADO en
 *    lib/factoraje/asiento-config.ts hasta que lo valide el contador.
 */
import 'server-only';
import { fetchAll, supabase } from '../supabase/client';
import { uuidRequerido } from '../supabase/writes';
import { getFacturas } from './facturas';
import { getClientes } from './clientes';
import { previewAsientoAdelanto, type AsientoFactorajePreview, type TerminosFactoraje } from '../factoraje/asiento-config';
import { cargarCesiones, getCesionesActivasPorFactura, TIPO_DOC_FACTORAJE, type Cesion, type CesionActiva, type EstadoCesion } from './factoraje-cesiones';

export { ESTADOS_CESION, TIPO_DOC_FACTORAJE, getCesionesActivasPorFactura } from './factoraje-cesiones';
export type { Cesion, CesionActiva, EstadoCesion } from './factoraje-cesiones';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface Factoraje {
  id: string;                 // id de app de la deuda (→ /deudas/[id])
  uuid: string;
  nombre: string;
  financiador: string;
  financiadorId: string;      // id de app del acreedor
  conRecurso: boolean;
  reservaPct: number;         // 0-1
  comisionPct: number;        // 0-1
  interesPct: number;         // 0-1 anual
  fechaEmision: string;
  fechaVencimiento: string;
  plazoDias: number;
  montoOriginal: number;      // monto adelantado / financiado
  saldoPendiente: number;
  estadoDeuda: string;
  cesiones: Cesion[];
  totalCedidoActivo: number;  // Σ monto_cedido con estado 'Cedida'
  numCedidas: number;
}

/** ¿Existe la migración 010? (GET real — HEAD 404 no reporta error en supabase-js) */
export async function factorajeDisponible(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { error } = await sb.from('factoraje_facturas').select('id').limit(1);
  return !error;
}

const dias = (a: string, b: string) => (a && b ? Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000) : 0);

/** Factorajes (deudas tipo Factoraje) con su financiador y sus cesiones. */
export async function getFactorajes(): Promise<Factoraje[]> {
  const [deudas, acreedores, cesiones] = await Promise.all([
    fetchAll<Row>('deudas', {
      select: 'id, airtable_id, nombre_deuda, acreedor_id, con_recurso, reserva_pct, tasa_comision_pct, interes_anual_pct, fecha_emision, fecha_vencimiento, monto_original, saldo_pendiente, estado_deuda, estado',
      eq: { tipo_documento: TIPO_DOC_FACTORAJE },
    }),
    fetchAll<Row>('acreedores', { select: 'id, airtable_id, nombre_acreedor, nombre_legal' }),
    cargarCesiones(),
  ]);
  const acr = new Map(acreedores.map(a => [s(a.id), a]));
  const porDeuda = new Map<string, Cesion[]>();
  for (const c of cesiones) porDeuda.set(c.deudaUuid, [...(porDeuda.get(c.deudaUuid) ?? []), c]);
  return deudas.map(d => {
    const a = acr.get(s(d.acreedor_id));
    const ces = (porDeuda.get(s(d.id)) ?? []).sort((x, y) => y.fechaCesion.localeCompare(x.fechaCesion));
    const activas = ces.filter(c => c.estado === 'Cedida');
    return {
      id: s(d.airtable_id), uuid: s(d.id), nombre: s(d.nombre_deuda).trim(),
      financiador: s(a?.nombre_acreedor || a?.nombre_legal).trim() || '—', financiadorId: s(a?.airtable_id),
      conRecurso: d.con_recurso === true, reservaPct: n(d.reserva_pct), comisionPct: n(d.tasa_comision_pct), interesPct: n(d.interes_anual_pct),
      fechaEmision: s(d.fecha_emision), fechaVencimiento: s(d.fecha_vencimiento), plazoDias: dias(s(d.fecha_emision), s(d.fecha_vencimiento)),
      montoOriginal: r2(n(d.monto_original)), saldoPendiente: r2(n(d.saldo_pendiente)), estadoDeuda: s(d.estado_deuda) || s(d.estado),
      cesiones: ces, totalCedidoActivo: r2(activas.reduce((t, c) => t + c.montoCedido, 0)), numCedidas: activas.length,
    };
  }).sort((x, y) => (x.estadoDeuda === y.estadoDeuda ? y.fechaEmision.localeCompare(x.fechaEmision) : x.estadoDeuda.localeCompare(y.estadoDeuda)));
}

export interface FacturaCedible {
  id: string;            // Invoice.id
  noFactura: string;
  cliente: string;
  fechaEmision: string;
  total: number;
  saldo: number;         // total − cobros − NC activas (lo que la app ya calcula como balance)
}

/** Facturas activas con saldo por cobrar y sin cesión activa. */
export async function getFacturasCedibles(): Promise<FacturaCedible[]> {
  const [facturas, clientes, cedidas] = await Promise.all([getFacturas(), getClientes(), getCesionesActivasPorFactura()]);
  const nombre = new Map(clientes.map(c => [c.id, c.name]));
  return facturas
    .filter(f => (f.estadoBruto === 'emitida' || f.estadoBruto === 'pendiente' || f.estadoBruto === 'cobrado_parcial') && f.balance > 0 && !cedidas[f.id])
    .map(f => ({ id: f.id, noFactura: f.noFactura, cliente: nombre.get(f.custId) ?? f.custId, fechaEmision: f.fechaEmision ?? '', total: r2(f.total), saldo: r2(f.balance) }))
    .sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision));
}

export type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

/**
 * Cede una o varias facturas a un factoraje. Validaciones en servidor:
 * la deuda existe y es Factoraje; cada factura existe, está activa con
 * saldo, no está cedida activa (app) y monto_cedido ≤ saldo. Inserta todo
 * en UN insert: si el índice único rechaza una, no entra ninguna.
 */
export async function cederFacturas(args: {
  factorajeId: string;
  items: Array<{ facturaId: string; montoCedido?: number; nota?: string }>;
  usuario: string;
}): Promise<Resultado> {
  const sb = supabase();
  if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  if (!args.items.length) return { ok: false, error: 'Elegí al menos una factura.' };
  try {
    const deudaUuid = await uuidRequerido('deudas', args.factorajeId, 'cederFacturas');
    const { data: deuda } = await sb.from('deudas').select('tipo_documento, estado_deuda').eq('id', deudaUuid).maybeSingle();
    if (!deuda) return { ok: false, error: 'Factoraje inexistente.' };
    if (s(deuda.tipo_documento) !== TIPO_DOC_FACTORAJE) return { ok: false, error: 'Esa deuda no es un factoraje.' };

    const [facturas, cedidas] = await Promise.all([getFacturas(), getCesionesActivasPorFactura()]);
    const porId = new Map(facturas.map(f => [f.id, f]));
    const filas: Row[] = [];
    const vistos = new Set<string>();
    for (const it of args.items) {
      if (vistos.has(it.facturaId)) return { ok: false, error: 'Hay una factura repetida en la selección.' };
      vistos.add(it.facturaId);
      const f = porId.get(it.facturaId);
      if (!f) return { ok: false, error: `Factura ${it.facturaId} no encontrada.` };
      if (f.estadoBruto === 'anulado' || f.estadoBruto === 'refacturado' || f.estadoBruto === 'cobrado') return { ok: false, error: `La factura ${f.noFactura} no está activa con saldo (${f.estadoBruto}).` };
      if (!(f.balance > 0)) return { ok: false, error: `La factura ${f.noFactura} no tiene saldo por cobrar.` };
      const ya = cedidas[f.id];
      if (ya) return { ok: false, error: `La factura ${f.noFactura} ya está cedida a ${ya.financiador} (Q${ya.montoCedido.toFixed(2)}). Liberala antes de volver a cederla.` };
      const monto = r2(it.montoCedido ?? f.balance);
      if (!(monto > 0)) return { ok: false, error: `Monto a ceder inválido para ${f.noFactura}.` };
      if (monto > r2(f.balance) + 0.01) return { ok: false, error: `No se puede ceder Q${monto.toFixed(2)} de la factura ${f.noFactura}: su saldo por cobrar es Q${r2(f.balance).toFixed(2)} (total − cobros − notas de crédito).` };
      filas.push({
        deuda_id: deudaUuid,
        factura_id: await uuidRequerido('facturas_clientes', f.id, 'cederFacturas.factura'),
        monto_cedido: monto, nota: it.nota?.trim() || null, created_by: args.usuario, estado: 'Cedida',
      });
    }
    const { error } = await sb.from('factoraje_facturas').insert(filas);   // un solo INSERT = todo o nada
    if (error) {
      if (error.code === '23505' || /uq_factfact_factura_activa/.test(error.message)) {
        return { ok: false, error: 'Alguna de las facturas ya está cedida a un factoraje activo (la base impide cederla dos veces). No se cedió ninguna.' };
      }
      return { ok: false, error: `factoraje_facturas: ${error.message}` };
    }
    const total = r2(filas.reduce((t, r) => t + n(r.monto_cedido), 0));
    return { ok: true, mensaje: `${filas.length} factura(s) cedida(s) por Q${total.toFixed(2)}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Liberar / recomprar / marcar pagada: solo desde 'Cedida'. Abre el candado. */
export async function cambiarEstadoCesion(args: { cesionId: string; estado: Exclude<EstadoCesion, 'Cedida'>; usuario: string; nota?: string }): Promise<Resultado> {
  const sb = supabase();
  if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  if (!(['Liberada', 'Recomprada', 'Pagada'] as string[]).includes(args.estado)) return { ok: false, error: 'Estado inválido.' };
  const { data: c } = await sb.from('factoraje_facturas').select('id, estado, nota').eq('id', args.cesionId).maybeSingle();
  if (!c) return { ok: false, error: 'Cesión inexistente.' };
  if (s(c.estado) !== 'Cedida') return { ok: false, error: `La cesión ya está ${s(c.estado).toLowerCase()}; no se puede cambiar.` };
  const { error, count } = await sb.from('factoraje_facturas')
    .update({ estado: args.estado, estado_en: new Date().toISOString(), estado_por: args.usuario, nota: args.nota?.trim() ? `${s(c.nota) ? s(c.nota) + ' · ' : ''}${args.nota.trim()}` : c.nota }, { count: 'exact' })
    .eq('id', args.cesionId).eq('estado', 'Cedida');   // condición = sin carreras
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: 'La cesión cambió de estado mientras tanto. Recargá.' };
  return { ok: true, mensaje: `Factura ${args.estado.toLowerCase()}${args.estado === 'Liberada' ? ': vuelve a estar disponible para ceder' : ''}.` };
}

/** Preview del asiento del adelanto (parametrizado y APAGADO hasta validación del contador). */
export async function getPreviewAsiento(factorajeId: string): Promise<{ ok: true; preview: AsientoFactorajePreview; terminos: TerminosFactoraje } | { ok: false; error: string }> {
  const f = (await getFactorajes()).find(x => x.id === factorajeId);
  if (!f) return { ok: false, error: 'Factoraje inexistente.' };
  const terminos: TerminosFactoraje = {
    montoCedido: f.totalCedidoActivo || f.montoOriginal, reservaPct: f.reservaPct, comisionPct: f.comisionPct,
    interesPct: f.interesPct, plazoDias: f.plazoDias, conRecurso: f.conRecurso,
  };
  return { ok: true, preview: previewAsientoAdelanto(terminos, '1-1-2-x (banco receptor del adelanto)'), terminos };
}
