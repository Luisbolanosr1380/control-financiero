'use server';

/**
 * F-052 — Server action delgada que llama al motor de sugerencia.
 *
 * El motor (src/lib/gastos/services/sugerir-cuenta-gasto.ts) hace 1-3
 * lookups locales antes de decidir si llama a Gemini. Esta action es
 * solo un wrapper para exponer la función al modal del browser.
 */

import {
  sugerirCuentaGasto,
  type SugerenciaCuenta,
  type SugerirCuentaInput,
} from '@/lib/gastos/services/sugerir-cuenta-gasto';

export type { SugerenciaCuenta, SugerirCuentaInput } from '@/lib/gastos/services/sugerir-cuenta-gasto';

export async function sugerirCuentaGastoAction(input: SugerirCuentaInput): Promise<SugerenciaCuenta> {
  return await sugerirCuentaGasto(input);
}
