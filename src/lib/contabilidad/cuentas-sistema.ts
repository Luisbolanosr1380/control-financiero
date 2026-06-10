/**
 * F-050 — Cuentas críticas del plan de cuentas referenciadas por código.
 *
 * Verificadas via MCP el 6 jun 2026. Los recordIds están hardcoded porque
 * son cuentas estructurales del sistema contable — si Stark las renombra
 * el código sigue funcionando (referencia por ID, no por nombre). Si las
 * borra, las inserciones de PARTIDAS van a fallar con error claro de
 * Airtable.
 *
 * NO hardcodear otras cuentas (gastos, ingresos, etc.). Esas se eligen en
 * runtime desde la tabla CUENTAS — el modal de revisión de F-050 PARTE E
 * tiene un selector que filtra por TIPO_ESTADO ⊃ "ER" y NATURALEZA_ER =
 * "Deudora" (cuentas de gasto).
 */

export const CUENTAS_SISTEMA = {
  IVA_CREDITO_FISCAL: {
    recordId: 'reccLALKAj3z5A83J',
    codigo: '1-1-4',
    nombre: 'IVA Crédito Fiscal',
  },
  CXP_PROVEEDORES_NACIONALES: {
    recordId: 'recJpO8Twkt0c72Z4',
    codigo: '2-1-1-1',
    nombre: 'Proveedores Nacionales',
  },
  CXP_PROVEEDORES_INTERNACIONALES: {
    recordId: 'recTwWT3stv3YUJPT',
    codigo: '2-1-1-2',
    nombre: 'Proveedores Internacionales',
  },
} as const;

export const CUENTAS_TABLE_ID = 'tblBmZ6JpLqzCcEXn';   // F-050: pre-confirmar via MCP si el ID cambió.

/**
 * F-050 STUB — field IDs de CUENTAS pendientes de confirmar.
 * Las consultas que filtran cuentas de gasto en PARTE E necesitan estos IDs.
 * Hasta tenerlos confirmados, el selector de cuenta contable del modal
 * funciona con un fetch ALL + filtro en memoria sobre los nombres de campo
 * legacy (`Codigo`, `Nombre`, `TIPO_ESTADO`, `NATURALEZA_ER`). Cuando Stark
 * pase los IDs reales, se mueve a returnFieldsByFieldId aquí.
 */
export const CUENTAS_FIELDS_TODO = {
  codigo:         'TODO_codigo',
  nombre:         'TODO_nombre',
  tipo_estado:    'TODO_tipo_estado',   // multipleSelects ⊃ "ER" para cuentas del Estado de Resultados
  naturaleza_er:  'TODO_naturaleza_er', // singleSelect "Deudora" para cuentas de gasto
} as const;
