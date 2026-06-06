/**
 * F-049 PARTE B — Utilidades de parsing de factura.
 *
 * Porting fiel de utils.gs y los helpers ligeros de codigo.gs del Apps Script.
 * Se mantiene la lógica intacta para que los parsers DTE y genérico sigan
 * comportándose exactamente igual que hoy en GAS.
 *
 * Diferencias menores aceptadas (no afectan resultados):
 *  - Underscore final removido (convención GAS de "privado").
 *  - `Math.max.apply(null, arr)` → `Math.max(...arr)` (idiomático TS).
 *  - `pickConsistentTotal` aparecía DOS VECES en utils.gs; la segunda
 *    sobrescribía la primera. Porto SOLO la segunda (la que tolera margen
 *    de 0.01 al comparar contra IVA/SUBTOTAL).
 *  - `guessProveedorFromHeader_` no existe en los .gs (solo era un hook
 *    opcional con typeof check). No se porta — el parser genérico cae a
 *    string vacío si no se encuentra el nombre.
 */

/** Palabras que aparecen acompañando números grandes pero NO son montos
 * (NIT, números de DTE, número de autorización, etc.). Se exporta para que
 * los parsers puedan reusarla en las funciones de fallback "maxMoneyTail". */
export const AVOID_BIG_IDS = /(NIT\s|N[úu]mero\s+de\s+DTE|AUTORIZ|ACCESO|SERIE|\bNo\.|\bN[°º]|\bDTE\b)/i;

/** IVA Guatemala (12%). Constante interna usada por los conversores
 * exactos de centavos. */
const GT_IVA_RATE = 0.12;

/* ============================================================
 * Numéricos básicos
 * ============================================================ */

export function round2(n: unknown): number {
  return Math.round(Number(n ?? 0) * 100) / 100;
}

/**
 * Parser numérico robusto. Soporta:
 *  - EU: "1.234.567,89"
 *  - US: "1,234,567.89"
 *  - Un solo separador como decimal: "13.928570", "130,00", "51.0"
 *  - Entero simple: "51"
 *  - Fallback: primer token numérico de la cadena.
 */
export function toNumberFlex(s: unknown): number | null {
  if (s == null) return null;
  let str = String(s).trim();
  str = str.replace(/[^\d.,\- ]/g, '').replace(/\s+/g, '');

  // EU: 1.234.567,89
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
    return Number(str);
  }
  // US: 1,234,567.89
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(str)) {
    str = str.replace(/,/g, '');
    return Number(str);
  }
  // Un solo separador (decimal): 13.928570, 130,00, 51.0
  if (/^\d+[.,]\d+$/.test(str)) {
    str = str.replace(',', '.');
    return Number(str);
  }
  // Entero simple
  if (/^\d+$/.test(str)) return Number(str);

  // Fallback: primer token numérico
  const m = str.match(/\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
}

/** Devuelve el MAYOR número dentro de un texto (e.g. de "0.00 51.00" → 51). */
export function extractMaxNumber(s: unknown): number | null {
  if (!s) return null;
  const tokens = String(s).match(/\d+(?:[.,]\d+)?/g) ?? [];
  let best: number | null = null;
  for (const tok of tokens) {
    const n = toNumberFlex(tok);
    if (Number.isFinite(n)) best = best == null || (n as number) > best ? (n as number) : best;
  }
  return best == null ? null : round2(best);
}

/* ============================================================
 * Búsqueda de montos por etiquetas
 * ============================================================ */

/** Busca monto tras etiquetas (misma línea o la siguiente). Recorre de arriba a abajo. */
export function bestMoneyAfter(textNoAccents: string, labelRegexes: RegExp[]): number | null {
  const lines = String(textNoAccents ?? '').split('\n').map(x => x.trim()).filter(Boolean);
  for (const re of labelRegexes) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        if (/LETRAS/i.test(lines[i])) continue;
        let val = extractMaxNumber((lines[i].match(/([0-9.,\s]+)(?:Q|GTQ|USD|\$)?$/i) ?? [])[1]);
        if (val == null && i + 1 < lines.length) {
          val = extractMaxNumber((lines[i + 1].match(/([0-9.,\s]+)(?:Q|GTQ|USD|\$)?/i) ?? [])[1]);
        }
        if (Number.isFinite(val)) return round2(val);
      }
    }
  }
  return null;
}

