import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario, ROLES_USUARIOS, type Role } from '@/lib/auth/allowlist';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getResumenUsoMensual, getTotalesMes } from '@/lib/db/uso-auros';
import { AdminUsuariosClient } from '@/components/admin/usuarios-client';

export const dynamic = 'force-dynamic';

export default async function AdminUsuariosPage() {
  // Server guard: solo admin entra.
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);
  if (rol !== 'admin') {
    redirect('/no-acceso');
  }

  const [resumen, totales] = await Promise.all([
    getResumenUsoMensual(),
    getTotalesMes(),
  ]);

  // Lista de usuarios "conocidos" (los que tienen rol explícito en el código).
  // Para cada uno, derivar consumo si tuvo actividad en el mes.
  const conocidos = Object.entries(ROLES_USUARIOS).map(([emailKey, rolKey]) => {
    const r = resumen.find(u => u.email === emailKey.toLowerCase());
    return {
      email: emailKey,
      rol: rolKey as Role,
      consultas: r?.consultas ?? 0,
      analisisManual: r?.analisisManual ?? 0,
      costoTotalUsd: r?.costoTotalUsd ?? 0,
      ultimoUso: r?.ultimoUso ?? null,
      tokensInput: r?.tokensInput ?? 0,
      tokensOutput: r?.tokensOutput ?? 0,
      limite: PERMISSIONS[rolKey as Role].aurosLimiteMensual,
    };
  });

  // Usuarios con actividad pero no en el map explícito (fallback 'operativo' via env).
  const otros = resumen.filter(u => !ROLES_USUARIOS[u.email]).map(u => ({
    email: u.email,
    rol: u.rol ?? ('operativo' as Role),
    consultas: u.consultas,
    analisisManual: u.analisisManual,
    costoTotalUsd: u.costoTotalUsd,
    ultimoUso: u.ultimoUso,
    tokensInput: u.tokensInput,
    tokensOutput: u.tokensOutput,
    limite: PERMISSIONS[(u.rol ?? 'operativo') as Role].aurosLimiteMensual,
  }));

  const usuarios = [...conocidos, ...otros];

  return <AdminUsuariosClient usuarios={usuarios} totales={totales} miEmail={email} />;
}
