'use server';

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import {
  anularFactura,
  editarFacturaNoContable,
  type AnularFacturaResult,
  type EditarFacturaResult,
  type MotivoAnulacion,
  type CambiosFacturaPermitidos,
} from '@/lib/db/facturas';
import {
  crearNotaCredito,
  anularNotaCredito,
  aprobarNotaCredito,
  type CrearNotaCreditoInput,
  type CrearNotaCreditoResult,
  type AnularNCResult,
  type AprobarNCResult,
} from '@/lib/db/notas-credito';
import { getRolUsuario } from '@/lib/auth/allowlist';
import {
  registrarCobro, anularCobro, anularCobroLegacy,
  type RegistrarCobroInput, type RegistrarCobroResult, type AnularCobroResult,
} from '@/lib/db/cobros';
import {
  uploadAttachment,
  CONSTANCIA_FIELD_ID,
  ATTACHMENT_MIME_ACCEPTED,
  ATTACHMENT_MAX_BYTES,
} from '@/lib/db/attachments';

export type AnularResult = AnularFacturaResult;
export type CobroResult = RegistrarCobroResult & {
  /** F-035.1: avisos no-fatales (ej. "constancia del componente #2 no se pudo subir"). */
  avisos?: string[];
};

function revalidarTodo() {
  revalidatePath('/facturacion');
  revalidatePath('/facturacion', 'layout');   // alcanza /facturacion/[id]
  revalidatePath('/dashboard');
  revalidatePath('/clientes');
  revalidatePath('/analitica');
  revalidatePath('/cobros');
  revalidatePath('/cobros/identificar');
  revalidatePath('/retenciones');
  revalidatePath('/notas-credito');           // F-045
}

export async function anularFacturaAction(
  noFactura: string,
  motivo?: string,
  motivoTipo?: MotivoAnulacion,
): Promise<AnularResult> {
  const result = await anularFactura(noFactura, motivo, motivoTipo);
  if (result.ok || result.recordsActualizados > 0) revalidarTodo();
  return result;
}

/**
 * F-035.1: acepta FormData con el JSON del cobro + N archivos `constancia_<idx>`
 * para componentes de retención. Mismo patrón que crearFacturaAction usa para
 * el PDF de factura: registramos primero, después adjuntamos por separado para
 * que un upload caído no pierda el cobro.
 */
export async function registrarCobroAction(formData: FormData): Promise<CobroResult> {
  const raw = formData.get('data');
  if (typeof raw !== 'string') {
    return { ...errorResult('Datos del cobro faltantes en el formulario.') };
  }
  let input: RegistrarCobroInput;
  try {
    input = JSON.parse(raw) as RegistrarCobroInput;
  } catch {
    return { ...errorResult('Datos del cobro inválidos.') };
  }

  const result = await registrarCobro(input);
  const avisos: string[] = [];

  // Subir constancias (si las hay) — solo si los records se crearon ok.
  if (result.cobrosCreados > 0) {
    for (let i = 0; i < input.componentes.length; i++) {
      const file = formData.get(`constancia_${i}`);
      if (!(file instanceof File) || file.size === 0) continue;
      // Validación tipo + tamaño (espejo de lo que el modal valida cliente-side).
      if (!ATTACHMENT_MIME_ACCEPTED.includes(file.type as typeof ATTACHMENT_MIME_ACCEPTED[number])) {
        avisos.push(`Componente #${i + 1}: tipo de archivo no soportado (${file.type || 'desconocido'}).`);
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        avisos.push(`Componente #${i + 1}: archivo excede 15MB (${(file.size / 1024 / 1024).toFixed(1)}MB).`);
        continue;
      }
      const recordId = result.componentesRecordIds[i]?.[0];
      if (!recordId) {
        avisos.push(`Componente #${i + 1}: no se encontró record creado para subirle la constancia.`);
        continue;
      }
      try {
        const buf = await file.arrayBuffer();
        await uploadAttachment(recordId, CONSTANCIA_FIELD_ID, file.name, file.type, buf);
      } catch (err) {
        console.error(`Error subiendo constancia componente ${i}:`, err);
        avisos.push(`Componente #${i + 1}: cobro registrado pero la constancia no se pudo adjuntar (podés reintentar manualmente en Airtable).`);
      }
    }
  }

  if (result.ok || result.cobrosCreados > 0) revalidarTodo();
  return avisos.length > 0 ? { ...result, avisos } : result;
}

/* F-045: emitir nota de crédito desde el detalle de factura. */
export async function emitirNotaCreditoAction(input: CrearNotaCreditoInput): Promise<CrearNotaCreditoResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';
  const result = await crearNotaCredito(input, email);
  if (result.ok) revalidarTodo();
  return result;
}

/* F-045: aprobar una NC (solo admin). */
export async function aprobarNotaCreditoAction(ncId: string): Promise<AprobarNCResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);
  const esAdmin = rol === 'admin';
  const result = await aprobarNotaCredito(ncId, email || 'sistema', esAdmin);
  if (result.ok) revalidarTodo();
  return result;
}

/* F-045: anular una NC (revierte el saldo). */
export async function anularNotaCreditoAction(ncId: string, motivo: string): Promise<AnularNCResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';
  const result = await anularNotaCredito(ncId, motivo, email);
  if (result.ok) revalidarTodo();
  return result;
}

/* F-044: editar campos NO-contables de una factura. */
export async function editarFacturaAction(
  facturaId: string,
  cambios: CambiosFacturaPermitidos,
): Promise<EditarFacturaResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';
  const result = await editarFacturaNoContable(facturaId, cambios, email);
  if (result.ok) revalidarTodo();
  return result;
}

/* F-036: anular un cobro por grupoId (o por recordId si es legacy). */
export async function anularCobroAction(
  grupoId: string,
  motivo: string,
): Promise<AnularCobroResult> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';
  const result = grupoId.startsWith('__legacy__')
    ? await anularCobroLegacy(grupoId.replace('__legacy__', ''), motivo, email)
    : await anularCobro(grupoId, motivo, email);
  if (result.ok) revalidarTodo();
  return result;
}

function errorResult(msg: string): RegistrarCobroResult {
  return {
    ok: false,
    noFactura: '',
    grupoId: '',
    totalCobrado: 0,
    saldoAnterior: 0,
    saldoNuevo: 0,
    estadoNuevo: '',
    cobrosCreados: 0,
    recordsActualizados: 0,
    desglose: { transferencia: 0, cheque: 0, efectivo: 0, tarjeta: 0, retencionIVA: 0, retencionISR: 0 },
    componentesRecordIds: [],
    error: msg,
  };
}
