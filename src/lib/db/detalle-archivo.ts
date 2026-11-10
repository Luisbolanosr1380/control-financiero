/**
 * DETALLE FIRMADO EN PAPEL (032) · archivos del detalle en el bucket PRIVADO `detalles-firmados` — SOLO SERVIDOR.
 *
 * Subida en dos pasos (el navegador manda el archivo directo al bucket: una función en Vercel no recibe 15 MB):
 *  1. prepararSubida: valida estado, cantidad, tamaño y mime declarados, y devuelve una URL FIRMADA DE SUBIDA por
 *     archivo a un path fijo `<detalle_id>/<uuid>-<nombre-saneado>` (solo sirve para ese path, una vez).
 *  2. confirmarSubida: el servidor baja cada objeto con la llave de servicio, valida el TIPO REAL por los primeros
 *     bytes (nunca la extensión), el tamaño y calcula el sha256; registra la fila. Lo que no pasa se borra del bucket.
 *     Si el detalle está enviado / con observaciones y se pidió, lo marca aprobado con canal `papel` y revoca el link.
 * Descarga: URL firmada de 5 minutos, generada acá después de que la ruta validó el permiso. Nunca una URL pública.
 * Reemplazar / quitar (admin y contador, con motivo): el anterior queda como versión anterior; nunca se borra.
 * Sin el marcador 'server-only' (como detalle-facturacion.ts, que lo carga): los validadores lo importan fuera de la
 * condición react-server; la frontera servidor / cliente la vigila validate-frontera-cliente.
 */
import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase/client';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { BUCKET_FIRMADOS, MAX_ARCHIVOS_FIRMADO, MAX_BYTES_ARCHIVO, SEGUNDOS_URL_FIRMADA, esImagen, puedeAprobarEnPapelEn, puedeSubirFirmadoEn, sanearNombre, tipoRealDe, validarArchivosDeclarados, validarMetaFirmado, type MetaFirmado, type MimeFirmado } from '@/lib/detalle-archivo/puro';
import { getDetalleBasico, marcarAprobada } from './detalle-facturacion';
import type { DetalleFacturacion } from '@/lib/facturacion-agenda/detalle';

export interface ArchivoDetalle {
  id: string; detalleId: string; path: string; nombre: string; mime: MimeFirmado; bytes: number; sha256: string;
  firmadoPor: string; firmadoCargo: string; firmadoFecha: string; notas: string; subidoPor: string; subidoEn: string;
  reemplazadoPor: string | null; reemplazadoEn: string | null; motivoReemplazo: string;
  /** vigente = no fue reemplazado ni quitado */ vigente: boolean;
  /** miniatura (URL firmada de 5 min) solo para imágenes vigentes; se arma al leer el detalle */ miniaturaUrl?: string | null;
}

const rowToArchivo = (r: Record<string, unknown>): ArchivoDetalle => ({
  id: String(r.id), detalleId: String(r.detalle_id), path: String(r.path), nombre: String(r.nombre), mime: r.mime as MimeFirmado, bytes: Number(r.bytes), sha256: String(r.sha256),
  firmadoPor: String(r.firmado_por ?? ''), firmadoCargo: String(r.firmado_cargo ?? ''), firmadoFecha: String(r.firmado_fecha ?? ''), notas: String(r.notas ?? ''), subidoPor: String(r.subido_por ?? ''), subidoEn: String(r.subido_en ?? ''),
  reemplazadoPor: (r.reemplazado_por as string | null) ?? null, reemplazadoEn: (r.reemplazado_en as string | null) ?? null, motivoReemplazo: String(r.motivo_reemplazo ?? ''),
  vigente: !r.reemplazado_en,
});

const esUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Archivos del detalle (vigentes y anteriores, el más nuevo primero). Sin la 032 → []. Con miniaturas firmadas para las imágenes vigentes. */
export async function archivosDeDetalle(detalleId: string, opts: { miniaturas?: boolean } = {}): Promise<ArchivoDetalle[]> {
  const sb = supabase(); if (!sb || !esUuid(detalleId)) return [];
  const { data, error } = await sb.from('detalle_facturacion_archivo').select('*').eq('detalle_id', detalleId).order('subido_en', { ascending: false }).limit(50);
  if (error) return [];
  const archivos = ((data ?? []) as Record<string, unknown>[]).map(rowToArchivo);
  if (opts.miniaturas) {
    const imgs = archivos.filter(a => a.vigente && esImagen(a.mime) && a.mime !== 'image/heic');
    if (imgs.length) {
      const { data: urls } = await sb.storage.from(BUCKET_FIRMADOS).createSignedUrls(imgs.map(a => a.path), SEGUNDOS_URL_FIRMADA);
      for (const a of imgs) a.miniaturaUrl = urls?.find(u => u.path === a.path)?.signedUrl ?? null;
    }
  }
  return archivos;
}

/** Para la lista de detalles: cuáles tienen un archivo firmado vigente. Fail-soft. */
export async function detallesConFirmado(detalleIds: string[]): Promise<string[]> {
  const sb = supabase(); const ids = [...new Set(detalleIds)].filter(esUuid); if (!sb || !ids.length) return [];
  const { data, error } = await sb.from('detalle_facturacion_archivo').select('detalle_id').in('detalle_id', ids).is('reemplazado_en', null).limit(5000);
  if (error) return [];
  return [...new Set(((data ?? []) as { detalle_id: string }[]).map(r => r.detalle_id))];
}

export interface ArchivoDeclarado { nombre: string; bytes: number; mime: string }
export interface SubidaPreparada { path: string; url: string; token: string; nombre: string; mime: MimeFirmado }
export type PrepararResult = { ok: true; subidas: SubidaPreparada[] } | { ok: false; error: string };

async function detalleParaSubir(detalleId: string): Promise<{ ok: true; detalle: DetalleFacturacion; vigentes: number } | { ok: false; error: string }> {
  if (!esUuid(detalleId)) return { ok: false, error: 'El detalle no existe.' };
  const detalle = await getDetalleBasico(detalleId); if (!detalle) return { ok: false, error: 'El detalle no existe.' };
  if (!puedeSubirFirmadoEn(detalle.estado)) return { ok: false, error: 'El detalle firmado se sube con el detalle enviado, con observaciones, aprobado o facturado.' };
  const vigentes = (await archivosDeDetalle(detalleId)).filter(a => a.vigente).length;
  return { ok: true, detalle, vigentes };
}

/** Paso 1: URLs firmadas de subida (una por archivo, path fijo del detalle). `reemplazaId` no cuenta el que se va a reemplazar. */
export async function prepararSubida(detalleId: string, archivos: ArchivoDeclarado[], opts: { reemplazaId?: string | null } = {}): Promise<PrepararResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const d = await detalleParaSubir(detalleId); if (!d.ok) return d;
  const v = validarArchivosDeclarados(archivos, Math.max(0, d.vigentes - (opts.reemplazaId ? 1 : 0))); if (!v.ok) return v;
  const subidas: SubidaPreparada[] = [];
  for (const a of archivos) {
    const mime = a.mime as MimeFirmado;
    const path = `${detalleId}/${randomUUID()}-${sanearNombre(a.nombre, mime)}`;
    const { data, error } = await sb.storage.from(BUCKET_FIRMADOS).createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: /not found|Bucket/i.test(error?.message ?? '') ? 'Falta aplicar la migración 032 (bucket detalles-firmados) en esta base.' : `No se pudo preparar la subida: ${error?.message ?? 'sin respuesta'}` };
    subidas.push({ path, url: data.signedUrl, token: data.token, nombre: a.nombre, mime });
  }
  return { ok: true, subidas };
}

export interface ConfirmarInput extends Partial<MetaFirmado> { archivos: Array<{ path: string; nombre: string }>; aprobar?: boolean; reemplazaId?: string | null; motivo?: string }
export type ConfirmarResult = { ok: true; archivos: ArchivoDetalle[]; detalle: DetalleFacturacion; aprobado: boolean; linkRevocado: number } | { ok: false; error: string };

