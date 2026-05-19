import { airtable, USE_MOCK, TABLES } from './airtable';
import { CUSTOMERS } from '../mock-data';
import type { Customer } from '../types';

export async function getClientes(): Promise<Customer[]> {
  if (USE_MOCK || !airtable) return CUSTOMERS;
  // TODO Fase 2
  return CUSTOMERS;
}

export async function getCliente(id: string): Promise<Customer | null> {
  if (USE_MOCK || !airtable) {
    return CUSTOMERS.find(c => c.id === id) ?? null;
  }
  // TODO Fase 2
  return CUSTOMERS.find(c => c.id === id) ?? null;
}
