// ============================================================
// Cliente Airtable centralizado
// Este es el ÚNICO archivo que sabe que estamos usando Airtable.
// Cuando migremos a Postgres/Supabase, solo cambia este archivo
// y las funciones de /lib/db/* — el resto de la app no se entera.
// ============================================================

import Airtable from 'airtable';

if (!process.env.AIRTABLE_API_KEY) {
  console.warn('⚠️ AIRTABLE_API_KEY no configurado — usando mock data');
}
if (!process.env.AIRTABLE_BASE_ID) {
  console.warn('⚠️ AIRTABLE_BASE_ID no configurado — usando mock data');
}

export const airtable = process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID
  ? new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)
  : null;

/**
 * Si Airtable no está configurado o falla, usamos mock data.
 * Ideal para desarrollo local sin tener que tener internet siempre.
 */
export const USE_MOCK = !airtable;

export const TABLES = {
  FACTURAS: 'FACTURAS_CLIENTES',
  COBROS: 'COBROS_CLIENTES',
  CLIENTES: 'CLIENTES',
  CENTROS_COSTO: 'CENTROS_COSTO',
  ASIENTOS: 'ASIENTOS',
  PARTIDAS: 'PARTIDAS',
  EMPLEADOS: 'EMPLEADOS',
  PLANILLA: 'PLANILLA',
  PROVEEDORES: 'PROVEEDORES',
  GASTOS: 'GASTOS',
  BANCOS: 'BANCOS',
  MOVIMIENTOS_BANCARIOS: 'MOVIMIENTOS_BANCARIOS',
  DEUDAS: 'DEUDAS',
  ACREEDORES: 'ACREEDORES',
  PAGOS_PROVEEDORES: 'PAGOS_PROVEEDORES',
  CUENTAS: 'CUENTAS',
  PERIODOS: 'PERIODOS',
  ER_SNAPSHOT: 'ER_SNAPSHOT',
  BS_SNAPSHOT: 'BS_SNAPSHOT',
  MAPEO_ER: 'MAPEO_ER',
  MAPEO_BS: 'MAPEO_BS',
  ANALISIS_AI: 'ANALISIS_AI',
  USO_AUROS:   'USO_AUROS',
  NOTAS_CREDITO: 'NOTAS_CREDITO',        // F-045
  AYUDA: 'AYUDA',                        // F-046
} as const;
