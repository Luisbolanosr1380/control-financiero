import { airtable, USE_MOCK, TABLES } from './airtable';
import { dataSource, writeSource } from '../config/data-source';
import { sbClientesRecords } from '../supabase/records';
import { insertar } from '../supabase/writes';
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

// ============================================================
// FIX-CLIENTES-ALTA: crear cliente desde la app.
// El alta NUNCA existió acá — se hacía a mano en la interfaz de
// Airtable. Por eso no hay rama legacy: escribe SOLO a Supabase,
// gateado por la operación 'facturacion' (dueña del cliente: si
// facturación rollbackea a Airtable, el alta se bloquea para no
// crear clientes invisibles al backend que emite la factura).
// ============================================================

export interface CrearClienteInput {
  nombreEmpresa: string;            // requerido
  razonSocial?: string;             // la que va en la factura
  nit?: string;                     // formato Guatemala o 'CF'
  cuentaCxc?: string;               // default '1-1-3-1' (los 316 existentes)
  emailCobros?: string;
  correoCobro?: string;             // email secundario
  whatsappCobros?: string;
  diasCredito?: number;             // default 30
  periodicidadFactura?: string;     // ej. "25 de cada mes"
  fechaFacturacion?: number;        // día del mes (1-31)
  instruccionesCobro?: string;
  contextoComercial?: string;
  activo?: boolean;                 // default true
}

export type CrearClienteResult =
  | { ok: true; clienteId: string; mensaje: string }
  | { ok: false; error: string };

const normClienteTxt = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** NIT sin espacios/guiones, mayúscula (el dígito verificador puede ser K). */
const normNit = (s: string) => s.replace(/[\s-]+/g, '').toUpperCase();

/** NIT guatemalteco: dígitos + verificador (número o K), o 'CF' consumidor final. */
export function nitValido(nit: string): boolean {
  const n = normNit(nit);
  return n === 'CF' || /^\d{2,12}[0-9K]$/.test(n);
}

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

export async function crearCliente(input: CrearClienteInput): Promise<CrearClienteResult> {
  if (writeSource('facturacion') !== 'supabase') {
    return { ok: false, error: 'El alta de clientes requiere el backend Supabase (facturación está en rollback).' };
  }

  const nombre = (input.nombreEmpresa ?? '').trim();
  if (!nombre) return { ok: false, error: 'El nombre de la empresa es requerido.' };

  const nit = input.nit?.trim() || '';
  if (nit && !nitValido(nit)) {
    return { ok: false, error: `NIT "${nit}" no parece un NIT de Guatemala (dígitos + verificador, ej. 1234567-8) ni 'CF'.` };
  }
  for (const [campo, valor] of [['Email cobros', input.emailCobros], ['Correo cobro', input.correoCobro]] as const) {
    if (valor?.trim() && !emailValido(valor)) return { ok: false, error: `${campo}: "${valor.trim()}" no es un email válido.` };
  }
  if (input.fechaFacturacion !== undefined && (input.fechaFacturacion < 1 || input.fechaFacturacion > 31 || !Number.isInteger(input.fechaFacturacion))) {
    return { ok: false, error: 'El día de facturación debe ser un entero entre 1 y 31.' };
  }
  if (input.diasCredito !== undefined && (input.diasCredito < 0 || !Number.isInteger(input.diasCredito))) {
    return { ok: false, error: 'Los días de crédito deben ser un entero ≥ 0.' };
  }

  // Duplicados (la migración sufrió justo esto): mismo nombre/razón social
  // (case+acento insensible) o mismo NIT (salvo CF, que se repite legítimamente).
  const existentes = await getClientes();
  const q = normClienteTxt(nombre);
  const qRazon = input.razonSocial?.trim() ? normClienteTxt(input.razonSocial) : '';
  const dupNombre = existentes.find(c => normClienteTxt(c.name) === q || (qRazon !== '' && normClienteTxt(c.name) === qRazon));
  if (dupNombre) return { ok: false, error: `Ya existe un cliente con ese nombre: "${dupNombre.name}".` };
  if (nit && normNit(nit) !== 'CF') {
    const dupNit = existentes.find(c => c.nit && normNit(c.nit) === normNit(nit));
    if (dupNit) return { ok: false, error: `Ya existe un cliente con el NIT ${nit}: "${dupNit.name}".` };
  }

  try {
    const razon = input.razonSocial?.trim() || nombre;
    const res = await insertar('clientes', {
      nombre_empresa:       nombre,
      razon_social:         razon,
      etiqueta:             razon,   // en Airtable se autollenaba = razón social
      nit:                  nit || null,
      cuenta_cxc:           input.cuentaCxc?.trim() || '1-1-3-1',
      email_cobros:         input.emailCobros?.trim() || null,
      correo_cobro:         input.correoCobro?.trim() || null,
      whatsapp_cobros:      input.whatsappCobros?.trim() || null,
      dias_credito:         input.diasCredito ?? 30,
      periodicidad_factura: input.periodicidadFactura?.trim() || null,
      fecha_facturacion:    input.fechaFacturacion ?? null,
      instrucciones_cobro:  input.instruccionesCobro?.trim() || null,
      contexto_comercial:   input.contextoComercial?.trim() || null,
      activo:               input.activo ?? true,
    });
    return { ok: true, clienteId: res.airtable_id, mensaje: `Cliente "${nombre}" creado.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `No se pudo crear el cliente: ${msg}` };
  }
}
