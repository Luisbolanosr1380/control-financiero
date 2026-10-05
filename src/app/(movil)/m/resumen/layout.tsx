import { redirect } from 'next/navigation';
import { getSesion } from '@/lib/auth/guard';
import { vistasResumen } from '@/lib/movil/secciones';
import { TabsResumen } from '@/components/movil/tabs-resumen';

export const dynamic = 'force-dynamic';

/** Resumen (consulta visual, read-only): admin, contador y lectura. El auxiliar sigue en captura. */
export default async function ResumenLayout({ children }: { children: React.ReactNode }) {
  const { rol } = await getSesion();
  const vistas = vistasResumen(rol);
  if (vistas.length === 0) redirect('/m');
  return (
    <>
      <TabsResumen vistas={vistas} />
      {children}
    </>
  );
}
