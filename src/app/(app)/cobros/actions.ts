'use server';

import { getCobrosPagina, type GetCobrosPaginaResult } from '@/lib/db/cobros';

export async function cargarMasCobrosAction(before: string, limit = 50, mes?: string): Promise<GetCobrosPaginaResult> {
  return await getCobrosPagina({ before, limit, mes });
}
