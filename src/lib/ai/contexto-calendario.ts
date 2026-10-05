/**
 * AUROS — conciencia de calendario. PURO (sin IO).
 *
 * El día 4 del mes, "¿cómo facturamos este mes?" da ~Q0 y una respuesta
 * pelada ("nadie facturó") parece un sistema roto. Este módulo arma, en una
 * sola estructura, lo que el modelo necesita para no responder un cero
 * suelto: día del mes, mes en curso a hoy, mes anterior completo y el mes
 * anterior acumulado AL MISMO DÍA (el ritmo comparable).
 */

export const DIAS_INICIO_DE_MES = 7;
/** Por debajo de este monto el mes en curso se trata como "~0". */
export const UMBRAL_CASI_CERO_Q = 1;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const ultimoDia = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

export interface VentanasCalendario {
  hoy: string;
  diaDelMes: number;
  diasDelMes: number;
  mesRecienEmpieza: boolean;
  mesActual: { desde: string; hasta: string; etiqueta: string };
  mesAnterior: { desde: string; hasta: string; etiqueta: string };
  /** Mes anterior del 1 al mismo día (acotado a su último día: 31-mar → 28/29-feb). */
  mesAnteriorAlMismoDia: { desde: string; hasta: string };
}

export function ventanasCalendario(hoy: string): VentanasCalendario {
  const [y, m, d] = hoy.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const finAnt = ultimoDia(py, pm);
  return {
    hoy,
    diaDelMes: d,
    diasDelMes: ultimoDia(y, m),
    mesRecienEmpieza: d <= DIAS_INICIO_DE_MES,
    mesActual: { desde: `${y}-${pad2(m)}-01`, hasta: hoy, etiqueta: `${MESES[m - 1]} ${y}` },
    mesAnterior: { desde: `${py}-${pad2(pm)}-01`, hasta: `${py}-${pad2(pm)}-${pad2(finAnt)}`, etiqueta: `${MESES[pm - 1]} ${py}` },
    mesAnteriorAlMismoDia: { desde: `${py}-${pad2(pm)}-01`, hasta: `${py}-${pad2(pm)}-${pad2(Math.min(d, finAnt))}` },
  };
}

export interface Movimiento { fecha: string; monto: number }

export interface MetricaCalendario {
  mesActualAHoyQ: number;
  mesAnteriorQ: number;
  mesAnteriorAlMismoDiaQ: number;
  /** mes en curso vs mes anterior al mismo día, en %. null si la base es 0. */
  ritmoVsMismoDiaPct: number | null;
}

const sumaEn = (movs: Movimiento[], desde: string, hasta: string) =>
  Math.round(movs.reduce((s, x) => (x.fecha >= desde && x.fecha <= hasta ? s + x.monto : s), 0));

export function metricaCalendario(movs: Movimiento[], v: VentanasCalendario): MetricaCalendario {
  const actual = sumaEn(movs, v.mesActual.desde, v.mesActual.hasta);
  const mismoDia = sumaEn(movs, v.mesAnteriorAlMismoDia.desde, v.mesAnteriorAlMismoDia.hasta);
  return {
    mesActualAHoyQ: actual,
    mesAnteriorQ: sumaEn(movs, v.mesAnterior.desde, v.mesAnterior.hasta),
    mesAnteriorAlMismoDiaQ: mismoDia,
    ritmoVsMismoDiaPct: mismoDia > 0 ? Number((((actual - mismoDia) / mismoDia) * 100).toFixed(1)) : null,
  };
}

export const INSTRUCCION_CALENDARIO =
  'Si mes_recien_empieza es true o el mes en curso está en ~0: NUNCA respondas solo el cero ni "nadie facturó/cobró". ' +
  'Arrancá la respuesta con frase_base (ya trae el día, el mes en curso, el cierre del mes anterior y el ritmo a la misma fecha, con cifras reales) y después agregá lo que pidieron.';

const fmtQ = (n: number) => `Q${Math.round(n).toLocaleString('en-US')}`;
const DIAS_SEM_MES = (v: VentanasCalendario) => `${v.diaDelMes} de ${v.mesActual.etiqueta.split(' ')[0]}`;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Frase armada en el servidor con cifras reales: el modelo la usa tal cual en vez de redactar números. */
export function fraseBase(v: VentanasCalendario, m: MetricaCalendario, verbo: 'facturado' | 'cobrado'): string {
  const mesAnt = capital(v.mesAnterior.etiqueta.split(' ')[0]);
  const arranque = v.mesRecienEmpieza ? `Vamos día ${DIAS_SEM_MES(v)}, el mes apenas arranca: ` : `Vamos día ${DIAS_SEM_MES(v)}: `;
  return `${arranque}${fmtQ(m.mesActualAHoyQ)} ${verbo} hasta ahora. ${mesAnt} cerró en ${fmtQ(m.mesAnteriorQ)} y a estas alturas (día ${v.mesAnteriorAlMismoDia.hasta.slice(8).replace(/^0/, '')}) llevaba ${fmtQ(m.mesAnteriorAlMismoDiaQ)}.`;
}

/** Bloque que se adjunta a las respuestas de tools sobre el mes en curso. */
export function bloqueCalendario(v: VentanasCalendario, metricas: { facturado?: MetricaCalendario; cobrado?: MetricaCalendario }) {
  const casiCero = Object.values(metricas).some(m => m && m.mesActualAHoyQ < UMBRAL_CASI_CERO_Q);
  return {
    hoy: v.hoy,
    dia_del_mes: v.diaDelMes,
    dias_del_mes: v.diasDelMes,
    mes_recien_empieza: v.mesRecienEmpieza,
    mes_en_curso_en_cero: casiCero,
    mes_actual: v.mesActual.etiqueta,
    mes_anterior: v.mesAnterior.etiqueta,
    mes_anterior_al_mismo_dia_hasta: v.mesAnteriorAlMismoDia.hasta,
    ...(metricas.facturado ? { facturado: {
      mes_actual_a_hoy_Q: metricas.facturado.mesActualAHoyQ,
      mes_anterior_Q: metricas.facturado.mesAnteriorQ,
      mes_anterior_al_mismo_dia_Q: metricas.facturado.mesAnteriorAlMismoDiaQ,
      ritmo_vs_mismo_dia_pct: metricas.facturado.ritmoVsMismoDiaPct,
      frase_base: fraseBase(v, metricas.facturado, 'facturado'),
    } } : {}),
    ...(metricas.cobrado ? { cobrado: {
      mes_actual_a_hoy_Q: metricas.cobrado.mesActualAHoyQ,
      mes_anterior_Q: metricas.cobrado.mesAnteriorQ,
      mes_anterior_al_mismo_dia_Q: metricas.cobrado.mesAnteriorAlMismoDiaQ,
      ritmo_vs_mismo_dia_pct: metricas.cobrado.ritmoVsMismoDiaPct,
      frase_base: fraseBase(v, metricas.cobrado, 'cobrado'),
    } } : {}),
    instruccion: INSTRUCCION_CALENDARIO,
  };
}
