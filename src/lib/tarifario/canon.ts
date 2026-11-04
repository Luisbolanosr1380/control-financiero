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

export const TIPOS_PRUEBA = ['POLIGRAFO', 'SOCIOECONOMICO', 'COMPLETO', 'POLIGRAFO BASIC', 'INFORNET', 'VISITA DOMICILIAR', 'ENTREVISTA FORENSE', 'SOCIOECONOMICO EMPRESARIAL', 'SOCIOECONOMICO VIRTUAL', 'PDA', 'ENTREVISTA GERENCIAL', 'ENTREVISTA ESPECIALISTA', 'INSIGHT', 'MIDOT', 'BACKGROUND CHECK', 'FEE VISITA SOCIO CANCELADO'] as const;
export const CATEGORIAS   = ['PRE EMPLEO', 'RUTINA', 'ESPECIFICO'] as const;
/** Categorías del socioeconómico (ESPECIFICO no aplica al socio): las usa la plantilla y la forma 'categoria'. */
export const CATEGORIAS_SOCIO = ['PRE EMPLEO', 'RUTINA'] as const;

/**
 * FORMAS DE PRECIO (confirmadas con el CFO): no todos los servicios se cobran con la misma llave.
 *  - matriz:     NIT × tipo × categoría × territorio (POLIGRAFO, SOCIOECONOMICO, BASIC, FORENSE, VISITA; default).
 *  - territorio: NIT × tipo × territorio, sin categoría (SOCIOECONOMICO EMPRESARIAL).
 *  - categoria:  NIT × tipo × categoría, sin territorio (SOCIOECONOMICO VIRTUAL: es virtual, no hay visita;
 *                metro/depto es irrelevante, la categoría PRE EMPLEO / RUTINA sí importa).
 *  - unico:      NIT × tipo, sin categoría ni territorio (INFORNET, PDA, ENTREVISTA GERENCIAL / ESPECIALISTA,
 *                INSIGHT, MIDOT — confirmados con el CFO; INSIGHT y MIDOT por el mismo patrón de datos, a ratificar).
 * Queda completo el 2×2 (categoría sí/no × territorio sí/no). Las dimensiones que no aplican se guardan con el
 * centinela 'UNICA' (las columnas siguen NOT NULL y la clave única nit × tipo × categoría × territorio sigue
 * sirviendo; sin migración).
 */
export type FormaPrecio = 'matriz' | 'territorio' | 'categoria' | 'unico';
export const UNICA = 'UNICA';
const FORMA_POR_TIPO: Record<string, FormaPrecio> = {
  'SOCIOECONOMICO EMPRESARIAL': 'territorio',
  'FEE VISITA SOCIO CANCELADO': 'territorio',   // 024: socio cancelado con la visita/entrevista ya hecha → fee con tarifa propia (costo de visita: metro/depto)
  'SOCIOECONOMICO VIRTUAL': 'categoria',
  INFORNET: 'unico',
  'BACKGROUND CHECK': 'unico',   // confirmado por el CFO: sin versiones (ni categoría ni territorio); la Agenda manda PRE EMPLEO (y erratas) que se ignoran
  PDA: 'unico',
  'ENTREVISTA GERENCIAL': 'unico',
  'ENTREVISTA ESPECIALISTA': 'unico',
  INSIGHT: 'unico',   // confirmar con el CFO
  MIDOT: 'unico',     // confirmar con el CFO
};
/** Forma de precio de un tipo de prueba (canónico o no). Lo no declarado (BACKGROUND CHECK…) es matriz hasta que el CFO decida. */
export const formaPrecio = (tipoPrueba: string | null | undefined): FormaPrecio => FORMA_POR_TIPO[canonTipoPrueba(tipoPrueba)] ?? 'matriz';
export const usaCategoria  = (forma: FormaPrecio): boolean => forma === 'matriz' || forma === 'categoria';
export const usaTerritorio = (forma: FormaPrecio): boolean => forma === 'matriz' || forma === 'territorio';
export const ETIQUETA_FORMA: Record<FormaPrecio, string> = { matriz: 'Por categoría y territorio', territorio: 'Por territorio (sin categoría)', categoria: 'Por categoría (sin territorio)', unico: 'Precio único por cliente' };
/** Qué significa la forma para quien carga la tarifa (form de alta, resumen del plan). */
export const DESCRIPCION_FORMA: Record<FormaPrecio, string> = {
  matriz: 'un precio por categoría y territorio.',
  territorio: 'sin categoría; un precio por territorio.',
  categoria: 'un precio por categoría, el mismo en METROPOLITANA y DEPARTAMENTAL (servicio virtual, sin visita).',
  unico: 'sin categoría ni territorio; un solo precio para el cliente.',
};
export const esUnica = (v: string | null | undefined): boolean => normalizarTexto(v) === UNICA;
/** Texto de una dimensión para la pantalla: el centinela se muestra como "—". */
export const dimTexto = (v: string | null | undefined): string => (esUnica(v) ? '—' : normalizarTexto(v));

