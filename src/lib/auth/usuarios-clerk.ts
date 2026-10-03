/**
 * F-GESTION-USUARIOS — Usuarios y accesos contra la API de Clerk.
 *
 * Clerk sigue siendo la AUTENTICACIÓN (login/contraseñas); acá solo se
 * leen y escriben los PERMISOS (`publicMetadata.accesos`). Server-only:
 * usa la secret key. Toda llamada desde la UI pasa antes por las server
 * actions de /admin/usuarios, que exigen rol admin y aplican las reglas
 * anti-escalada de roles.ts.
 */
import 'server-only';
import { clerkClient } from '@clerk/nextjs/server';
import { configLegacy } from './allowlist';
import { accesosDeMetadata, rolEnEmpresa, type Acceso } from './roles';
import { DEPLOYS } from '../config/deploys';

export interface UsuarioAccesos {
  id: string;                 // user id de Clerk, o 'inv_…' si es invitación pendiente
  tipo: 'usuario' | 'invitacion';
  email: string;
  nombre: string;
  bloqueado: boolean;
  ultimoIngreso: string | null;
  accesos: Acceso[];          // efectivos (explícitos o derivados del esquema legacy)
  legacy: boolean;            // true = aún sin publicMetadata.accesos (derivado del allowlist)
}

/** Accesos efectivos: los explícitos o, si no migró, los que le daría el esquema legacy por empresa. */
export function accesosEfectivos(meta: unknown, email: string): { accesos: Acceso[]; legacy: boolean } {
  const explicitos = accesosDeMetadata(meta);
  if (explicitos !== null) return { accesos: explicitos, legacy: false };
  const legacy = configLegacy();
  const accesos: Acceso[] = [];
  for (const d of DEPLOYS) {
    const rol = rolEnEmpresa({ meta, email, slugDeploy: d.slug, legacy });
    if (rol) accesos.push({ empresa_slug: d.slug, rol });
  }
  return { accesos, legacy: true };
}

export async function listarUsuarios(): Promise<UsuarioAccesos[]> {
  const c = await clerkClient();
  const out: UsuarioAccesos[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data } = await c.users.getUserList({ limit: 100, offset, orderBy: '-created_at' });
    for (const u of data) {
      const email = (u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? '').toLowerCase();
      const { accesos, legacy } = accesosEfectivos(u.publicMetadata, email);
      out.push({
        id: u.id,
        tipo: 'usuario',
        email,
        nombre: [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
        bloqueado: u.banned,
        ultimoIngreso: u.lastSignInAt ? new Date(u.lastSignInAt).toISOString() : null,
        accesos,
        legacy,
      });
    }
    if (data.length < 100) break;
  }
  const inv = await c.invitations.getInvitationList({ status: 'pending', limit: 100 });
  for (const i of inv.data) {
    const meta = i.publicMetadata as Record<string, unknown> | null;
    out.push({
      id: i.id,
      tipo: 'invitacion',
      email: i.emailAddress.toLowerCase(),
      nombre: String(meta?.nombre_invitado ?? ''),
      bloqueado: false,
      ultimoIngreso: null,
      accesos: accesosDeMetadata(meta) ?? [],
      legacy: false,
    });
  }
  return out;
}

export async function getUsuario(userId: string): Promise<UsuarioAccesos | null> {
  return (await listarUsuarios()).find(u => u.id === userId) ?? null;
}

/** Invita por email: al aceptar, el usuario nace con sus accesos ya puestos. */
export async function invitarUsuario(args: { email: string; nombre: string; accesos: Acceso[] }): Promise<void> {
  const c = await clerkClient();
  await c.invitations.createInvitation({
    emailAddress: args.email,
    publicMetadata: { accesos: args.accesos, nombre_invitado: args.nombre },
    notify: true,
  });
}

export async function revocarInvitacion(invitacionId: string): Promise<void> {
  const c = await clerkClient();
  await c.invitations.revokeInvitation(invitacionId);
}

/** Reemplaza `accesos` (merge de primer nivel: otras claves del metadata se conservan). */
export async function guardarAccesos(userId: string, accesos: Acceso[]): Promise<void> {
  const c = await clerkClient();
  await c.users.updateUserMetadata(userId, { publicMetadata: { accesos } });
}

export async function bloquearUsuario(userId: string, bloquear: boolean): Promise<void> {
  const c = await clerkClient();
  if (bloquear) await c.users.banUser(userId);
  else await c.users.unbanUser(userId);
}
