/**
 * F-047 — Datos de la empresa para boletas de pago.
 *
 * MULTI-EMPRESA 1-D: ahora se leen de la config central por deploy
 * (src/lib/config/empresa.ts, env vars EMPRESA_*). Los defaults de la
 * config son los valores históricos de Golden — sin env vars, las
 * boletas salen idénticas a siempre.
 */

import { empresaConfig } from '../config/empresa';

const TEXTO_LEGAL =
  'Este documento sirve como comprobante de pago de salario por el período indicado. ' +
  'El empleado declara recibir el monto neto descrito en concepto de salario y prestaciones devengadas. ' +
  'La firma del empleado confirma la recepción del monto.';

export const EMPRESA = {
  get razonSocial() { return empresaConfig().nombreLegal; },
  get nit()         { return empresaConfig().nit; },
  get direccion()   { return empresaConfig().direccion; },
  textoLegal: TEXTO_LEGAL,
};
