/**
 * F-057 — Configuración del módulo de depreciación.
 *
 * Patrón gemelo de intercompany-config.ts (F-056.1): el flag arranca en
 * `false` para que el motor calcule y la UI muestre el preview, pero
 * NADIE escriba a libros hasta que el contador valide:
 *   1. La estructura del asiento (Dr Cuenta_Depreciacion / Cr deprec.
 *      acumulada del catch-all correspondiente).
 *   2. Las tasas fiscales (Tasa_Fiscal_Anual_% de cada activo) según
 *      Ley ISR.
 *
 * Mientras esté en `false`, los call-sites que intenten generar el
 * asiento deben respetar la guarda.
 *
 * ORIGEN del asiento mensual de depreciación. Se usa también para la
 * detección de idempotencia (no depreciar dos veces el mismo período).
 */
export const ORIGEN_ASIENTO_DEPRECIACION = 'DEPRECIACION';

export const GENERAR_ASIENTO_DEPRECIACION = false;