/** Igual que bestMoneyAfter, pero evitando líneas que matcheen `avoidRegex`. */
export function bestMoneyAfterAvoid(
  textNoAccents: string,
  labelRegexes: RegExp[],
  avoidRegex: RegExp | null,
): number | null {
  const lines = String(textNoAccents ?? '').split('\n').map(x => x.trim()).filter(Boolean);
  for (const re of labelRegexes) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        if (/LETRAS/i.test(lines[i])) continue;
        if (avoidRegex && avoidRegex.test(lines[i])) continue;
        let val = extractMaxNumber((lines[i].match(/([0-9.,\s]+)(?:Q|GTQ|USD|\$)?$/i) ?? [])[1]);
        if (val == null && i + 1 < lines.length) {
          if (!(avoidRegex && avoidRegex.test(lines[i + 1]))) {
            val = extractMaxNumber((lines[i + 1].match(/([0-9.,\s]+)(?:Q|GTQ|USD|\$)?/i) ?? [])[1]);
          }
        }
        if (Number.isFinite(val)) return round2(val);
      }
    }
  }
  return null;
}

/** Igual que bestMoneyAfterAvoid pero recorriendo de ABAJO hacia ARRIBA. */
export function bestMoneyAfterAvoidFromBottom(
  textNoAccents: string,
  labelRegexes: RegExp[],
  avoidRegex: RegExp | null,
): number | null {
  const lines = String(textNoAccents ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  for (const re of labelRegexes) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (re.test(lines[i])) {
        if (/LETRAS/i.test(lines[i])) continue;
        if (avoidRegex && avoidRegex.test(lines[i])) continue;

        let val = extractMaxNumber((lines[i].match(/([0-9.,\s]+)(?:Q|GTQ|USD|\$)?$/i) ?? [])[1]);
        if (val == null && i + 1 < lines.length) {
          if (!(avoidRegex && avoidRegex.test(lines[i + 1]))) {
            val = extractMaxNumber((lines[i + 1].match(/([0-9.,\s]+)(?:Q|GTQ|USD|\$)?/i) ?? [])[1]);
          }
        }
        if (Number.isFinite(val)) return round2(val);
      }
    }
  }
  return null;
}

/* ============================================================
 * Fallbacks de búsqueda de TOTAL
 * ============================================================ */

/** Devuelve las últimas N líneas no vacías. */
export function lastLines(textNoAccents: string, n: number): string[] {
  const lines = String(textNoAccents ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - n));
}

/** Mayor importe en las últimas N líneas, excluyendo líneas con "IVA" o avoidRegex. */
export function maxMoneyTailExcludingIva(
  textNoAccents: string,
  avoidRegex: RegExp | null,
  tailN: number,
): number | null {
  const lines = lastLines(textNoAccents, tailN || 40);
  const vals: number[] = [];
  for (const ln of lines) {
    if (/\bIVA\b/i.test(ln)) continue;
    if (avoidRegex && avoidRegex.test(ln)) continue;
    const tokens = ln.match(/\d+(?:[.,]\d+)?/g) ?? [];
    for (const tok of tokens) {
      const n = toNumberFlex(tok);
      if (Number.isFinite(n)) vals.push(n as number);
    }
  }
  if (!vals.length) return null;
  return round2(Math.max(...vals));
}

