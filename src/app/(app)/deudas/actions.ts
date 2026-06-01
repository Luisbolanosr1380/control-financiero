'use server';

import { revalidatePath } from 'next/cache';
import {
  crearDeuda,
  editarDeuda,
  type CrearDeudaInput,
  type CrearDeudaResult,
  type EditarDeudaInput,
  type EditarDeudaResult,
} from '@/lib/db/deudas';
import {
  crearAcreedor,
  type CrearAcreedorInput,
  type CrearAcreedorResult,
} from '@/lib/db/acreedores';

function revalidarTodo(): void {
  revalidatePath('/deudas');
  revalidatePath('/deudas', 'layout');     // alcanza /deudas/[id]
  revalidatePath('/acreedores', 'layout'); // alcanza /acreedores/[id]
  revalidatePath('/dashboard');
  revalidatePath('/pagos-deudas');
}

export async function crearDeudaAction(input: CrearDeudaInput): Promise<CrearDeudaResult> {
  const result = await crearDeuda(input);
  if (result.ok) revalidarTodo();
  return result;
}

export async function editarDeudaAction(deudaId: string, input: EditarDeudaInput): Promise<EditarDeudaResult> {
  const result = await editarDeuda(deudaId, input);
  if (result.ok) revalidarTodo();
  return result;
}

export async function crearAcreedorAction(input: CrearAcreedorInput): Promise<CrearAcreedorResult> {
  const result = await crearAcreedor(input);
  if (result.ok) revalidarTodo();
  return result;
}
