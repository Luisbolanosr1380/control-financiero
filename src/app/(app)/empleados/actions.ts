'use server';

import { revalidatePath } from 'next/cache';
import {
  crearEmpleado, editarEmpleado, darDeBajaEmpleado,
  crearDeudaSalarioPendiente,
  type CrearEmpleadoInput, type EditarEmpleadoInput, type EmpleadoMutationResult,
  type CrearDeudaSalarialResult, type StatusEmpleado,
} from '@/lib/db/empleados';

function revalidarTodo(): void {
  revalidatePath('/empleados');
  revalidatePath('/empleados', 'layout');
  revalidatePath('/deudas');
  revalidatePath('/dashboard');
}

export async function crearEmpleadoAction(input: CrearEmpleadoInput): Promise<EmpleadoMutationResult> {
  const result = await crearEmpleado(input);
  if (result.ok) revalidarTodo();
  return result;
}

export async function editarEmpleadoAction(id: string, input: EditarEmpleadoInput): Promise<EmpleadoMutationResult> {
  const result = await editarEmpleado(id, input);
  if (result.ok) revalidarTodo();
  return result;
}

export async function darDeBajaEmpleadoAction(
  id: string, fechaSalida: string, motivoSalida: string, nuevoStatus: StatusEmpleado = 'INACTIVO',
): Promise<EmpleadoMutationResult> {
  const result = await darDeBajaEmpleado(id, fechaSalida, motivoSalida, nuevoStatus);
  if (result.ok) revalidarTodo();
  return result;
}

export async function crearDeudaSalarialAction(
  empleadoId: string, monto: number, fechaQuincena: string, notas?: string,
): Promise<CrearDeudaSalarialResult> {
  const result = await crearDeudaSalarioPendiente(empleadoId, monto, fechaQuincena, notas);
  if (result.ok) revalidarTodo();
  return result;
}
