/**
 * POR FACTURAR · FILTROS PARA ARMAR EL DETALLE (PR 1 del brief "Detalle digital"). PURO (sin IO).
 *
 * El cliente pide cortes por persona: "a esta mandale los polígrafos de rutina; a esta otra los socios".
 * Filtros por servicio, categoría, territorio y solicitante, que trabajan A NIVEL PRUEBA (en un COMPLETO,
 * filtrar "Polígrafo" deja ver y seleccionar solo el polígrafo). El solicitante sale del campo `solicitante`
 * del expediente (ya llega de la Agenda), normalizado con trim + mayúsculas; vacío = "Sin solicitante".
 * Los filtros viajan en la URL (search params) para que al volver atrás no se pierdan. Al generar el detalle
 * se propone un título del corte a partir de los filtros activos.
 */
import type { ExpedienteLocal, PruebaLocal } from './tipos';
import { etiquetaMes } from './produccion';

/** Valor del filtro de solicitante para los expedientes sin solicitante. */
export const SIN_SOLICITANTE = '__sin__';

export interface FiltrosPrueba {
  servicio?: string;
  categoria?: string;
  territorio?: string;
  /** Solicitante normalizado (trim + mayúsculas) o SIN_SOLICITANTE. */
  solicitante?: string;
}

/** Claves en la URL (search params) de TODOS los filtros de la lista del cliente. */
export interface FiltrosLista extends FiltrosPrueba {
  mes?: string;
  mesResultado?: string;
  cobro?: string;
  soloListos?: boolean;
}

export const normalizarSolicitante = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
/** Clave de filtro de un expediente: su solicitante normalizado o SIN_SOLICITANTE. */
export const claveSolicitante = (e: Pick<ExpedienteLocal, 'solicitante'>): string => normalizarSolicitante(e.solicitante) || SIN_SOLICITANTE;
export const etiquetaSolicitante = (clave: string): string => (clave === SIN_SOLICITANTE ? 'Sin solicitante' : clave);

const ETIQUETA_SERVICIO: Record<string, string> = {
  'POLIGRAFO': 'Polígrafo', 'POLIGRAFO BASIC': 'Polígrafo basic', 'SOCIOECONOMICO': 'Socioeconómico', 'SOCIOECONOMICO VIRTUAL': 'Socioeconómico virtual',
  'SOCIOECONOMICO EMPRESARIAL': 'Socioeconómico empresarial', 'FEE VISITA SOCIO CANCELADO': 'Fee visita', 'INFORNET': 'Infornet', 'BACKGROUND CHECK': 'Background check',
  'PDA': 'PDA', 'MIDOT': 'MIDOT', 'INSIGHT': 'Insight', 'ENTREVISTA GERENCIAL': 'Entrevista gerencial', 'ENTREVISTA ESPECIALISTA': 'Entrevista especialista',
};
const PLURAL_SERVICIO: Record<string, string> = {
  'POLIGRAFO': 'Polígrafos', 'POLIGRAFO BASIC': 'Polígrafos basic', 'SOCIOECONOMICO': 'Socios', 'SOCIOECONOMICO VIRTUAL': 'Socios virtuales',
  'SOCIOECONOMICO EMPRESARIAL': 'Socios empresariales', 'FEE VISITA SOCIO CANCELADO': 'Fees de visita', 'INFORNET': 'Infornet', 'BACKGROUND CHECK': 'Background checks',
};
const capitalizar = (s: string): string => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);
export const etiquetaServicio = (s: string): string => ETIQUETA_SERVICIO[s] ?? capitalizar(s);
const ETIQUETA_CATEGORIA: Record<string, string> = { 'PRE EMPLEO': 'Pre empleo', 'RUTINA': 'Rutina', 'ESPECIFICO': 'Específico' };
export const etiquetaCategoria = (c: string): string => ETIQUETA_CATEGORIA[c] ?? capitalizar(c);
const ETIQUETA_TERRITORIO: Record<string, string> = { METROPOLITANA: 'Metro', DEPARTAMENTAL: 'Depto' };
export const etiquetaTerritorio = (t: string): string => ETIQUETA_TERRITORIO[t] ?? capitalizar(t);

const esDim = (v: string | null | undefined): v is string => !!v && v !== 'UNICA';
const vigente = (e: Pick<ExpedienteLocal, 'eliminado'>) => !e.eliminado;

export interface OpcionesFiltros { servicios: string[]; categorias: string[]; territorios: string[]; solicitantes: string[] }

/** Solo lo que el cliente tiene: servicios / categorías / territorios de sus pruebas y los solicitantes de sus expedientes. */
export function opcionesFiltros(exps: readonly ExpedienteLocal[]): OpcionesFiltros {
  const vig = exps.filter(vigente);
  const pruebas = vig.flatMap(e => e.pruebas);
  const ord = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'es'));
  const solicitantes = ord(vig.map(claveSolicitante).filter(s => s !== SIN_SOLICITANTE));
  if (vig.some(e => claveSolicitante(e) === SIN_SOLICITANTE)) solicitantes.push(SIN_SOLICITANTE);
  return {
    servicios: ord(pruebas.map(p => p.servicio).filter(Boolean)),
    categorias: ord(pruebas.map(p => p.categoria).filter(esDim)),
    territorios: ord(pruebas.map(p => p.territorio).filter(esDim)),
    solicitantes,
  };
}

