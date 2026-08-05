'use server';

import { revalidatePath } from 'next/cache';
import { crearCliente, type CrearClienteInput, type CrearClienteResult } from '@/lib/db/clientes';

export async function crearClienteAction(input: CrearClienteInput): Promise<CrearClienteResult> {
  const result = await crearCliente(input);
  if (result.ok) {
    revalidatePath('/clientes', 'layout');       // lista + /clientes/[id]
    revalidatePath('/facturacion/nueva');        // el picker debe verlo de inmediato
    revalidatePath('/dashboard');
  }
  return result;
}
