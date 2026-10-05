import { redirect } from 'next/navigation';
import { getSesion } from '@/lib/auth/guard';
import { slugsConAcceso } from '@/lib/auth/roles';
import { empresaConfig, inicialesEmpresa } from '@/lib/config/empresa';
import { seccionesMovil } from '@/lib/movil/secciones';
import { MovilShell } from '@/components/movil/movil-shell';

export const dynamic = 'force-dynamic';

/**
 * MÓVIL — shell de la PWA (/m). Mismo control de acceso que el layout de
 * escritorio: el rol se resuelve por empresa; cada página revalida su
 * sección y las server actions validan su propio permiso.
 */
export default async function MovilLayout({ children }: { children: React.ReactNode }) {
  const marca = empresaConfig();
  const { rol, meta } = await getSesion();
  if (!rol) {
    const empresas = slugsConAcceso(meta);
    redirect(empresas && empresas.some(x => x !== marca.slug) ? '/empresas' : '/no-acceso');
  }
  const secciones = seccionesMovil(rol);
  if (secciones.length === 0) redirect('/dashboard');

  return (
    <MovilShell
      rol={rol}
      secciones={secciones}
      empresa={marca.nombre}
      nombreApp={marca.nombreApp}
      iniciales={inicialesEmpresa(marca.nombre)}
      iconoUrl={marca.iconoUrl}
      colorMarca={marca.colorMarca}
    >
      {children}
    </MovilShell>
  );
}
