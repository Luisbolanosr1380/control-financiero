// Subida de adjuntos a Airtable vía Content API (uploadAttachment).
// Se usa para adjuntar el PDF de la factura SAT al record principal.

// Field ID del campo 'ADJUNTO ' (con espacio final) en FACTURAS_CLIENTES.
// Se usa el ID en vez del nombre para evitar problemas con el espacio.
export const ADJUNTO_FIELD_ID = 'fldu9i1eWwtdLzpft';

export async function uploadAttachmentPdf(
  recordId: string,
  fieldId: string,
  filename: string,
  data: ArrayBuffer | Uint8Array | Buffer,
): Promise<void> {
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
      contentType: 'application/pdf',
      filename: filename || 'factura.pdf',
      file: base64,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`uploadAttachment ${resp.status}: ${text}`);
  }
}
