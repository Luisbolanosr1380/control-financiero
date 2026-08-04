import { airtable, USE_MOCK, TABLES } from './airtable';
import { dataSource } from '../config/data-source';
import { sbClientesRecords } from '../supabase/records';
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
  CONTEXTO:     'Contexto_Comercial',
} as const;

function recordToCustomer(record: { id: string; fields: FieldSet }): Customer {
  const f = record.fields;
  const nombre = String(f[FC.NOMBRE] ?? f[FC.RAZON_SOCIAL] ?? '').trim();
  const contexto = String(f[FC.CONTEXTO] ?? '').trim();
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
    contextoComercial: contexto || undefined,
  };
}

export async function getClientes(): Promise<Customer[]> {
  if (dataSource('clientes') === 'supabase') {
    try {
      const records = await sbClientesRecords();
      return records.map(r => recordToCustomer({ id: r.id, fields: r.fields as FieldSet }));
    } catch (err) {
      console.error('Error fetching clientes (supabase):', err);
      return CUSTOMERS;
    }
  }
  if (USE_MOCK || !airtable) return CUSTOMERS;

  try {
    // F-034: sin maxRecords — `.all()` agota todas las páginas.
    const records = await airtable(TABLES.CLIENTES)
      .select()
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
