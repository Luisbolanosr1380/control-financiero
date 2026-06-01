'use server';

import { revalidatePath } from 'next/cache';
import {
  registrarPagoDeuda,
  type RegistrarPagoInput,
  type RegistrarPagoResult,
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
