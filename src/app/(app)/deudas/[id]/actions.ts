'use server';

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import {
  registrarPagoDeuda, anularPagoDeuda,
  type RegistrarPagoInput,
  type RegistrarPagoResult,
  type AnularPagoResult,
  getCuentasBancoParaPago,
} from '@/lib/db/pagos-deudas';

function revalidarTodo(): void {
  revalidatePath('/deudas');
  revalidatePath('/deudas', 'layout');     // alcanza /deudas/[id]
  revalidatePath('/dashboard');
  revalidatePath('/pagos-deudas');
  revalidatePath('/acreedores', 'layout'); // alcanza /acreedores/[id]
}

export async function registrarPagoDeudaAction(input: RegistrarPagoInput): Promise<RegistrarPagoResult> {
  const result = await registrarPagoDeuda(input);
  if (result.ok) revalidarTodo();
  return result;
}

export async function getCuentasBancoAction(): Promise<string[]> {
  return getCuentasBancoParaPago();
}

/* F-036: anular un pago a deuda. */
export async function anularPagoDeudaAction(pagoId: string, motivo: string): Promise<AnularPagoResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';
  const result = await anularPagoDeuda(pagoId, motivo, email);
  if (result.ok) revalidarTodo();
  return result;
}
