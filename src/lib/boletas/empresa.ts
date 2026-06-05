/**
 * F-047 — Datos de la empresa para boletas de pago.
 *
 * Hardcoded en código por ahora. Si Stark quiere editarlos sin redeploy, se
 * pueden mover a Airtable (tabla CONFIG_EMPRESA con una sola fila); cambio
 * acotado al campo que lo lea.
 */

export const EMPRESA = {
  razonSocial: 'Golden Talent Guatemala, S.A.',
  nit: '8439027-3',
  direccion: 'Ciudad de Guatemala, Guatemala C.A.',
  textoLegal:
    'Este documento sirve como comprobante de pago de salario por el período indicado. ' +
    'El empleado declara recibir el monto neto descrito en concepto de salario y prestaciones devengadas. ' +
    'La firma del empleado confirma la recepción del monto.',
} as const;
