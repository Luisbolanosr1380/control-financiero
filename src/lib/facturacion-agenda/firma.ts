/**
 * FACTURACIÓN AGENDA · Firma del webhook — PURA (solo node:crypto).
 *
 * `x-golden-firma: t=<segundos unix>,v1=<hex>` con
 * v1 = HMAC-SHA256(secreto, t + "." + cuerpo crudo). Se rechaza un `t` a más
 * de 5 minutos del reloj y la comparación es en tiempo constante.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCIA_SEGUNDOS = 300;

export function parsearFirma(firma: string | null | undefined): { t: number; v1: string } | null {
  if (!firma) return null;
  const partes = Object.fromEntries(firma.split(',').map(x => { const i = x.indexOf('='); return i < 0 ? [x.trim(), ''] : [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }));
  const t = Number(partes.t); const v1 = String(partes.v1 ?? '');
  if (!Number.isFinite(t) || !/^[0-9a-f]+$/i.test(v1)) return null;
  return { t, v1: v1.toLowerCase() };
}

/** Firma un cuerpo (para pruebas y para el doble del API). */
export function firmar(cuerpoCrudo: string, secreto: string, tSegundos: number): string {
  const v1 = createHmac('sha256', secreto).update(`${tSegundos}.${cuerpoCrudo}`).digest('hex');
  return `t=${tSegundos},v1=${v1}`;
}

export type MotivoFirma = 'ok' | 'sin_firma' | 'firma_malformada' | 'fuera_de_tiempo' | 'no_coincide' | 'sin_secreto';

export function verificarFirma(cuerpoCrudo: string, firma: string | null | undefined, secreto: string | undefined, ahoraMs: number = Date.now()): MotivoFirma {
  if (!secreto) return 'sin_secreto';
  if (!firma) return 'sin_firma';
  const p = parsearFirma(firma);
  if (!p) return 'firma_malformada';
  if (Math.abs(ahoraMs / 1000 - p.t) > TOLERANCIA_SEGUNDOS) return 'fuera_de_tiempo';
  const esperada = createHmac('sha256', secreto).update(`${p.t}.${cuerpoCrudo}`).digest('hex');
  const a = Buffer.from(p.v1, 'utf8'), b = Buffer.from(esperada, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'no_coincide';
  return 'ok';
}

export const firmaValida = (cuerpoCrudo: string, firma: string | null | undefined, secreto: string | undefined, ahoraMs?: number): boolean =>
  verificarFirma(cuerpoCrudo, firma, secreto, ahoraMs) === 'ok';
