'use server';

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
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
  const permiso = await autorizar('registrar_cobro');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await crearGestionCobro({ ...input, usuario: permiso.email });
  if (res.ok) revalidatePath('/facturacion/pendientes');
  return res;
}

export async function getGestionesClienteAction(custId: string): Promise<GestionCobro[]> {
  await exigir('ver');
  return getGestionesCliente(custId);
}
