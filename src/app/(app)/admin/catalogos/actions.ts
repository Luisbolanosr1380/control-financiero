'use server';

import { revalidatePath } from 'next/cache';
import { autorizar } from '@/lib/auth/guard';
import {
  crearBanco, crearCentroCosto, crearCuentaContable,
  type CrearBancoInput, type CrearCentroCostoInput, type CrearCuentaContableInput,
} from '@/lib/db/catalogos';

type Resultado = { ok: true; id: string; mensaje: string } | { ok: false; error: string };

function revalidar(): void {
  revalidatePath('/admin/catalogos');
  revalidatePath('/dashboard');
  revalidatePath('/flujo');
}

export async function crearBancoAction(input: CrearBancoInput): Promise<Resultado> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await crearBanco(input);
  if (res.ok) revalidar();
  return res;
}

export async function crearCentroCostoAction(input: CrearCentroCostoInput): Promise<Resultado> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await crearCentroCosto(input);
  if (res.ok) revalidar();
  return res;
}

export async function crearCuentaContableAction(input: CrearCuentaContableInput): Promise<Resultado> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await crearCuentaContable(input);
  if (res.ok) revalidar();
  return res;
}
