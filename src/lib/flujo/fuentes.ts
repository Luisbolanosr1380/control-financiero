/**
 * F-051 — Fuentes existentes (READ-ONLY) que alimentan el cash-flow planner.
 *
 *  a) CxP    — GASTOS no pagados ni anulados (Supabase).
 *  b) Deudas — DEUDAS activas con saldo > 0 y próximo pago calculable.
 *  c) Planilla — quincenas proyectadas desde la última planilla pagada.
 *  d) Cobros esperados — facturas con saldo pendiente, sin las cedidas (ingreso).
 *
 * Convención de fecha (lección F-041):
 *  - Toda comparación contra "hoy" usa obtenerFechaHoyGuatemala().
 *  - Constructor local de Date (`new Date(y, m-1, d)`) para no aplicar shift UTC.
 *
 * Tolerancia: si una fuente falla (Airtable down, schema cambió), atrapamos
 * el error y devolvemos []. El cash-flow se renderiza con las fuentes vivas.
 */

import { fetchAll } from '@/lib/supabase/client';
import { getFacturasPendientesCobro } from '@/lib/db/facturas-pendientes';
import { getDeudas } from '@/lib/db/deudas';
import { getEmpleados } from '@/lib/db/empleados';
import { getPeriodos, getLineasPlanilla } from '@/lib/db/planillas';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { sumarDias } from './proyectar-recurrentes';
import type { EventoFlujo } from './types';
import type { PrioridadObligacion } from '@/lib/airtable/obligaciones-recurrentes-fields';
import { esGolden, EMPRESA_EMPLEADORA_DEFAULT } from '@/lib/empleados/empresa';

const pad2 = (n: number) => String(n).padStart(2, '0');

/* ============================================================
 * a) CxP — GASTOS por pagar
 * ============================================================ */

const CXP_VENCIMIENTO_DEFAULT_DIAS = 30;

