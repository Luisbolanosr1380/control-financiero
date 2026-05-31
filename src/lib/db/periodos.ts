/**
 * Resolución de períodos para tools AI y filtros internos.
 * Una sola fuente de verdad sobre qué significa "mes_actual",
 * "ultimos_3_meses", "ytd", etc. — y sobre cuántos días lleva el
 * período en curso vs cuántos le quedan.
 */

export type PeriodoNombre =
  | 'mes_actual'
  | 'mes_anterior'
  | 'ultimos_3_meses'
  | 'ultimos_6_meses'
  | 'ytd'
  | 'rango';

export interface PeriodoMetadata {
  periodo_solicitado: PeriodoNombre;
  fecha_desde: string;             // YYYY-MM-DD inclusive
  fecha_hasta: string;             // YYYY-MM-DD inclusive
  estado_periodo: 'en_curso' | 'cerrado';
  dias_transcurridos: number;      // días YA transcurridos del período (vs hoy)
  dias_totales: number;            // días que dura el período completo
  pct_transcurrido: number;        // 0–100
  etiqueta_humana: string;         // p.ej. "mayo 2026 (en curso, 29/31 días)"
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function diasEntre(desde: Date, hastaIncl: Date): number {
  // Diferencia en días, ambos extremos inclusive.
  const ms = hastaIncl.getTime() - desde.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
}

function diasMes(y: number, m1based: number): number {
  return new Date(y, m1based, 0).getDate();
}

function inicioMes(y: number, m1based: number): Date {
  return new Date(y, m1based - 1, 1);
}
function finMes(y: number, m1based: number): Date {
  return new Date(y, m1based - 1, diasMes(y, m1based));
}

export function resolverPeriodo(
  periodo: PeriodoNombre,
  hoy: Date = new Date(),
  args?: { desde?: string; hasta?: string },
): PeriodoMetadata {
  const Y = hoy.getFullYear();
  const M = hoy.getMonth() + 1;

  let desde: Date;
  let hastaInterno: Date;   // último día del período (siempre el formal del período, no el de "hoy")
  let hastaParaCorte: Date; // hasta dónde llegan los datos REALES (= hoy si estamos dentro del período)
  let estado: 'en_curso' | 'cerrado';
  let etiqueta: string;

  switch (periodo) {
    case 'mes_actual': {
      desde = inicioMes(Y, M);
      hastaInterno = finMes(Y, M);
      hastaParaCorte = hoy;
      estado = 'en_curso';
      etiqueta = `${MESES[M - 1]} ${Y} (en curso)`;
      break;
    }
    case 'mes_anterior': {
      const y = M === 1 ? Y - 1 : Y;
      const m = M === 1 ? 12 : M - 1;
      desde = inicioMes(y, m);
      hastaInterno = finMes(y, m);
      hastaParaCorte = hastaInterno;
      estado = 'cerrado';
      etiqueta = `${MESES[m - 1]} ${y} (cerrado)`;
      break;
    }
    case 'ultimos_3_meses':
    case 'ultimos_6_meses': {
      const n = periodo === 'ultimos_3_meses' ? 3 : 6;
      // Últimos N meses CERRADOS (NO incluye el mes en curso).
      const yEnd = M === 1 ? Y - 1 : Y;
      const mEnd = M === 1 ? 12 : M - 1;
      const yStart = mEnd - n + 1 > 0 ? yEnd : yEnd - 1;
      const mStart = ((mEnd - n + 12) % 12) + 1;
      desde = inicioMes(yStart, mStart);
      hastaInterno = finMes(yEnd, mEnd);
      hastaParaCorte = hastaInterno;
      estado = 'cerrado';
      etiqueta = `últimos ${n} meses cerrados (${MESES[mStart - 1]} ${yStart} → ${MESES[mEnd - 1]} ${yEnd})`;
      break;
    }
    case 'ytd': {
      desde = new Date(Y, 0, 1);
      hastaInterno = new Date(Y, 11, 31);
      hastaParaCorte = hoy;
      estado = 'en_curso';
      etiqueta = `año ${Y} a la fecha (YTD)`;
      break;
    }
    case 'rango': {
      if (!args?.desde || !args?.hasta) throw new Error('periodo="rango" requiere desde y hasta');
      const [y1, m1, d1] = args.desde.split('-').map(Number);
      const [y2, m2, d2] = args.hasta.split('-').map(Number);
      desde = new Date(y1, m1 - 1, d1);
      hastaInterno = new Date(y2, m2 - 1, d2);
      // si el rango incluye días futuros, estado es en_curso
      hastaParaCorte = hoy < hastaInterno ? hoy : hastaInterno;
      estado = hoy < hastaInterno ? 'en_curso' : 'cerrado';
      etiqueta = `${args.desde} → ${args.hasta}${estado === 'en_curso' ? ' (en curso)' : ''}`;
      break;
    }
    default: throw new Error(`Periodo desconocido: ${periodo}`);
  }

  const dias_totales       = diasEntre(desde, hastaInterno);
  const dias_transcurridos = hastaParaCorte >= desde ? diasEntre(desde, hastaParaCorte) : 0;
  const pct_transcurrido   = dias_totales > 0 ? Math.min(100, Math.round((dias_transcurridos / dias_totales) * 1000) / 10) : 0;

  return {
    periodo_solicitado: periodo,
    fecha_desde: iso(desde),
    fecha_hasta: iso(hastaInterno),
    estado_periodo: estado,
    dias_transcurridos,
    dias_totales,
    pct_transcurrido,
    etiqueta_humana: etiqueta,
  };
}

/**
 * Filtro genérico por rango ISO (YYYY-MM-DD), inclusive ambos extremos.
 * Para "mes_actual" usamos `fecha_desde` y `fecha_hasta` del período COMPLETO
 * (no del corte a hoy) — pero como las facturas/cobros futuros no existen aún,
 * el resultado es equivalente a cortar a hoy.
 */
export function enRango(fechaISO: string | undefined, desde: string, hasta: string): boolean {
  if (!fechaISO) return false;
  const f = fechaISO.slice(0, 10);
  return f >= desde && f <= hasta;
}

export const MESES_LARGO = MESES;
