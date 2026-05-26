'use server';

import { revalidatePath } from 'next/cache';
import { anularFactura, type AnularFacturaResult } from '@/lib/db/facturas';

export type AnularResult = AnularFacturaResult;

export async function anularFacturaAction(noFactura: string, motivo?: string): Promise<AnularResult> {
  const result = await anularFactura(noFactura, motivo);
  if (result.ok || result.recordsActualizados > 0) {
    // Revalidar todo lo que se nutre de facturas
    revalidatePath('/facturacion');
    revalidatePath('/facturacion', 'layout');   // alcanza /facturacion/[id]
    revalidatePath('/dashboard');
    revalidatePath('/clientes');
    revalidatePath('/analitica');
  }
  return result;
}
