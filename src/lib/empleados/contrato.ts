/**
 * FIX-HONORARIOS — Régimen laboral según tipo de contrato (Guatemala).
 *
 *  · DEPENDENCIA (Indefinido, Plazo fijo, Por obra, CONTRATO INDEFINIDO…):
 *    lleva TODO — IGSS patronal, Bono 14, Aguinaldo, Vacaciones,
 *    Indemnización, bonificación incentivo (Dto. 78-89), IGSS laboral e
 *    ISR de renta de trabajo.
 *  · HONORARIOS / SERVICIOS PROFESIONALES: NINGUNA prestación ni
 *    cargo laboral. Costo = solo el honorario pactado. Cargarle
 *    prestaciones es indicio de relación laboral encubierta.
 *
 * Vocabulario real de las bases: la app guarda 'Honorarios' (form);
 * Golden trae 'SERVICIOS PROFESIONALES' del import de Airtable. Antes
 * solo se reconocía el segundo — por eso un honorarios dado de alta
 * desde la app (Hannah, HIT) recibía prestaciones.
 *
 * Lo no reconocido (null, 'CONTRATO' legacy) se trata como dependencia:
 * es el comportamiento histórico de la fórmula de Airtable y el lado
 * seguro ante la Inspección de Trabajo.
 */

export type RegimenContrato = 'dependencia' | 'honorarios';

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export function regimenContrato(tipoContrato: string | null | undefined): RegimenContrato {
  const t = norm(String(tipoContrato ?? ''));
  if (!t) return 'dependencia';
  if (t.includes('HONORARIO') || t.includes('SERVICIOS PROFESIONALES')) return 'honorarios';
  return 'dependencia';
}

export function esHonorarios(tipoContrato: string | null | undefined): boolean {
  return regimenContrato(tipoContrato) === 'honorarios';
}
