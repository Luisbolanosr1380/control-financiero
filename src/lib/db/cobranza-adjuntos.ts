/**
 * CENTRO DE COBROS (033) · adjuntos de un evento manual (captura de WhatsApp, PDF, correo .eml) en el bucket PRIVADO
 * `cobranza-adjuntos` (10 MB). Mismo esquema que el detalle firmado (032): URL firmada de subida por archivo → PUT
 * directo desde el navegador → el servidor baja el objeto, decide el tipo por los primeros bytes y registra la fila.
 * Descarga por URL firmada de 5 minutos después de validar el permiso. Nunca una URL pública.
 */
import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase/client';
import { MAX_ADJUNTOS_EVENTO, MAX_BYTES_ADJUNTO, MIMES_ADJUNTO, nombreAdjuntoSaneado, tipoRealAdjunto, type MimeAdjunto } from '@/lib/cobranza/adjuntos';

export const BUCKET_COBRANZA = 'cobranza-adjuntos';
export const SEGUNDOS_URL_ADJUNTO = 300;
const esUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const nombreSaneado = nombreAdjuntoSaneado;

export interface SubidaAdjunto { path: string; url: string; token: string; nombre: string; mime: MimeAdjunto }
export async function prepararSubidaAdjuntos(eventoId: string, archivos: Array<{ nombre: string; bytes: number; mime: string }>): Promise<{ ok: true; subidas: SubidaAdjunto[] } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  if (!esUuid(eventoId)) return { ok: false, error: 'El evento no existe.' };
  const { data: ev } = await sb.from('cobranza_evento').select('id, origen').eq('id', eventoId).maybeSingle();
  if (!ev) return { ok: false, error: 'El evento no existe.' };
  if ((ev as { origen: string }).origen !== 'manual') return { ok: false, error: 'Solo los eventos manuales llevan adjuntos.' };
  const { count } = await sb.from('cobranza_adjunto').select('id', { count: 'exact', head: true }).eq('evento_id', eventoId);
  if (!archivos.length) return { ok: false, error: 'Elegí al menos un archivo.' };
  if (archivos.length + (count ?? 0) > MAX_ADJUNTOS_EVENTO) return { ok: false, error: `Hasta ${MAX_ADJUNTOS_EVENTO} adjuntos por evento.` };
  const subidas: SubidaAdjunto[] = [];
  for (const a of archivos) {
    if (!(a.bytes > 0)) return { ok: false, error: `"${a.nombre}" está vacío.` };
    if (a.bytes > MAX_BYTES_ADJUNTO) return { ok: false, error: `"${a.nombre}" pesa más de 10 MB.` };
    if (!(MIMES_ADJUNTO as readonly string[]).includes(a.mime)) return { ok: false, error: `"${a.nombre}" no es PDF, imagen ni correo (.eml).` };
    const mime = a.mime as MimeAdjunto;
    const path = `${eventoId}/${randomUUID()}-${nombreSaneado(a.nombre, mime)}`;
    const { data, error } = await sb.storage.from(BUCKET_COBRANZA).createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: /not found|Bucket/i.test(error?.message ?? '') ? 'Falta aplicar la migración 033 (bucket cobranza-adjuntos) en esta base.' : `No se pudo preparar la subida: ${error?.message ?? 'sin respuesta'}` };
    subidas.push({ path, url: data.signedUrl, token: data.token, nombre: a.nombre, mime });
  }
  return { ok: true, subidas };
}

export async function confirmarSubidaAdjuntos(eventoId: string, archivos: Array<{ path: string; nombre: string }>, actor: string): Promise<{ ok: true; adjuntos: Array<{ id: string; nombre: string; mime: string; bytes: number }> } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb || !esUuid(eventoId)) return { ok: false, error: 'El evento no existe.' };
  const out: Array<{ id: string; nombre: string; mime: string; bytes: number }> = [];
  for (const a of archivos.slice(0, MAX_ADJUNTOS_EVENTO)) {
    const path = String(a.path ?? '');
    if (!path.startsWith(`${eventoId}/`) || path.includes('..')) return { ok: false, error: 'Ruta de archivo inválida.' };
    const { data, error } = await sb.storage.from(BUCKET_COBRANZA).download(path);
    if (error || !data) return { ok: false, error: 'El archivo no llegó al servidor: volvé a intentarlo.' };
    const buf = Buffer.from(await data.arrayBuffer());
    const mime = tipoRealAdjunto(buf.subarray(0, 512), String(a.nombre ?? ''));
    if (!mime || buf.length === 0 || buf.length > MAX_BYTES_ADJUNTO) { await sb.storage.from(BUCKET_COBRANZA).remove([path]); return { ok: false, error: !mime ? 'El archivo no es PDF, imagen ni correo (.eml): se descartó.' : 'El archivo está vacío o pesa más de 10 MB: se descartó.' }; }
    const { data: row, error: e2 } = await sb.from('cobranza_adjunto').insert({ evento_id: eventoId, path, nombre: nombreSaneado(String(a.nombre ?? ''), mime), mime, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), subido_por: actor }).select('id, nombre, mime, bytes').single();
    if (e2 || !row) { await sb.storage.from(BUCKET_COBRANZA).remove([path]); return { ok: false, error: `No se pudo registrar el adjunto: ${e2?.message ?? 'sin respuesta'}` }; }
    const r = row as { id: string; nombre: string; mime: string; bytes: number };
    out.push({ id: r.id, nombre: r.nombre, mime: r.mime, bytes: Number(r.bytes) });
  }
  return { ok: true, adjuntos: out };
}

/** Subida directa desde el servidor (validadores): sube el buffer y confirma igual que el navegador. */
export async function subirAdjuntoDirecto(eventoId: string, archivo: { nombre: string; mime: string; data: Buffer }, actor: string) {
  const sb = supabase(); if (!sb) return { ok: false as const, error: 'Supabase no está configurado.' };
  const prep = await prepararSubidaAdjuntos(eventoId, [{ nombre: archivo.nombre, bytes: archivo.data.length, mime: archivo.mime }]);
  if (!prep.ok) return prep;
  const { error } = await sb.storage.from(BUCKET_COBRANZA).upload(prep.subidas[0].path, archivo.data, { contentType: archivo.mime, upsert: false });
  if (error) return { ok: false as const, error: `storage: ${error.message}` };
  return confirmarSubidaAdjuntos(eventoId, [{ path: prep.subidas[0].path, nombre: archivo.nombre }], actor);
}

export async function urlFirmadaAdjunto(adjuntoId: string, opts: { descargar?: boolean; segundos?: number } = {}): Promise<{ ok: true; url: string; nombre: string } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb || !esUuid(adjuntoId)) return { ok: false, error: 'El adjunto no existe.' };
  const { data } = await sb.from('cobranza_adjunto').select('path, nombre').eq('id', adjuntoId).maybeSingle();
  if (!data) return { ok: false, error: 'El adjunto no existe.' };
  const a = data as { path: string; nombre: string };
  const { data: s, error } = await sb.storage.from(BUCKET_COBRANZA).createSignedUrl(a.path, Math.min(Math.max(opts.segundos ?? SEGUNDOS_URL_ADJUNTO, 1), SEGUNDOS_URL_ADJUNTO), opts.descargar ? { download: a.nombre } : undefined);
  if (error || !s?.signedUrl) return { ok: false, error: 'No se pudo generar el enlace: probá de nuevo.' };
  return { ok: true, url: s.signedUrl, nombre: a.nombre };
}
