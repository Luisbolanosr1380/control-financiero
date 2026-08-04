/**
 * F-056.2 — Configuración del generador de asiento de planilla.
 *
 * Patrón gemelo de depreciacion-config.ts (F-057) y intercompany-config.ts
 * (F-056.1). El flag arranca en `false` para que la UI muestre el preview
 * pero NADIE escriba a libros hasta validar el PRIMER asiento real con
 * el contador.
 *
 * Reglas del contador (jun-2026):
 *  1. IGSS patronal en el MISMO asiento de la quincena.
 *  2. Cr Banco directo (no contra "sueldos por pagar").
 *  3. Nómina operativa = costo de ventas (5-x); administrativa = gasto (6-x).
 */

export const GENERAR_ASIENTO_PLANILLA = false;

/** ORIGEN del asiento mensual de planilla. Idempotencia: un solo asiento por planilla. */
export const ORIGEN_ASIENTO_PLANILLA = 'PLANILLA';

/**
 * Cuentas de nómina por centro de costo (Golden Talent). Mapeo confirmado
 * con el contador (jun-2026). Verificadas por recordId — son cuentas
 * estructurales, si Stark las renombra el código sigue funcionando.
 *
 * 6-1-1 (Admin) se LEE en runtime por código porque su recordId no
 * estaba listado en el brief — buscar por prefijo "6-1-1" en CUENTAS.
 */
// FASE 2.6: códigos actualizados a los definitivos de Supabase. Airtable
// tenía estos 3 códigos DUPLICADOS (los reusaba "Insumos y Calibración"
// etc.); Postgres los reasignó al siguiente hermano libre (…-3). Los
// recordIds NO cambian — son los mismos records.
export const CUENTAS_NOMINA_GOLDEN_POR_CC = {
  POLIGRAFIA: {
    recordId: 'reckqFTk5CnY7rHFC',
    codigo:   '5-1-3-3',
    nombre:   'Nómina Directa Poligrafía',
  },
  SOCIOECONOMICOS: {
    recordId: 'reczi8KqO4NrkMe26',
    codigo:   '5-1-4-3',
    nombre:   'Nómina Directa Socioeconómicos',
  },
  TALENTTRACK: {
    recordId: 'rec23VvQjJjCQxgLo',
    codigo:   '5-1-5-3',
    nombre:   'Nómina Directa TalentTrack',
  },
  // ADMIN: se resuelve en runtime por prefijo "6-1-1" desde CUENTAS,
  // porque su recordId no estaba listado en el brief F-056.2.
} as const;

/** Códigos exactos que mapean cada nombre de CC al codigo_path de CUENTAS. */
export const PREFIJOS_NOMINA_GOLDEN = {
  POLIGRAFIA:        '5-1-3-3',
  SOCIOECONOMICOS:   '5-1-4-3',
  TALENTTRACK:       '5-1-5-3',
  ADMINISTRATIVO:    '6-1-1',  // se resuelve en runtime
} as const;

/**
 * Caja chica como fallback de Cr Banco cuando la planilla no
 * especifica banco. Hoy NO se usa — el caller pide banco antes de
 * generar. Se mantiene el recordId documentado para futuro.
 */
export const CAJA_CHICA = {
  recordId: 'recHcljQhygg9z3c4',
  codigo:   '1-1-1-1',
  nombre:   'Caja Chica',
} as const;
