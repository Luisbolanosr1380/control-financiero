/**
 * F-056.1 — Configuración del módulo intercompany.
 *
 * Dos perillas globales. Se editan acá (constante) hasta que F-058 mueva
 * la config a una tabla CONTROL_CONFIG o equivalente. Centralizadas para
 * no buscar magic numbers regados por el código.
 */

/**
 * Margen de management fee aplicado al cobrar la factura intercompany.
 *
 * 0 = reembolso al costo (estado actual, mientras la empresa crece).
 * Subirá a ~0.05 (5%) cuando haya equilibrio operativo.
 *
 * El motor de proyección lee este valor por defecto, pero acepta un
 * override explícito (para probar escenarios sin tocar la constante).
 */
export const MARGEN_INTERCOMPANY_PCT = 0;

/**
 * Flag de seguridad: con `false`, el motor calcula y la UI muestra el
 * preview del asiento de recuperación, pero NO se escribe nada a
 * Airtable. Se prende a `true` SOLO después de que el contador valide
 * la estructura del asiento (Dr Banco / Cr CxC [+ Cr Ingreso si margen]).
 *
 * Mientras esté en `false`, los call-sites que intenten generar el
 * asiento deben respetar la guarda — el motor en sí no escribe, así
 * que la guarda vive en el caller real (cuando exista).
 */
export const GENERAR_ASIENTO_INTERCOMPANY = false;
