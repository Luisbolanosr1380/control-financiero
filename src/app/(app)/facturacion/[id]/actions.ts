'use server';

import { revalidatePath } from 'next/cache';
import { anularFactura, type AnularFacturaResult } from '@/lib/db/facturas';
import { registrarCobro, type RegistrarCobroInput, type RegistrarCobroResult } from '@/lib/db/cobros';

export type AnularResult = AnularFacturaResult;
export type CobroResult = RegistrarCobroResult;

function revalidarTodo() {
  revalidatePath('/facturacion');
  revalidatePath('/facturacion', 'layout');   // alcanza /facturacion/[id]
  revalidatePath('/dashboard');
  revalidatePath('/clientes');
  revalidatePath('/analitica');
  revalidatePath('/cobros');
  revalidatePath('/cobros/identificar');
}

export async function anularFacturaAction(noFactura: string, motivo?: string): Promise<AnularResult> {
  const result = await anularFactura(noFactura, motivo);
  if (result.ok || result.recordsActualizados > 0) revalidarTodo();
  return result;
}

export async function registrarCobroAction(input: RegistrarCobroInput): Promise<CobroResult> {
  const result = await registrarCobro(input);
  if (result.ok || result.cobrosCreados > 0) revalidarTodo();
  return result;
}
