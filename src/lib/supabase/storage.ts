/**
 * FASE 2.5 — Adjuntos en Supabase Storage.
 *
 * Bucket público `adjuntos` (creado por scripts/06_migrar_adjuntos_storage.py).
 * Paths: <tipo>/<record-id-app>/<filename>. Las URLs públicas son estables
 * (no expiran como las de Airtable).
 */

import { supabase } from './client';

export const BUCKET_ADJUNTOS = 'adjuntos';

function sanitizarNombre(nombre: string): string {
  return (nombre || 'archivo')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 120);
}

export async function subirAdjuntoStorage(args: {
  carpeta: 'facturas' | 'facturas-in' | 'boletas' | 'constancias' | 'firmas';
  recordAppId: string;
  filename: string;
  contentType: string;
  data: ArrayBuffer | Uint8Array | Buffer;
}): Promise<{ url: string; nombre: string; path: string }> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const nombre = sanitizarNombre(args.filename);
  const path = `${args.carpeta}/${args.recordAppId}/${Date.now()}-${nombre}`;
  const { error } = await sb.storage.from(BUCKET_ADJUNTOS).upload(path, args.data, {
    contentType: args.contentType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`storage upload: ${error.message}`);
  const { data } = sb.storage.from(BUCKET_ADJUNTOS).getPublicUrl(path);
  return { url: data.publicUrl, nombre, path };
}
