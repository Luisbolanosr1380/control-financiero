import { getArticulos } from '@/lib/db/ayuda';
import { getSesion } from '@/lib/auth/guard';
import { AyudaHubClient } from '@/components/ayuda/ayuda-hub-client';

export const revalidate = 60;

export default async function AyudaPage() {
  const { email, rol } = await getSesion();

  const articulos = await getArticulos({ soloActivos: true });
  return <AyudaHubClient articulos={articulos} esAdmin={rol === 'admin'} />;
}