/** Baja el objeto con la llave de servicio y decide por los primeros bytes. Si no pasa, lo borra del bucket. */
async function verificarObjeto(path: string): Promise<{ ok: true; mime: MimeFirmado; bytes: number; sha256: string } | { ok: false; error: string }> {
  const sb = supabase()!;
  const { data, error } = await sb.storage.from(BUCKET_FIRMADOS).download(path);
  if (error || !data) return { ok: false, error: 'El archivo no llegó al servidor: volvé a intentarlo.' };
  const buf = Buffer.from(await data.arrayBuffer());
  const mime = tipoRealDe(buf.subarray(0, 16));
  if (!mime || buf.length === 0 || buf.length > MAX_BYTES_ARCHIVO) {
    await sb.storage.from(BUCKET_FIRMADOS).remove([path]);
    return { ok: false, error: !mime ? 'El archivo no es PDF ni imagen (JPG, PNG o HEIC): se descartó.' : buf.length === 0 ? 'El archivo está vacío: se descartó.' : 'El archivo pesa más de 15 MB: se descartó.' };
  }
  return { ok: true, mime, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Paso 2: valida los objetos subidos, registra las filas y, si corresponde, aprueba en papel (revoca el link). */
export async function confirmarSubida(detalleId: string, input: ConfirmarInput, actor: string): Promise<ConfirmarResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const d = await detalleParaSubir(detalleId); if (!d.ok) return d;
  const meta = validarMetaFirmado(input, obtenerFechaHoyGuatemala()); if (!meta.ok) return meta;
  const paths = (input.archivos ?? []).map(a => ({ path: String(a.path ?? ''), nombre: String(a.nombre ?? '').slice(0, 200) }));
  if (!paths.length) return { ok: false, error: 'No llegó ningún archivo.' };
  if (paths.length + Math.max(0, d.vigentes - (input.reemplazaId ? 1 : 0)) > MAX_ARCHIVOS_FIRMADO) return { ok: false, error: `Hasta ${MAX_ARCHIVOS_FIRMADO} archivos por detalle.` };
  if (paths.some(p => !p.path.startsWith(`${detalleId}/`) || p.path.includes('..'))) return { ok: false, error: 'Ruta de archivo inválida.' };
  // reemplazo: el anterior tiene que ser de este detalle y estar vigente
  let anterior: ArchivoDetalle | null = null;
  if (input.reemplazaId) {
    anterior = (await archivosDeDetalle(detalleId)).find(a => a.id === input.reemplazaId && a.vigente) ?? null;
    if (!anterior) return { ok: false, error: 'El archivo a reemplazar ya no está vigente.' };
    if (String(input.motivo ?? '').trim().length < 3) return { ok: false, error: 'Indicá el motivo del reemplazo.' };
  }
  const guardados: ArchivoDetalle[] = [];
  for (const p of paths) {
    const v = await verificarObjeto(p.path);
    if (!v.ok) { for (const g of guardados) { await sb.from('detalle_facturacion_archivo').delete().eq('id', g.id); await sb.storage.from(BUCKET_FIRMADOS).remove([g.path]); } return v; }
    const { data, error } = await sb.from('detalle_facturacion_archivo').insert({ detalle_id: detalleId, tipo: 'firmado_papel', path: p.path, nombre: sanearNombre(p.nombre, v.mime), mime: v.mime, bytes: v.bytes, sha256: v.sha256, firmado_por: meta.meta.firmadoPor, firmado_cargo: meta.meta.firmadoCargo || null, firmado_fecha: meta.meta.firmadoFecha, notas: meta.meta.notas || null, subido_por: actor }).select('*').single();
    if (error || !data) { await sb.storage.from(BUCKET_FIRMADOS).remove([p.path]); return { ok: false, error: /does not exist|Could not find|schema cache/i.test(error?.message ?? '') ? 'Falta aplicar la migración 032 en esta base.' : `No se pudo registrar el archivo: ${error?.message ?? 'sin respuesta'}` }; }
    guardados.push(rowToArchivo(data as Record<string, unknown>));
  }
  if (anterior) await sb.from('detalle_facturacion_archivo').update({ reemplazado_por: guardados[0].id, reemplazado_en: new Date().toISOString(), motivo_reemplazo: String(input.motivo ?? '').trim().slice(0, 300) }).eq('id', anterior.id);
  // «y marcar como aprobado»: solo enviada / con_observaciones; el papel manda y el link digital ya no hace falta
  let aprobado = false, linkRevocado = 0, detalle = d.detalle;
  if (input.aprobar && puedeAprobarEnPapelEn(d.detalle.estado)) {
    const r = await marcarAprobada(detalleId, { aprobadoPor: meta.meta.firmadoPor, canal: 'papel' }, actor);
    if (!r.ok) return { ok: false, error: `Los archivos quedaron guardados, pero no se pudo aprobar: ${r.error}` };
    detalle = r.detalle; aprobado = true;
    // detalle-link.ts es 'server-only': se carga acá (solo al aprobar) para que este módulo siga importable desde los validadores sin la condición react-server
    const { revocarLinkDetalle } = await import('./detalle-link');
    const rv = await revocarLinkDetalle(detalleId, actor, 'aprobado con el detalle firmado en papel');
    linkRevocado = rv.ok ? rv.revocados : 0;
  }
  return { ok: true, archivos: guardados, detalle, aprobado, linkRevocado };
}

/** Subida directa desde el servidor (validadores / pruebas): sube el buffer al path del detalle y confirma igual que el navegador. */
export async function subirArchivoDirecto(detalleId: string, archivo: { nombre: string; mime: string; data: Buffer }, input: Omit<ConfirmarInput, 'archivos'>, actor: string): Promise<ConfirmarResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const prep = await prepararSubida(detalleId, [{ nombre: archivo.nombre, bytes: archivo.data.length, mime: archivo.mime }], { reemplazaId: input.reemplazaId });
  if (!prep.ok) return prep;
  const { error } = await sb.storage.from(BUCKET_FIRMADOS).upload(prep.subidas[0].path, archivo.data, { contentType: archivo.mime, upsert: false });
  if (error) return { ok: false, error: `storage: ${error.message}` };
  return confirmarSubida(detalleId, { ...input, archivos: [{ path: prep.subidas[0].path, nombre: archivo.nombre }] }, actor);
}

