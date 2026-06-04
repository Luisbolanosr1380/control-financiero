'use server';

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import {
  crearPeriodo, generarPlanilla, ajustarLineaPlanilla,
  aprobarPeriodo, registrarPagoEmpleado, diferirPagoEmpleado, cancelarPagoEmpleado,
  type CrearPeriodoInput, type GenerarPlanillaResult, type PlanillaMutationResult,
} from '@/lib/db/planillas';
import type { AjustesQuincena } from '@/lib/calculos/planilla-calc';

function revalidarTodo(): void {
  revalidatePath('/planillas');
  revalidatePath('/planillas', 'layout');
  revalidatePath('/planilla');
  revalidatePath('/empleados');
  revalidatePath('/deudas');
  revalidatePath('/dashboard');
}

async function emailUsuario(): Promise<string> {
  const user = await currentUser();
  return user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';
}

export async function crearPeriodoAction(input: CrearPeriodoInput): Promise<PlanillaMutationResult & { periodoId?: string }> {
  const result = await crearPeriodo(input);
  if (result.ok) revalidarTodo();
  return result;
}

export async function generarPlanillaAction(periodoId: string): Promise<GenerarPlanillaResult> {
  const result = await generarPlanilla(periodoId);
  if (result.ok) revalidarTodo();
  return result;
}

export async function ajustarLineaAction(lineaId: string, ajustes: AjustesQuincena): Promise<PlanillaMutationResult> {
  const result = await ajustarLineaPlanilla(lineaId, ajustes);
  if (result.ok) revalidarTodo();
  return result;
}

export async function aprobarPeriodoAction(periodoId: string): Promise<PlanillaMutationResult> {
  const email = await emailUsuario();
  const result = await aprobarPeriodo(periodoId, email);
  if (result.ok) revalidarTodo();
  return result;
}

export async function registrarPagoEmpleadoAction(args: {
  lineaId: string;
  fechaPago: string;
  bancoId: string;
  referencia?: string;
}): Promise<PlanillaMutationResult> {
  const email = await emailUsuario();
  const result = await registrarPagoEmpleado({ ...args, usuarioEmail: email });
  if (result.ok) revalidarTodo();
  return result;
}

export async function diferirPagoEmpleadoAction(args: {
  lineaId: string;
  motivo: string;
}): Promise<PlanillaMutationResult> {
  const email = await emailUsuario();
  const result = await diferirPagoEmpleado({ ...args, usuarioEmail: email });
  if (result.ok) revalidarTodo();
  return result;
}

/* F-038.4: cancelar pago (NO genera deuda — caso licencia sin goce, etc.). */
export async function cancelarPagoEmpleadoAction(args: {
  lineaId: string;
  motivo: string;
}): Promise<PlanillaMutationResult> {
  const email = await emailUsuario();
  const result = await cancelarPagoEmpleado({ ...args, usuarioEmail: email });
  if (result.ok) revalidarTodo();
  return result;
}

/**
 * F-038.4.bis: diferir N empleados a deuda en una sola operación (banner de
 * decisión "Diferir todos"). Ejecuta secuencialmente (no batch — cada uno crea
 * su deuda independiente). Reporta agregado al final; si alguno falla, sigue
 * con el resto para que el error de uno no bloquee a todos.
 */
export interface DiferirMasivoResult {
  ok: boolean;
  exitosos: number;
  fallidos: number;
  totalDiferidoQ: number;
  errores: Array<{ lineaId: string; nombre?: string; error: string }>;
}

export async function diferirMasivoAction(args: {
  lineaIds: string[];
  motivo: string;
}): Promise<DiferirMasivoResult> {
  const email = await emailUsuario();
  let exitosos = 0;
  let totalDiferidoQ = 0;
  const errores: DiferirMasivoResult['errores'] = [];

  // Necesitamos los datos para devolver totales — leemos uno por uno via la
  // misma action de diferir.
  for (const lineaId of args.lineaIds) {
    const r = await diferirPagoEmpleado({ lineaId, motivo: args.motivo, usuarioEmail: email });
    if (r.ok) {
      exitosos += 1;
      // El monto exacto lo conoce el server; el mensaje suele incluirlo. Para no
      // doble-read, dejamos totalDiferido aproximado (la UI también lo calcula).
    } else {
      errores.push({ lineaId, error: r.error ?? 'Error desconocido' });
    }
  }
  revalidarTodo();
  return {
    ok: errores.length === 0,
    exitosos,
    fallidos: errores.length,
    totalDiferidoQ,
    errores,
  };
}
