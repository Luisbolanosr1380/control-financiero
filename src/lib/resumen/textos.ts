/**
 * Textos del Resumen móvil. PURO. Misma regla que Auros: nunca un cero
 * pelado — a inicio de mes (o con el mes en ~0) se muestra el cierre del
 * mes anterior y lo que se llevaba a esta misma fecha.
 */
import { UMBRAL_CASI_CERO_Q, type MetricaCalendario, type VentanasCalendario } from '@/lib/ai/contexto-calendario';

const Q = (n: number) => `Q${Math.round(n).toLocaleString('en-US')}`;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function tituloDia(v: VentanasCalendario): string {
  const mes = v.mesActual.etiqueta.split(' ')[0];
  return `Día ${v.diaDelMes} de ${mes}${v.mesRecienEmpieza ? ' · el mes apenas arranca' : ` · ${v.diasDelMes - v.diaDelMes} días para el cierre`}`;
}

export function lineaCalendario(v: VentanasCalendario, m: MetricaCalendario): string {
  const mesAnt = capital(v.mesAnterior.etiqueta.split(' ')[0]);
  const diaRef = Number(v.mesAnteriorAlMismoDia.hasta.slice(8));
  if (v.mesRecienEmpieza || m.mesActualAHoyQ < UMBRAL_CASI_CERO_Q) {
    return `${mesAnt} cerró en ${Q(m.mesAnteriorQ)} · al día ${diaRef} llevaba ${Q(m.mesAnteriorAlMismoDiaQ)}`;
  }
  const ritmo = m.ritmoVsMismoDiaPct;
  const vs = `al día ${diaRef} de ${mesAnt.toLowerCase()} (${Q(m.mesAnteriorAlMismoDiaQ)})`;
  const ritmoTxt = ritmo === null ? `Mes pasado ${vs}` : `${ritmo >= 0 ? '+' : ''}${ritmo.toFixed(0)}% vs ${vs}`;
  return `${ritmoTxt} · cerró en ${Q(m.mesAnteriorQ)}`;
}
