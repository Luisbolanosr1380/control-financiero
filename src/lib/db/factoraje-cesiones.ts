/**
 * FACTORAJE — lectura de cesiones (SIN 'server-only').
 *
 * Vive separado de factoraje.ts a propósito: facturas-pendientes.ts (que
 * pendientes-client importa por sus constantes de aging y por eso entra al
 * bundle del cliente) necesita saber qué facturas están cedidas. Si este
 * código llevara 'server-only', `next build` fallaría. Acá solo hay
 * lecturas; las mutaciones (ceder, cambiar estado) quedan en factoraje.ts
 * con 'server-only'.
 */
import { fetchAll } from '../supabase/client';

export const TIPO_DOC_FACTORAJE = 'Factoraje';
export const ESTADOS_CESION = ['Cedida', 'Liberada', 'Recomprada', 'Pagada'] as const;
export type EstadoCesion = (typeof ESTADOS_CESION)[number];

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface Cesion {
  id: string;                 // uuid del puente
  facturaUuid: string;
  facturaAppId: string;       // Invoice.id (línea principal) → /facturacion/[id]
  noFactura: string;
  cliente: string;
  montoCedido: number;
  fechaCesion: string;
  estado: EstadoCesion;
  nota: string | null;
  createdBy: string | null;
  estadoEn: string | null;
  estadoPor: string | null;
  totalFactura: number;
}

export interface CesionActiva { factorajeId: string; financiador: string; montoCedido: number; fechaCesion: string }

/** Todas las cesiones con su factura y cliente (embeds con FK explícita — PGRST201). */
export async function cargarCesiones(): Promise<Array<Cesion & { deudaUuid: string }>> {
  const rows = await fetchAll<Row>('factoraje_facturas', {
    select: 'id, deuda_id, factura_id, monto_cedido, fecha_cesion, estado, nota, created_by, estado_en, estado_por, '
      + 'factura:facturas_clientes!factoraje_facturas_factura_id_fkey(airtable_id, no_factura, total, cliente:clientes!facturas_clientes_cliente_id_fkey(razon_social, nombre_empresa))',
  });
  return rows.map(r => {
    const f = r.factura as { airtable_id?: string; no_factura?: string; total?: number; cliente?: { razon_social?: string; nombre_empresa?: string } } | null;
    return {
      id: s(r.id), deudaUuid: s(r.deuda_id), facturaUuid: s(r.factura_id),
      facturaAppId: s(f?.airtable_id), noFactura: s(f?.no_factura), totalFactura: n(f?.total),
      cliente: f?.cliente?.razon_social || f?.cliente?.nombre_empresa || '—',
      montoCedido: r2(n(r.monto_cedido)), fechaCesion: s(r.fecha_cesion),
      estado: (ESTADOS_CESION as readonly string[]).includes(s(r.estado)) ? (s(r.estado) as EstadoCesion) : 'Cedida',
      nota: s(r.nota) || null, createdBy: s(r.created_by) || null, estadoEn: s(r.estado_en) || null, estadoPor: s(r.estado_por) || null,
    };
  });
}

/**
 * Mapa facturaAppId → cesión ACTIVA (para marcar y separar en CxC/pendientes).
 * Fail-soft: {} si la migración 010 no está aplicada.
 */
export async function getCesionesActivasPorFactura(): Promise<Record<string, CesionActiva>> {
  try {
    const [cesiones, deudas, acreedores] = await Promise.all([
      cargarCesiones(),
      fetchAll<Row>('deudas', { select: 'id, airtable_id, acreedor_id', eq: { tipo_documento: TIPO_DOC_FACTORAJE } }),
      fetchAll<Row>('acreedores', { select: 'id, nombre_acreedor, nombre_legal' }),
    ]);
    const acr = new Map(acreedores.map(a => [s(a.id), s(a.nombre_acreedor || a.nombre_legal).trim()]));
    const deu = new Map(deudas.map(d => [s(d.id), { app: s(d.airtable_id), fin: acr.get(s(d.acreedor_id)) ?? '—' }]));
    const out: Record<string, CesionActiva> = {};
    for (const c of cesiones) {
      if (c.estado !== 'Cedida' || !c.facturaAppId) continue;
      const d = deu.get(c.deudaUuid);
      out[c.facturaAppId] = { factorajeId: d?.app ?? '', financiador: d?.fin ?? '—', montoCedido: c.montoCedido, fechaCesion: c.fechaCesion };
    }
    return out;
  } catch {
    return {};
  }
}