/** Lee TOTAL(Q) del bloque "TOTALES" (ventana de 4 líneas, ignora lo tras "IVA"). */
export function totalFromTotalsBlock(textNoAccents: string): number | null {
  const lines = String(textNoAccents ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/\bTOTALES?\b/i.test(lines[i])) {
      let seg = lines.slice(i, i + 4).join(' ');
      seg = seg.split(/IVA/i)[0];
      const tokens = seg.match(/\d+(?:[.,]\d+)?/g) ?? [];
      const vals = tokens.map(t => toNumberFlex(t)).filter((n): n is number => Number.isFinite(n));
      if (vals.length) return round2(Math.max(...vals));
    }
  }
  return null;
}

/**
 * Elige el primer candidate consistente: >= IVA y >= SUBTOTAL (con margen de
 * 1 centavo por redondeo). Es la VERSIÓN 2 de pickConsistentTotal de utils.gs
 * (la primera se sobrescribía por esta sin tolerancia; el brief lo aclara).
 */
export function pickConsistentTotal(
  candidates: Array<number | null>,
  iva: number | null,
  subtotal: number | null,
): number | null {
  for (const t of candidates) {
    if (!Number.isFinite(t)) continue;
    const tn = t as number;
    if (Number.isFinite(iva) && tn + 0.01 < (iva as number)) continue;       // tolera 1 centavo
    if (Number.isFinite(subtotal) && tn + 0.01 < (subtotal as number)) continue;
    return round2(tn);
  }
  return null;
}

/* ============================================================
 * Cálculos exactos de IVA 12% (GT)
 * ============================================================ */

/** Total a partir del IVA y la tasa (por defecto 12%). Si tasa fuera (0,1) inválida → null. */
export function totalFromIva(iva: number | null, rate: number = GT_IVA_RATE): number | null {
  if (!Number.isFinite(iva) || (iva as number) <= 0) return null;
  const r = Number(rate || GT_IVA_RATE);
  if (!(r > 0 && r < 1)) return null;
  return round2((iva as number) / r + (iva as number));
}

/** Total exacto en centavos para IVA 12% (GT). 28/3 es exacto en fracción. */
export function totalFromIvaExactCents(iva: number | null): number | null {
  if (!Number.isFinite(iva) || (iva as number) <= 0) return null;
  const ivaCents = Math.round((iva as number) * 100);
  const totalCents = Math.round((ivaCents * 28) / 3);
  return totalCents / 100;
}

/** Subtotal exacto en centavos para IVA 12% (GT). 25/3 es exacto en fracción. */
export function subtotalFromIvaExactCents(iva: number | null): number | null {
  if (!Number.isFinite(iva) || (iva as number) <= 0) return null;
  const ivaCents = Math.round((iva as number) * 100);
  const subCents = Math.round((ivaCents * 25) / 3);
  return subCents / 100;
}

/* ============================================================
 * Strings y normalizadores
 * ============================================================ */

