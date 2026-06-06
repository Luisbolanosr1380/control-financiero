'use server';

/**
 * F-049 — Server action que procesa N PDFs de factura en serie.
 *
 * Flujo por PDF:
 *   1. Validar mimetype + magic bytes ("%PDF-").
 *   2. SHA-256 → dedupe por file_hash → si existe, marcar duplicada y skip.
 *   3. Upload PDF a Airtable (campo archivo_adjunto). Fail-soft: si la
 *      subida falla, el record se crea igual con archivo_adjunto vacío y
 *      el motivo se loguea para diagnóstico. F-049.1 lo mejora si recurre.
 *   4. OCR con Gemini → texto plano.
 *   5. parseFactura(texto) → meta (DTE o genérico, decidido por el módulo
 *      parsers).
 *   6. Validar mínimos: total > 0 && fecha_emision !== ''. Si no, error.
 *   7. buildDocKey(meta) → dedupe lógico → si existe, marcar duplicada.
 *   8. Crear record en FACTURAS_IN con typecast=true (auto-crea Sistema /
 *      Factura GT / USD si aparecen por primera vez).
 *
 * Serial, no paralelo: Gemini tiene rate limits suaves y queremos respeto.
 * Volumen esperado típico: 5-15 PDFs por sesión de Stark.
 */

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { airtable } from '@/lib/db/airtable';
import { uploadAttachment, ATTACHMENT_MIME_PDF } from '@/lib/db/attachments';
import { obtenerDateTimeHoyGuatemala } from '@/lib/utils/fechas';
import {
  FACTURAS_IN_TABLE_ID,
  FACTURAS_IN_FIELDS,
} from '@/lib/airtable/facturas-in-fields';
import {
  fileContentHash,
  checkDuplicateByHash,
  checkDuplicateByDocKey,
} from '@/lib/facturas/dedupe';
import { extraerTextoDeFactura } from '@/lib/facturas/ocr-gemini';
import { parseFactura, buildDocKey } from '@/lib/facturas/parsers';

export interface ResultadoProcesamiento {
  creadas: Array<{ nombreArchivo: string; facturaInId: string; total: number; proveedor: string }>;
  duplicadas: Array<{ nombreArchivo: string; motivo: 'hash' | 'doc_key'; existingId?: string }>;
  errores: Array<{ nombreArchivo: string; motivo: string }>;
}

const MAX_OCR_CHARS_GUARDAR = 90_000;

