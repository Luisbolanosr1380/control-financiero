'use server';

/**
 * PAQUETES PREPAGADOS (034) — acciones del servidor. Crear, editar, cerrar y confirmar la retroactiva exigen
 * `gestionar_paquetes` (admin y contador); la vista previa y buscar la factura del anticipo, `ver`.
 * Toda escritura pasa por las RPC de la 034 (src/lib/db/paquetes.ts); nunca se toca un consumo a mano.
 */
import { revalidatePath } from 'next/cache';
import { exigir } from '@/lib/auth/guard';
import {
  buscarFacturaAnticipo, cerrarPaquete, confirmarRetroactivo, crearPaquete, editarPaquete, vistaPreviaPaquete,
  type AplicadoPaquetes, type CrearPaqueteInput, type CrearPaqueteResult, type FacturaAnticipo, type LineaInput, type PaqueteResult, type VistaPreviaLinea,
} from '@/lib/db/paquetes';

const revalidar = (nit?: string) => {
  revalidatePath('/paquetes');
  revalidatePath('/por-facturar');
  revalidatePath('/por-facturar/[grupo]', 'page');
  revalidatePath('/tarifario/paquetes/[id]', 'page');
  if (nit) revalidatePath(`/tarifario/${encodeURIComponent(nit)}`);
};

export async function crearPaqueteAction(input: CrearPaqueteInput): Promise<CrearPaqueteResult> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await crearPaquete(input, email);
  if (r.ok) revalidar(input.nit);
  return r;
}

export async function editarPaqueteAction(id: string, cambios: { nombre?: string; umbralAviso?: number; noFactura?: string | null; notas?: string | null; venceEn?: string | null }): Promise<PaqueteResult> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await editarPaquete(id, cambios, email);
  if (r.ok) revalidar(r.paquete.nit);
  return r;
}

export async function cerrarPaqueteAction(id: string, motivo: string): Promise<PaqueteResult> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await cerrarPaquete(id, motivo, email);
  if (r.ok) revalidar(r.paquete.nit);
  return r;
}

export async function confirmarRetroactivoAction(id: string): Promise<{ ok: true; aplicado: AplicadoPaquetes } | { ok: false; error: string }> {
  const { email } = await exigir('gestionar_paquetes');
  const r = await confirmarRetroactivo(id, email);
  if (r.ok) revalidar();
  return r;
}

export async function vistaPreviaPaqueteAction(nit: string, fechaInicio: string, venceEn: string | null, lineas: LineaInput[]): Promise<VistaPreviaLinea[]> {
  await exigir('ver');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) return [];
  return vistaPreviaPaquete(nit, fechaInicio, venceEn, lineas);
}

export async function buscarFacturaAnticipoAction(numero: string): Promise<FacturaAnticipo | null> {
  await exigir('ver');
  return buscarFacturaAnticipo(numero);
}
