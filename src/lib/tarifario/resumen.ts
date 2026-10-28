/**
 * TARIFARIO · Resumen por empresa — PURO (sin IO).
 * Una fila por NIT con los conteos que guían la acción: activas, pendientes
 * de aprobar, en Q0 (sin tarifa) y ESTANCADAS (precio sin subir más allá del
 * umbral; migración 015). Semáforo: rojo si tiene Q0, amarillo si tiene
 * pendientes, verde si todo está aprobado y sin Q0. Orden por defecto:
 * primero las que requieren acción, luego alfabético.
 */
import { esSinTarifa } from './canon';
import type { Tarifa } from './lookup';
import { precioDesdeMasAntiguo, type AntiguedadPrecio } from './antiguedad';

export type Semaforo = 'rojo' | 'amarillo' | 'verde';

export interface EmpresaTarifario {
  nit: string;
  razonSocial: string;
  activas: number;
  pendientes: number;
  sinTarifa: number;
  aprobadas: number;
  semaforo: Semaforo;
  /** Tarifas activas con monto cuya antigüedad supera el umbral (fuga de margen). */
  estancadas: number;
  /** Desde cuándo no se le revisa precio en general = la tarifa menos reciente del cliente (ISO) o null sin dato. */
  precioDesde: string | null;
}

export const esPendiente = (t: Tarifa): boolean => t.activo && !t.aprobadoEn && !esSinTarifa(t.monto);

export function semaforoDe(e: Pick<EmpresaTarifario, 'pendientes' | 'sinTarifa'>): Semaforo {
  if (e.sinTarifa > 0) return 'rojo';
  if (e.pendientes > 0) return 'amarillo';
  return 'verde';
}

/**
 * Agrega las tarifas ACTIVAS por NIT. Las inactivas no cuentan (quedan en el
 * histórico). `antiguedad` (id → antigüedad del precio) es opcional: sin ella
 * no hay estancadas ni "precio desde".
 */
export function resumenPorEmpresa(tarifas: readonly Tarifa[], antiguedad: Readonly<Record<string, AntiguedadPrecio>> = {}): EmpresaTarifario[] {
  const porNit = new Map<string, EmpresaTarifario & { _ant: AntiguedadPrecio[] }>();
  for (const t of tarifas) {
    if (!t.activo) continue;
    let e = porNit.get(t.nit);
    if (!e) { e = { nit: t.nit, razonSocial: t.razonSocial, activas: 0, pendientes: 0, sinTarifa: 0, aprobadas: 0, semaforo: 'verde', estancadas: 0, precioDesde: null, _ant: [] }; porNit.set(t.nit, e); }
    if (!e.razonSocial && t.razonSocial) e.razonSocial = t.razonSocial;
    e.activas++;
    if (esSinTarifa(t.monto)) e.sinTarifa++;
    else {
      if (t.aprobadoEn) e.aprobadas++; else e.pendientes++;
      const a = antiguedad[t.id];
      if (a) { e._ant.push(a); if (a.estancada) e.estancadas++; }
    }
  }
  const out = [...porNit.values()].map(({ _ant, ...e }) => ({ ...e, semaforo: semaforoDe(e), precioDesde: precioDesdeMasAntiguo(_ant) }));
  return ordenarEmpresas(out);
}

/** Primero las que requieren acción (rojo, luego amarillo), después alfabético por razón social. */
export function ordenarEmpresas(empresas: readonly EmpresaTarifario[]): EmpresaTarifario[] {
  const peso: Record<Semaforo, number> = { rojo: 0, amarillo: 1, verde: 2 };
  return [...empresas].sort((a, b) => peso[a.semaforo] - peso[b.semaforo] || (a.razonSocial || a.nit).localeCompare(b.razonSocial || b.nit, 'es'));
}

/** Filtro del buscador de empresas: razón social o NIT; opcionalmente solo las que tienen tarifas estancadas. */
export function filtrarEmpresas(empresas: readonly EmpresaTarifario[], q: string, soloEstancadas = false): EmpresaTarifario[] {
  const s = q.trim().toLowerCase();
  return empresas.filter(e => (!soloEstancadas || e.estancadas > 0) && (!s || e.razonSocial.toLowerCase().includes(s) || e.nit.toLowerCase().includes(s)));
}

/** Las que un "aprobar en lote" tocaría: activas, pendientes y con monto (nunca Q0). */
export const aprobablesDe = (tarifas: readonly Tarifa[]): Tarifa[] => tarifas.filter(esPendiente);
