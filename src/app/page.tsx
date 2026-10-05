import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { esTelefono } from '@/lib/movil/secciones';

export default async function RootPage() {
  // MÓVIL: en un teléfono la entrada es la app móvil (home según rol).
  const ua = (await headers()).get('user-agent');
  redirect(esTelefono(ua) ? '/m' : '/dashboard');
}
