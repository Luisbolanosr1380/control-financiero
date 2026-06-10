'use server';

/**
 * F-050 — Helper de UI: buscar proveedor por NIT.
 *
 * Llamada desde el modal de revisión para resolver el estado del bloque
 * "Proveedor" (existente vs crear nuevo) mientras el usuario tipea o
 * abre la factura. Lectura ligera, sin side-effects.
 */

import { buscarProveedorPorNit } from '@/lib/gastos/services/buscar-o-crear-proveedor';

export async function buscarProveedorPorNitAction(nit: string) {
  return buscarProveedorPorNit(nit);
}
