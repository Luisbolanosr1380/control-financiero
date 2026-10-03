/**
 * MULTI-EMPRESA · Paso 3 — Permisos usuario→empresas (propuesta 2 aprobada).
 *
 * Fuente: Clerk `publicMetadata.empresas` del usuario — el ÚNICO lugar
 * compartido por construcción entre los deploys (viaja en la sesión;
 * ni el selector ni el guard tocan ninguna base):
 *
 *   { "empresas": [
 *       { "slug": "golden", "nombre": "Golden Talent", "url": "https://cf-golden.vercel.app" },
 *       { "slug": "hit",    "nombre": "HIT",           "url": "https://cf-hit.vercel.app" }
 *   ] }
 *
 * Cada deploy declara quién es con EMPRESA_SLUG (config 1-A).
 *
 * COMPATIBILIDAD (clave para no romper Golden hoy): si el usuario NO
 * tiene `empresas` en su metadata (nadie lo tiene hasta el Paso 4),
 * el guard cae al comportamiento actual — el allowlist por deploy
 * (ALLOWED_EMAILS), que ya aísla y queda como segunda capa SIEMPRE.
 * Con metadata presente, el guard además exige el slug del deploy.
 *
 * Módulo PURO (sin IO) — las pruebas con usuarios simulados corren
 * sobre estas funciones sin Clerk real.
 */

import { accesosDeMetadata, ROL_LABEL, type Rol } from './roles';
import { deployDe } from '../config/deploys';

export interface EmpresaAcceso {
  slug: string;
  nombre: string;
  url: string;
  rol?: Rol;
}

/**
 * F-GESTION-USUARIOS: empresas del usuario para el selector. Con
 * `accesos` (formato nuevo) se arman desde el registro de deploys; sin
 * él, se cae al viejo `empresas` (null = modo compatibilidad).
 */
export function empresasDelUsuario(meta: unknown): EmpresaAcceso[] | null {
  const accesos = accesosDeMetadata(meta);
  if (accesos === null) return empresasDeMetadata(meta);
  return accesos.map(a => ({ ...deployDe(a.empresa_slug), rol: a.rol }));
}

export const etiquetaRol = (r?: Rol) => (r ? ROL_LABEL[r] : '');

/**
 * Parsea `publicMetadata` de Clerk.
 *  - null  → el metadata NO define empresas (usuario pre-Paso 4):
 *            modo compatibilidad, decide solo el allowlist.
 *  - []    → define empresas y es VACÍO: sin acceso a ninguna.
 *  - [...] → las empresas del usuario (entradas inválidas se descartan).
 */
export function empresasDeMetadata(meta: unknown): EmpresaAcceso[] | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as { empresas?: unknown }).empresas;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;   // metadata malformado = como ausente (no bloquear por basura)
  const out: EmpresaAcceso[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const slug = String((e as { slug?: unknown }).slug ?? '').trim().toLowerCase();
    const nombre = String((e as { nombre?: unknown }).nombre ?? '').trim();
    const url = String((e as { url?: unknown }).url ?? '').trim();
    if (!slug) continue;
    out.push({ slug, nombre: nombre || slug, url });
  }
  return out;
}

/** ¿El usuario tiene permiso a la empresa de ESTE deploy? (null = modo compat → sí, decide el allowlist). */
export function tieneAccesoAlDeploy(empresas: EmpresaAcceso[] | null, slugDeploy: string): boolean {
  if (empresas === null) return true;
  return empresas.some(e => e.slug === slugDeploy.toLowerCase());
}

export type Seleccion =
  | { tipo: 'directo-local' }                    // 1 empresa y es este deploy (o modo compat)
  | { tipo: 'directo-externo'; url: string }     // 1 empresa y vive en otro deploy
  | { tipo: 'selector'; empresas: EmpresaAcceso[] }  // 2+ → elegir
  | { tipo: 'sin-empresas' };                    // metadata presente y vacío

/** Lógica del selector: a dónde va el usuario al entrar a /empresas. */
export function resolverSeleccion(empresas: EmpresaAcceso[] | null, slugDeploy: string): Seleccion {
  if (empresas === null) return { tipo: 'directo-local' };   // compat: el allowlist ya decidió
  if (empresas.length === 0) return { tipo: 'sin-empresas' };
  if (empresas.length === 1) {
    const e = empresas[0];
    if (e.slug === slugDeploy.toLowerCase() || !e.url) return { tipo: 'directo-local' };
    return { tipo: 'directo-externo', url: e.url };
  }
  return { tipo: 'selector', empresas };
}
