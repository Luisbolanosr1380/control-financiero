/**
 * PRESUPUESTO — capa de datos (server).
 *
 * Las líneas se resuelven por `mapeo_er.orden` (clave estable entre bases;
 * los uuid/airtable_id difieren entre HIT y Golden): el detalle guarda el
 * uuid de ESTA base y acá se traduce uuid ↔ orden. El real sale del motor
 * del ER en vivo (generarRealPorCelda), no de un cálculo aparte.
 *
 * Reglas que se validan acá (el permiso lo valida la action, primera línea):
 *  · solo un Borrador se edita/precarga/limpia;
 *  · aprobar: Borrador → Aprobado; el índice único parcial de la base
 *    garantiza UN aprobado por año (23505 → mensaje claro);
 *  · reabrir: Aprobado → Borrador; todo queda en presupuesto_log.
 */
import 'server-only';
import { fetchAll, supabase } from '../supabase/client';
import { generarRealPorCelda } from '../contabilidad/estado-resultados';
import { esSignoNegativo } from '../contabilidad/er-formulas';
import {
  celdasDesdeReal, claveCelda, lineasPresupuesto,
  type AjustesPrecarga, type LineaPres, type RealCeldas,
} from '../presupuesto/modelo';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export type EstadoPresupuesto = 'Borrador' | 'Aprobado' | 'Archivado';
export interface CentroPres { id: string; appId: string; nombre: string; activo: boolean }
export interface Estructura {
  lineas: LineaPres[];
  centros: CentroPres[];            // activos (los que se presupuestan)
  uuidPorOrden: Map<number, string>;
  ordenPorUuid: Map<string, number>;
  centroUuidPorAppId: Map<string, string>;
}
export interface PresupuestoCab {
  id: string; anio: number; nombre: string; estado: EstadoPresupuesto; moneda: string;
  aprobadoPor: string | null; aprobadoEn: string | null; nota: string | null;
  createdAt: string; createdBy: string | null; updatedAt: string;
}
export interface EntradaLog { id: string; accion: string; detalle: unknown; actor: string | null; createdAt: string }
export type Resultado<T = object> = ({ ok: true; mensaje: string } & T) | { ok: false; error: string };

const sb = () => {
  const c = supabase();
  if (!c) throw new Error('Supabase no está configurado.');
  return c;
};

/** ¿Está aplicada la migración 011? (GET, no HEAD: un HEAD a tabla inexistente devuelve 404 sin error). */
export async function presupuestoDisponible(): Promise<boolean> {
  try {
    const { error } = await sb().from('presupuesto').select('id').limit(1);
    return !error;
  } catch { return false; }
}

export async function getEstructura(): Promise<Estructura> {
  const [mapeo, centros] = await Promise.all([
    fetchAll<Row>('mapeo_er', { select: 'id, orden, linea, tipo, signo' }),
    fetchAll<Row>('centros_costo', { select: 'id, airtable_id, nombre, activo' }),
  ]);
  const ordenes = mapeo.map(m => Number(m.orden));
  if (new Set(ordenes).size !== ordenes.length) throw new Error('mapeo_er tiene órdenes repetidos: la clave de línea del presupuesto debe ser única.');
  const lineas = lineasPresupuesto(mapeo.map(m => ({
    orden: Number(m.orden),
    nombre: s(m.linea).trim(),
    tipo: s(m.tipo).trim() === 'Calculada' ? 'Calculada' as const : 'Suma cuentas' as const,
    negativa: esSignoNegativo(s(m.signo)),
  })));
  return {
    lineas,
    centros: centros
      .map(c => ({ id: s(c.id), appId: s(c.airtable_id), nombre: s(c.nombre), activo: c.activo !== false }))
      .filter(c => c.activo)
      .sort((a, b) => (a.nombre === 'Administrativo' ? -1 : b.nombre === 'Administrativo' ? 1 : a.nombre.localeCompare(b.nombre))),
    uuidPorOrden: new Map(mapeo.map(m => [Number(m.orden), s(m.id)])),
    ordenPorUuid: new Map(mapeo.map(m => [s(m.id), Number(m.orden)])),
    centroUuidPorAppId: new Map(centros.map(c => [s(c.airtable_id), s(c.id)])),
  };
}

