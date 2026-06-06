/**
 * F-049 — Lectura de FACTURAS_IN para el listado en /gastos.
 *
 * Patrón de lectura con returnFieldsByFieldId: true (regla F-047.2: cero
 * acceso por nombre de campo). El mapper expone un objeto camelCase para
 * que la UI sea agnóstica del esquema Airtable.
 */

import { airtable, USE_MOCK } from './airtable';
import { FACTURAS_IN_TABLE_ID, FACTURAS_IN_FIELDS, type FacturaInFieldKey } from '@/lib/airtable/facturas-in-fields';

export type EstatusFacturaIn = 'Pendiente' | 'Validada' | 'Anulada' | string;

export interface FacturaIn {
  id: string;
  proveedorNombre: string;
  proveedorNit: string;
  serie: string;
  numero: string;
  fechaEmision: string;
  moneda: string;
  subtotal: number;
  iva: number;
  total: number;
  pais: string;
  tipoDoc: string;
  estatus: EstatusFacturaIn;
  fuente: string;
  textoOcr: string;
  subidoPor: string;
  fechaSubida: string;
  archivoUrl?: string;
  archivoNombre?: string;
  docKey?: string;
  fileHash?: string;
  // F-049.2
  confianzaExtraccion?: number;
  datosNormalizados?: string;            // JSON blob crudo (parsea opcional en UI)
  datosNormalizadosOk: boolean;
}

interface AttachmentLike {
  url?: string;
  filename?: string;
}

const numFromField = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function mapRecord(rec: { id: string; fields: Record<string, unknown> }): FacturaIn {
  const f = rec.fields;
  const get = (key: FacturaInFieldKey): unknown => f[FACTURAS_IN_FIELDS[key]];

  const adjuntos = get('archivo_adjunto') as AttachmentLike[] | undefined;
  const principalAdjunto = adjuntos?.[0];

  return {
    id: rec.id,
    proveedorNombre: String(get('proveedor_nombre') ?? '').trim(),
    proveedorNit:    String(get('proveedor_nit') ?? '').trim(),
    serie:           String(get('serie') ?? ''),
    numero:          String(get('numero') ?? ''),
    fechaEmision:    String(get('fecha_emision') ?? ''),
    moneda:          String(get('moneda') ?? 'Q'),
    subtotal:        numFromField(get('subtotal')),
    iva:             numFromField(get('iva')),
    total:           numFromField(get('total')),
    pais:            String(get('pais') ?? ''),
    tipoDoc:         String(get('tipo_doc') ?? ''),
    estatus:         (String(get('estatus') ?? 'Pendiente')) as EstatusFacturaIn,
    fuente:          String(get('fuente') ?? ''),
    textoOcr:        String(get('texto_ocr') ?? ''),
    subidoPor:       String(get('subido_por') ?? ''),
    fechaSubida:     String(get('fecha_subida') ?? ''),
    archivoUrl:      principalAdjunto?.url ?? (String(get('archivo_url') ?? '') || undefined),
    archivoNombre:   principalAdjunto?.filename,
    docKey:          String(get('doc_key') ?? '') || undefined,
    fileHash:        String(get('file_hash') ?? '') || undefined,
    confianzaExtraccion: typeof get('confianza_extraccion') === 'number'
      ? (get('confianza_extraccion') as number)
      : undefined,
    datosNormalizados:   String(get('datos_normalizados') ?? '') || undefined,
    datosNormalizadosOk: Boolean(get('datos_normalizados_ok')),
  };
}

export interface FacturasInFiltros {
  desde?: string;        // YYYY-MM-DD inclusive (sobre fecha_subida)
  hasta?: string;
  estatus?: EstatusFacturaIn;
  subidoPor?: string;
  limit?: number;
}

export async function getFacturasIn(filtros: FacturasInFiltros = {}): Promise<FacturaIn[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(FACTURAS_IN_TABLE_ID)
      .select({
        returnFieldsByFieldId: true,
        sort: [{ field: FACTURAS_IN_FIELDS.fecha_subida, direction: 'desc' }],
      })
      .all();

    let lista = records.map(r => mapRecord({ id: r.id, fields: r.fields as Record<string, unknown> }));

    if (filtros.estatus)   lista = lista.filter(f => f.estatus === filtros.estatus);
    if (filtros.subidoPor) lista = lista.filter(f => f.subidoPor === filtros.subidoPor);
    if (filtros.desde) {
      const d = filtros.desde;
      lista = lista.filter(f => (f.fechaSubida || '').slice(0, 10) >= d);
    }
    if (filtros.hasta) {
      const h = filtros.hasta;
      lista = lista.filter(f => (f.fechaSubida || '').slice(0, 10) <= h);
    }
    if (filtros.limit && filtros.limit > 0) lista = lista.slice(0, filtros.limit);

    return lista;
  } catch (err) {
    console.warn('F-049: getFacturasIn falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getFacturaInPorId(id: string): Promise<FacturaIn | null> {
  if (!airtable) return null;
  try {
    const records = await airtable(FACTURAS_IN_TABLE_ID)
      .select({ returnFieldsByFieldId: true, filterByFormula: `RECORD_ID() = '${id}'`, maxRecords: 1 })
      .all();
    if (records.length === 0) return null;
    return mapRecord({ id: records[0].id, fields: records[0].fields as Record<string, unknown> });
  } catch {
    return null;
  }
}

/** Top N facturas más recientes (default 50, suficiente para la primera vista). */
export async function getFacturasInRecientes(limit = 50): Promise<FacturaIn[]> {
  return getFacturasIn({ limit });
}

export interface KPIsFacturasIn {
  totalPendientes: number;
  montoTotalPendientes: number;
  subidasUltimos7Dias: number;
  porSubidor: Array<{ email: string; cantidad: number }>;
}

export async function getKPIsFacturasIn(): Promise<KPIsFacturasIn> {
  const todas = await getFacturasIn();
  const pendientes = todas.filter(f => f.estatus === 'Pendiente');
  const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recientes = todas.filter(f => (f.fechaSubida || '').slice(0, 10) >= hace7);

  const subidorMap = new Map<string, number>();
  for (const f of todas) {
    if (!f.subidoPor) continue;
    subidorMap.set(f.subidoPor, (subidorMap.get(f.subidoPor) ?? 0) + 1);
  }
  const porSubidor = [...subidorMap.entries()]
    .map(([email, cantidad]) => ({ email, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    totalPendientes: pendientes.length,
    montoTotalPendientes: pendientes.reduce((s, f) => s + f.total, 0),
    subidasUltimos7Dias: recientes.length,
    porSubidor,
  };
}
