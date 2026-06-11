/**
 * F-051 — Orquestador: une recurrentes + CxP + deudas + planilla + cobros
 * en una proyección diaria con saldo acumulado.
 *
 * Horizonte: días desde HOY (incluido) hasta HOY + (horizonteDias - 1).
 * Default 60. Soportado: 30 / 60 / 90 (la UI lo controla).
 *
 * El cálculo del saldo acumulado parte de `saldoInicial` (input) — no se
 * recomputa contra MOVIMIENTOS_BANCARIOS porque la conciliación todavía
 * no es confiable. El input lo provee la UI (manual o estimado por
 * `getSaldoInicialBancos`).
 */

import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { sumarDias, proyectarObligaciones } from './proyectar-recurrentes';
import {
  cxpDesdeGastos,
  pagosDesdeDeudas,
  planillaProyectada,
  cobrosEsperados,
} from './fuentes';
import { getObligacionesRecurrentes } from './obligaciones';
import type { DiaFlujo, EventoFlujo, ProyeccionFlujo } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

const PRIORIDAD_ORDEN: Record<EventoFlujo['prioridad'], number> = {
  'Crítica': 0,
  'Alta': 1,
  'Media': 2,
  'Baja': 3,
};

function ordenarEventos(eventos: EventoFlujo[]): EventoFlujo[] {
  // Ingresos al final del día (para que el saldo "muestre primero el agujero").
  return [...eventos].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'egreso' ? -1 : 1;
    return PRIORIDAD_ORDEN[a.prioridad] - PRIORIDAD_ORDEN[b.prioridad];
  });
}

export interface ConstruirFlujoInput {
  horizonteDias?: number;
  saldoInicial?: number;
  fechaDesde?: string;     // override de "hoy". YYYY-MM-DD.
}

export async function construirFlujo(input: ConstruirFlujoInput = {}): Promise<ProyeccionFlujo> {
  const horizonteDias = input.horizonteDias ?? 60;
  const fechaDesde = input.fechaDesde ?? obtenerFechaHoyGuatemala();
  const fechaHasta = sumarDias(fechaDesde, Math.max(0, horizonteDias - 1));
  const saldoInicial = input.saldoInicial ?? 0;

  const [obligaciones, cxp, deudas, planilla, cobros] = await Promise.all([
    getObligacionesRecurrentes(true),
    cxpDesdeGastos(fechaDesde, fechaHasta),
    pagosDesdeDeudas(fechaDesde, fechaHasta),
    planillaProyectada(fechaDesde, fechaHasta),
    cobrosEsperados(fechaDesde, fechaHasta),
  ]);

  const recurrentes = proyectarObligaciones(obligaciones, fechaDesde, fechaHasta);
  const todos: EventoFlujo[] = [...recurrentes, ...cxp, ...deudas, ...planilla, ...cobros];

  // Agrupar por fecha.
  const porFecha = new Map<string, EventoFlujo[]>();
  for (const ev of todos) {
    const list = porFecha.get(ev.fecha) ?? [];
    list.push(ev);
    porFecha.set(ev.fecha, list);
  }

  const fechasOrdenadas = [...porFecha.keys()].sort();
  let saldo = saldoInicial;
  let totalEgresos = 0;
  let totalIngresos = 0;
  const dias: DiaFlujo[] = [];
  let puntoCritico: ProyeccionFlujo['puntoCritico'] = null;

  for (const fecha of fechasOrdenadas) {
    const eventos = ordenarEventos(porFecha.get(fecha)!);
    const egresos = round2(eventos.filter(e => e.tipo === 'egreso').reduce((s, e) => s + e.monto, 0));
    const ingresos = round2(eventos.filter(e => e.tipo === 'ingreso').reduce((s, e) => s + e.monto, 0));
    const neto = round2(ingresos - egresos);
    saldo = round2(saldo + neto);
    totalEgresos = round2(totalEgresos + egresos);
    totalIngresos = round2(totalIngresos + ingresos);
    dias.push({
      fecha,
      eventos,
      totalEgresos: egresos,
      totalIngresos: ingresos,
      neto,
      saldoProyectado: saldo,
    });
    if (!puntoCritico || saldo < puntoCritico.saldoProyectado) {
      puntoCritico = {
        fecha,
        saldoProyectado: saldo,
        seraNegativo: saldo < 0,
      };
    }
  }

  return {
    saldoInicial,
    horizonteDias,
    fechaDesde,
    fechaHasta,
    dias,
    totalEgresos,
    totalIngresos,
    puntoCritico,
  };
}