const aCab = (r: Row): PresupuestoCab => ({
  id: s(r.id), anio: Number(r.anio), nombre: s(r.nombre) || `Presupuesto ${r.anio}`, estado: s(r.estado) as EstadoPresupuesto,
  moneda: s(r.moneda) || 'GTQ', aprobadoPor: s(r.aprobado_por) || null, aprobadoEn: s(r.aprobado_en) || null,
  nota: s(r.nota) || null, createdAt: s(r.created_at), createdBy: s(r.created_by) || null, updatedAt: s(r.updated_at),
});

export async function listarPresupuestos(): Promise<Array<PresupuestoCab & { totalIngresos: number; totalGastos: number }>> {
  const [cabs, est] = await Promise.all([fetchAll<Row>('presupuesto', { select: '*' }), getEstructura()]);
  const lineas = await fetchAll<Row>('presupuesto_lineas', { select: 'presupuesto_id, mapeo_er_id, monto' });
  const claseDe = new Map(est.lineas.map(l => [l.orden, l.clase]));
  const tot = new Map<string, { ing: number; gas: number }>();
  for (const l of lineas) {
    const clase = claseDe.get(est.ordenPorUuid.get(s(l.mapeo_er_id)) ?? -1);
    const t = tot.get(s(l.presupuesto_id)) ?? { ing: 0, gas: 0 };
    if (clase === 'ingreso') t.ing += Number(l.monto);
    else if (clase === 'costo' || clase === 'gasto') t.gas += Number(l.monto);
    tot.set(s(l.presupuesto_id), t);
  }
  return cabs.map(aCab)
    .map(c => ({ ...c, totalIngresos: r2(tot.get(c.id)?.ing ?? 0), totalGastos: r2(tot.get(c.id)?.gas ?? 0) }))
    .sort((a, b) => b.anio - a.anio || (a.estado === 'Aprobado' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt));
}

async function cabecera(id: string): Promise<PresupuestoCab | null> {
  const { data } = await sb().from('presupuesto').select('*').eq('id', id).maybeSingle();
  return data ? aCab(data as Row) : null;
}

