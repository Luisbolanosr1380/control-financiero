'use server';

/**
 * F-047 — Server actions de boletas de pago.
 *
 *  - generarBoletaAction(lineaId, opts): genera PDF y lo sube como adjunto
 *    a la línea de planilla en Airtable. Si ya existía, requiere `motivo`
 *    para sobreescribir y registra en NOTAS de la línea.
 *  - generarBoletasMasivoAction(periodoId): bulk para todas las Pagadas
 *    del período; reporta por línea ok/error.
 *  - descargarBoletaAction(lineaId): devuelve el PDF en base64 (los Server
 *    Actions no pueden retornar Buffer/Blob directos, así que el caller
 *    decodifica del lado cliente).
 */

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { generarBoletaPago, nombreArchivoBoleta } from '@/lib/boletas/generar-boleta';
import { airtable, TABLES } from '@/lib/db/airtable';
import {
  uploadAttachment,
  BOLETA_FIELD_ID,
  ATTACHMENT_MIME_PDF,
} from '@/lib/db/attachments';
import { obtenerDateTimeHoyGuatemala } from '@/lib/utils/fechas';
import { getPeriodoPorId } from '@/lib/db/planillas';

const FL_NOTAS = 'NOTAS';

function revalidar(periodoId?: string, empleadoId?: string) {
  revalidatePath('/planillas');
  if (periodoId)  revalidatePath(`/planillas/${periodoId}`);
  if (empleadoId) revalidatePath(`/empleados/${empleadoId}`);
  revalidatePath('/empleados', 'layout');
}

async function appendNota(lineaId: string, mensaje: string): Promise<void> {
  if (!airtable) return;
  try {
    const r = await airtable(TABLES.PLANILLA).find(lineaId);
    const previo = String(r.fields[FL_NOTAS] ?? '').trim();
    const nueva = previo ? `${previo}\n${mensaje}` : mensaje;
    await airtable(TABLES.PLANILLA).update([{ id: lineaId, fields: { [FL_NOTAS]: nueva } }]);
  } catch {
    /* fail-soft: el log no detiene la generación */
  }
}

export interface GenerarBoletaActionResult {
  ok: boolean;
  lineaId: string;
  empleadoNombre?: string;
  filename?: string;
  yaExistia?: boolean;
  error?: string;
}

