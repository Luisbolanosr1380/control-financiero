import { currentUser } from '@clerk/nextjs/server';
import { getArticulos } from '@/lib/db/ayuda';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { AyudaHubClient } from '@/components/ayuda/ayuda-hub-client';

export const revalidate = 60;

export default async function AyudaPage() {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);

  const articulos = await getArticulos({ soloActivos: true });
  return <AyudaHubClient articulos={articulos} esAdmin={rol === 'admin'} />;
}
