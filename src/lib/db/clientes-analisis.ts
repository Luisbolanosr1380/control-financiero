// ============================================================
// Análisis de retención de clientes (marco RFM, ventana 12 meses)
// Detecta churn / declive midiendo a cada cliente contra SU PROPIA
// frecuencia normal — no un umbral fijo.
// ============================================================

import { getFacturas } from './facturas';
import { getClientes } from './clientes';
import type { Invoice } from '../types';

export type ClienteClasificacion =
  | 'perdido'
  | 'en_riesgo'
  | 'en_declive'
  | 'sano'
  | 'nuevo';

export type Tendencia = 'creciente' | 'estable' | 'decreciente';

export interface SerieMes {
  mes: string;     // 'YYYY-MM'
  monto: number;
}

export interface AnalisisCliente {
  custId: string;
  nombre: string;
  clasificacion: ClienteClasificacion;
  mesesSinFacturar: number;
  intervaloNormal: number | null;   // null si insuficiente data
  montoPromedio: number;             // por mes activo
  montoReciente: number;             // últimos 3 meses
  montoBase: number;                 // 3 meses anteriores a los recientes
  tendencia: Tendencia;
  serieMensual: SerieMes[];
  ultimaFactura: string;             // 'YYYY-MM-DD'
}

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;
const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function mediana(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function getAnalisisClientes(): Promise<AnalisisCliente[]> {
  const [facturas, clientes] = await Promise.all([getFacturas(), getClientes()]);
  const nombreById = new Map(clientes.map(c => [c.id, c.name]));

  const now = new Date();
  // 12 buckets: este mes y los 11 anteriores, en orden cronológico
  const buckets: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push(ymKey(d));
  }
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // Filtrar activas de los últimos 12 meses con fecha conocida
  const activas = facturas.filter((f): f is Invoice & { fechaEmision: string } => {
    if (f.status === 'anulado' || !f.fechaEmision) return false;
    return new Date(f.fechaEmision) >= windowStart;
  });

  // Agrupar por cliente
  const grupos = new Map<string, Array<{ fecha: Date; total: number }>>();
  for (const f of activas) {
    const arr = grupos.get(f.custId) ?? [];
    arr.push({ fecha: new Date(f.fechaEmision), total: f.total });
    grupos.set(f.custId, arr);
  }

  const out: AnalisisCliente[] = [];

  for (const [custId, lista] of grupos) {
    lista.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    // serie mensual: monto por bucket, 0 en meses sin factura
    const porMes = new Map<string, number>();
    for (const m of buckets) porMes.set(m, 0);
    for (const f of lista) {
      const k = ymKey(f.fecha);
      porMes.set(k, (porMes.get(k) ?? 0) + f.total);
    }
    const serieMensual: SerieMes[] = buckets.map(m => ({ mes: m, monto: porMes.get(m) ?? 0 }));

    const ultima = lista[lista.length - 1].fecha;
    const mesesSinFacturar = Math.max(0, (now.getTime() - ultima.getTime()) / MS_PER_MONTH);

    // Intervalo "normal": mediana de los intervalos entre facturas consecutivas (en meses)
    const intervalos: number[] = [];
    for (let i = 1; i < lista.length; i++) {
      intervalos.push((lista[i].fecha.getTime() - lista[i - 1].fecha.getTime()) / MS_PER_MONTH);
    }
    const intervaloNormal = intervalos.length === 0 ? null : (mediana(intervalos) || 1);

    // Montos
    const mesesActivos = serieMensual.filter(s => s.monto > 0).length;
    const totalFacturado = serieMensual.reduce((s, x) => s + x.monto, 0);
    const montoPromedio = mesesActivos > 0 ? totalFacturado / mesesActivos : 0;

    // Recientes: últimos 3 buckets; base: los 3 anteriores a esos
    const montoReciente = serieMensual.slice(9, 12).reduce((s, x) => s + x.monto, 0);
    const montoBase     = serieMensual.slice(6, 9).reduce((s, x) => s + x.monto, 0);

    let tendencia: Tendencia = 'estable';
    if (montoBase === 0 && montoReciente > 0)        tendencia = 'creciente';
    else if (montoBase > 0) {
      const r = montoReciente / montoBase;
      if (r < 0.9)      tendencia = 'decreciente';
      else if (r > 1.1) tendencia = 'creciente';
    }

    // Clasificación
    let clasificacion: ClienteClasificacion;
    if (intervaloNormal === null) {
      clasificacion = 'nuevo';
    } else if (mesesSinFacturar >= intervaloNormal * 3) {
      clasificacion = 'perdido';
    } else if (mesesSinFacturar >= intervaloNormal * 1.5) {
      clasificacion = 'en_riesgo';
    } else if (montoBase > 0 && montoReciente < montoBase * 0.5) {
      clasificacion = 'en_declive';
    } else {
      clasificacion = 'sano';
    }

    out.push({
      custId,
      nombre: nombreById.get(custId) || custId || '—',
      clasificacion,
      mesesSinFacturar,
      intervaloNormal,
      montoPromedio,
      montoReciente,
      montoBase,
      tendencia,
      serieMensual,
      ultimaFactura: ultima.toISOString().slice(0, 10),
    });
  }

  return out;
}
