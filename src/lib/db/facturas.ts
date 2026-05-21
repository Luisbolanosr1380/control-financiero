import { airtable, USE_MOCK, TABLES } from './airtable';
import { consolidateRecords, F } from './mappers';
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

export interface NewFacturaLine {
  centroCostoId: string;
  total: number;   // monto CON IVA (como en la factura SAT)
  iva: number;     // IVA extraído del total
}

export interface NewFacturaInput {
  noFactura: string;
  custId: string;
  fechaEmision: string;
  lineas: NewFacturaLine[];
}

export interface CreateFacturaResult {
  noFactura: string;
  recordsCreados: number;
  recordIdPrincipal: string;   // record de mayor monto (para adjuntar el PDF)
}

export async function createFactura(input: NewFacturaInput): Promise<CreateFacturaResult> {
  if (USE_MOCK || !airtable) {
    throw new Error('createFactura: Airtable no está configurado.');
  }
  if (!input.noFactura?.trim()) throw new Error('NO.FACTURA es requerido.');
  if (!input.custId)            throw new Error('Cliente es requerido.');
  if (!input.lineas?.length)    throw new Error('Se requiere al menos una línea.');

  try {
    // Evitar duplicado silencioso: ¿ya existe ese NO.FACTURA?
    const noFacturaEsc = input.noFactura.replace(/"/g, '\\"');
    const existentes = await airtable(TABLES.FACTURAS)
      .select({ filterByFormula: `{${F.NO_FACTURA}} = "${noFacturaEsc}"`, maxRecords: 1 })
      .all();
    if (existentes.length > 0) {
      throw new Error(`La factura ${input.noFactura} ya existe en Airtable. No se creó para evitar un duplicado.`);
    }

    const payload = input.lineas.map(l => ({
      fields: {
        [F.NO_FACTURA]:    input.noFactura,
        [F.CLIENTE]:       [input.custId],
        [F.CENTRO_COSTO]:  [l.centroCostoId],
        [F.FECHA_EMISION]: input.fechaEmision,
        [F.TOTAL]:         l.total,   // monto con IVA. SUBTOTAL es fórmula (= TOTAL - IVA): no se escribe
        [F.IVA]:           l.iva,
        [F.ESTADO]:        'EMITIDA',
      },
    }));

    // Airtable crea máximo 10 records por llamada. El orden se preserva.
    const createdIds: string[] = [];
    for (let i = 0; i < payload.length; i += 10) {
      const lote = payload.slice(i, i + 10);
      const res = await airtable(TABLES.FACTURAS).create(lote);
      createdIds.push(...res.map(r => r.id));
    }

    // Principal = línea de mayor total (mismo orden que input.lineas)
    let maxIdx = 0;
    for (let i = 1; i < input.lineas.length; i++) {
      if (input.lineas[i].total > input.lineas[maxIdx].total) maxIdx = i;
    }

    return {
      noFactura: input.noFactura,
      recordsCreados: createdIds.length,
      recordIdPrincipal: createdIds[maxIdx] ?? createdIds[0] ?? '',
    };
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : `Error creando factura: ${String(err)}`);
  }
}

export async function anularFactura(_id: string): Promise<void> {
  // TODO Fase 3
}
