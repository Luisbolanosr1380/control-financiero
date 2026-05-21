'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createFactura } from '@/lib/db/facturas';
import { uploadAttachmentPdf, ADJUNTO_FIELD_ID } from '@/lib/db/attachments';

const schema = z.object({
  noFactura: z.string().trim().min(1, 'NO.FACTURA es requerido'),
  custId: z.string().min(1, 'Cliente es requerido'),
  fechaEmision: z.string().min(1, 'Fecha de emisión es requerida'),
  lineas: z.array(z.object({
    centroCostoId: z.string().min(1, 'Centro de costo requerido'),
    total: z.number().positive('Total debe ser mayor a 0'),
    iva: z.number().min(0, 'IVA inválido'),
  })).min(1, 'Se requiere al menos una línea'),
});

export type CrearFacturaResult =
  | { ok: true; noFactura: string; recordsCreados: number; pdfAdjuntado: boolean; aviso?: string }
  | { ok: false; error: string; duplicado?: boolean };

export async function crearFacturaAction(formData: FormData): Promise<CrearFacturaResult> {
  const rawData = formData.get('data');
  if (typeof rawData !== 'string') return { ok: false, error: 'Datos faltantes en el formulario.' };

  let json: unknown;
  try { json = JSON.parse(rawData); } catch { return { ok: false, error: 'Datos del formulario inválidos.' }; }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map(i => i.message).join(' · ') };
  }

  // 1) Crear la factura (filas en Airtable)
  let creada;
  try {
    creada = await createFactura(parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, duplicado: /ya existe/i.test(msg) };
  }
  revalidatePath('/facturacion');

  // 2) Adjuntar PDF (opcional). Si falla, NO se pierde la factura ya creada.
  const pdf = formData.get('pdf');
  if (pdf instanceof File && pdf.size > 0 && creada.recordIdPrincipal) {
    try {
      const buf = await pdf.arrayBuffer();
      await uploadAttachmentPdf(creada.recordIdPrincipal, ADJUNTO_FIELD_ID, pdf.name, buf);
      return { ok: true, noFactura: creada.noFactura, recordsCreados: creada.recordsCreados, pdfAdjuntado: true };
    } catch (err) {
      console.error('Error adjuntando PDF a la factura:', err);
      return {
        ok: true,
        noFactura: creada.noFactura,
        recordsCreados: creada.recordsCreados,
        pdfAdjuntado: false,
        aviso: 'Factura registrada, pero el PDF no se pudo adjuntar (podés reintentar más tarde).',
      };
    }
  }

  return { ok: true, noFactura: creada.noFactura, recordsCreados: creada.recordsCreados, pdfAdjuntado: false };
}