/** Quitar (sin archivo nuevo): el anterior queda como versión anterior con el motivo. Admin / contador. */
export async function quitarArchivo(archivoId: string, motivo: string, actor: string): Promise<{ ok: true; archivo: ArchivoDetalle } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb || !esUuid(archivoId)) return { ok: false, error: 'El archivo no existe.' };
  const m = String(motivo ?? '').trim().slice(0, 300); if (m.length < 3) return { ok: false, error: 'Indicá el motivo (mínimo 3 caracteres).' };
  const { data, error } = await sb.from('detalle_facturacion_archivo').update({ reemplazado_en: new Date().toISOString(), motivo_reemplazo: `${m} · quitado por ${actor}` }).eq('id', archivoId).is('reemplazado_en', null).select('*').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'El archivo ya no está vigente.' };
  return { ok: true, archivo: rowToArchivo(data as Record<string, unknown>) };
}

/** URL firmada de 5 minutos (la ruta valida el permiso antes). `descargar` fuerza el nombre de descarga. */
export async function urlFirmadaArchivo(archivoId: string, opts: { descargar?: boolean; segundos?: number } = {}): Promise<{ ok: true; url: string; archivo: ArchivoDetalle } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb || !esUuid(archivoId)) return { ok: false, error: 'El archivo no existe.' };
  const { data, error } = await sb.from('detalle_facturacion_archivo').select('*').eq('id', archivoId).maybeSingle();
  if (error || !data) return { ok: false, error: 'El archivo no existe.' };
  const archivo = rowToArchivo(data as Record<string, unknown>);
  const { data: s, error: e2 } = await sb.storage.from(BUCKET_FIRMADOS).createSignedUrl(archivo.path, Math.min(Math.max(opts.segundos ?? SEGUNDOS_URL_FIRMADA, 1), SEGUNDOS_URL_FIRMADA), opts.descargar ? { download: archivo.nombre } : undefined);
  if (e2 || !s?.signedUrl) return { ok: false, error: 'No se pudo generar el enlace: probá de nuevo.' };
  return { ok: true, url: s.signedUrl, archivo };
}