export async function cxpDesdeGastos(fechaDesde: string, fechaHasta: string): Promise<EventoFlujo[]> {
  try {
    // gastos vive en Supabase (flag 'gastos'); getGastos() es la lectura legacy de Airtable.
    const gastos = await fetchAll<Record<string, unknown>>('gastos', { select: 'airtable_id, fecha, fecha_vencimiento, monto, estado' });
    const out: EventoFlujo[] = [];
    for (const g of gastos) {
      if (/^(pagado|anulado)$/i.test(String(g.estado ?? '').trim())) continue;
      const monto = Number(g.monto ?? 0);
      if (!(monto > 0)) continue;
      let fecha = String(g.fecha_vencimiento ?? '').slice(0, 10);
      let fechaAjustada = false;
      if (!fecha) {
        if (!g.fecha) continue;
        // F-051: si falta vencimiento, asumir 30 días desde emisión.
        fecha = sumarDias(String(g.fecha).slice(0, 10), CXP_VENCIMIENTO_DEFAULT_DIAS);
        fechaAjustada = true;
      }
      if (fecha < fechaDesde || fecha > fechaHasta) continue;
      const id = String(g.airtable_id ?? '');
      out.push({
        fecha,
        tipo: 'egreso',
        fuente: 'cxp',
        descripcion: `CxP gasto ${id.slice(-6)}`,
        monto,
        prioridad: 'Alta',
        esEstimado: false,
        fechaAjustada,
        linkId: id,
        linkTipo: 'gasto',
      });
    }
    return out;
  } catch (err) {
    console.warn('F-051 cxpDesdeGastos falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* ============================================================
 * b) Pagos desde DEUDAS
 *
 * Estrategia de fecha de próximo pago:
 *  1. Si la deuda tiene `fechaVencimientoReal` o `fechaVencimiento` futura, usarla.
 *  2. Si ya está vencida pero con saldo > 0, proyectar a hoy + 7 días (flag).
 *  3. El motor de cuotas mensuales con Dia_Pago_Fijo no se modela acá — V1
 *     usa solo el vencimiento contractual. F-051.x lo refinará.
 * ============================================================ */

export async function pagosDesdeDeudas(fechaDesde: string, fechaHasta: string): Promise<EventoFlujo[]> {
  try {
    const deudas = await getDeudas();
    const hoy = obtenerFechaHoyGuatemala();
    const out: EventoFlujo[] = [];
    for (const d of deudas) {
      if (d.saldoPendiente <= 0.01) continue;
      // Estado: liquidada/anulada → skip (defensivo, `getDeudas` ya excluye no_incluir).
      if (/liquidada|anulada|saldada/i.test(d.estadoDeuda)) continue;

      const venc = (d.fechaVencimientoReal?.trim() || d.fechaVencimiento?.trim() || '').slice(0, 10);
      let fecha = venc;
      let fechaAjustada = false;
      if (!fecha || fecha < hoy) {
        // Vencida sin pago futuro definido: proyectar a hoy+7.
        fecha = sumarDias(hoy, 7);
        fechaAjustada = true;
      }
      if (fecha < fechaDesde || fecha > fechaHasta) continue;

      const prioridad: PrioridadObligacion = d.vencida || d.diasEnMora > 0 ? 'Crítica' : 'Alta';
      out.push({
        fecha,
        tipo: 'egreso',
        fuente: 'deuda',
        descripcion: `${d.tipoDocumento || 'Deuda'}: ${d.acreedorCorto || d.acreedorNombre || d.nombreDeuda}`,
        monto: d.saldoPendiente,
        prioridad,
        esEstimado: false,
        fechaAjustada,
        linkId: d.id,
        linkTipo: 'deuda',
      });
    }
    return out;
  } catch (err) {
    console.warn('F-051 pagosDesdeDeudas falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* ============================================================
 * c) Planilla proyectada — quincenas días 15 y último de cada mes
 *
 * V1: monto = NETO_PAGAR total de la última quincena con líneas, FILTRADO
 * a empleados Golden Talent. Los empleados HIT/Poligrafy/BYDSA NO entran
 * acá — su quincena se modela como obligación recurrente intercompany
 * (F-051.6). Sin filtro, se contarían DOBLE en el horizonte.
 *
 * Si la planilla más reciente no tiene líneas Golden con monto, devolvemos
 * 0 y la proyección de planilla queda vacía. Mejor sub-estimar que doblar.
 * ============================================================ */

async function obtenerMontoQuincenaReferencia(): Promise<number> {
  try {
    const [periodos, empleados] = await Promise.all([
      getPeriodos({ estado: 'todos' }),
      getEmpleados({ status: 'todos' }),
    ]);
    if (periodos.length === 0) return 0;

    // F-051.7: mapa empleadoId → empresa (vacío == Golden por convención).
    const empresaPorEmpleado = new Map(empleados.map(e => [e.id, e.empresaEmpleadora]));
    const esLineaGolden = (empleadoId: string) =>
      esGolden(empresaPorEmpleado.get(empleadoId) ?? EMPRESA_EMPLEADORA_DEFAULT);

    // Recorremos períodos del más reciente al más viejo y devolvemos el
    // primer NETO_PAGAR total > 0 sumando SOLO líneas Golden.
    const ordenados = [...periodos].sort(
      (a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''),
    );
    for (const p of ordenados) {
      const lineas = await getLineasPlanilla(p.id);
      const totalGolden = lineas
        .filter(l => esLineaGolden(l.empleadoId))
        .reduce((s, l) => s + l.netoPagar, 0);
      if (totalGolden > 0) return totalGolden;
    }
    return 0;
  } catch (err) {
    console.warn('F-051 obtenerMontoQuincenaReferencia falló:', err instanceof Error ? err.message : err);
    return 0;
  }
}

function ultimoDiaMes(anio: number, mesIdx0: number): number {
  return new Date(anio, mesIdx0 + 1, 0).getDate();
}

export async function planillaProyectada(fechaDesde: string, fechaHasta: string): Promise<EventoFlujo[]> {
  const monto = await obtenerMontoQuincenaReferencia();
  if (monto <= 0) return [];

  const [ya, ma] = fechaDesde.split('-').map(Number);
  const [yh, mh] = fechaHasta.split('-').map(Number);
  const out: EventoFlujo[] = [];
  let y = ya, m = ma - 1;
  while (y < yh || (y === yh && m <= mh - 1)) {
    const candidatos = [15, ultimoDiaMes(y, m)];
    for (const dia of candidatos) {
      const fecha = `${y}-${pad2(m + 1)}-${pad2(dia)}`;
      if (fecha >= fechaDesde && fecha <= fechaHasta) {
        out.push({
          fecha,
          tipo: 'egreso',
          fuente: 'planilla',
          descripcion: `Planilla Q${dia === 15 ? '1' : '2'} (estimado)`,
          monto,
          prioridad: 'Crítica',
          esEstimado: true,
          linkTipo: 'planilla',
        });
      }
    }
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

/* ============================================================
 * d) Cobros esperados — facturas con saldo > 0 (getFacturasPendientesCobro:
 * consolidada por factura, saldo = total − cobros − NC activas).
 *
 * Las facturas CEDIDAS a factoraje no son ingreso propio (las cobra el
 * financiador) → fuera. Vencida sin cobrar: se empuja a hoy + 7.
 * ============================================================ */

export async function cobrosEsperados(fechaDesde: string, fechaHasta: string): Promise<EventoFlujo[]> {
  try {
    const { filas } = await getFacturasPendientesCobro();
    const hoy = obtenerFechaHoyGuatemala();
    const out: EventoFlujo[] = [];
    for (const f of filas) {
      if (f.cedida || !(f.saldo > 0.01)) continue;
      let fecha = f.fechaVencimiento;
      let fechaAjustada = false;
      if (!fecha || fecha < hoy) {
        fecha = sumarDias(hoy, 7);
        fechaAjustada = true;
      }
      if (fecha < fechaDesde || fecha > fechaHasta) continue;
      out.push({
        fecha,
        tipo: 'ingreso',
        fuente: 'cobro_esperado',
        descripcion: `Cobro ${f.cliente || 'cliente'} (Fact ${f.noFactura || f.id.slice(-6)})`,
        monto: f.saldo,
        prioridad: 'Media',
        esEstimado: true,
        fechaAjustada,
        linkId: f.id,
        linkTipo: 'factura_cliente',
      });
    }
    return out;
  } catch (err) {
    console.warn('F-051 cobrosEsperados falló:', err instanceof Error ? err.message : err);
    return [];
  }
}