export function removeDiacritics(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "CF" se preserva; cualquier otro se uppercasea y deja solo [0-9A-Z]. */
export function normalizeNitGT(s: unknown): string {
  if (!s) return '';
  const up = String(s).toUpperCase().trim();
  if (up === 'CF') return 'CF';
  return up.replace(/[^0-9A-Z]/g, '');
}

/* ============================================================
 * Helpers de regex (cap1/cap2/cap3/pick/capNear/capSpanishDate)
 * ============================================================ */

export function cap1(txt: string, re: RegExp): string {
  const m = txt.match(re);
  return m ? String(m[1] ?? '').trim() : '';
}

export function cap2(txt: string, re: RegExp): string {
  const m = txt.match(re);
  return m ? String(m[2] ?? '').trim() : '';
}

export function cap3(txt: string, re: RegExp): string {
  const m = txt.match(re);
  return m ? String(m[3] ?? '').trim() : '';
}

/** Primer argumento truthy; fallback a string vacío. */
export function pick(...args: Array<string | null | undefined>): string {
  for (const a of args) {
    if (a) return a;
  }
  return '';
}

export function capNear(txt: string, re: RegExp, groupIndex: number): string {
  const m = txt.match(re);
  return m ? String(m[groupIndex] ?? '').trim() : '';
}

/** Reconoce "12 de agosto de 2025" → "2025-08-12". */
export function capSpanishDate(txt: string): string {
  const meses = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
  const re = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${meses})\\s+de\\s+(\\d{4})\\b`, 'i');
  const m = txt.match(re);
  if (!m) return '';
  const day = String(m[1]).padStart(2, '0');
  const monthIdx = 'enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre'
    .split(' ')
    .indexOf(m[2].toLowerCase());
  const mm = String(monthIdx + 1).padStart(2, '0');
  return `${m[3]}-${mm}-${day}`;
}

/* ============================================================
 * Fechas
 * ============================================================ */

/**
 * Normaliza fechas a YYYY-MM-DD. Acepta:
 *  - ISO ya canónico
 *  - dd/mm/yyyy
 *  - dd-mm-yyyy
 *  - dd-mmm-yyyy (mmm en español: ene, feb, ..., dic)
 *  - "12 de agosto de 2025"
 *  - Fallback: parser nativo Date (solo si el string no es Date-only YYYY-MM-DD).
 *
 * Quita la hora si viene mezclada. Devuelve '' si no logra parsear.
 */
export function normalizeFechaISO(s: unknown): string {
  if (!s) return '';
  let str = String(s).trim();

  // Quita hora si viene mezclada.
  str = str.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, '');

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/');
    return `${y}-${m}-${d}`;
  }

  // dd-mm-yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    const [d, m, y] = str.split('-');
    return `${y}-${m}-${d}`;
  }

  // dd-mmm-yyyy (ene..dic)
  const reAbbr = /\b(\d{1,2})-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)-(\d{4})\b/i;
  let m = str.match(reAbbr);
  if (m) {
    const map: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(map[m[2].toLowerCase()]).padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }

  // "12 de agosto de 2025"
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const reEsp = new RegExp(`^(\\d{1,2})\\s+de\\s+(${meses.join('|')})\\s+de\\s+(\\d{4})$`, 'i');
  m = str.match(reEsp);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mmIdx = meses.indexOf(m[2].toLowerCase());
    const mm = String(mmIdx + 1).padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }

  // Fallback nativo. Cuidado: NO usar para strings YYYY-MM-DD ya canónicas
  // (ya se devolvieron arriba). Para otros formatos arbitrarios.
  const dt = new Date(str);
  if (!isNaN(dt.valueOf())) {
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

/* ============================================================
 * doc_key (dedupe lógico)
 * ============================================================ */

function normIdPart(s: unknown): string {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * Clave documental para dedupe por CONTENIDO (mismo DTE en distintos PDFs).
 *
 * Cascadea por completitud de datos:
 *  - Si hay NIT + (serie o numero) → "NIT|serie|numero|fecha|total"
 *  - Si solo hay NIT              → "NIT|fecha|total"
 *  - Si solo hay proveedor_nombre → "PROVNORM|fecha|total"
 *  - Último recurso              → "UNKNOWN|fecha|total"
 */
export function buildDocKey(meta: {
  proveedor_nit?: string;
  serie?: string;
  numero?: string;
  fecha_emision?: string;
  total?: number;
  proveedor_nombre?: string;
}): string {
  const nit = normIdPart(meta.proveedor_nit);
  const serie = normIdPart(meta.serie);
  const numero = normIdPart(meta.numero);
  const fecha = normalizeFechaISO(meta.fecha_emision ?? '') || '';
  const totNum = Number(meta.total ?? 0);
  const total = Number.isFinite(totNum) ? totNum.toFixed(2) : '0.00';

  if (nit && (serie || numero)) return [nit, serie, numero, fecha, total].join('|');
  if (nit) return [nit, fecha, total].join('|');

  const prov = normIdPart(meta.proveedor_nombre);
  if (prov) return [prov, fecha, total].join('|');

  return ['UNKNOWN', fecha, total].join('|');
}
