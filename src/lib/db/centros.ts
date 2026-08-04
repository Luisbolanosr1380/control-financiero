import { airtable, USE_MOCK, TABLES } from './airtable';
import { dataSource } from '../config/data-source';
import { sbCentrosCostoRecords } from '../supabase/records';
import type { FieldSet } from 'airtable';

export type Naturaleza = 'recurrente' | 'proyecto';

export interface CentroCosto {
  id: string;
  nombre: string;
  activo: boolean;
  naturaleza: Naturaleza | null;   // null si no está categorizado (interno/sin valor)
}

// Campos reales de CENTROS_COSTO
const FCC = {
  NOMBRE:     'NOMBRE',
  ACTIVO:     'ACTIVO',     // checkbox
  NATURALEZA: 'Naturaleza', // singleSelect: "Recurrente" / "Por proyecto"
} as const;

function naturalezaFromAirtable(v: unknown): Naturaleza | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'recurrente') return 'recurrente';
  if (s === 'por proyecto' || s === 'proyecto') return 'proyecto';
  return null;
}

function recordToCentro(record: { id: string; fields: FieldSet }): CentroCosto {
  return {
    id:         record.id,
    nombre:     String(record.fields[FCC.NOMBRE] ?? ''),
    activo:     Boolean(record.fields[FCC.ACTIVO]),
    naturaleza: naturalezaFromAirtable(record.fields[FCC.NATURALEZA]),
  };
}

/** Helper: mapa id → naturaleza (null si no categorizado). */
export function buildNaturalezaMap(centros: CentroCosto[]): Map<string, Naturaleza | null> {
  return new Map(centros.map(c => [c.id, c.naturaleza]));
}

export async function getCentrosCosto(): Promise<CentroCosto[]> {
  if (dataSource('centros_costo') === 'supabase') {
    try {
      const records = await sbCentrosCostoRecords();
      return records.map(r => recordToCentro({ id: r.id, fields: r.fields as FieldSet }));
    } catch (err) {
      console.error('Error fetching centros de costo (supabase):', err);
      return [];
    }
  }
  if (USE_MOCK || !airtable) return [];

  try {
    // F-BF-004: sin maxRecords — `.all()` agota la paginación.
    const records = await airtable(TABLES.CENTROS_COSTO).select().all();
    return records.map(r => recordToCentro({ id: r.id, fields: r.fields }));
  } catch (err) {
    console.error('Error fetching centros de costo:', err);
    return [];
  }
}

export async function getCentrosCostoActivos(): Promise<CentroCosto[]> {
  return (await getCentrosCosto()).filter(c => c.activo);
}
