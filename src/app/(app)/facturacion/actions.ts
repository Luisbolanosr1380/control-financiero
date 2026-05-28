'use server';

import { getFacturasPagina, type GetFacturasPaginaResult } from '@/lib/db/facturas';

export async function cargarMasFacturasAction(before: string, limit = 50): Promise<GetFacturasPaginaResult> {
  return await getFacturasPagina({ before, limit });
}
