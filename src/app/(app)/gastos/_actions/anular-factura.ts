'use server';

/**
 * F-050 — Server action: anular una FACTURA_IN.
 *
 * Solo aplica si la factura NO fue aprobada. Si ya tiene GASTO asociado,
 * Stark debe usar el flujo de anulación de GASTO (no implementado en F-050;
 * va en F-050.1 con reverso de asiento).
 *
 * El motivo se persiste en `datos_normalizados` como un JSON anexo, no
 * sobrescribiendo el contenido previo. Eso preserva la metadata de
 * extracción (F-049.2) y permite reconstruir la historia de la factura.
 */

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { airtable } from '@/lib/db/airtable';
import {
  FACTURAS_IN_TABLE_ID,
  FACTURAS_IN_FIELDS,
} from '@/lib/airtable/facturas-in-fields';
import { findRecordById, selectValue } from '@/lib/airtable/find-by-id';
import { obtenerDateTimeHoyGuatemala } from '@/lib/utils/fechas';
import { writeSource } from '@/lib/config/data-source';
import { getFacturaInPorId } from '@/lib/db/facturas-in';
import { sbAnularFacturaIn } from '@/lib/gastos/supabase-gastos';

export interface AnularFacturaInput {
  facturaInId: string;
  motivo: string;
}

export interface AnularFacturaResult {
  ok: boolean;
  error?: string;
}

const MIN_MOTIVO_CHARS = 5;

export async function anularFacturaAction(input: AnularFacturaInput): Promise<AnularFacturaResult> {
  const escribeSupabase = writeSource('gastos') === 'supabase';
  if (!airtable && !escribeSupabase) return { ok: false, error: 'Airtable no está configurado.' };

  const motivo = (input.motivo ?? '').trim();
  if (motivo.length < MIN_MOTIVO_CHARS) {
    return { ok: false, error: `Motivo debe tener al menos ${MIN_MOTIVO_CHARS} caracteres.` };
  }
  if (!input.facturaInId) return { ok: false, error: 'facturaInId requerido.' };

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';

  // FASE 2.3: leer del backend activo de la operación.
  let estatusActual: string;
  let datosPrevios: string;
  if (escribeSupabase) {
    const fin = await getFacturaInPorId(input.facturaInId);
    if (!fin) return { ok: false, error: `No se pudo cargar la factura ${input.facturaInId}.` };
    estatusActual = fin.estatus;
    datosPrevios  = fin.datosNormalizados ?? '';
  } else {
    // F-050.3: `.find()` no acepta returnFieldsByFieldId → estatus leído por
    // field ID quedaba "". Helper findRecordById usa select+RECORD_ID().
    const r = await findRecordById(FACTURAS_IN_TABLE_ID, input.facturaInId);
    if (!r) {
      return { ok: false, error: `No se pudo cargar la factura ${input.facturaInId}.` };
    }
    estatusActual = selectValue(r.fields[FACTURAS_IN_FIELDS.estatus]);
    datosPrevios  = String(r.fields[FACTURAS_IN_FIELDS.datos_normalizados] ?? '');
  }

  if (estatusActual === 'Aprobada') {
    return {
      ok: false,
      error: 'Esta factura ya tiene gasto asociado. Anular el gasto desde su propia vista (flujo no implementado en F-050).',
    };
  }
  if (estatusActual !== 'Pendiente') {
    return { ok: false, error: `La factura está en estatus "${estatusActual}". Solo se anulan Pendientes.` };
  }

  // Construir el datos_normalizados con anexo de anulación.
  const ahora = obtenerDateTimeHoyGuatemala();
  let blobPrevio: Record<string, unknown> = {};
  if (datosPrevios) {
    try { blobPrevio = JSON.parse(datosPrevios); } catch { /* texto no-JSON: lo descartamos del parse y guardamos el motivo aparte */ }
  }
  const blobNuevo = {
    ...blobPrevio,
    anulado: {
      motivo,
      por:   email,
      fecha: ahora,
    },
  };

  try {
    if (escribeSupabase) {
      await sbAnularFacturaIn(input.facturaInId, JSON.stringify(blobNuevo));
    } else {
      await airtable!(FACTURAS_IN_TABLE_ID).update([{
        id: input.facturaInId,
        fields: {
          [FACTURAS_IN_FIELDS.estatus]:            'Anulada',
          [FACTURAS_IN_FIELDS.datos_normalizados]: JSON.stringify(blobNuevo),
        },
      }], { typecast: true });
    }
  } catch (err) {
    return { ok: false, error: `Error al actualizar: ${err instanceof Error ? err.message : String(err)}` };
  }

  revalidatePath('/gastos');
  return { ok: true };
}
