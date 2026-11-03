/**
 * FACTURACIÓN AGENDA · Aviso del webhook (025) — PURO (sin IO).
 *
 * De cada aviso se guarda, además del id / tipo / ocurrido (016), QUÉ expediente cambió y QUÉ
 * cambió: solo el bloque `cambios` normalizado a [{ campo, antes, despues }], con los valores
 * recortados. Sin datos personales extra (nombre, DPI, correo… viajan en `expediente` y no se
 * copian acá). Así el momento real de cada cambio de estado deja de perderse.
 */

export interface CambioAviso { campo: string; antes: string | null; despues: string | null }

const MAX_CAMBIOS = 50;
const MAX_TEXTO = 200;

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > MAX_TEXTO ? `${s.slice(0, MAX_TEXTO - 1)}…` : s;
};
const pick = (o: Record<string, unknown>, llaves: string[]): unknown => { for (const k of llaves) if (k in o) return o[k]; return undefined; };

/**
 * Acepta las dos formas razonables del bloque `cambios`:
 *  · lista: [{ campo, antes, despues }] (también field/before/after, anterior/nuevo, de/a)
 *  · objeto: { estadoPoligrafo: { antes, despues }, statusProceso: 'APROBO' }
 * Devuelve null si no hay nada utilizable.
 */
export function normalizarCambios(x: unknown): CambioAviso[] | null {
  const out: CambioAviso[] = [];
  if (Array.isArray(x)) {
    for (const it of x) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const campo = texto(pick(o, ['campo', 'field', 'nombre', 'key']));
      if (!campo) continue;
      out.push({ campo, antes: texto(pick(o, ['antes', 'anterior', 'before', 'de', 'old', 'previo'])), despues: texto(pick(o, ['despues', 'después', 'nuevo', 'after', 'a', 'new', 'actual'])) });
    }
  } else if (x && typeof x === 'object') {
    for (const [campo, v] of Object.entries(x as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        out.push({ campo, antes: texto(pick(o, ['antes', 'anterior', 'before', 'de', 'old', 'previo'])), despues: texto(pick(o, ['despues', 'después', 'nuevo', 'after', 'a', 'new', 'actual'])) });
      } else out.push({ campo, antes: null, despues: texto(v) });
    }
  }
  return out.length ? out.slice(0, MAX_CAMBIOS) : null;
}
