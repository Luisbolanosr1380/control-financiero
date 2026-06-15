'use server';

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import {
  crearPeriodo, generarPlanilla, ajustarLineaPlanilla,
  aprobarPeriodo, registrarPagoEmpleado, diferirPagoEmpleado, cancelarPagoEmpleado,
  getPeriodoPorId,
  type CrearPeriodoInput, type GenerarPlanillaResult, type PlanillaMutationResult,
} from '@/lib/db/planillas';
import type { AjustesQuincena } from '@/lib/calculos/planilla-calc';
import { getEmpleados } from '@/lib/db/empleados';
import {
  previewAsientoPlanilla,
  generarAsientoPlanilla,
  type PreviewAsientoPlanilla,
  type ResultadoGeneracion,
} from '@/lib/planilla/generar-asiento-planilla';

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

/* =========================================================================
 * F-056.2 — Asiento de planilla (multi-empresa)
 * ========================================================================= */

async function armarInputAsiento(periodoId: string, bancoId: string) {
  const datos = await getPeriodoPorId(periodoId);
  if (!datos) return { ok: false as const, error: 'Período no encontrado.' };
  const empleados = await getEmpleados({ status: 'todos' });
  const empleadosMin = empleados.map(e => ({
    id:                 e.id,
    nombre:             e.nombre,
    empresaEmpleadora:  e.empresaEmpleadora,
    igssPatronal:       e.igssPatronal,
    centroCostoId:      e.centroCostoId,
  }));
  const lineasMin = datos.lineas
    .filter(l => l.estadoPago !== 'Cancelado')
    .map(l => ({
      id:               l.id,
      empleadoId:       l.empleadoId,
      centroCostoId:    l.centroCostoId,
      ordinario:        l.ordinario,
      bonificacion:     l.bonificacion,
      extraordinario:   l.extraordinario,
      comisiones:       l.comisiones,
      otrosIngresos:    l.otrosIngresos,
      igssLaboral:      l.igssLaboral,
      isr:              l.isr,
      netoPagar:        l.netoPagar,
    }));
  return {
    ok: true as const,
    input: {
      periodoId,
      periodoNombre: datos.periodo.nombre,
      // Fecha del asiento = fechaFin del período (último día de la quincena).
      fechaAsiento:  datos.periodo.fechaFin,
      lineas:        lineasMin,
      empleados:     empleadosMin,
      bancoId,
    },
  };
}

export async function previewAsientoPlanillaAction(args: {
  periodoId: string;
  bancoId: string;
}): Promise<{ ok: true; preview: PreviewAsientoPlanilla } | { ok: false; error: string }> {
  const armado = await armarInputAsiento(args.periodoId, args.bancoId);
  if (!armado.ok) return armado;
  try {
    const preview = await previewAsientoPlanilla(armado.input);
    return { ok: true, preview };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function generarAsientoPlanillaAction(args: {
  periodoId: string;
  bancoId: string;
}): Promise<ResultadoGeneracion> {
  const armado = await armarInputAsiento(args.periodoId, args.bancoId);
  if (!armado.ok) return { ok: false, error: armado.error };
  const result = await generarAsientoPlanilla(armado.input);
  if (result.ok) revalidarTodo();
  return result;
}
