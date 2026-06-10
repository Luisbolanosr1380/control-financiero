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
} as const;

export type ProveedorFieldKey = keyof typeof PROVEEDORES_FIELDS;
