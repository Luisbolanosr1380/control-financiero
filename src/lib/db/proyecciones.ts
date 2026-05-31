/**
 * Proyección del cierre del mes en curso, con dos métodos independientes:
 *  - Lineal: facturado_real / dias_transcurridos × dias_totales.
 *  - Promedio histórico: media de los últimos 3 meses cerrados.
 *
 * Se devuelven los 3 últimos meses cerrados como referencia + la
 * variación proyectada vs el mes anterior, para que el modelo pueda
 * contar la historia sin recalcular nada por su cuenta.
 */
import { getFacturadoPorRango } from './analitica';
import { resolverPeriodo, MESES_LARGO } from './periodos';

export interface MesCerrado { mes: string; facturadoQ: number; }

export interface ProyeccionMesActual {
  mes_actual: {
    nombre: string;             // p.ej. "mayo 2026"
    facturado_real_q: number;
    dias_transcurridos: number;
    dias_totales: number;
    pct_transcurrido: number;
  };
  proyecciones: {
    lineal: {
      monto_q: number;
      metodo: string;
    };
    promedio_historico: {
      monto_q: number;
      metodo: string;
      ventana_usada: string[];  // p.ej. ["febrero 2026", "marzo 2026", "abril 2026"]
    };
  };
  ultimos_meses_cerrados: MesCerrado[];   // últimos 3, orden cronológico
  variacion_vs_anterior: {
    mes_anterior: string;
    facturado_anterior_q: number;
    proyectado_q: number;          // usamos la proyección lineal por defecto
    diferencia_q: number;
    pct_variacion: number | null;  // null si el anterior fue 0
  };
}

const fmt = (y: number, m: number) => `${MESES_LARGO[m - 1]} ${y}`;

export async function getProyeccionMesActual(hoy: Date = new Date()): Promise<ProyeccionMesActual> {
  const mAct = resolverPeriodo('mes_actual', hoy);

  // Últimos 3 meses cerrados (en orden cronológico, no incluye el mes actual)
  const Y = hoy.getFullYear();
  const M = hoy.getMonth() + 1;
  const cerrados: Array<{ y: number; m: number }> = [];
  for (let i = 3; i >= 1; i--) {
    const m = ((M - 1 - i + 12) % 12) + 1;
    const y = M - i <= 0 ? Y - 1 : Y;
    cerrados.push({ y, m });
  }
  const ultimosMesesArgs = cerrados.map(({ y, m }) => {
    const desde = `${y}-${String(m).padStart(2, '0')}-01`;
    const fin = new Date(y, m, 0).getDate();
    const hasta = `${y}-${String(m).padStart(2, '0')}-${String(fin).padStart(2, '0')}`;
    return { y, m, desde, hasta };
  });

  // En paralelo: facturado mes actual + cada uno de los últimos 3 cerrados
  const [actualFact, ...histFacts] = await Promise.all([
    getFacturadoPorRango(mAct.fecha_desde, mAct.fecha_hasta),
    ...ultimosMesesArgs.map(u => getFacturadoPorRango(u.desde, u.hasta)),
  ]);

  const ultimos: MesCerrado[] = ultimosMesesArgs.map((u, i) => ({
    mes: fmt(u.y, u.m),
    facturadoQ: histFacts[i].facturadoTotalQ,
  }));

  // Proyección lineal
  const real = actualFact.facturadoTotalQ;
  const proyLineal = mAct.dias_transcurridos > 0
    ? Math.round(real / mAct.dias_transcurridos * mAct.dias_totales)
    : 0;

  // Promedio histórico
  const promedio = ultimos.length > 0
    ? Math.round(ultimos.reduce((s, m) => s + m.facturadoQ, 0) / ultimos.length)
    : 0;

  // Variación vs mes anterior (último de la ventana cerrados)
  const anterior = ultimos[ultimos.length - 1] ?? { mes: '—', facturadoQ: 0 };
  const diff = proyLineal - anterior.facturadoQ;
  const pct  = anterior.facturadoQ > 0 ? Number(((diff / anterior.facturadoQ) * 100).toFixed(1)) : null;

  return {
    mes_actual: {
      nombre: fmt(Y, M),
      facturado_real_q: real,
      dias_transcurridos: mAct.dias_transcurridos,
      dias_totales: mAct.dias_totales,
      pct_transcurrido: mAct.pct_transcurrido,
    },
    proyecciones: {
      lineal: {
        monto_q: proyLineal,
        metodo: 'Extrapolación lineal por días (real ÷ días_transcurridos × días_totales)',
      },
      promedio_historico: {
        monto_q: promedio,
        metodo: 'Promedio simple del facturado de los últimos 3 meses cerrados',
        ventana_usada: ultimos.map(u => u.mes),
      },
    },
    ultimos_meses_cerrados: ultimos,
    variacion_vs_anterior: {
      mes_anterior: anterior.mes,
      facturado_anterior_q: anterior.facturadoQ,
      proyectado_q: proyLineal,
      diferencia_q: diff,
      pct_variacion: pct,
    },
  };
}
