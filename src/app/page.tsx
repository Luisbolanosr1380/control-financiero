import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { esTelefono } from '@/lib/movil/secciones';
import { getSesion } from '@/lib/auth/guard';

export default async function RootPage() {
  // MÓVIL: en un teléfono la entrada es la app móvil (home según rol).
  // CENTRO DE COBROS (033): el rol cobranza entra a su bandeja (también en el teléfono: la bandeja y la ficha van a 390 px).
  const ua = (await headers()).get('user-agent');
  const { rol } = await getSesion();
  if (rol === 'cobranza') redirect('/cobranza');
  redirect(esTelefono(ua) ? '/m' : '/dashboard');
}
