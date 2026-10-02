/**
 * F-CXC-SELECTOR — detección de cliente intercompany (lógica PURA).
 *
 * Un cliente "parece empresa del grupo" si su nombre (o razón social)
 * matchea una empresa del catálogo empresas_relacionadas que NO es la
 * principal de este deploy. 'Otra' se excluye (label genérico). El
 * match es por contención normalizada en ambos sentidos — cubre
 * "Poligrafy" vs "Poligrafy, S.A." y "Golden" vs "Golden Talent".
 * Es una SUGERENCIA de cuenta CxC (1-1-3-3), nunca una imposición.
 */

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

export const CUENTA_CXC_DEFAULT = '1-1-3-1';
export const CUENTA_CXC_INTERCOMPANY = '1-1-3-3';

/** Devuelve el nombre de la hermana que matchea, o null. */
export function detectarIntercompany(
  nombreCliente: string,
  hermanas: readonly string[],
): string | null {
  const n = norm(nombreCliente);
  if (n.length < 3) return null;
  const palabras = n.split(' ');
  for (const h of hermanas) {
    if (h === 'Otra') continue;
    const hn = norm(h);
    if (hn.length < 3) continue;
    // Nombres cortos ("HIT") solo matchean como PALABRA completa —
    // sin esto, "Hitachi" dispararía la sugerencia por substring.
    if (hn.length <= 4) {
      if (palabras.includes(hn)) return h;
    } else if (n.includes(hn) || hn.includes(n)) {
      return h;
    }
  }
  return null;
}
