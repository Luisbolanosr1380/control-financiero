import { airtable, USE_MOCK, TABLES } from './airtable';
import type { FieldSet } from 'airtable';

export type MonedaBanco = 'Q' | 'USD' | 'OTRA';

export interface Banco {
  id: string;
  nombreCuenta: string;
  banco: string;
  numeroCuenta: string;
  moneda: MonedaBanco;
  activo: boolean;
}

const FB = {
  NOMBRE_CUENTA: 'NOMBRE_CUENTA',
  BANCO:         'BANCO',
  NUMERO_CUENTA: 'NUMERO_CUENTA',
  MONEDA:        'MONEDA',
  ACTIVO:        'ACTIVO',
} as const;

function monedaFromAirtable(v: unknown): MonedaBanco {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'Q' || s === 'GTQ') return 'Q';
  if (s === 'USD')               return 'USD';
  return 'OTRA';
}

function recordToBanco(record: { id: string; fields: FieldSet }): Banco {
  return {
    id:            record.id,
    nombreCuenta:  String(record.fields[FB.NOMBRE_CUENTA] ?? ''),
    banco:         String(record.fields[FB.BANCO] ?? ''),
    numeroCuenta:  String(record.fields[FB.NUMERO_CUENTA] ?? ''),
    moneda:        monedaFromAirtable(record.fields[FB.MONEDA]),
    activo:        Boolean(record.fields[FB.ACTIVO]),
  };
}

export async function getBancos(): Promise<Banco[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(TABLES.BANCOS).select({ maxRecords: 100 }).all();
    return records.map(r => recordToBanco({ id: r.id, fields: r.fields }));
  } catch (err) {
    console.error('Error fetching bancos:', err);
    return [];
  }
}

export async function getBancosActivos(): Promise<Banco[]> {
  return (await getBancos()).filter(b => b.activo);
}
