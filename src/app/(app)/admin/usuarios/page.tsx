import { redirect } from 'next/navigation';
import { getSesion } from '@/lib/auth/guard';
import { puede, type Rol } from '@/lib/auth/roles';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { accesosEfectivos, listarUsuarios, type UsuarioAccesos } from '@/lib/auth/usuarios-clerk';
import { getResumenUsoMensual, getTotalesMes } from '@/lib/db/uso-auros';
import { DEPLOYS } from '@/lib/config/deploys';
import { AdminUsuariosClient } from '@/components/admin/usuarios-client';
import { AccesosClient } from '@/components/admin/accesos-client';

export const dynamic = 'force-dynamic';

export default async function AdminUsuariosPage() {
  // F-GESTION-USUARIOS: solo ADMIN de esta empresa (las actions revalidan).
  const { email, rol, userId, meta, slug } = await getSesion();
  if (!puede(rol, 'gestionar_usuarios')) {
    redirect('/no-acceso');
  }

  let usuarios: UsuarioAccesos[] = [];
  let errorClerk: string | null = null;
  try {
    usuarios = await listarUsuarios();
  } catch (err) {
    errorClerk = err instanceof Error ? err.message : String(err);
  }
  const [resumen, totales] = await Promise.all([getResumenUsoMensual(), getTotalesMes()]);

  // Uso de AI: el rol mostrado es el de ESTA empresa.
  const rolAqui = new Map<string, Rol>();
  for (const u of usuarios) {
    const r = u.accesos.find(a => a.empresa_slug === slug)?.rol;
    if (r) rolAqui.set(u.email, r);
  }
  const emails = new Set([...rolAqui.keys(), ...resumen.map(r => r.email)]);
  const usoAI = [...emails].map(e => {
    const r = resumen.find(x => x.email === e);
    const rolE = rolAqui.get(e) ?? null;
    return {
      email: e,
      rol: rolE,
      consultas: r?.consultas ?? 0,
      analisisManual: r?.analisisManual ?? 0,
      costoTotalUsd: r?.costoTotalUsd ?? 0,
      ultimoUso: r?.ultimoUso ?? null,
      tokensInput: r?.tokensInput ?? 0,
      tokensOutput: r?.tokensOutput ?? 0,
      limite: rolE ? PERMISSIONS[rolE].aurosLimiteMensual : 0,
    };
  });

  return (
    <>
      <AccesosClient
        usuarios={usuarios}
        empresas={[...DEPLOYS]}
        slugActual={slug}
        miUserId={userId ?? ''}
        misAccesos={accesosEfectivos(meta, email).accesos}
        errorClerk={errorClerk}
      />
      <AdminUsuariosClient usuarios={usoAI} totales={totales} miEmail={email} />
    </>
  );
}
