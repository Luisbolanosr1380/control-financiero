'use server';

import { getFacturasPagina, type GetFacturasPaginaResult, type FiltroTabFactura } from '@/lib/db/facturas';

export async function cargarMasFacturasAction(
  before: string,
  limit = 50,
  filtro?: FiltroTabFactura,
  mes?: string,   // F-BF-002a: respeta el selector de mes activo.
): Promise<GetFacturasPaginaResult> {
  return await getFacturasPagina({ before, limit, filtro, mes });
}
