'use server';

/**
 * F-COBRANZA → CENTRO DE COBROS (033): la bitácora de Pendientes ya registra en el historial nuevo (cobranza_evento);
 * no hay dos formas de registrar. Permiso gestionar_cobranza (admin, contador, cobranza).
 */
import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import { crearGestionCobro, getGestionesCliente, type CanalGestion, type CrearGestionCobroResult, type GestionCobro } from '@/lib/db/gestiones-cobro';
import { getContactos, clienteUuid } from '@/lib/db/cobranza';
import type { ContactoCobro } from '@/lib/db/cobranza';

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
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await crearGestionCobro({ ...input, usuario: permiso.email });
  if (res.ok) { revalidatePath('/facturacion/pendientes'); revalidatePath('/cobranza'); }
  return res;
}

export async function getGestionesClienteAction(custId: string): Promise<GestionCobro[]> {
  await exigir('ver');
  return getGestionesCliente(custId);
}

/** 033: contactos activos del cliente para el formulario rápido de Pendientes. */
export async function getContactosClienteAction(custId: string): Promise<ContactoCobro[]> {
  await exigir('ver');
  const uuid = await clienteUuid(custId);
  return uuid ? getContactos(uuid) : [];
}
