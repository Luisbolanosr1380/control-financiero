'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createFactura } from '@/lib/db/facturas';

const schema = z.object({
  noFactura: z.string().trim().min(1, 'NO.FACTURA es requerido'),
  custId: z.string().min(1, 'Cliente es requerido'),
  fechaEmision: z.string().min(1, 'Fecha de emisión es requerida'),
  lineas: z.array(z.object({
    centroCostoId: z.string().min(1, 'Centro de costo requerido'),
    subtotal: z.number().positive('Subtotal debe ser mayor a 0'),
    iva: z.number().min(0, 'IVA inválido'),
  })).min(1, 'Se requiere al menos una línea'),
});

export type CrearFacturaResult =
  | { ok: true; noFactura: string; recordsCreados: number }
  | { ok: false; error: string; duplicado?: boolean };

export async function crearFacturaAction(input: unknown): Promise<CrearFacturaResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map(i => i.message).join(' · ') };
  }

  try {
    const res = await createFactura(parsed.data);
    revalidatePath('/facturacion');
    return { ok: true, noFactura: res.noFactura, recordsCreados: res.recordsCreados };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, duplicado: /ya existe/i.test(msg) };
  }
}
