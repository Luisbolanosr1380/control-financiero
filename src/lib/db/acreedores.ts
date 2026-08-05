// ============================================================
// Acreedores: CRUD aparte de deudas.ts (que ya estaba grande).
// La lectura (getAcreedores, tipos) sigue viviendo en deudas.ts
// por compatibilidad — re-exportamos lo necesario para que la UI
// pueda importar todo desde un solo lugar si quiere.
// ============================================================

import { airtable, USE_MOCK, TABLES } from './airtable';
import { getAcreedores, type Acreedor } from './deudas';
import { writeSource } from '../config/data-source';
import { insertar } from '../supabase/writes';

// Opciones del singleSelect Tipo_Acreedor (ACREEDORES). Snapshot de Airtable.
// F-037: 'Empleado' agregado para vincular ACREEDORES auto-generados a empleados
// activos que tienen salarios pendientes diferidos.
export const TIPOS_ACREEDOR = [
  'Socio',
  'Banco',
  'Tarjeta',
  'Financiera',
  'Proveedor',
  'Empleado',
  'Ex-Empleado',
  'Asesor Relacionado',
  'Nómina',
  'Seguridad Social',
  'Gasto Acumulado',
] as const;
export type TipoAcreedor = (typeof TIPOS_ACREEDOR)[number];

// Opciones del singleSelect Tipo Producto (ACREEDORES).
export const TIPOS_PRODUCTO_ACREEDOR = [
  'Tarjeta de Credito',
  'Préstamo',
  'Leasing',
  'Factoraje',
  'Reembolso',
  'Impuestos',
  'Gasto Acumulado',
  'Depósito en garantía',
  'Dividendos',
  'Otros',
  'Extrafinanciamiento',
  'Proveedor',
  'Seguridad Social',
  'Salario Devengado',
] as const;

// La tabla acepta 'Q' / 'USD' en ACREEDORES (no 'GTQ' como DEUDAS — ojo con el mapeo).
export type MonedaAcreedor = 'Q' | 'USD';

// Field names en ACREEDORES (debe coincidir EXACTO con el schema Airtable).
const FA_WRITE = {
  NOMBRE_LEGAL:    'Acreedor_Nombre_Legal',
  TIPO_PRODUCTO:   'Tipo Producto',
  TIPO_ACREEDOR:   'Tipo_Acreedor',
  ES_RELACIONADA:  'Es_Parte_Relacionada',
  NIT:             'NIT',
  MONEDA:          'Moneda',
  ESTATUS:         'Estatus',
  EMAIL:           'Email',
  TELEFONO:        'Telefono',
  NOTAS:           'Notas',
} as const;

// ============================================================
// Tipos públicos
// ============================================================

export interface CrearAcreedorInput {
  nombreAcreedor: string;             // requerido — se escribe en Acreedor_Nombre_Legal
  acreedorNombreLegal?: string;       // si está, usa éste como Acreedor_Nombre_Legal
  tipoProducto?: string;
  tipoAcreedor: TipoAcreedor;
  esParteRelacionada?: boolean;
  nit?: string;
  moneda?: MonedaAcreedor;
  email?: string;
  telefono?: string;
  notas?: string;
}

export type CrearAcreedorResult =
  | { ok: true; acreedorId: string; mensaje: string }
  | { ok: false; error: string };

// ============================================================
// API pública
// ============================================================

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function crearAcreedor(input: CrearAcreedorInput): Promise<CrearAcreedorResult> {
  if ((USE_MOCK || !airtable) && writeSource('deudas') !== 'supabase') return { ok: false, error: 'Airtable no está configurado.' };

  const nombre = (input.nombreAcreedor ?? '').trim();
  if (!nombre)                return { ok: false, error: 'Nombre del acreedor es requerido.' };
  if (!input.tipoAcreedor)    return { ok: false, error: 'Tipo de acreedor es requerido.' };

  // 1) Validar duplicados (case+acento insensible) contra Nombre_Acreedor (formula) y
  //    Acreedor_Nombre_Legal (singleLineText).
  const existentes = await getAcreedores();
  const q = norm(nombre);
  const dup = existentes.find(a => norm(a.nombre) === q || norm(a.nombreLegal) === q);
  if (dup) return { ok: false, error: `Ya existe un acreedor con ese nombre: "${dup.nombre || dup.nombreLegal}".` };

  // 2) Si es Socio, forzar Es_Parte_Relacionada=true.
  const esParteRelacionada = input.esParteRelacionada || input.tipoAcreedor === 'Socio';

  // ═══ FASE 3 — ACREEDOR EN SUPABASE ═══
  if (writeSource('deudas') === 'supabase') {
    try {
      const legal = input.acreedorNombreLegal?.trim() || nombre;
      const res = await insertar('acreedores', {
        // fórmula Nombre_Acreedor de Airtable: `legal — tipoProducto`
        nombre_acreedor: `${legal} — ${input.tipoProducto ?? ''}`.trim(),
        nombre_legal: legal,
        tipo_acreedor: input.tipoAcreedor,
        tipo_producto: input.tipoProducto ?? null,
        es_parte_relacionada: esParteRelacionada,
        moneda: input.moneda === 'USD' ? 'USD' : 'GTQ',
        estatus: 'Activo',
        nit: input.nit?.trim() || null,
        email: input.email?.trim() || null,
        telefono: input.telefono?.trim() || null,
        notas: input.notas?.trim() || null,
      });
      return { ok: true, acreedorId: res.airtable_id, mensaje: `Acreedor "${nombre}" creado.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `No se pudo crear el acreedor en Supabase: ${msg}` };
    }
  }

  try {
    type AField = string | number | boolean | string[] | undefined;
    const fields: Record<string, AField> = {
      [FA_WRITE.NOMBRE_LEGAL]:    input.acreedorNombreLegal?.trim() || nombre,
      [FA_WRITE.TIPO_ACREEDOR]:   input.tipoAcreedor,
      [FA_WRITE.ES_RELACIONADA]:  esParteRelacionada,
      [FA_WRITE.MONEDA]:          input.moneda ?? 'Q',
      [FA_WRITE.ESTATUS]:         'Activo',
    };
    if (input.tipoProducto)        fields[FA_WRITE.TIPO_PRODUCTO] = input.tipoProducto;
    if (input.nit?.trim())         fields[FA_WRITE.NIT]           = input.nit.trim();
    if (input.email?.trim())       fields[FA_WRITE.EMAIL]         = input.email.trim();
    if (input.telefono?.trim())    fields[FA_WRITE.TELEFONO]      = input.telefono.trim();
    if (input.notas?.trim())       fields[FA_WRITE.NOTAS]         = input.notas.trim();

    const created = await airtable!(TABLES.ACREEDORES).create(fields);
    return {
      ok: true,
      acreedorId: created.id,
      mensaje: `Acreedor "${nombre}" creado.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error creando acreedor:', msg);
    return { ok: false, error: `No se pudo crear el acreedor en Airtable: ${msg}` };
  }
}

export async function getAcreedorPorId(id: string): Promise<Acreedor | null> {
  const todos = await getAcreedores();
  return todos.find(a => a.id === id) ?? null;
}
