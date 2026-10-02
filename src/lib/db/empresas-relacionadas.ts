// ============================================================
// MULTI-EMPRESA · Paso 3 — Catálogo de empresas relacionadas.
//
// Fuente de las opciones de "empresa empleadora" / "por cuenta de":
// la tabla `empresas_relacionadas` (la crea la migración 007,
// propuesta aprobada). MIENTRAS la 007 no esté aplicada (Golden hoy),
// la tabla no existe y este módulo cae al FALLBACK legacy — los 5
// labels históricos del enum — así Golden queda idéntica y el switch
// al catálogo es automático post-007, sin tocar código.
// ============================================================

import { supabase } from '../supabase/client';
import { EMPRESAS_EMPLEADORAS_LEGACY, EMPRESA_EMPLEADORA_DEFAULT } from '../empleados/empresa';

export interface EmpresaRelacionada {
  nombre: string;
  esPrincipal: boolean;
  activo: boolean;
}

/** Filas crudas → catálogo (pura, testeable sin base). */
export function parseCatalogo(rows: Array<Record<string, unknown>>): EmpresaRelacionada[] {
  return rows
    .map(r => ({
      nombre: String(r.nombre ?? '').trim(),
      esPrincipal: r.es_principal === true,
      activo: r.activo !== false,
    }))
    .filter(e => e.nombre !== '');
}

/** Fallback pre-007: los labels históricos del enum, con la principal de la config. */
export function catalogoLegacy(): EmpresaRelacionada[] {
  return EMPRESAS_EMPLEADORAS_LEGACY.map(nombre => ({
    nombre,
    esPrincipal: nombre === EMPRESA_EMPLEADORA_DEFAULT,
    activo: true,
  }));
}

let cache: EmpresaRelacionada[] | null = null;
let cacheExpira = 0;
const TTL_MS = 5 * 60_000;

/**
 * Catálogo de empresas del grupo (activas). Fail-soft doble: tabla
 * inexistente (pre-007) o error de red → fallback legacy.
 */
export async function getEmpresasRelacionadas(): Promise<EmpresaRelacionada[]> {
  if (cache && Date.now() < cacheExpira) return cache;
  try {
    const sb = supabase();
    if (!sb) return catalogoLegacy();
    const { data, error } = await sb.from('empresas_relacionadas')
      .select('nombre, es_principal, activo').order('nombre');
    if (error) throw new Error(error.message);
    const parsed = parseCatalogo(data ?? []).filter(e => e.activo);
    cache = parsed.length > 0 ? parsed : catalogoLegacy();
  } catch {
    // Pre-007 la tabla no existe (42P01/PGRST205) — comportamiento esperado.
    cache = catalogoLegacy();
  }
  cacheExpira = Date.now() + TTL_MS;
  return cache;
}

/** Solo los nombres, para selects de UI (se pasan por props a los client components). */
export async function getOpcionesEmpresas(): Promise<string[]> {
  return (await getEmpresasRelacionadas()).map(e => e.nombre);
}