export const hayFiltrosPrueba = (f: FiltrosPrueba): boolean => !!(f.servicio || f.categoria || f.territorio || f.solicitante);

/** ¿La prueba pasa los filtros? (el solicitante es del expediente; servicio / categoría / territorio son de la prueba). */
export function pruebaCumple(p: Pick<PruebaLocal, 'servicio' | 'categoria' | 'territorio'>, e: Pick<ExpedienteLocal, 'solicitante'>, f: FiltrosPrueba): boolean {
  if (f.servicio && p.servicio !== f.servicio) return false;
  if (f.categoria && p.categoria !== f.categoria) return false;
  if (f.territorio && p.territorio !== f.territorio) return false;
  if (f.solicitante && claveSolicitante(e) !== f.solicitante) return false;
  return true;
}

/** Pruebas del expediente que pasan los filtros. Sin filtros de prueba devuelve todas. */
export const pruebasQueCumplen = <P extends Pick<PruebaLocal, 'servicio' | 'categoria' | 'territorio'>>(pruebas: readonly P[], e: Pick<ExpedienteLocal, 'solicitante'>, f: FiltrosPrueba): P[] =>
  hayFiltrosPrueba(f) ? pruebas.filter(p => pruebaCumple(p, e, f)) : [...pruebas];

/**
 * ¿El expediente se muestra? Con filtros de prueba activos, solo si alguna de sus pruebas los pasa; un expediente
 * sin pruebas calculadas solo pasa el filtro de solicitante (no tiene servicio / categoría / territorio por prueba).
 */
export function expedienteCumple(e: Pick<ExpedienteLocal, 'solicitante' | 'pruebas'>, f: FiltrosPrueba): boolean {
  if (!hayFiltrosPrueba(f)) return true;
  if (f.solicitante && claveSolicitante(e) !== f.solicitante) return false;
  if (!e.pruebas.length) return !(f.servicio || f.categoria || f.territorio);
  return e.pruebas.some(p => pruebaCumple(p, e, f));
}

// ── URL ────────────────────────────────────────────────────────────────────────────────────────
const CLAVES = ['servicio', 'categoria', 'territorio', 'solicitante', 'mes', 'termino', 'cobro', 'listos'] as const;
const COBROS = ['por_facturar', 'facturados', 'todos'];

/** Lee los filtros de los search params (lo inválido se ignora). */
export function filtrosDesdeParams(get: (k: string) => string | null): FiltrosLista {
  const v = (k: string) => (get(k) ?? '').trim().slice(0, 120);
  const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
  const mes = MES.test(v('mes')) ? v('mes') : '';
  const termino = MES.test(v('termino')) ? v('termino') : '';
  const cobro = COBROS.includes(v('cobro')) ? v('cobro') : '';
  return {
    servicio: v('servicio') || undefined, categoria: v('categoria') || undefined, territorio: v('territorio') || undefined, solicitante: v('solicitante') || undefined,
    mes: mes || undefined, mesResultado: termino || undefined, cobro: cobro || undefined, soloListos: v('listos') === '1' || undefined,
  };
}

/** Query string de los filtros (sin los vacíos; '' si no hay ninguno). Conserva otros params que se pasen en `base`. */
export function paramsDeFiltros(f: FiltrosLista, base?: URLSearchParams): string {
  const sp = new URLSearchParams(base ? base.toString() : '');
  for (const k of CLAVES) sp.delete(k);
  if (f.servicio) sp.set('servicio', f.servicio);
  if (f.categoria) sp.set('categoria', f.categoria);
  if (f.territorio) sp.set('territorio', f.territorio);
  if (f.solicitante) sp.set('solicitante', f.solicitante);
  if (f.mes) sp.set('mes', f.mes);
  if (f.mesResultado) sp.set('termino', f.mesResultado);
  if (f.cobro && f.cobro !== 'por_facturar') sp.set('cobro', f.cobro);
  if (f.soloListos) sp.set('listos', '1');
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ── Título del corte ───────────────────────────────────────────────────────────────────────────
const etiquetaMesTitulo = (m: string): string => { const t = etiquetaMes(m); return t ? t.charAt(0).toUpperCase() + t.slice(1) : m; };

/**
 * Propuesta a partir de los filtros activos: "Polígrafos rutina · Solicitante ADELA CEBALLOS · Oct 2026".
 * Sin filtros devuelve '' (el título es opcional). Si el usuario lo edita, se respeta lo que escribió.
 */
export function tituloPropuesto(f: FiltrosLista): string {
  const partes: string[] = [];
  const servicio = f.servicio ? (PLURAL_SERVICIO[f.servicio] ?? etiquetaServicio(f.servicio)) : '';
  const cat = f.categoria ? etiquetaCategoria(f.categoria).toLowerCase() : '';
  const ter = f.territorio ? etiquetaTerritorio(f.territorio).toLowerCase() : '';
  const primera = [servicio, cat, ter].filter(Boolean).join(' ');
  if (primera) partes.push(primera.charAt(0).toUpperCase() + primera.slice(1));
  if (f.solicitante) partes.push(f.solicitante === SIN_SOLICITANTE ? 'Sin solicitante' : `Solicitante ${f.solicitante}`);
  if (f.mesResultado) partes.push(etiquetaMesTitulo(f.mesResultado));
  else if (f.mes) partes.push(`Ingreso ${etiquetaMesTitulo(f.mes)}`);
  return partes.join(' · ').slice(0, 200);
}

export const limpiarTexto = (s: string | null | undefined, max: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