/** Llave EFECTIVA de una tarifa según la forma de su tipo: las dimensiones que no aplican quedan en UNICA. */
export function llaveEfectiva(t: { tipoPrueba: string; categoria: string | null | undefined; territorio: string | null | undefined }): { tipoPrueba: string; categoria: string; territorio: string; forma: FormaPrecio } {
  const tipoPrueba = canonTipoPrueba(t.tipoPrueba); const forma = formaPrecio(tipoPrueba);
  return { tipoPrueba, forma, categoria: usaCategoria(forma) ? canonCategoria(t.categoria) : UNICA, territorio: usaTerritorio(forma) ? canonTerritorio(t.territorio) : UNICA };
}
export const TERRITORIOS  = ['METROPOLITANA', 'DEPARTAMENTAL'] as const;

/**
 * Tipo de prueba canónico. "COMPLETO" = polígrafo + socioeconómico pedidos JUNTOS en un
 * mismo texto ("POLIGRAFO, SOCIOECONOMICO"). El motor de la Agenda parte primero la lista
 * por coma y canoniza cada servicio: una fila cuyo tipoPrueba es un solo servicio nunca
 * se vuelve COMPLETO por su procesoSolicitado (fix "COMPLETO doble").
 */
export function canonTipoPrueba(s: string | null | undefined): string {
  const c = compacto(s);
  if (!c) return '';
  if (c.includes('FEE')) return 'FEE VISITA SOCIO CANCELADO';   // 024: fee del socio cancelado con visita realizada — ANTES de las reglas de SOCIO (el nombre lo contiene)
  if (c.includes('POLIGRAF') && c.includes('BASIC')) return 'POLIGRAFO BASIC';
  if (c.includes('COMPLET') || (c.includes('POLIGRAF') && c.includes('SOCIO'))) return 'COMPLETO';
  if (c.includes('POLIGRAF')) return 'POLIGRAFO';
  if (c.includes('SOCIO') && c.includes('EMPRESARIAL')) return 'SOCIOECONOMICO EMPRESARIAL';   // FACTURACIÓN AGENDA: "SOCIO EMPRESARIAL" es otro servicio, no un socioeconómico
  if (c.includes('SOCIO') && c.includes('VIRTUAL'))     return 'SOCIOECONOMICO VIRTUAL';       // forma 'categoria': sin visita, el territorio no importa
  if (c.includes('SOCIO'))    return 'SOCIOECONOMICO';
  if (c.includes('INFORNET')) return 'INFORNET';
  if (c.includes('VISITA'))   return 'VISITA DOMICILIAR';
  if (c.includes('FORENSE'))  return 'ENTREVISTA FORENSE';
  // Servicios de precio único (brief "servicios de precio único"): la llave tiene que coincidir con FORMA_POR_TIPO.
  if (c.includes('GERENCI'))  return 'ENTREVISTA GERENCIAL';     // incluye la errata "GERENCIL" de la Agenda
  if (c.includes('ESPECIALISTA')) return 'ENTREVISTA ESPECIALISTA';
  if (c.includes('INSIGHT'))  return 'INSIGHT';
  if (c.includes('MIDOT'))    return 'MIDOT';
  if (c.includes('BACKGROUND')) return 'BACKGROUND CHECK';
  if (/\bPDA\b/.test(normalizarTexto(s))) return 'PDA';
  return normalizarTexto(s);
}