/** Cabecera + celdas (clave orden|centroUuid|mes → magnitud) + log. */
export async function getPresupuesto(id: string): Promise<{ cab: PresupuestoCab; celdas: Map<string, number>; log: EntradaLog[]; est: Estructura } | null> {
  const [cab, est] = await Promise.all([cabecera(id), getEstructura()]);
  if (!cab) return null;
  const [rows, log] = await Promise.all([
    fetchAll<Row>('presupuesto_lineas', { select: 'id, mapeo_er_id, centro_costo_id, mes, monto', eq: { presupuesto_id: id } }),
    fetchAll<Row>('presupuesto_log', { select: 'id, accion, detalle, actor, created_at', eq: { presupuesto_id: id } }),
  ]);
  const celdas = new Map<string, number>();
  for (const r of rows) {
    const orden = est.ordenPorUuid.get(s(r.mapeo_er_id));
    if (orden == null) continue;
    celdas.set(claveCelda(orden, s(r.centro_costo_id), Number(r.mes)), Number(r.monto));
  }
  return {
    cab, celdas, est,
    log: log.map(l => ({ id: s(l.id), accion: s(l.accion), detalle: l.detalle, actor: s(l.actor) || null, createdAt: s(l.created_at) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function getPresupuestoAprobado(anio: number): Promise<PresupuestoCab | null> {
  const { data } = await sb().from('presupuesto').select('*').eq('anio', anio).eq('estado', 'Aprobado').maybeSingle();
  return data ? aCab(data as Row) : null;
}

async function log(presupuestoId: string, accion: string, detalle: unknown, actor: string) {
  const { error } = await sb().from('presupuesto_log').insert({ presupuesto_id: presupuestoId, accion, detalle, actor });
  if (error) throw new Error(`log: ${error.message}`);
}

/** Real del ER de un año, con las celdas en uuid de centro de esta base ('' = partidas sin centro). */
export async function getReal(anio: number, est?: Estructura): Promise<RealCeldas & { numPartidas: number; partidasSinCentro: number }> {
  const e = est ?? await getEstructura();
  const real = await generarRealPorCelda({ anio });
  const porCelda = new Map<string, number>();
  for (const [orden, porMes] of real.porOrden) {
    for (const [mes, porCentro] of porMes) {
      for (const [appId, monto] of porCentro) {
        const k = claveCelda(orden, appId ? (e.centroUuidPorAppId.get(appId) ?? `app:${appId}`) : '', mes);
        porCelda.set(k, r2((porCelda.get(k) ?? 0) + monto));
      }
    }
  }
  const consolidado = new Map<string, number>();
  for (const [orden, porMes] of real.consolidado) for (const [mes, monto] of porMes) consolidado.set(`${orden}|${mes}`, monto);
  return { porCelda, consolidado, numPartidas: real.numPartidas, partidasSinCentro: real.partidasSinCentro };
}

async function upsertCeldas(presupuestoId: string, est: Estructura, celdas: Array<{ orden: number; centroId: string; mes: number; monto: number }>) {
  const filas = celdas.map(c => ({
    presupuesto_id: presupuestoId,
    mapeo_er_id: est.uuidPorOrden.get(c.orden)!,
    centro_costo_id: c.centroId,
    mes: c.mes,
    monto: r2(c.monto),
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await sb().from('presupuesto_lineas').upsert(filas.slice(i, i + 500), { onConflict: 'presupuesto_id,mapeo_er_id,centro_costo_id,mes' });
    if (error) throw new Error(`celdas: ${error.message}`);
  }
}

function validarCeldas(est: Estructura, celdas: Array<{ orden: number; centroId: string; mes: number; monto: number }>): string | null {
  const base = new Set(est.lineas.filter(l => l.clase !== 'calculada').map(l => l.orden));
  const centros = new Set(est.centros.map(c => c.id));
  for (const c of celdas) {
    if (!base.has(c.orden)) return `La línea ${c.orden} no se presupuesta (los subtotales se calculan).`;
    if (!centros.has(c.centroId)) return 'Centro de costo inexistente o inactivo.';
    if (!(c.mes >= 1 && c.mes <= 12)) return `Mes inválido (${c.mes}).`;
    if (!Number.isFinite(c.monto) || Math.abs(c.monto) > 1e11) return `Monto inválido en la línea ${c.orden}, mes ${c.mes}.`;
  }
  return null;
}

/** Celdas a precargar desde el real del año anterior (solo centros activos; reporta lo que queda afuera). */
async function celdasPrecarga(anio: number, est: Estructura, ajustes: AjustesPrecarga) {
  const real = await getReal(anio - 1, est);
  const activos = new Set(est.centros.map(c => c.id));
  const entradas: Array<{ orden: number; centroId: string; mes: number; montoConSigno: number }> = [];
  let fueraDeCentro = 0;
  for (const [k, v] of real.porCelda) {
    const [o, c, m] = k.split('|');
    if (!activos.has(c)) { fueraDeCentro = r2(fueraDeCentro + Math.abs(v)); continue; }
    entradas.push({ orden: Number(o), centroId: c, mes: Number(m), montoConSigno: v });
  }
  const celdas = celdasDesdeReal(est.lineas, entradas, ajustes);
  return { celdas, numPartidas: real.numPartidas, fueraDeCentro };
}

export async function crearPresupuesto(input: {
  anio: number; nombre?: string; modo: 'blanco' | 'precarga'; ajustes?: AjustesPrecarga; usuario: string;
}): Promise<Resultado<{ id: string }>> {
  if (!(input.anio >= 2024 && input.anio <= 2100)) return { ok: false, error: 'Año inválido.' };
  const est = await getEstructura();
  const { data, error } = await sb().from('presupuesto').insert({
    anio: input.anio, nombre: input.nombre?.trim() || `Presupuesto ${input.anio}`, created_by: input.usuario,
  }).select('id').single();
  if (error || !data) return { ok: false, error: `No se pudo crear: ${error?.message ?? 'sin respuesta'}` };
  const id = s((data as Row).id);
  await log(id, 'crear', { anio: input.anio, modo: input.modo }, input.usuario);
  if (input.modo === 'precarga') {
    const r = await precargarPresupuesto({ id, ajustes: input.ajustes ?? { globalPct: 0 }, usuario: input.usuario, est });
    if (!r.ok) return r;
    return { ok: true, id, mensaje: `Presupuesto ${input.anio} creado. ${r.mensaje}` };
  }
  return { ok: true, id, mensaje: `Presupuesto ${input.anio} creado en blanco.` };
}

export async function precargarPresupuesto(input: { id: string; ajustes: AjustesPrecarga; usuario: string; est?: Estructura }): Promise<Resultado<{ celdas: number }>> {
  const cab = await cabecera(input.id);
  if (!cab) return { ok: false, error: 'Presupuesto no encontrado.' };
  if (cab.estado !== 'Borrador') return { ok: false, error: `Solo se precarga un Borrador (este está ${cab.estado}).` };
  const est = input.est ?? await getEstructura();
  const { celdas, numPartidas, fueraDeCentro } = await celdasPrecarga(cab.anio, est, input.ajustes);
  const lista = [...celdas].map(([k, monto]) => { const [o, c, m] = k.split('|'); return { orden: Number(o), centroId: c, mes: Number(m), monto }; });
  await upsertCeldas(input.id, est, lista);
  const total = r2(lista.reduce((t, c) => t + c.monto, 0));
  await log(input.id, 'precargar', {
    desde: `real ${cab.anio - 1} (Estado de Resultados)`, ajustes: input.ajustes,
    celdas: lista.length, montoTotal: total, partidasLeidas: numPartidas, realFueraDeCentrosActivos: fueraDeCentro,
  }, input.usuario);
  await sb().from('presupuesto').update({ updated_at: new Date().toISOString() }).eq('id', input.id);
  const aviso = numPartidas === 0 ? ` El Estado de Resultados de ${cab.anio - 1} no tiene partidas: no había real que traer (quedó en blanco).` : '';
  return { ok: true, celdas: lista.length, mensaje: `Precargado desde el real ${cab.anio - 1}: ${lista.length} celdas.${aviso}` };
}

export async function editarCeldas(input: { id: string; cambios: Array<{ orden: number; centroId: string; mes: number; monto: number }>; usuario: string }): Promise<Resultado<{ celdas: number }>> {
  if (input.cambios.length === 0) return { ok: true, celdas: 0, mensaje: 'Sin cambios.' };
  if (input.cambios.length > 5000) return { ok: false, error: 'Demasiadas celdas en un solo guardado.' };
  const cab = await cabecera(input.id);
  if (!cab) return { ok: false, error: 'Presupuesto no encontrado.' };
  if (cab.estado !== 'Borrador') return { ok: false, error: `El presupuesto está ${cab.estado}: no se edita. ${cab.estado === 'Aprobado' ? 'Para cambiarlo, un Admin lo reabre (queda en el historial).' : ''}`.trim() };
  const est = await getEstructura();
  const invalido = validarCeldas(est, input.cambios);
  if (invalido) return { ok: false, error: invalido };
  const actual = await getPresupuesto(input.id);
  const antes = input.cambios.map(c => ({ ...c, antes: actual?.celdas.get(claveCelda(c.orden, c.centroId, c.mes)) ?? 0 }));
  await upsertCeldas(input.id, est, input.cambios);
  await log(input.id, 'editar_celda', {
    celdas: antes.length,
    cambios: antes.slice(0, 200).map(c => ({ orden: c.orden, centro: c.centroId, mes: c.mes, antes: c.antes, despues: r2(c.monto) })),
  }, input.usuario);
  await sb().from('presupuesto').update({ updated_at: new Date().toISOString() }).eq('id', input.id);
  return { ok: true, celdas: antes.length, mensaje: `${antes.length} celda${antes.length === 1 ? '' : 's'} guardada${antes.length === 1 ? '' : 's'}.` };
}

export async function limpiarCeldas(input: { id: string; centroId: string | null; usuario: string }): Promise<Resultado> {
  const cab = await cabecera(input.id);
  if (!cab) return { ok: false, error: 'Presupuesto no encontrado.' };
  if (cab.estado !== 'Borrador') return { ok: false, error: `El presupuesto está ${cab.estado}: no se edita.` };
  let q = sb().from('presupuesto_lineas').update({ monto: 0 }).eq('presupuesto_id', input.id);
  if (input.centroId) q = q.eq('centro_costo_id', input.centroId);
  const { error } = await q;
  if (error) return { ok: false, error: error.message };
  await log(input.id, 'limpiar', { centro: input.centroId ?? 'todos' }, input.usuario);
  return { ok: true, mensaje: input.centroId ? 'Celdas del centro en cero.' : 'Todas las celdas en cero.' };
}

export async function aprobarPresupuesto(input: { id: string; usuario: string }): Promise<Resultado> {
  const cab = await cabecera(input.id);
  if (!cab) return { ok: false, error: 'Presupuesto no encontrado.' };
  if (cab.estado !== 'Borrador') return { ok: false, error: `Solo se aprueba un Borrador (este está ${cab.estado}).` };
  const ahora = new Date().toISOString();
  const { data, error } = await sb().from('presupuesto')
    .update({ estado: 'Aprobado', aprobado_por: input.usuario, aprobado_en: ahora, updated_at: ahora })
    .eq('id', input.id).eq('estado', 'Borrador').select('id');
  if (error) {
    if (error.code === '23505' || /uq_presupuesto_anio_aprobado/.test(error.message)) {
      return { ok: false, error: `Ya hay un presupuesto aprobado para ${cab.anio}. Solo puede haber uno vigente por año: reabrí el otro primero.` };
    }
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: 'El presupuesto cambió de estado mientras se aprobaba; recargá.' };
  await log(input.id, 'aprobar', { anio: cab.anio, aprobado_en: ahora }, input.usuario);
  return { ok: true, mensaje: `Presupuesto ${cab.anio} aprobado. Las celdas quedan bloqueadas.` };
}

export async function reabrirPresupuesto(input: { id: string; usuario: string; motivo: string }): Promise<Resultado> {
  if (!input.motivo.trim()) return { ok: false, error: 'Indicá el motivo de la reapertura (queda en el historial).' };
  const cab = await cabecera(input.id);
  if (!cab) return { ok: false, error: 'Presupuesto no encontrado.' };
  if (cab.estado !== 'Aprobado') return { ok: false, error: `Solo se reabre un presupuesto Aprobado (este está ${cab.estado}).` };
  const { data, error } = await sb().from('presupuesto')
    .update({ estado: 'Borrador', aprobado_por: null, aprobado_en: null, updated_at: new Date().toISOString() })
    .eq('id', input.id).eq('estado', 'Aprobado').select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'El presupuesto cambió de estado; recargá.' };
  await log(input.id, 'reabrir', { motivo: input.motivo.trim(), aprobadoAntesPor: cab.aprobadoPor, aprobadoAntesEn: cab.aprobadoEn }, input.usuario);
  return { ok: true, mensaje: 'Presupuesto reabierto a Borrador (queda en el historial quién lo aprobó y cuándo).' };
}

export async function archivarPresupuesto(input: { id: string; usuario: string }): Promise<Resultado> {
  const cab = await cabecera(input.id);
  if (!cab) return { ok: false, error: 'Presupuesto no encontrado.' };
  if (cab.estado !== 'Borrador') return { ok: false, error: cab.estado === 'Aprobado' ? 'Un presupuesto aprobado se reabre antes de archivarlo.' : 'Ya está archivado.' };
  const { error } = await sb().from('presupuesto').update({ estado: 'Archivado', updated_at: new Date().toISOString() }).eq('id', input.id).eq('estado', 'Borrador');
  if (error) return { ok: false, error: error.message };
  await log(input.id, 'archivar', { anio: cab.anio }, input.usuario);
  return { ok: true, mensaje: 'Presupuesto archivado.' };
}
