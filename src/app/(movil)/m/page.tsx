import { redirect } from 'next/navigation';
import { getSesion } from '@/lib/auth/guard';
import { homeMovil } from '@/lib/movil/secciones';

export const dynamic = 'force-dynamic';

/** Home móvil según el rol (mapa en lib/movil/secciones.ts). */
export default async function MovilHome() {
  const { rol } = await getSesion();
  const home = homeMovil(rol);
  redirect(home ? `/m/${home}` : '/dashboard');
}
