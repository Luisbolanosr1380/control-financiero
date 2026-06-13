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

/**
 * F-056 — CxC intercompany por empresa hermana.
 *
 * Cuando Golden paga la planilla de un empleado de HIT/Poligrafy/BYDSA,
 * el desembolso NO es gasto de Golden: es una cuenta por cobrar a la
 * empresa hermana que se liquida vía facturación intercompany.
 *
 * Cuentas creadas via MCP el 12 jun 2026 (códigos 1-1-3-3-x).
 *
 * NOTA DE ALCANCE (F-056):
 * Lo que SÍ se modela acá: la PROYECCIÓN del débito al generar la
 * planilla — sustituye Dr Gasto Nómina por Dr CxC para las líneas
 * no-Golden. El módulo `src/lib/planilla/proyectar-asiento.ts` calcula
 * las partidas sin escribir a Airtable (el generador real de ASIENTOS
 * + PARTIDAS para planilla aún no existe en este repo — F-051.7 banner
 * y este módulo son el preview).
 *
 * Lo que NO se modela todavía (queda para F-056.1+):
 *  · La RECLASIFICACIÓN cuando Golden emite la factura intercompany
 *    (Dr CxC Cliente / Cr 1-1-3-3-x). Requiere decidir con el contador
 *    si la factura lleva management fee o es reembolso exacto.
 *  · Auros tool de saldos vivos de CxC intercompany.
 *  · La conciliación quincena intercompany vs. factura emitida.
 */
export const CXC_INTERCOMPANY = {
  HIT: {
    recordId: 'rec6m7Qbn3NCBug3x',
    codigo: '1-1-3-3-1',
    nombre: 'CxC Intercompany — HIT',
    empresa: 'HIT' as const,
  },
  Poligrafy: {
    recordId: 'rec6od3KsYTzARZpu',
    codigo: '1-1-3-3-2',
    nombre: 'CxC Intercompany — Poligrafy',
    empresa: 'Poligrafy' as const,
  },
  BYDSA: {
    recordId: 'recBhglJe2Go0r0Ok',
    codigo: '1-1-3-3-3',
    nombre: 'CxC Intercompany — BYDSA',
    empresa: 'BYDSA' as const,
  },
} as const;

export type EmpresaIntercompany = keyof typeof CXC_INTERCOMPANY;

/**
 * F-056.1 — Cuentas de INGRESO por servicios administrativos a la
 * empresa hermana (management fee / margen intercompany).
 *
 * Códigos 4-1-7-x creados via MCP el 12 jun 2026. Una cuenta de ingreso
 * por cada empresa hermana, espejo de CXC_INTERCOMPANY.
 *
 * Cuando se cobra la factura intercompany con margen > 0, la diferencia
 * entre (cobrado) y (CxC adelantada) se acredita acá como ingreso por
 * servicios administrativos prestados.
 *
 * Con margen = 0 (estado actual: reembolso al costo), esta cuenta no se
 * usa — el asiento de recuperación es solo Dr Banco / Cr CxC.
 */
export const INGRESO_INTERCOMPANY = {
  HIT: {
    recordId: 'recnw90JQ1TWJtIEz',
    codigo: '4-1-7-1',
    nombre: 'Ingresos Servicios Admin. — HIT',
    empresa: 'HIT' as const,
  },
  Poligrafy: {
    recordId: 'recOTOhk4GIPO0cJI',
    codigo: '4-1-7-2',
    nombre: 'Ingresos Servicios Admin. — Poligrafy',
    empresa: 'Poligrafy' as const,
  },
  BYDSA: {
    recordId: 'recOjSaZjPI6gMHYX',
    codigo: '4-1-7-3',
    nombre: 'Ingresos Servicios Admin. — BYDSA',
    empresa: 'BYDSA' as const,
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
