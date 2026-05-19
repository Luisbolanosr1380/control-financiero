// ============================================================
// Adapter de Facturas
// Estas funciones son la única forma de leer/escribir facturas
// en la app. Hoy usan Airtable + mock fallback. Mañana pueden
// usar cualquier otra base de datos sin tocar la UI.
// ============================================================

import { airtable, USE_MOCK, TABLES } from './airtable';
import { INVOICES, CUSTOMERS } from '../mock-data';
import type { Invoice } from '../types';

/**
 * Obtener todas las facturas. Filtros opcionales.
 * En Fase 2 esto va a leer de Airtable real.
 */
export async function getFacturas(filters?: {
  status?: Invoice['status'];
  custId?: string;
  line?: string;
}): Promise<Invoice[]> {
  if (USE_MOCK || !airtable) {
    let result = [...INVOICES];
    if (filters?.status) result = result.filter(i => i.status === filters.status);
    if (filters?.custId) result = result.filter(i => i.custId === filters.custId);
    if (filters?.line)   result = result.filter(i => i.line === filters.line);
    return result;
  }

  // TODO Fase 2: leer de Airtable real
  // const records = await airtable(TABLES.FACTURAS).select({ ... }).all();
  // return records.map(mapAirtableToInvoice);
  return INVOICES;
}

export async function getFactura(id: string): Promise<Invoice | null> {
  if (USE_MOCK || !airtable) {
    return INVOICES.find(i => i.id === id) ?? null;
  }
  // TODO Fase 2
  return INVOICES.find(i => i.id === id) ?? null;
}

export interface NewFacturaInput {
  custId: string;
  line: Invoice['line'];
  total: number;
  credit: number;
}

/**
 * Crear factura nueva. En Fase 3 esto va a:
 *   1. Escribir a tabla FACTURAS_CLIENTES en Airtable
 *   2. Generar asiento contable automático
 *   3. Devolver el ID del registro creado
 */
export async function createFactura(input: NewFacturaInput): Promise<{ id: string }> {
  if (USE_MOCK || !airtable) {
    const id = `F-2026-${Math.floor(Math.random() * 9000 + 1000)}`;
    return { id };
  }
  // TODO Fase 3
  throw new Error('createFactura: pendiente implementación Fase 3');
}

export async function anularFactura(id: string): Promise<void> {
  if (USE_MOCK || !airtable) return;
  // TODO Fase 3: marcar ESTADO = "ANULADO" en Airtable
}