function esPdfPorMagicBytes(buffer: Buffer): boolean {
  // PDFs siempre arrancan con "%PDF-" (25 50 44 46 2D).
  if (buffer.length < 5) return false;
  return (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}

export async function procesarFacturasAction(formData: FormData): Promise<ResultadoProcesamiento> {
  const resultado: ResultadoProcesamiento = { creadas: [], duplicadas: [], errores: [] };

  const archivos = formData.getAll('archivos');
  if (archivos.length === 0) {
    return { ...resultado, errores: [{ nombreArchivo: '—', motivo: 'No se recibieron archivos.' }] };
  }
  if (!airtable) {
    return { ...resultado, errores: [{ nombreArchivo: '—', motivo: 'Airtable no está configurado en el server.' }] };
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';

  for (const f of archivos) {
    if (!(f instanceof File)) continue;
    const nombreArchivo = f.name || 'sin-nombre.pdf';

    // 1. Validación mimetype + magic bytes.
    if (f.type !== 'application/pdf') {
      resultado.errores.push({ nombreArchivo, motivo: `Tipo no soportado (${f.type || 'desconocido'}). Solo PDF.` });
      continue;
    }
    const buf = Buffer.from(await f.arrayBuffer());
    if (!esPdfPorMagicBytes(buf)) {
      resultado.errores.push({ nombreArchivo, motivo: 'El archivo no es un PDF real (magic bytes inválidos).' });
      continue;
    }

    // 2. Hash + dedupe por hash.
    const hash = fileContentHash(buf);
    const dupHash = await checkDuplicateByHash(hash);
    if (dupHash.existe) {
      resultado.duplicadas.push({ nombreArchivo, motivo: 'hash', existingId: dupHash.recordId });
      continue;
    }

    // 3. OCR con Gemini.
    const ocr = await extraerTextoDeFactura(buf);
    if (!ocr.ok || !ocr.texto) {
      resultado.errores.push({ nombreArchivo, motivo: `OCR falló: ${ocr.error ?? 'sin texto'}` });
      continue;
    }

    // 4. Parse (DTE o genérico). El parser puede throw — capturamos.
    let meta;
    try {
      meta = parseFactura(ocr.texto);
    } catch (err) {
      resultado.errores.push({ nombreArchivo, motivo: err instanceof Error ? err.message : String(err) });
      continue;
    }

    // 5. Validar campos mínimos.
    if (!(meta.total > 0) || !meta.fecha_emision) {
      resultado.errores.push({
        nombreArchivo,
        motivo: 'Campos mínimos no detectados (total/fecha). Revisar manualmente o subir mejor calidad de PDF.',
      });
      continue;
    }

    // 6. Dedupe por doc_key.
    const docKey = buildDocKey(meta);
    const dupKey = await checkDuplicateByDocKey(docKey);
    if (dupKey.existe) {
      resultado.duplicadas.push({ nombreArchivo, motivo: 'doc_key', existingId: dupKey.recordId });
      continue;
    }

    // 7. Crear record en FACTURAS_IN. Primero sin adjunto; el upload va
    // después para que un fallo de Content API no impida persistir lo que
    // ya teníamos extraído (texto OCR + campos parseados).
    type AField = string | number | boolean | null | undefined;
    const fields: Record<string, AField> = {
      [FACTURAS_IN_FIELDS.file_hash]:        hash,
      [FACTURAS_IN_FIELDS.doc_key]:          docKey,
      [FACTURAS_IN_FIELDS.proveedor_nombre]: meta.proveedor_nombre,
      [FACTURAS_IN_FIELDS.proveedor_nit]:    meta.proveedor_nit,
      [FACTURAS_IN_FIELDS.serie]:            meta.serie,
      [FACTURAS_IN_FIELDS.numero]:           meta.numero,
      [FACTURAS_IN_FIELDS.fecha_emision]:    meta.fecha_emision,
      [FACTURAS_IN_FIELDS.moneda]:           meta.moneda,
      [FACTURAS_IN_FIELDS.subtotal]:         meta.subtotal,
      [FACTURAS_IN_FIELDS.iva]:              meta.iva,
      [FACTURAS_IN_FIELDS.total]:            meta.total,
      [FACTURAS_IN_FIELDS.pais]:             meta.pais,
      [FACTURAS_IN_FIELDS.tipo_doc]:         meta.tipo_doc,
      [FACTURAS_IN_FIELDS.estatus]:          'Pendiente',
      [FACTURAS_IN_FIELDS.fuente]:           'Sistema',
      [FACTURAS_IN_FIELDS.texto_ocr]:        ocr.texto.slice(0, MAX_OCR_CHARS_GUARDAR),
      [FACTURAS_IN_FIELDS.subido_por]:       email,
      [FACTURAS_IN_FIELDS.fecha_subida]:     obtenerDateTimeHoyGuatemala(),
    };

    let recordId: string;
    try {
      // airtable@0.12.2 typing es laxo con la sobrecarga array+opts; el
      // runtime acepta el segundo arg { typecast: true } perfectamente.
      // Esto auto-crea opciones de singleSelect que aún no existen
      // (Sistema, Factura GT, USD, etc.).
      const created = (await (airtable(FACTURAS_IN_TABLE_ID).create as unknown as (
        records: Array<{ fields: Record<string, AField> }>,
        opts: { typecast: boolean },
      ) => Promise<Array<{ id: string }>>)([{ fields }], { typecast: true }));
      recordId = created[0].id;
    } catch (err) {
      resultado.errores.push({
        nombreArchivo,
        motivo: `Error al crear record en Airtable: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // 8. Subir PDF al campo archivo_adjunto (fail-soft).
    try {
      await uploadAttachment(recordId, FACTURAS_IN_FIELDS.archivo_adjunto, nombreArchivo, ATTACHMENT_MIME_PDF, buf);
    } catch (err) {
      // Record ya existe — solo perdemos el adjunto. Log y seguimos.
      console.warn(`F-049: adjunto no persistido para ${nombreArchivo}:`, err instanceof Error ? err.message : err);
    }

    resultado.creadas.push({
      nombreArchivo,
      facturaInId: recordId,
      total: meta.total,
      proveedor: meta.proveedor_nombre || meta.proveedor_nit || '—',
    });
  }

  revalidatePath('/gastos');
  return resultado;
}
