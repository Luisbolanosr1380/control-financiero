// Subida de adjuntos a Airtable vía Content API (uploadAttachment).
// Se usa para:
// - PDF de factura SAT en ADJUNTO de FACTURAS_CLIENTES (createFactura)
// - Constancia de retención (PDF o imagen) en Constancia_Retencion de
//   COBROS_CLIENTES (F-035.1, mismo patrón).

// Field IDs (se usan IDs en vez de nombres para evitar problemas con espacios/acentos).
export const ADJUNTO_FIELD_ID     = 'fldu9i1eWwtdLzpft';  // FACTURAS_CLIENTES.ADJUNTO
export const CONSTANCIA_FIELD_ID  = 'fldFzyXYOGqGYjYLe';  // COBROS_CLIENTES.Constancia_Retencion
export const BOLETA_FIELD_ID      = 'fldmnn1YD8HICzKAg';  // F-047: PLANILLA.Adjunto (boleta PDF por línea)
export const FIRMA_EMPLEADO_FIELD = 'Firma_Digital';      // F-047: EMPLEADOS.Firma_Digital — placeholder por nombre hasta confirmar field ID

// MIME types aceptados — mismo set que usa el flujo de facturas más imágenes
// comunes para las constancias (las contadoras a veces escanean a JPG/PNG).
export const ATTACHMENT_MIME_PDF = 'application/pdf';
export const ATTACHMENT_MIME_ACCEPTED = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;   // 15 MB, mismo que el modal de facturas asume

/**
 * Sube un archivo a Airtable Content API. `contentType` y `filename` los pasa
 * el caller (el frontend ya validó tipo+tamaño). Lanza si el upload falla.
 */
export async function uploadAttachment(
  recordId: string,
  fieldId: string,
  filename: string,
  contentType: string,
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<void> {
  // ═══ FASE 2.5 / FASE 3 — adjuntos SIN flag propio ═══
  // El backend del adjunto es SIEMPRE el de la operación dueña del registro
  // destino: así no puede pasar que la factura se emita en un backend y el
  // PDF se adjunte en otro ("id no encontrado" por backends cruzados).
  const { writeSource } = await import('@/lib/config/data-source');
  const destinos: Record<string, {
    op: 'facturacion' | 'cobros' | 'planilla' | 'gastos';
    carpeta: 'facturas' | 'boletas' | 'constancias' | 'facturas-in';
    tabla: string; colUrl: string; colNombre: string;
  }> = {
    [ADJUNTO_FIELD_ID]:    { op: 'facturacion', carpeta: 'facturas',    tabla: 'facturas_clientes', colUrl: 'adjunto_url',    colNombre: 'adjunto_nombre' },
    [CONSTANCIA_FIELD_ID]: { op: 'cobros',      carpeta: 'constancias', tabla: 'cobros_clientes',   colUrl: 'constancia_url', colNombre: 'constancia_nombre' },
    [BOLETA_FIELD_ID]:     { op: 'planilla',    carpeta: 'boletas',     tabla: 'planilla',          colUrl: 'boleta_url',     colNombre: 'boleta_nombre' },
  };
  const destino = destinos[fieldId];
  if (destino && writeSource(destino.op) === 'supabase') {
    const { subirAdjuntoStorage } = await import('@/lib/supabase/storage');
    const { actualizarPorAppId } = await import('@/lib/supabase/writes');
    const subida = await subirAdjuntoStorage({
      carpeta: destino.carpeta,
      recordAppId: recordId,
      filename: filename || 'archivo',
      contentType: contentType || ATTACHMENT_MIME_PDF,
      data,
    });
    await actualizarPorAppId(destino.tabla, recordId, {
      [destino.colUrl]: subida.url,
      [destino.colNombre]: subida.nombre,
    });
    return;
  }

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!baseId || !apiKey) throw new Error('Airtable no configurado');

  const base64 = Buffer.from(data as Uint8Array).toString('base64');
  const url = `https://content.airtable.com/v0/${baseId}/${recordId}/${fieldId}/uploadAttachment`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contentType: contentType || ATTACHMENT_MIME_PDF,
      filename: filename || 'archivo',
      file: base64,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`uploadAttachment ${resp.status}: ${text}`);
  }
}

/** Wrapper backward-compat: el flujo de facturas SAT siempre sube PDF. */
export async function uploadAttachmentPdf(
  recordId: string,
  fieldId: string,
  filename: string,
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<void> {
  return uploadAttachment(recordId, fieldId, filename || 'factura.pdf', ATTACHMENT_MIME_PDF, data);
}