/** Categoría canónica: PRE EMPLEO (y sus erratas), RUTINA, ESPECIFICO, INFORNET. */
export function canonCategoria(s: string | null | undefined): string {
  const c = compacto(s);
  if (!c) return '';
  if (c === 'UNICA') return 'UNICA';   // centinela de las formas sin categoría
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
  if (c === 'UNICA') return 'UNICA';   // centinela de la forma 'unico'
  if (/^(METRO|LOCAL|CAPITAL|CIUDAD|GUATEMALA|GT)/.test(c) || c.includes('METROPOL')) return 'METROPOLITANA';
  if (/^(DEPART|DEPTO|DPTO|INTERIOR)/.test(c) || c.includes('DEPARTAMENT'))          return 'DEPARTAMENTAL';
  return normalizarTexto(s);
}

export interface LlaveTarifa { nit: string | null | undefined; tipoPrueba: string; categoria: string; territorio: string }

/** Llave canónica de una tarifa: NIT comparable + tipo + categoría + territorio. */
export function llaveTarifa(t: LlaveTarifa): string {
  const e = llaveEfectiva(t);
  return [nitComparable(t.nit), e.tipoPrueba, e.categoria, e.territorio].join('|');
}

/** Q0 (o negativo) NO es gratis: es "sin tarifa definida". */
export const esSinTarifa = (monto: number | null | undefined): boolean => !(Number(monto) > 0);

export const IVA_PCT = 0.12;
export const round2 = (n: number) => Math.round(n * 100) / 100;
/**
 * IVA y total sobre UN monto sin IVA (12 %, Guatemala): para mostrar una tarifa suelta.
 * NO usar sobre sumas: el redondeo se acumula (16 × 401.79 + IVA ≠ 16 × 450). Para conjuntos, `totalesFel`.
 */
export function conIva(montoSinIva: number): { iva: number; total: number } {
  const iva = round2(montoSinIva * IVA_PCT);
  return { iva, total: round2(montoSinIva + iva) };
}

/**
 * REGLA FEL (030): la factura electrónica (y la SAT) parten del PRECIO CON IVA por unidad y separan el IVA del
 * TOTAL. Las tarifas están guardadas sin IVA redondeadas a 2 decimales (450 con IVA → 401.79, no 401.7857…), así
 * que cada prueba vuelve a su precio redondo con `precioConIva` y los totales de un conjunto se calculan así:
 *   total = Σ precioConIva(prueba) · base = round2(total / 1.12) · iva = total − base (por resta: base + iva = total siempre).
 * Espejo SQL: fel_totales(numeric[]) en la migración 030. Vale para un detalle, una línea de factura por centro de
 * costo o un grupo de la cola. `conIva()` de un monto suelto queda solo para mostrar una tarifa.
 */
// Aritmética en CENTAVOS ENTEROS: así el redondeo en TS es idéntico al `numeric` de Postgres (fel_totales), también
// en los casos límite (x.xx5), y la huella del documento firmado da lo mismo en los dos lados.
const centavos = (m: number): number => Math.round(Number(m) * 100);
const IVA_CENT = 100 + Math.round(IVA_PCT * 100);   // 112
export const precioConIva = (montoSinIva: number): number => Math.round((centavos(montoSinIva) * IVA_CENT) / 100) / 100;
export function totalesFel(montosSinIva: readonly number[]): { base: number; iva: number; total: number } {
  const totalCent = montosSinIva.reduce((s, m) => s + Math.round((centavos(m) * IVA_CENT) / 100), 0);
  const baseCent = Math.round((totalCent * 100) / IVA_CENT);
  return { base: baseCent / 100, iva: (totalCent - baseCent) / 100, total: totalCent / 100 };
}
