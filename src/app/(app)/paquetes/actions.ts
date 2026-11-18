'use server';

/**
 * PAQUETES PREPAGADOS (034) — acciones del servidor. Crear, editar, cerrar y confirmar la retroactiva exigen
 * `gestionar_paquetes` (admin y contador); la vista previa y buscar la factura del anticipo, `ver`.
 * Toda escritura pasa por las RPC de la 034 (src/lib/db/paquetes.ts); nunca se toca un consumo a mano.
 */
import { revalidatePath } from 'next/cache';
import { exigir } from '@/lib/auth/guard';
import {
  buscarClientesParaPaquete, buscarFacturaAnticipo, cerrarPaquete, confirmarRetroactivo, crearPaquete, editarPaquete, vistaPreviaPaquete,
  type AplicadoPaquetes, type CambiosPaquete, type ClientePaquete, type CrearPaqueteInput, type CrearPaqueteResult, type FacturaAnticipo, type LineaInput, type PaqueteResult, type VistaPreviaLinea,
} from '@/lib/db/paquetes';
import { nitsDe } from '@/lib/paquetes/paquete';

/** 036: un paquete compartido se ve en el tarifario y en Por facturar de TODOS sus NIT. */
const revalidar = (nit?: string | readonly string[]) => {
  revalidatePath('/paquetes');
  revalidatePath('/por-facturar');
  revalidatePath('/por-facturar/[grupo]', 'page');
  revalidatePath('/tarifario/paquetes/[id]', 'page');
  for (const k of typeof nit === 'string' ? [nit] : nit ?? []) revalidatePath(`/tarifario/${encodeURIComponent(k)}`);
};

export async function crearPaqueteAction(input: CrearPaqueteInput): Promise<CrearPaqueteResult> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await crearPaquete(input, email);
  if (r.ok) revalidar([input.nit, ...(input.nitsAdicionales ?? [])]);
  return r;
}

export async function editarPaqueteAction(id: string, cambios: CambiosPaquete): Promise<PaqueteResult> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await editarPaquete(id, cambios, email);
  if (r.ok) revalidar(nitsDe(r.paquete));
  return r;
}

export async function cerrarPaqueteAction(id: string, motivo: string): Promise<PaqueteResult> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await cerrarPaquete(id, motivo, email);
  if (r.ok) revalidar(nitsDe(r.paquete));
  return r;
}

export async function confirmarRetroactivoAction(id: string): Promise<{ ok: true; aplicado: AplicadoPaquetes } | { ok: false; error: string }> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await confirmarRetroactivo(id, email);
  if (r.ok) revalidar();
  return r;
}

/** `nits`: el titular y los adicionales (036). */
export async function vistaPreviaPaqueteAction(nits: string | string[], fechaInicio: string, venceEn: string | null, lineas: LineaInput[]): Promise<VistaPreviaLinea[]> {
  await exigir('ver');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) return [];
  return vistaPreviaPaquete(nits, fechaInicio, venceEn, lineas);
}

export async function buscarFacturaAnticipoAction(numero: string): Promise<FacturaAnticipo | null> {
  await exigir('ver');
  return buscarFacturaAnticipo(numero);
}

/** 036 · «También lo usan»: clientes por nombre o NIT (sin los que ya están en el paquete). */
export async function buscarClientesPaqueteAction(consulta: string, excluirNits: string[] = []): Promise<ClientePaquete[]> {
  await exigir('ver');
  return buscarClientesParaPaquete(consulta, excluirNits);
}
