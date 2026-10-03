/**
 * Allowlist LEGACY (F-011 + F-030) — solo para usuarios SIN
 * `publicMetadata.accesos` (pre-migración F-GESTION-USUARIOS).
 *
 * La decisión de rol vive en roles.ts (rolEnEmpresa) y el servidor la
 * aplica con guard.ts. Acá queda únicamente la configuración vieja:
 * emails explícitos (conservan su rol mapeado) y ALLOWED_EMAILS /
 * ALLOWED_DOMAIN (entran como 'lectura' hasta que un admin les asigne
 * un rol desde Admin → Usuarios y accesos).
 */

import type { ConfigLegacy, RolLegacy } from './roles';

export type { Rol as Role } from './roles';

export const ROLES_USUARIOS: Record<string, RolLegacy> = {
  'luisbolanosr1380@gmail.com': 'admin',
  'luis@goldentalent.org': 'admin',
  'rcontreras@goldentalent.org': 'admin',
};

export function configLegacy(): ConfigLegacy {
  const emailsRaw = (process.env.ALLOWED_EMAILS ?? '').trim();
  return {
    rolesExplicitos: ROLES_USUARIOS,
    allowedEmails: emailsRaw ? emailsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [],
    allowedDomain: (process.env.ALLOWED_DOMAIN ?? '').trim(),
  };
}
