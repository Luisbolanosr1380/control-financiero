/**
 * Allowlist + roles del sistema (F-011 base + F-030 roles).
 *
 * Decide si un email autenticado puede entrar al sistema y qué rol tiene.
 * Lee ALLOWED_EMAILS (compat F-011) y ALLOWED_DOMAIN, además del map de
 * roles hardcoded abajo (F-030).
 *
 * Fail-closed: si nada matchea, retorna null/false. Para agregar usuarios
 * o cambiar roles, editar ROLES_USUARIOS y desplegar.
 */

export type Role = 'admin' | 'gerencia' | 'operativo';

/**
 * Map email → rol. Stark mantiene este registro a mano y despliega.
 * Para usuarios que cumplen ALLOWED_DOMAIN pero no están en el map, el
 * fallback es 'operativo' (el más restrictivo).
 */
export const ROLES_USUARIOS: Record<string, Role> = {
  'luisbolanosr1380@gmail.com': 'admin',
  'luis@goldentalent.org': 'admin',
  // 'monica@goldentalent.org': 'gerencia',
  // 'operativo1@goldentalent.org': 'operativo',
};


/** Devuelve el rol del usuario, o null si no está autorizado. */
export function getRolUsuario(email: string | null | undefined): Role | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();

  // 1) Match explícito por email
  if (ROLES_USUARIOS[e]) return ROLES_USUARIOS[e];

  // 2) Allowed por env: ALLOWED_EMAILS (compat F-011, default 'operativo')
  const emailsRaw = (process.env.ALLOWED_EMAILS ?? '').trim();
  const emails = emailsRaw
    ? emailsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];
  if (emails.includes(e)) return 'operativo';

  // 3) Dominio permitido (default 'operativo')
  const domainRaw = (process.env.ALLOWED_DOMAIN ?? '').trim();
  if (domainRaw) {
    const domain = domainRaw.startsWith('@') ? domainRaw.toLowerCase() : '@' + domainRaw.toLowerCase();
    if (e.endsWith(domain)) return 'operativo';
  }

  return null;
}

/** Compatibilidad F-011: el guard del (app)/layout sigue usando esto. */
export function isEmailAllowed(email: string | null | undefined): boolean {
  return getRolUsuario(email) !== null;
}
