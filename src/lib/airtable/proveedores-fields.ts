/**
 * F-050 — Field IDs de la tabla PROVEEDORES.
 *
 * Convención: `activo` se asume checkbox (boolean true por default al crear).
 * Si Stark lo definió como singleSelect, `typecast:true` lo absorberá.
 */

export const PROVEEDORES_TABLE_ID = 'tblAmjEOhRQDqfd7K';

export const PROVEEDORES_FIELDS = {
  nombre:    'fldVOCBdXZfKki95r',
  nit:       'fldlDOWBOJGYsbM8f',
  contacto:  'fld9gMU2nXFPCEcUJ',
  telefono:  'fldsq5EMVHSpmTXNq',
  email:     'fld1vGNCHU1amSrK8',
  direccion: 'fldEBOAADrsLIgoiG',
  activo:    'fldI2I0dSkYvcAhvG',
  gastos:    'fld6MzEphGjKxWDlR',
  // F-052: link a CUENTAS — la cuenta de gasto que el sistema sugerirá
  // por default cuando llegue una factura de este proveedor. Se actualiza
  // automáticamente al aprobar un gasto si Stark cambió la sugerencia
  // (aprendizaje pasivo).
  cuenta_gasto_habitual: 'fldsoUE0ktkKrmRnA',
  // F-052.1: análogo a cuenta_gasto_habitual pero para el centro de costo.
  // Mismo bucle de aprendizaje: se actualiza al aprobar el gasto cuando
  // Stark cambia el CC sugerido.
  centro_costo_habitual: 'fldIsk97VKDG80PCz',
} as const;

export type ProveedorFieldKey = keyof typeof PROVEEDORES_FIELDS;
