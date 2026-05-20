import { airtable, USE_MOCK, TABLES } from './airtable';
import { consolidateRecords } from './mappers';
import { INVOICES as MOCK_INVOICES } from '../mock-data';
import type { Invoice } from '../types';

export async function getFacturas(filters?: {
  status?: Invoice['status'];
  custId?: string;
  line?: string;
}): Promise<Invoice[]> {
  if (USE_MOCK || !airtable) {
    let result = [...MOCK_INVOICES];
    if (filters?.status) result = result.filter(i => i.status === filters.status);
    if (filters?.custId) result = result.filter(i => i.custId === filters.custId);
    if (filters?.line)   result = result.filter(i => i.line === filters.line);
    return result;
  }

  try {
    const records = await airtable(TABLES.FACTURAS)
      .select({
        sort: [{ field: 'FECHA_EMISION', direction: 'desc' }],
        maxRecords: 2000,
      })
      .all();

    let invoices = consolidateRecords(records.map(r => ({ id: r.id, fields: r.fields })));

    if (filters?.status) invoices = invoices.filter(i => i.status === filters.status);
    if (filters?.custId) invoices = invoices.filter(i => i.custId === filters.custId);
    if (filters?.line)   invoices = invoices.filter(i => i.lineas.some(l => l.line === filters.line));

    return invoices;
  } catch (err) {
    console.error('Error fetching facturas:', err);
    return MOCK_INVOICES;
  }
}

export async function getFactura(id: string): Promise<Invoice | null> {
  const facturas = await getFacturas();
  return facturas.find(f => f.id === id) ?? null;
}

export interface NewFacturaInput {
  custId: string;
  lineas: { line: Invoice['line']; amount: number }[];
  credit: number;
}

export async function createFactura(_input: NewFacturaInput): Promise<{ id: string }> {
  throw new Error('createFactura: pendiente implementación Fase 3');
}

export async function anularFactura(_id: string): Promise<void> {
  // TODO Fase 3
}
