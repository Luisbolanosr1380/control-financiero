/**
 * F-GESTION-USUARIOS — Enforcement en el SERVIDOR.
 *
 * Las server actions NO pasan por el layout (su guard de acceso no las
 * cubre) y el middleware solo exige sesión de Clerk — que es COMPARTIDO
 * entre deploys. Por eso CADA mutación llama a autorizar(acción), que
 * verifica las tres cosas: sesión + acceso a la empresa de ESTE deploy +
 * rol permitido para la acción. La UI oculta botones por UX; esto es la
 * seguridad real.
 */
import 'server-only';
import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { configLegacy } from './allowlist';
import { decidirAcceso, rolEnEmpresa, type Accion, type Rol } from './roles';
import { empresaConfig } from '../config/empresa';

export interface Sesion {
  userId: string | null;
  email: string;
  nombre: string;
  rol: Rol | null;          // rol en la empresa de este deploy (null = sin acceso)
  meta: unknown;            // publicMetadata crudo
  slug: string;             // EMPRESA_SLUG del deploy
  baneado: boolean;
}

export async function getSesion(): Promise<Sesion> {
  const slug = empresaConfig().slug;
  const user = await currentUser();
  if (!user) return { userId: null, email: '', nombre: '', rol: null, meta: null, slug, baneado: false };
  const email = (user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? '').toLowerCase();
  const nombre = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || email;
  const rol = user.banned ? null : rolEnEmpresa({ meta: user.publicMetadata, email, slugDeploy: slug, legacy: configLegacy() });
  return { userId: user.id, email, nombre, rol, meta: user.publicMetadata, slug, baneado: user.banned };
}

export type Autorizacion =
  | { ok: true; email: string; rol: Rol; userId: string; nombre: string; meta: unknown }
  | { ok: false; error: string };

export async function autorizar(accion: Accion): Promise<Autorizacion> {
  const cfg = empresaConfig();
  const s = await getSesion();
  const d = decidirAcceso({
    usuario: s.userId ? { id: s.userId, banned: s.baneado, email: s.email, meta: s.meta } : null,
    accion,
    slugDeploy: cfg.slug,
    nombreEmpresa: cfg.nombre,
    legacy: configLegacy(),
  });
  if (!d.ok) return d;
  return { ok: true, email: s.email, rol: d.rol, userId: s.userId!, nombre: s.nombre, meta: s.meta };
}

export class PermisoDenegadoError extends Error {}

/** Para acciones de lectura que devuelven datos (no un {ok,error}): lanza si no autoriza. */
export async function exigir(accion: Accion): Promise<{ email: string; rol: Rol }> {
  const a = await autorizar(accion);
  if (!a.ok) throw new PermisoDenegadoError(a.error);
  return { email: a.email, rol: a.rol };
}

/** Para páginas (server components): sin permiso → /no-acceso. */
export async function exigirPagina(accion: Accion): Promise<{ email: string; rol: Rol }> {
  const a = await autorizar(accion);
  if (!a.ok) redirect('/no-acceso');
  return { email: a.email, rol: a.rol };
}
