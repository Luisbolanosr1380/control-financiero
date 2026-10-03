/**
 * Registro de empresas del grupo con deploy propio (multi-deploy).
 *
 * Lo usan el selector /empresas (a dónde mandar al usuario) y la
 * pantalla de Usuarios y accesos (a qué empresas se puede dar acceso).
 * Sumar una empresa nueva = bootstrap de su base + deploy + una entrada
 * acá (el slug debe coincidir con EMPRESA_SLUG de su deploy).
 */

export interface DeployEmpresa {
  slug: string;
  nombre: string;
  url: string;
}

export const DEPLOYS: readonly DeployEmpresa[] = [
  { slug: 'golden', nombre: 'Golden Talent',      url: 'https://finanzas.golden-talent.com' },
  { slug: 'hit',    nombre: 'High Impact Talent', url: 'https://control-financiero-hit.vercel.app' },
];

export function deployDe(slug: string): DeployEmpresa {
  const s = slug.trim().toLowerCase();
  return DEPLOYS.find(d => d.slug === s) ?? { slug: s, nombre: s, url: '' };
}
