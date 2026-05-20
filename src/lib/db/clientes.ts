import { airtable, USE_MOCK, TABLES } from './airtable';
import { CUSTOMERS } from '../mock-data';
import type { Customer } from '../types';
import type { FieldSet } from 'airtable';

// Campos reales de la tabla CLIENTES en Airtable
const FC = {
  NOMBRE:       'Nombre de la Empresa',
  RAZON_SOCIAL: 'Razón social',
  NIT:          'NIt',
  EMAIL:        'Email cobros',
  DIAS_CREDITO: 'Dias Credito',
} as const;

function recordToCustomer(record: { id: string; fields: FieldSet }): Customer {
  const f = record.fields;
  const nombre = String(f[FC.NOMBRE] ?? f[FC.RAZON_SOCIAL] ?? '').trim();
  return {
    id:           record.id,
    name:         nombre,
    short:        nombre,
    nit:          String(f[FC.NIT] ?? ''),
    contact:      '',
    email:        String(f[FC.EMAIL] ?? ''),
    phone:        '',
    credit:       Number(f[FC.DIAS_CREDITO] ?? 0),
    totalBalance: 0,
    vencido:      0,
    avgPayDays:   0,
    onTimeRate:   0,
  };
}

export async function getClientes(): Promise<Customer[]> {
  if (USE_MOCK || !airtable) return CUSTOMERS;

  try {
    const records = await airtable(TABLES.CLIENTES)
      .select({ maxRecords: 2000 })
      .all();
    return records.map(r => recordToCustomer({ id: r.id, fields: r.fields }));
  } catch (err) {
    console.error('Error fetching clientes:', err);
    return CUSTOMERS;
  }
}

export async function getCliente(id: string): Promise<Customer | null> {
  const clientes = await getClientes();
  return clientes.find(c => c.id === id) ?? null;
}
