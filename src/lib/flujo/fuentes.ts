/**
 * F-051 — Fuentes existentes (READ-ONLY) que alimentan el cash-flow planner.
 *
 *  a) CxP    — GASTOS con estado "Por pagar".
 *  b) Deudas — DEUDAS activas con saldo > 0 y próximo pago calculable.
 *  c) Planilla — quincenas proyectadas desde la última planilla pagada.
 *  d) Cobros esperados — FACTURAS_CLIENTES con saldo pendiente (ingreso).
 *
 * Convención de fecha (lección F-041):
 *  - Toda comparación contra "hoy" usa obtenerFechaHoyGuatemala().
 *  - Constructor local de Date (`new Date(y, m-1, d)`) para no aplicar shift UTC.
 *
 * Tolerancia: si una fuente falla (Airtable down, schema cambió), atrapamos
 * el error y devolvemos []. El cash-flow se renderiza con las fuentes vivas.
 */

import { airtable } from '@/lib/db/airtable';
import { getGastos } from '@/lib/db/gastos';
import { getDeudas } from '@/lib/db/deudas';
import { getEmpleados } from '@/lib/db/empleados';
import { getPeriodos, getLineasPlanilla } from '@/lib/db/planillas';
import { TABLES } from '@/lib/db/airtable';
import { F } from '@/lib/db/mappers';
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
    const gastos = await getGastos({ estado: 'Por pagar' });
    const out: EventoFlujo[] = [];
    for (const g of gastos) {
      let fecha = g.fechaVencimiento?.trim() || '';
      let fechaAjustada = false;
      if (!fecha) {
        if (!g.fecha) continue;
        // F-051: si falta vencimiento, asumir 30 días desde emisión.
        fecha = sumarDias(g.fecha, CXP_VENCIMIENTO_DEFAULT_DIAS);
        fechaAjustada = true;
      }
      if (fecha < fechaDesde || fecha > fechaHasta) continue;
      out.push({
        fecha,
        tipo: 'egreso',
        fuente: 'cxp',
        descripcion: `CxP gasto ${g.id.slice(-6)}`,
        monto: g.total,
        prioridad: 'Alta',
        esEstimado: false,
        fechaAjustada,
        linkId: g.id,
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
 * d) Cobros esperados — FACTURAS_CLIENTES con saldo > 0
 *
 * Leemos directo de FACTURAS_CLIENTES (no consolidamos lineaPorLínea —
 * cada línea con saldo > 0 es un cobro esperado). Saldo desde
 * `Saldo_Por_Cobrar` (formula). Fecha desde `Fecha vencimiento`; si está
 * vencida sin cobrar, empujamos a hoy + 7.
 *
 * NOTA: el campo "Fecha confirmación pago ETA" mencionado en la spec no
 * existe en el schema actual de FACTURAS_CLIENTES. Si se agrega después,
 * acá es donde se debe leer ANTES del vencimiento.
 * ============================================================ */

export async function cobrosEsperados(fechaDesde: string, fechaHasta: string): Promise<EventoFlujo[]> {
  const { dataSource } = await import('@/lib/config/data-source');
  if (dataSource('facturas_clientes') !== 'supabase' && !airtable) return [];
  try {
    const records = dataSource('facturas_clientes') === 'supabase'
      ? await (await import('@/lib/supabase/records')).sbFacturasRecords()
      : (await airtable!(TABLES.FACTURAS)
          .select({
            fields: [F.NO_FACTURA, F.FECHA_VENCE, F.SALDO, F.TOTAL, F.ESTADO, F.CLIENTE, F.RAZON_SOCIAL],
          })
          .all()).map(r => ({ id: r.id, fields: r.fields as Record<string, unknown> }));
    const hoy = obtenerFechaHoyGuatemala();
    const out: EventoFlujo[] = [];
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const estadoRaw = String(f[F.ESTADO] ?? '').toUpperCase().trim();
      if (estadoRaw === 'ANULADO' || estadoRaw === 'ANULADA' || estadoRaw === 'REFACTURADO' || estadoRaw === 'REFACTURADA') continue;
      const saldo = Number(f[F.SALDO] ?? 0);
      if (!(saldo > 0.01)) continue;
      const venc = String(f[F.FECHA_VENCE] ?? '').slice(0, 10);
      let fecha = venc;
      let fechaAjustada = false;
      if (!fecha || fecha < hoy) {
        fecha = sumarDias(hoy, 7);
        fechaAjustada = true;
      }
      if (fecha < fechaDesde || fecha > fechaHasta) continue;
      const razonRaw = f[F.RAZON_SOCIAL];
      const razon = Array.isArray(razonRaw) ? String(razonRaw[0] ?? '') : String(razonRaw ?? '');
      const noFactura = String(f[F.NO_FACTURA] ?? '').trim() || r.id.slice(-6);
      out.push({
        fecha,
        tipo: 'ingreso',
        fuente: 'cobro_esperado',
        descripcion: `Cobro ${razon || 'cliente'} (Fact ${noFactura})`,
        monto: saldo,
        prioridad: 'Media',
        esEstimado: true,
        fechaAjustada,
        linkId: r.id,
        linkTipo: 'factura_cliente',
      });
    }
    return out;
  } catch (err) {
    console.warn('F-051 cobrosEsperados falló:', err instanceof Error ? err.message : err);
    return [];
  }
}
