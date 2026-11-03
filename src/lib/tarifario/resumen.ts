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
import { coincideCliente, nombresDe, terminosDe, type ClienteBuscable } from '../clientes/buscar';
import { nitComparable, nitEsPlaceholder } from '../clientes/nit';

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
  /**
   * Título de la fila: el nombre de empresa del cliente activo con ese NIT ("WALMART / GPB LOGISTIC"); si el NIT
   * no tiene cliente activo (tarifas huérfanas), la razón social de la tarifa. Siempre hay algo (al final, el NIT).
   */
  nombre: string;
  /** true = el NIT no tiene ningún cliente activo en Clientes. */
  sinCliente: boolean;
  /** Todos los nombres por los que se encuentra (cliente + razón social de la tarifa), para el buscador y el title. */
  nombres: string[];
}

/** Lo que el tarifario necesita de un cliente de Clientes para titular y buscar (020: nombre comercial y aliases). */
export interface ClienteTarifario {
  nit: string | null | undefined;
  name: string;
  razonSocial?: string | null;
  nombreComercial?: string | null;
  aliases?: readonly string[] | null;
  activo?: boolean;
}

/** Clientes ACTIVOS indexados por NIT comparable (varios pueden compartir NIT: todos cuentan para buscar); NIT placeholder (vacío, 0, CF) no indexa. */
export function clientesPorNit(clientes: readonly ClienteTarifario[]): Map<string, ClienteTarifario[]> {
  const m = new Map<string, ClienteTarifario[]>();
  for (const c of clientes) {
    if (c.activo === false) continue;
    const k = nitComparable(c.nit);
    if (nitEsPlaceholder(k)) continue;   // vacío, '0' o 'CF' no identifican a nadie
    (m.get(k) ?? m.set(k, []).get(k)!).push(c);
  }
  return m;
}

/** Nombre y términos de búsqueda de una empresa del tarifario a partir de sus clientes activos (o solo de la tarifa). */
export function identidadEmpresa(nit: string, razonSocial: string, clientes: readonly ClienteTarifario[] | undefined): Pick<EmpresaTarifario, 'nombre' | 'sinCliente' | 'nombres'> {
  const activos = (clientes ?? []).filter(c => c.activo !== false);
  const vistos = new Set<string>();
  const nombres: string[] = [];
  const add = (n: string | null | undefined) => { const t = String(n ?? '').replace(/\s+/g, ' ').trim(); const k = t.toLowerCase(); if (t && !vistos.has(k)) { vistos.add(k); nombres.push(t); } };
  for (const c of activos) for (const n of nombresDe({ id: nitComparable(c.nit) || c.name, name: c.name, nit: c.nit, razonSocial: c.razonSocial, nombreComercial: c.nombreComercial, aliases: c.aliases })) add(n);
  add(razonSocial);
  const titulo = activos.map(c => c.name.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const nombre = (titulo.length ? [...new Set(titulo)].join(' · ') : razonSocial.trim()) || `NIT ${nit}`;
  return { nombre, sinCliente: activos.length === 0, nombres: nombres.length ? nombres : [nombre] };
}

/** Lo que el buscador de clientes necesita de una fila del tarifario: primero el nombre (pesa más), luego los demás. */
export const empresaBuscable = (e: EmpresaTarifario): ClienteBuscable => ({ id: e.nit, name: e.nombre, nit: e.nit, aliases: e.nombres });

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
export function resumenPorEmpresa(tarifas: readonly Tarifa[], antiguedad: Readonly<Record<string, AntiguedadPrecio>> = {}, clientes: readonly ClienteTarifario[] = []): EmpresaTarifario[] {
  const porNit = new Map<string, EmpresaTarifario & { _ant: AntiguedadPrecio[] }>();
  const cli = clientesPorNit(clientes);
  for (const t of tarifas) {
    if (!t.activo) continue;
    let e = porNit.get(t.nit);
    if (!e) { e = { nit: t.nit, razonSocial: t.razonSocial, activas: 0, pendientes: 0, sinTarifa: 0, aprobadas: 0, semaforo: 'verde', estancadas: 0, precioDesde: null, nombre: '', sinCliente: true, nombres: [], _ant: [] }; porNit.set(t.nit, e); }
    if (!e.razonSocial && t.razonSocial) e.razonSocial = t.razonSocial;
    e.activas++;
    if (esSinTarifa(t.monto)) e.sinTarifa++;
    else {
      if (t.aprobadoEn) e.aprobadas++; else e.pendientes++;
      const a = antiguedad[t.id];
      if (a) { e._ant.push(a); if (a.estancada) e.estancadas++; }
    }
  }
  const out = [...porNit.values()].map(({ _ant, ...e }) => ({ ...e, semaforo: semaforoDe(e), precioDesde: precioDesdeMasAntiguo(_ant), ...identidadEmpresa(e.nit, e.razonSocial, cli.get(nitComparable(e.nit))) }));
  return ordenarEmpresas(out);
}

/** Primero las que requieren acción (rojo, luego amarillo), después alfabético por el nombre que se muestra. */
export function ordenarEmpresas(empresas: readonly EmpresaTarifario[]): EmpresaTarifario[] {
  const peso: Record<Semaforo, number> = { rojo: 0, amarillo: 1, verde: 2 };
  return [...empresas].sort((a, b) => peso[a.semaforo] - peso[b.semaforo] || (a.nombre || a.razonSocial || a.nit).localeCompare(b.nombre || b.razonSocial || b.nit, 'es'));
}

/**
 * Filtro del buscador de empresas: por CUALQUIER nombre del cliente (nombre de empresa, razón social, nombre
 * comercial, aliases) o por la razón social de la tarifa, sin tildes ni mayúsculas, y por NIT (misma lógica que
 * Clientes y el mapeo de la Agenda: `src/lib/clientes/buscar.ts`). Opcionalmente solo las que tienen estancadas.
 * Conserva el orden de la lista (no reordena por relevancia).
 */
export function filtrarEmpresas(empresas: readonly EmpresaTarifario[], q: string, soloEstancadas = false): EmpresaTarifario[] {
  const s = q.trim();
  return empresas.filter(e => (!soloEstancadas || e.estancadas > 0) && (!s || coincideCliente(empresaBuscable(e), s, terminosDe(empresaBuscable(e)))));
}

/** Términos de búsqueda por NIT para la tabla plana ("Ver todas"): nombre del cliente + razón social. */
export function terminosPorNit(empresas: readonly EmpresaTarifario[]): Map<string, { nombre: string; sinCliente: boolean; terminos: readonly string[] }> {
  return new Map(empresas.map(e => [nitComparable(e.nit), { nombre: e.nombre, sinCliente: e.sinCliente, terminos: terminosDe(empresaBuscable(e)) }]));
}

/** Las que un "aprobar en lote" tocaría: activas, pendientes y con monto (nunca Q0). */
export const aprobablesDe = (tarifas: readonly Tarifa[]): Tarifa[] => tarifas.filter(esPendiente);
