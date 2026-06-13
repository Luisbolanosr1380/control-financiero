'use server';

/**
 * F-052.1 — Server action delgada que llama al motor de sugerencia de
 * centro de costo. El motor (src/lib/gastos/services/sugerir-centro-costo.ts)
 * hace 1-3 lookups locales antes de decidir si llama a Gemini.
 */

import {
  sugerirCentroCosto,
  type SugerenciaCentroCosto,
  type SugerirCentroCostoInput,
} from '@/lib/gastos/services/sugerir-centro-costo';

export type {
  SugerenciaCentroCosto,
  SugerirCentroCostoInput,
} from '@/lib/gastos/services/sugerir-centro-costo';

export async function sugerirCentroCostoAction(input: SugerirCentroCostoInput): Promise<SugerenciaCentroCosto> {
  return await sugerirCentroCosto(input);
}
