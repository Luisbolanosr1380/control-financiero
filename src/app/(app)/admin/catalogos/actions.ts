'use server';

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import {
  crearBanco, crearCentroCosto, crearCuentaContable,
  type CrearBancoInput, type CrearCentroCostoInput, type CrearCuentaContableInput,
} from '@/lib/db/catalogos';

type Resultado = { ok: true; id: string; mensaje: string } | { ok: false; error: string };

async function guardAdmin(): Promise<{ ok: false; error: string } | null> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  if (getRolUsuario(email) !== 'admin') return { ok: false, error: 'Solo admin puede crear catálogos.' };
  return null;
}

function revalidar(): void {
  revalidatePath('/admin/catalogos');
  revalidatePath('/dashboard');
  revalidatePath('/flujo');
}

export async function crearBancoAction(input: CrearBancoInput): Promise<Resultado> {
  const guard = await guardAdmin();
  if (guard) return guard;
  const res = await crearBanco(input);
  if (res.ok) revalidar();
  return res;
}

export async function crearCentroCostoAction(input: CrearCentroCostoInput): Promise<Resultado> {
  const guard = await guardAdmin();
  if (guard) return guard;
  const res = await crearCentroCosto(input);
  if (res.ok) revalidar();
  return res;
}

export async function crearCuentaContableAction(input: CrearCuentaContableInput): Promise<Resultado> {
  const guard = await guardAdmin();
  if (guard) return guard;
  const res = await crearCuentaContable(input);
  if (res.ok) revalidar();
  return res;
}
