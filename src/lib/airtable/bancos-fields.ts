/**
 * F-050 — Field ID nuevo en BANCOS: CUENTA_CONTABLE (link a CUENTAS).
 *
 * Stark debe poblar este campo para cada banco activo antes de poder
 * generar asientos contables de pagos Contado. Si está vacío, la
 * aprobación falla con error claro.
 *
 * El resto del schema de BANCOS está modelado en `src/lib/db/bancos.ts`
 * por nombres (legacy). Este archivo agrega solo los IDs nuevos que F-050
 * necesita acceder por ID.
 */

export const BANCOS_TABLE_ID = 'tblAk53oAnz2XOBfD';

export const BANCOS_FIELDS = {
  // F-050: link a CUENTAS para que el partida 3 del asiento (Cr Banco)
  // sepa qué cuenta contable acreditar al pagar Contado.
  cuenta_contable: 'fldtaOhe4Ht89y2W6',
} as const;

export type BancoFieldKey = keyof typeof BANCOS_FIELDS;
