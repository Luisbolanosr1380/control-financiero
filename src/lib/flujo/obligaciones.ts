/**
 * F-051 — Lectura de OBLIGACIONES_RECURRENTES.
 *
 * Solo lectura tipada acá. El CRUD vive en `_actions/obligaciones.ts` y se
 * llama desde la UI. La proyección a EventoFlujo está en `proyectar-recurrentes.ts`.
 */

import { airtable } from '@/lib/db/airtable';
import {
  OBLIGACIONES_RECURRENTES_TABLE_ID,
  OBLIGACIONES_RECURRENTES_FIELDS as FO,
  POR_CUENTA_DE_OPCIONES,
  POR_CUENTA_DE_DEFAULT,
  type TipoObligacion,
  type FrecuenciaObligacion,
  type PrioridadObligacion,
  type PorCuentaDe,
} from '@/lib/airtable/obligaciones-recurrentes-fields';

export interface ObligacionRecurrente {
  id: string;
  nombre: string;
  tipo: TipoObligacion;
  montoEstimado: number;
  diaPago: number;                      // 1..31
  frecuencia: FrecuenciaObligacion;
  prioridad: PrioridadObligacion;
  proveedorId?: string;
  acreedorId?: string;
  centroCostoId?: string;
  cuentaContableId?: string;
  bancoPagoId?: string;
  /** YYYY-MM-DD del mes ancla — usado para ciclos > mensual. */
  mesReferencia?: string;
  activo: boolean;
  notas?: string;
  /** F-051.2: si existe, la obligación no genera eventos antes de esta fecha. */
  fechaInicio?: string;
  /** F-051.2: si existe, la obligación no genera eventos después de esta fecha. */
  fechaFin?: string;
  /** F-051.6: empresa que asume el pago (default Golden Talent). */
  porCuentaDe: PorCuentaDe;
}

const arrFirst = (v: unknown): string | undefined => {
  if (Array.isArray(v) && v.length > 0) {
    const x = v[0];
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && 'id' in (x as object)) return String((x as { id: unknown }).id ?? '');
  }
  return undefined;
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const selectStr = (v: unknown): string => {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && 'name' in (v as object)) {
    return String((v as { name?: unknown }).name ?? '').trim();
  }
  return '';
};

function tipoFromAirtable(v: unknown): TipoObligacion {
  const s = selectStr(v);
  if (s === 'Renta' || s === 'Servicio' || s === 'Tarjeta' || s === 'Seguro' || s === 'Suscripción' || s === 'Impuesto' || s === 'Otro') return s;
  return 'Otro';
}
function frecuenciaFromAirtable(v: unknown): FrecuenciaObligacion {
  const s = selectStr(v);
  if (s === 'Mensual' || s === 'Quincenal' || s === 'Bimestral' || s === 'Trimestral' || s === 'Anual') return s;
  return 'Mensual';
}
function prioridadFromAirtable(v: unknown): PrioridadObligacion {
  const s = selectStr(v);
  if (s === 'Crítica' || s === 'Alta' || s === 'Media' || s === 'Baja') return s;
  return 'Media';
}
function porCuentaDeFromAirtable(v: unknown): PorCuentaDe {
  const s = selectStr(v);
  return (POR_CUENTA_DE_OPCIONES as readonly string[]).includes(s)
    ? (s as PorCuentaDe)
    : POR_CUENTA_DE_DEFAULT;
}

function mapObligacion(rec: { id: string; fields: Record<string, unknown> }): ObligacionRecurrente {
  const f = rec.fields;
  return {
    id: rec.id,
    nombre:           String(f[FO.nombre] ?? '').trim(),
    tipo:             tipoFromAirtable(f[FO.tipo]),
    montoEstimado:    num(f[FO.monto_estimado]),
    diaPago:          num(f[FO.dia_pago]),
    frecuencia:       frecuenciaFromAirtable(f[FO.frecuencia]),
    prioridad:        prioridadFromAirtable(f[FO.prioridad]),
    proveedorId:      arrFirst(f[FO.proveedor]),
    acreedorId:       arrFirst(f[FO.acreedor]),
    centroCostoId:    arrFirst(f[FO.centro_costo]),
    cuentaContableId: arrFirst(f[FO.cuenta_contable]),
    bancoPagoId:      arrFirst(f[FO.banco_pago]),
    mesReferencia:    String(f[FO.mes_referencia] ?? '').trim() || undefined,
    activo:           Boolean(f[FO.activo]),
    notas:            String(f[FO.notas] ?? '').trim() || undefined,
    fechaInicio:      String(f[FO.fecha_inicio] ?? '').slice(0, 10) || undefined,
    fechaFin:         String(f[FO.fecha_fin] ?? '').slice(0, 10) || undefined,
    porCuentaDe:      porCuentaDeFromAirtable(f[FO.por_cuenta_de]),
  };
}

export async function getObligacionesRecurrentes(soloActivas = false): Promise<ObligacionRecurrente[]> {
  if (!airtable) return [];
  try {
    const recs = await airtable(OBLIGACIONES_RECURRENTES_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const lista = recs.map(r => mapObligacion({ id: r.id, fields: r.fields as Record<string, unknown> }));
    return soloActivas ? lista.filter(o => o.activo) : lista;
  } catch (err) {
    console.warn('F-051 getObligacionesRecurrentes falló:', err instanceof Error ? err.message : err);
    return [];
  }
}
