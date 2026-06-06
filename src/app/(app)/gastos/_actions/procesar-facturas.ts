'use server';

/**
 * F-049.2 — Server action que procesa N PDFs de factura en serie.
 *
 * Flujo por PDF:
 *   1. Validar mimetype + magic bytes ("%PDF-").
 *   2. SHA-256 → dedupe por file_hash.
 *   3. Gemini structured (gemini-extractor): texto OCR + datos estructurados
 *      + confianza + notas. Reemplaza el flujo previo OCR-plain → regex.
 *   4. Sanity checks (sanity.ts): 6 reglas duras. Si falla, NO crear record.
 *   5. Validación cruzada con parser regex (validacion-cruzada.ts):
 *      compara 5 campos críticos. NO bloquea — alimenta
 *      datos_normalizados_ok para que F-050 sepa qué auto-aprobar.
 *   6. buildDocKey(meta) → dedupe lógico por doc_key.
 *   7. Crear record en FACTURAS_IN con typecast=true (auto-crea opciones
 *      singleSelect nuevas).
 *   8. Upload PDF (fail-soft).
 *
 * Cambios vs F-049 PARTE E:
 *   - El parser regex YA NO es la fuente primaria; ahora valida solamente.
 *   - El paso 5 (validación de mínimos) lo absorbió `validarSanidad`, que
 *     da motivos legibles en lugar de un genérico.
 *   - Se persisten confianza_extraccion + datos_normalizados (JSON con
 *     metadata de extracción) + datos_normalizados_ok (boolean).
 *
 * Serial, no paralelo: Gemini tiene rate limits suaves y queremos respeto.
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
import { extraerFacturaConGemini } from '@/lib/facturas/gemini-extractor';
import { validarSanidad } from '@/lib/facturas/sanity';
import { validarConRegex, todosLosMatches } from '@/lib/facturas/validacion-cruzada';
import { buildDocKey } from '@/lib/facturas/parsers';

export interface ResultadoProcesamiento {
  creadas: Array<{
    nombreArchivo: string;
    facturaInId: string;
    total: number;
    proveedor: string;
    confianza: number;
    normalizado_ok: boolean;
  }>;
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

    // 1. mimetype + magic bytes.
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

    // 3. Extracción con Gemini structured.
    const extraccion = await extraerFacturaConGemini(buf);
    if (!extraccion.ok || !extraccion.extraida) {
      resultado.errores.push({ nombreArchivo, motivo: `Extracción Gemini falló: ${extraccion.error ?? 'sin datos'}` });
      continue;
    }
    const extraida = extraccion.extraida;

    // 4. Sanity checks — bloqueantes.
    const sanity = validarSanidad(extraida);
    if (!sanity.ok) {
      resultado.errores.push({ nombreArchivo, motivo: `Sanity check falló: ${sanity.motivo}` });
      continue;
    }

    // 5. Validación cruzada con parser regex — no bloqueante.
    const validacion = validarConRegex(extraida);
    const normalizado_ok = extraida.confianza >= 0.8 && todosLosMatches(validacion);

    // 6. dedupe lógico por doc_key.
    const docKey = buildDocKey({
      proveedor_nit: extraida.datos.proveedor_nit,
      serie: extraida.datos.serie,
      numero: extraida.datos.numero,
      fecha_emision: extraida.datos.fecha_emision,
      total: extraida.datos.total,
      proveedor_nombre: extraida.datos.proveedor_nombre,
    });
    const dupKey = await checkDuplicateByDocKey(docKey);
    if (dupKey.existe) {
      resultado.duplicadas.push({ nombreArchivo, motivo: 'doc_key', existingId: dupKey.recordId });
      continue;
    }

    // 7. Crear record en FACTURAS_IN.
    const datosNormalizadosBlob = JSON.stringify({
      confianza: extraida.confianza,
      notas: extraida.notas ?? '',
      validacion_cruzada: validacion,
      extraido_con: 'gemini-2.5-flash-structured',
      tokens_input: extraccion.tokensInput,
      tokens_output: extraccion.tokensOutput,
    });

    type AField = string | number | boolean | null | undefined;
    const fields: Record<string, AField> = {
      [FACTURAS_IN_FIELDS.file_hash]:             hash,
      [FACTURAS_IN_FIELDS.doc_key]:               docKey,
      [FACTURAS_IN_FIELDS.proveedor_nombre]:      extraida.datos.proveedor_nombre,
      [FACTURAS_IN_FIELDS.proveedor_nit]:         extraida.datos.proveedor_nit,
      [FACTURAS_IN_FIELDS.serie]:                 extraida.datos.serie,
      [FACTURAS_IN_FIELDS.numero]:                extraida.datos.numero,
      [FACTURAS_IN_FIELDS.fecha_emision]:         extraida.datos.fecha_emision,
      [FACTURAS_IN_FIELDS.moneda]:                extraida.datos.moneda,
      [FACTURAS_IN_FIELDS.subtotal]:              extraida.datos.subtotal,
      [FACTURAS_IN_FIELDS.iva]:                   extraida.datos.iva,
      [FACTURAS_IN_FIELDS.total]:                 extraida.datos.total,
      [FACTURAS_IN_FIELDS.pais]:                  'GT',
      [FACTURAS_IN_FIELDS.tipo_doc]:              extraida.datos.tipo_doc,
      [FACTURAS_IN_FIELDS.estatus]:               'Pendiente',
      [FACTURAS_IN_FIELDS.fuente]:                'Sistema',
      [FACTURAS_IN_FIELDS.texto_ocr]:             extraida.texto_ocr_completo.slice(0, MAX_OCR_CHARS_GUARDAR),
      [FACTURAS_IN_FIELDS.subido_por]:            email,
      [FACTURAS_IN_FIELDS.fecha_subida]:          obtenerDateTimeHoyGuatemala(),
      [FACTURAS_IN_FIELDS.confianza_extraccion]:  extraida.confianza,
      [FACTURAS_IN_FIELDS.datos_normalizados]:    datosNormalizadosBlob,
      [FACTURAS_IN_FIELDS.datos_normalizados_ok]: normalizado_ok,
    };

    let recordId: string;
    try {
      // airtable@0.12.2 typing es laxo con la sobrecarga array+opts.
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
      console.warn(`F-049.2: adjunto no persistido para ${nombreArchivo}:`, err instanceof Error ? err.message : err);
    }

    resultado.creadas.push({
      nombreArchivo,
      facturaInId: recordId,
      total: extraida.datos.total,
      proveedor: extraida.datos.proveedor_nombre || extraida.datos.proveedor_nit || '—',
      confianza: extraida.confianza,
      normalizado_ok,
    });
  }

  revalidatePath('/gastos');
  return resultado;
}
