'use server';

import { getFacturasPagina, type GetFacturasPaginaResult, type FiltroTabFactura } from '@/lib/db/facturas';

export async function cargarMasFacturasAction(
  before: string,
  limit = 50,
  filtro?: FiltroTabFactura,
): Promise<GetFacturasPaginaResult> {
  return await getFacturasPagina({ before, limit, filtro });
}
