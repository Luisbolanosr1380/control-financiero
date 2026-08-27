'use server';

import { getCobrosPagina, getCobrosCompletos, type GetCobrosPaginaResult, type CobroListado } from '@/lib/db/cobros';

export async function cargarMasCobrosAction(before: string, limit = 50, mes?: string): Promise<GetCobrosPaginaResult> {
  return await getCobrosPagina({ before, limit, mes });
}

/**
 * F-EXPORT-CONFIG: dataset COMPLETO de cobros consolidados para el export
 * configurable (getCobrosCompletos usa sbCobrosRecords → fetchAll paginado,
 * sin el corte de 1000 de PostgREST). El filtro de período corre en el
 * cliente sobre este dataset — cambio de rango instantáneo, como en el
 * reporte de facturación.
 */
export async function getCobrosParaExportAction(): Promise<CobroListado[]> {
  return await getCobrosCompletos({});
}
