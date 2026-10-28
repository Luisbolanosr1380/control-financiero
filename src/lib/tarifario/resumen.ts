/**
 * TARIFARIO · Resumen por empresa — PURO (sin IO).
 * Una fila por NIT con los conteos que guían la acción: activas, pendientes
 * de aprobar y en Q0 (sin tarifa). Semáforo: rojo si tiene Q0, amarillo si
 * tiene pendientes, verde si todo está aprobado y sin Q0. Orden por
 * defecto: primero las que requieren acción, luego alfabético.
 */
import { esSinTarifa } from './canon';
import type { Tarifa } from './lookup';

export type Semaforo = 'rojo' | 'amarillo' | 'verde';

export interface EmpresaTarifario {
  nit: string;
  razonSocial: string;
  activas: number;
  pendientes: number;
  sinTarifa: number;
  aprobadas: number;
  semaforo: Semaforo;
}

export const esPendiente = (t: Tarifa): boolean => t.activo && !t.aprobadoEn && !esSinTarifa(t.monto);

export function semaforoDe(e: Pick<EmpresaTarifario, 'pendientes' | 'sinTarifa'>): Semaforo {
  if (e.sinTarifa > 0) return 'rojo';
  if (e.pendientes > 0) return 'amarillo';
  return 'verde';
}

/** Agrega las tarifas ACTIVAS por NIT. Las inactivas no cuentan (quedan en el histórico). */
export function resumenPorEmpresa(tarifas: readonly Tarifa[]): EmpresaTarifario[] {
  const porNit = new Map<string, EmpresaTarifario>();
  for (const t of tarifas) {
    if (!t.activo) continue;
    let e = porNit.get(t.nit);
    if (!e) { e = { nit: t.nit, razonSocial: t.razonSocial, activas: 0, pendientes: 0, sinTarifa: 0, aprobadas: 0, semaforo: 'verde' }; porNit.set(t.nit, e); }
    if (!e.razonSocial && t.razonSocial) e.razonSocial = t.razonSocial;
    e.activas++;
    if (esSinTarifa(t.monto)) e.sinTarifa++;
    else if (t.aprobadoEn) e.aprobadas++;
    else e.pendientes++;
  }
  const out = [...porNit.values()].map(e => ({ ...e, semaforo: semaforoDe(e) }));
  return ordenarEmpresas(out);
}

/** Primero las que requieren acción (rojo, luego amarillo), después alfabético por razón social. */
export function ordenarEmpresas(empresas: readonly EmpresaTarifario[]): EmpresaTarifario[] {
  const peso: Record<Semaforo, number> = { rojo: 0, amarillo: 1, verde: 2 };
  return [...empresas].sort((a, b) => peso[a.semaforo] - peso[b.semaforo] || (a.razonSocial || a.nit).localeCompare(b.razonSocial || b.nit, 'es'));
}

/** Filtro del buscador de empresas: razón social o NIT. */
export function filtrarEmpresas(empresas: readonly EmpresaTarifario[], q: string): EmpresaTarifario[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...empresas];
  return empresas.filter(e => e.razonSocial.toLowerCase().includes(s) || e.nit.toLowerCase().includes(s));
}

/** Las que un "aprobar en lote" tocaría: activas, pendientes y con monto (nunca Q0). */
export const aprobablesDe = (tarifas: readonly Tarifa[]): Tarifa[] => tarifas.filter(esPendiente);
