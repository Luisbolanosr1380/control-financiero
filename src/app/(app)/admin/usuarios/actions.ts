'use server';

/**
 * F-GESTION-USUARIOS — gestión de usuarios y accesos (solo ADMIN).
 *
 * Reglas, todas validadas acá en el servidor:
 *  · gestionar_usuarios exige rol admin en la empresa de ESTE deploy.
 *  · Anti-escalada: un admin solo asigna/cambia/quita accesos de
 *    empresas donde él mismo es admin (aplicarCambioAccesos).
 *  · Sin auto-bloqueo: nadie se quita su propio admin de esta empresa
 *    ni se bloquea a sí mismo.
 *  · Ninguna empresa puede quedar sin admin (empresasSinAdmin).
 */

import { revalidatePath } from 'next/cache';
import { autorizar } from '@/lib/auth/guard';
import { aplicarCambioAccesos, empresasSinAdmin, esRol, type Acceso } from '@/lib/auth/roles';
import {
  accesosEfectivos, bloquearUsuario, guardarAccesos, invitarUsuario,
  listarUsuarios, revocarInvitacion,
} from '@/lib/auth/usuarios-clerk';
import { DEPLOYS } from '@/lib/config/deploys';
import { empresaConfig } from '@/lib/config/empresa';

type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUGS = new Set(DEPLOYS.map(d => d.slug));

function normalizarAccesos(raw: unknown): Acceso[] | string {
  if (!Array.isArray(raw)) return 'Accesos inválidos.';
  const out: Acceso[] = [];
  const vistos = new Set<string>();
  for (const a of raw) {
    const slug = String((a as Acceso)?.empresa_slug ?? '').trim().toLowerCase();
    const rol = (a as Acceso)?.rol;
    if (!SLUGS.has(slug)) return `Empresa desconocida: ${slug || '(vacía)'}`;
    if (!esRol(rol)) return `Rol inválido para ${slug}.`;
    if (vistos.has(slug)) return `Empresa repetida: ${slug}`;
    vistos.add(slug);
    out.push({ empresa_slug: slug, rol });
  }
  return out;
}

function errorMsg(err: unknown): string {
  const e = err as { errors?: Array<{ longMessage?: string; message?: string }> };
  return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? (err instanceof Error ? err.message : String(err));
}

async function contexto() {
  const permiso = await autorizar('gestionar_usuarios');
  if (!permiso.ok) return { ok: false as const, error: permiso.error };
  const usuarios = await listarUsuarios();
  const actor = accesosEfectivos(permiso.meta, permiso.email).accesos;
  return { ok: true as const, permiso, usuarios, actor };
}

export async function invitarUsuarioAction(input: { email: string; nombre: string; accesos: Acceso[] }): Promise<Resultado> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Email inválido.' };
  const accesos = normalizarAccesos(input.accesos);
  if (typeof accesos === 'string') return { ok: false, error: accesos };
  if (accesos.length === 0) return { ok: false, error: 'Asigná al menos una empresa con su rol.' };
  if (ctx.usuarios.some(u => u.email === email)) {
    return { ok: false, error: 'Ese email ya tiene usuario o invitación pendiente — editá sus accesos en la lista.' };
  }
  const cambio = aplicarCambioAccesos({ accesosActor: ctx.actor, accesosDestinoActuales: [], accesosDestinoNuevos: accesos });
  if (!cambio.ok) return cambio;
  try {
    await invitarUsuario({ email, nombre: String(input.nombre ?? '').trim(), accesos: cambio.accesos });
  } catch (err) {
    return { ok: false, error: `Clerk: ${errorMsg(err)}` };
  }
  revalidatePath('/admin/usuarios');
  return { ok: true, mensaje: `Invitación enviada a ${email}. Al aceptarla entra con los accesos asignados.` };
}

