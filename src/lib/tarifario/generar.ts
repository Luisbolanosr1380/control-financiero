/**
 * TARIFARIO · "Generar tarifas" para un cliente — PURO (sin IO).
 *
 * Arma las filas en Q0 que le faltan a un NIT según la FORMA de cada servicio
 * (canon.ts): matriz → categorías × territorios; por territorio → 2 filas con
 * categoría UNICA; único → 1 fila UNICA/UNICA. Plantilla estándar (polígrafo +
 * socio) más los tipos que la empresa pide en la Agenda (así CIBUS / APOLO
 * reciben socio empresarial e infornet aunque no estén en la plantilla). No
 * duplica: lo que ya existe (activo o inactivo, por llave efectiva) se omite.
 */
import { CATEGORIAS, TERRITORIOS, UNICA, canonTipoPrueba, formaPrecio, llaveTarifa, type FormaPrecio } from './canon';
import type { Tarifa } from './lookup';

export interface PlanFila { tipoPrueba: string; categoria: string; territorio: string; forma: FormaPrecio; origen: 'plantilla' | 'agenda' | 'extra' }
export interface PlanGenerar { nit: string; filas: PlanFila[]; omitidas: PlanFila[]; porTipo: Record<string, number> }

/** Plantilla estándar: polígrafo (3 categorías × 2 territorios) + socioeconómico (2 × 2) = 10 filas. */
export const PLANTILLA: ReadonlyArray<{ tipoPrueba: string; categorias: readonly string[] }> = [
  { tipoPrueba: 'POLIGRAFO', categorias: ['PRE EMPLEO', 'RUTINA', 'ESPECIFICO'] },
  { tipoPrueba: 'SOCIOECONOMICO', categorias: ['PRE EMPLEO', 'RUTINA'] },
];

/** Filas que corresponden a un tipo según su forma (categorías de la plantilla o las 3 estándar). */
export function filasDeTipo(tipoPrueba: string, origen: PlanFila['origen'], categorias?: readonly string[]): PlanFila[] {
  const tipo = canonTipoPrueba(tipoPrueba); if (!tipo || tipo === 'COMPLETO') return [];
  const forma = formaPrecio(tipo);
  if (forma === 'unico') return [{ tipoPrueba: tipo, categoria: UNICA, territorio: UNICA, forma, origen }];
  if (forma === 'territorio') return TERRITORIOS.map(ter => ({ tipoPrueba: tipo, categoria: UNICA, territorio: ter, forma, origen }));
  const cats = categorias ?? CATEGORIAS;
  return cats.flatMap(cat => TERRITORIOS.map(ter => ({ tipoPrueba: tipo, categoria: cat, territorio: ter, forma, origen })));
}

/**
 * Plan para un NIT: plantilla + tipos de la Agenda + extras, menos lo que ya existe.
 * `existentes` = TODAS las filas del NIT (activas e inactivas: la clave única de la base
 * es exacta y una inactiva igual bloquea el insert).
 */
export function planGenerar(nit: string, existentes: readonly Tarifa[], tiposAgenda: readonly string[] = [], tiposExtra: readonly string[] = []): PlanGenerar {
  const ocupadas = new Set(existentes.map(t => llaveTarifa(t)));
  const vistos = new Set<string>();
  const candidatas: PlanFila[] = [];
  const enPlantilla = new Set(PLANTILLA.map(p => p.tipoPrueba));
  for (const p of PLANTILLA) candidatas.push(...filasDeTipo(p.tipoPrueba, 'plantilla', p.categorias));
  // Lo que pide en la Agenda: solo tipos fuera de la plantilla (polígrafo/socio ya van con sus categorías estándar).
  for (const t of tiposAgenda) if (!enPlantilla.has(canonTipoPrueba(t))) candidatas.push(...filasDeTipo(t, 'agenda'));
  for (const t of tiposExtra) candidatas.push(...filasDeTipo(t, 'extra'));
  const filas: PlanFila[] = []; const omitidas: PlanFila[] = [];
  for (const f of candidatas) {
    const k = llaveTarifa({ nit, ...f });
    if (vistos.has(k)) continue; vistos.add(k);
    (ocupadas.has(k) ? omitidas : filas).push(f);
  }
  const porTipo: Record<string, number> = {};
  for (const f of filas) porTipo[f.tipoPrueba] = (porTipo[f.tipoPrueba] ?? 0) + 1;
  return { nit, filas, omitidas, porTipo };
}

/** Resumen legible: "POLIGRAFO 6 · SOCIOECONOMICO 4 · SOCIOECONOMICO EMPRESARIAL 2 (por territorio) · INFORNET 1 (único)". */
export function resumenPlan(plan: PlanGenerar): string {
  return Object.entries(plan.porTipo).map(([t, n]) => { const f = formaPrecio(t); return `${t} ${n}${f === 'unico' ? ' (único)' : f === 'territorio' ? ' (por territorio)' : ''}`; }).join(' · ') || 'nada que crear';
}
