'use server';

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import {
  crearGestionCobro, getGestionesCliente,
  type CanalGestion, type CrearGestionCobroResult, type GestionCobro,
} from '@/lib/db/gestiones-cobro';

export interface RegistrarGestionInput {
  custId: string;
  canal: CanalGestion;
  contactoCliente?: string;
  comentario: string;
  fechaPagoPromesa?: string;
  proximoSeguimiento?: string;
  facturas?: Array<{ facturaId: string; fechaPromesa?: string }>;
}

export async function registrarGestionAction(input: RegistrarGestionInput): Promise<CrearGestionCobroResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  if (!getRolUsuario(email)) return { ok: false, error: 'Usuario no autorizado.' };

  const res = await crearGestionCobro({ ...input, usuario: email });
  if (res.ok) revalidatePath('/facturacion/pendientes');
  return res;
}

export async function getGestionesClienteAction(custId: string): Promise<GestionCobro[]> {
  return getGestionesCliente(custId);
}
