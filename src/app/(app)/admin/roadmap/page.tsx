import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { getRoadmapItems } from '@/lib/db/roadmap';
import { RoadmapClient } from '@/components/admin/roadmap-client';

export const dynamic = 'force-dynamic';

export default async function RoadmapPage() {
  // Solo admin — el tablero personal de prioridades del dueño.
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  if (getRolUsuario(email) !== 'admin') {
    redirect('/no-acceso');
  }

  const items = await getRoadmapItems();
  return <RoadmapClient items={items} />;
}
