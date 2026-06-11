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
 * tiene un selector que filtra cuentas de gasto por código (5- o 6-) y
 * activo=TRUE().
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

export const CUENTAS_TABLE_ID = 'tblP2yysprsDBIjx5';

/**
 * F-050 — Field IDs reales de CUENTAS confirmados via MCP.
 * Acceso por field ID (returnFieldsByFieldId: true) para ser inmune a
 * renames en Airtable.
 *
 * Nota: el field 'activo' en Airtable se llama literalmente "ACTIVO "
 * (con espacio al final). Acá no importa porque referenciamos por ID,
 * pero queda documentado para evitar confusión si alguien debuggea por
 * nombre en la UI de Airtable.
 *
 * Los campos TIPO_ESTADO y NATURALEZA_ER del brief original fueron
 * descartados: están vacíos en los 232 records de CUENTAS, así que el
 * filtro de cuentas de gasto se hace por prefijo de codigo_path (5- / 6-).
 */
export const CUENTAS_FIELDS = {
  codigo_path: 'flda7PNsXwgb6RRU9',
  nombre:      'fldB5n2COhwEnCCAO',
  nivel:       'fldRM0TRZXa7w25h6',
  activo:      'fldeApsomJ7Z3ip0x',
} as const;