export async function generarBoletaAction(
  lineaId: string,
  opts: { motivoRegeneracion?: string } = {},
): Promise<GenerarBoletaActionResult> {
  if (!airtable) return { ok: false, lineaId, error: 'Airtable no está configurado.' };
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';

  // F-047.1: una sola lectura del record para obtener (a) si ya existe boleta,
  // (b) periodoId + empleadoId para revalidar los paths específicos al final.
  // El brief original solo revalidaba /planillas raíz — la página dinámica
  // /planillas/[id] quedaba cacheada y el UI no refrescaba el "📄✓".
  let yaExistia = false;
  let periodoId: string | undefined;
  let empleadoId: string | undefined;
  try {
    const rec = await airtable(TABLES.PLANILLA).find(lineaId);
    const att = rec.fields['Adjunto'] as Array<{ url?: string }> | undefined;
    yaExistia  = (att?.length ?? 0) > 0;
    periodoId  = (rec.fields['PERIODO']  as string[] | undefined)?.[0];
    empleadoId = (rec.fields['EMPLEADO '] as string[] | undefined)?.[0];   // OJO espacio (igual que FL.EMPLEADO)
  } catch {
    /* la generación abajo va a fallar igual si no se encuentra */
  }
  if (yaExistia && !opts.motivoRegeneracion?.trim()) {
    return { ok: false, lineaId, yaExistia: true, error: 'Esta línea ya tiene boleta. Indicá un motivo de regeneración para sobreescribir.' };
  }

  const gen = await generarBoletaPago(lineaId, email);
  if (!gen.ok || !gen.pdf) return { ok: false, lineaId, error: gen.error ?? 'Falló la generación del PDF.' };

  // F-047.1: la Content API de Airtable hace APPEND, no REPLACE. Sin esta
  // limpieza previa, cada regeneración deja N adjuntos acumulados — el
  // listado de Stark confirmó 1 línea con 2 PDFs duplicados. Limpiamos
  // explícitamente el campo antes del upload nuevo. Histórico de
  // regeneraciones ya queda en NOTAS, no perdemos auditoría.
  if (yaExistia) {
    try {
      await airtable(TABLES.PLANILLA).update([{ id: lineaId, fields: { 'Adjunto': [] } }]);
    } catch (err) {
      return { ok: false, lineaId, error: `No se pudo limpiar la boleta anterior: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const filename = nombreArchivoBoleta(gen.empleadoNombre ?? 'empleado', gen.periodoNombre ?? 'periodo');
  try {
    await uploadAttachment(lineaId, BOLETA_FIELD_ID, filename, ATTACHMENT_MIME_PDF, gen.pdf);
  } catch (err) {
    return { ok: false, lineaId, error: `Subida a Airtable falló: ${err instanceof Error ? err.message : String(err)}` };
  }

  const ts = obtenerDateTimeHoyGuatemala();
  if (yaExistia) {
    await appendNota(lineaId, `[${ts}] Boleta regenerada por ${email}. Motivo: ${opts.motivoRegeneracion!.trim()}.`);
  } else {
    await appendNota(lineaId, `[${ts}] Boleta generada por ${email}.`);
  }

  // F-047.1: revalidate específico al periodo + empleado, para que el server
  // component re-fetch con boletaUrl poblado y el UI muestre "📄✓"
  // inmediatamente tras router.refresh() en el cliente.
  revalidar(periodoId, empleadoId);
  return { ok: true, lineaId, empleadoNombre: gen.empleadoNombre, filename, yaExistia };
}

export interface GenerarBoletasMasivoResult {
  ok: boolean;
  periodoId: string;
  total: number;
  generadas: number;
  regeneradas: number;
  saltadas: number;        // no Pagadas
  fallidas: Array<{ lineaId: string; empleadoNombre?: string; error: string }>;
}

export async function generarBoletasMasivoAction(periodoId: string): Promise<GenerarBoletasMasivoResult> {
  const periodo = await getPeriodoPorId(periodoId);
  if (!periodo) {
    return { ok: false, periodoId, total: 0, generadas: 0, regeneradas: 0, saltadas: 0, fallidas: [] };
  }
  const pagadas = periodo.lineas.filter(l => l.estadoPago === 'Pagado');
  const saltadas = periodo.lineas.length - pagadas.length;

  const fallidas: GenerarBoletasMasivoResult['fallidas'] = [];
  let generadas = 0;
  let regeneradas = 0;

  // En serie para no saturar Airtable rate limits.
  for (const l of pagadas) {
    const tieneBoleta = !!l.boletaUrl;
    const res = await generarBoletaAction(l.id, tieneBoleta
      ? { motivoRegeneracion: 'Regeneración masiva del período' }
      : {});
    if (res.ok) {
      if (res.yaExistia) regeneradas += 1;
      else               generadas += 1;
    } else {
      fallidas.push({ lineaId: l.id, empleadoNombre: l.empleadoNombre, error: res.error ?? 'Error desconocido' });
    }
  }

  revalidar(periodoId);
  return {
    ok: fallidas.length === 0,
    periodoId,
    total: pagadas.length,
    generadas,
    regeneradas,
    saltadas,
    fallidas,
  };
}

export interface DescargarBoletaActionResult {
  ok: boolean;
  filename?: string;
  base64?: string;
  error?: string;
}

/**
 * Genera la boleta on-demand y la devuelve como base64 para descarga directa
 * desde el cliente. NO la sube a Airtable (no es side-effect de descargar).
 */
export async function descargarBoletaAction(lineaId: string): Promise<DescargarBoletaActionResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';
  const gen = await generarBoletaPago(lineaId, email);
  if (!gen.ok || !gen.pdf) return { ok: false, error: gen.error ?? 'Falló la generación.' };
  return {
    ok: true,
    filename: nombreArchivoBoleta(gen.empleadoNombre ?? 'empleado', gen.periodoNombre ?? 'periodo'),
    base64: gen.pdf.toString('base64'),
  };
}
