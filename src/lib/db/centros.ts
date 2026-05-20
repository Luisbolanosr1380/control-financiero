import { airtable, USE_MOCK, TABLES } from './airtable';
import type { FieldSet } from 'airtable';

export interface CentroCosto {
  id: string;
  nombre: string;
  activo: boolean;
}

// Campos reales de CENTROS_COSTO
const FCC = {
  NOMBRE: 'NOMBRE',
  ACTIVO: 'ACTIVO',   // checkbox
} as const;

function recordToCentro(record: { id: string; fields: FieldSet }): CentroCosto {
  return {
    id:     record.id,
    nombre: String(record.fields[FCC.NOMBRE] ?? ''),
    activo: Boolean(record.fields[FCC.ACTIVO]),
  };
}

export async function getCentrosCosto(): Promise<CentroCosto[]> {
  if (USE_MOCK || !airtable) return [];

  try {
    const records = await airtable(TABLES.CENTROS_COSTO).select({ maxRecords: 100 }).all();
    return records.map(r => recordToCentro({ id: r.id, fields: r.fields }));
  } catch (err) {
    console.error('Error fetching centros de costo:', err);
    return [];
  }
}

export async function getCentrosCostoActivos(): Promise<CentroCosto[]> {
  return (await getCentrosCosto()).filter(c => c.activo);
}
