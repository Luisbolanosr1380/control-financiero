import { airtable, USE_MOCK, TABLES } from './airtable';
import type { Payment } from '../types';

const MOCK_PAYMENTS: Payment[] = [
  { id: 'REC-2026-0188', date: '2026-05-17', custId: 'C-005', amount: 47260, method: 'Transferencia', bank: 'BAC',       ref: 'TRF-93481' },
  { id: 'REC-2026-0187', date: '2026-05-16', custId: 'C-009', amount: 24800, method: 'Cheque',        bank: 'Banrural',  ref: 'CHQ-00184' },
  { id: 'REC-2026-0186', date: '2026-05-15', custId: 'C-004', amount: 29400, method: 'Transferencia', bank: 'Cuscatlán', ref: 'TRF-91207' },
  { id: 'REC-2026-0185', date: '2026-05-14', custId: 'C-008', amount: 18900, method: 'Transferencia', bank: 'BAC',       ref: 'TRF-91103' },
  { id: 'REC-2026-0184', date: '2026-05-13', custId: 'C-006', amount: 12600, method: 'Depósito',      bank: 'Banrural',  ref: 'DEP-44012' },
  { id: 'REC-2026-0183', date: '2026-05-10', custId: 'C-002', amount: 35000, method: 'Transferencia', bank: 'Banrural',  ref: 'TRF-89045' },
];

export async function getCobros(): Promise<Payment[]> {
  if (USE_MOCK || !airtable) return MOCK_PAYMENTS;
  // TODO Fase 2
  return MOCK_PAYMENTS;
}

export interface NewCobroInput {
  custId: string;
  amount: number;
  bank: string;
  method: string;
  ref: string;
  invoiceIds: string[];
}

export async function registrarCobro(input: NewCobroInput): Promise<{ id: string }> {
  if (USE_MOCK || !airtable) {
    return { id: `REC-2026-${Math.floor(Math.random() * 9000 + 1000)}` };
  }
  // TODO Fase 3
  throw new Error('registrarCobro: pendiente implementación Fase 3');
}