export async function actualizarAccesosAction(userId: string, nuevos: Acceso[]): Promise<Resultado> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const destino = ctx.usuarios.find(u => u.id === userId && u.tipo === 'usuario');
  if (!destino) return { ok: false, error: 'Usuario no encontrado.' };
  const accesos = normalizarAccesos(nuevos);
  if (typeof accesos === 'string') return { ok: false, error: accesos };

  const cambio = aplicarCambioAccesos({ accesosActor: ctx.actor, accesosDestinoActuales: destino.accesos, accesosDestinoNuevos: accesos });
  if (!cambio.ok) return cambio;

  const slug = empresaConfig().slug;
  if (userId === ctx.permiso.userId && cambio.accesos.find(a => a.empresa_slug === slug)?.rol !== 'admin') {
    return { ok: false, error: `No podés quitarte tu propio rol de admin en ${empresaConfig().nombre} (te quedarías afuera). Pedíselo a otro admin.` };
  }
  const huerfanas = empresasSinAdmin({
    usuarios: ctx.usuarios.filter(u => u.tipo === 'usuario').map(u => ({ id: u.id, activo: !u.bloqueado, accesos: u.accesos })),
    destinoId: userId,
    nuevosAccesos: cambio.accesos,
  });
  if (huerfanas.length) return { ok: false, error: `${huerfanas.join(', ')} se quedaría sin ningún admin. Asigná otro admin primero.` };

  try {
    await guardarAccesos(userId, cambio.accesos);
  } catch (err) {
    return { ok: false, error: `Clerk: ${errorMsg(err)}` };
  }
  revalidatePath('/admin/usuarios');
  return { ok: true, mensaje: `Accesos de ${destino.email} actualizados.` };
}

export async function bloquearUsuarioAction(userId: string, bloquear: boolean): Promise<Resultado> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const destino = ctx.usuarios.find(u => u.id === userId && u.tipo === 'usuario');
  if (!destino) return { ok: false, error: 'Usuario no encontrado.' };
  if (userId === ctx.permiso.userId) return { ok: false, error: 'No podés bloquearte a vos mismo.' };
  // Bloquear es global (todas las empresas): exige ser admin de TODAS las del usuario.
  const adminDe = new Set(ctx.actor.filter(a => a.rol === 'admin').map(a => a.empresa_slug));
  const fuera = destino.accesos.map(a => a.empresa_slug).filter(s => !adminDe.has(s));
  if (fuera.length) return { ok: false, error: `Bloquear afecta todas sus empresas y no sos admin de: ${fuera.join(', ')}. Quitale el acceso a tu empresa en su lugar.` };
  if (bloquear) {
    const huerfanas = empresasSinAdmin({
      usuarios: ctx.usuarios.filter(u => u.tipo === 'usuario').map(u => ({ id: u.id, activo: !u.bloqueado, accesos: u.accesos })),
      destinoId: userId,
      nuevosAccesos: null,
    });
    if (huerfanas.length) return { ok: false, error: `${huerfanas.join(', ')} se quedaría sin ningún admin.` };
  }
  try {
    await bloquearUsuario(userId, bloquear);
  } catch (err) {
    return { ok: false, error: `Clerk: ${errorMsg(err)}` };
  }
  revalidatePath('/admin/usuarios');
  return { ok: true, mensaje: bloquear ? `${destino.email} bloqueado: ya no puede iniciar sesión en ninguna empresa.` : `${destino.email} desbloqueado.` };
}

export async function revocarInvitacionAction(invitacionId: string): Promise<Resultado> {
  const ctx = await contexto();
  if (!ctx.ok) return ctx;
  const inv = ctx.usuarios.find(u => u.id === invitacionId && u.tipo === 'invitacion');
  if (!inv) return { ok: false, error: 'Invitación no encontrada.' };
  const cambio = aplicarCambioAccesos({ accesosActor: ctx.actor, accesosDestinoActuales: inv.accesos, accesosDestinoNuevos: [] });
  if (!cambio.ok) return cambio;
  try {
    await revocarInvitacion(invitacionId);
  } catch (err) {
    return { ok: false, error: `Clerk: ${errorMsg(err)}` };
  }
  revalidatePath('/admin/usuarios');
  return { ok: true, mensaje: `Invitación a ${inv.email} revocada.` };
}
