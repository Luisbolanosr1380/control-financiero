/**
 * TARIFARIO · Canonicalización — PURA (sin IO).
 *
 * El tarifario y la Agenda (Airtable) escriben la misma cosa de muchas
 * formas: PREEMPLEO / PRE EMPLEO / PRE-EMPLEO / "PRE EMEPLEO" / "PRE E E",
 * ESPECIFICA / ESPECIFICO / ESPECÍFICA, "SOLO POLIGRAFO" / POLÍGRAFO, etc.
 * Acá se reduce cada variante a UNA forma canónica para comparar y buscar.
 * Lo usan el motor de lookup, el aviso de combinación repetida y el form.
 */
import { nitComparable } from '@/lib/clientes/nit';

/** Mayúsculas, sin acentos, espacios colapsados. */
export function normalizarTexto(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
/** Solo letras y dígitos (para comparar variantes de grafía). */
const compacto = (s: string | null | undefined) => normalizarTexto(s).replace(/[^A-Z0-9]/g, '');

export const TIPOS_PRUEBA = ['POLIGRAFO', 'SOCIOECONOMICO', 'COMPLETO', 'POLIGRAFO BASIC', 'INFORNET', 'VISITA DOMICILIAR', 'ENTREVISTA FORENSE'] as const;
export const CATEGORIAS   = ['PRE EMPLEO', 'RUTINA', 'ESPECIFICO', 'INFORNET'] as const;
export const TERRITORIOS  = ['METROPOLITANA', 'DEPARTAMENTAL'] as const;

/** Tipo de prueba canónico. "COMPLETO" = polígrafo + socioeconómico (lo arma el motor). */
export function canonTipoPrueba(s: string | null | undefined): string {
  const c = compacto(s);
  if (!c) return '';
  if (c.includes('POLIGRAF') && c.includes('BASIC')) return 'POLIGRAFO BASIC';
  if (c.includes('COMPLET') || (c.includes('POLIGRAF') && c.includes('SOCIO'))) return 'COMPLETO';
  if (c.includes('POLIGRAF')) return 'POLIGRAFO';
  if (c.includes('SOCIO'))    return 'SOCIOECONOMICO';
  if (c.includes('INFORNET')) return 'INFORNET';
  if (c.includes('VISITA'))   return 'VISITA DOMICILIAR';
  if (c.includes('FORENSE'))  return 'ENTREVISTA FORENSE';
  return normalizarTexto(s);
}

/** Categoría canónica: PRE EMPLEO (y sus erratas), RUTINA, ESPECIFICO, INFORNET. */
export function canonCategoria(s: string | null | undefined): string {
  const c = compacto(s);
  if (!c) return '';
  if (/^PRE/.test(c))          return 'PRE EMPLEO';     // PREEMPLEO, PREEMEPLEO, PREEMMPLEO, PREEE…
  if (c.includes('ESPECIF'))   return 'ESPECIFICO';     // ESPECIFICA / ESPECÍFICO
  if (/^RUTIN/.test(c))        return 'RUTINA';
  if (c.includes('INFORNET'))  return 'INFORNET';
  return normalizarTexto(s);
}

/** Territorio canónico; '' si no viene (el motor decide si hace falta). */
export function canonTerritorio(s: string | null | undefined): string {
  const c = compacto(s);
  if (!c) return '';
  if (/^(METRO|LOCAL|CAPITAL|CIUDAD|GUATEMALA|GT)/.test(c) || c.includes('METROPOL')) return 'METROPOLITANA';
  if (/^(DEPART|DEPTO|DPTO|INTERIOR)/.test(c) || c.includes('DEPARTAMENT'))          return 'DEPARTAMENTAL';
  return normalizarTexto(s);
}

export interface LlaveTarifa { nit: string | null | undefined; tipoPrueba: string; categoria: string; territorio: string }

/** Llave canónica de una tarifa: NIT comparable + tipo + categoría + territorio. */
export function llaveTarifa(t: LlaveTarifa): string {
  return [nitComparable(t.nit), canonTipoPrueba(t.tipoPrueba), canonCategoria(t.categoria), canonTerritorio(t.territorio)].join('|');
}

/** Q0 (o negativo) NO es gratis: es "sin tarifa definida". */
export const esSinTarifa = (monto: number | null | undefined): boolean => !(Number(monto) > 0);

export const IVA_PCT = 0.12;
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** IVA y total sobre un monto sin IVA (12 %, Guatemala). */
export function conIva(montoSinIva: number): { iva: number; total: number } {
  const iva = round2(montoSinIva * IVA_PCT);
  return { iva, total: round2(montoSinIva + iva) };
}
