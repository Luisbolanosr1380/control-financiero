import { redirect } from 'next/navigation';
import { getSesion } from '@/lib/auth/guard';
import { getRoadmapItems } from '@/lib/db/roadmap';
import { RoadmapClient } from '@/components/admin/roadmap-client';

export const dynamic = 'force-dynamic';

export default async function RoadmapPage() {
  // Solo admin — el tablero personal de prioridades del dueño.
  const { rol: rolSesion } = await getSesion();
  if (rolSesion !== 'admin') {
    redirect('/no-acceso');
  }

  const items = await getRoadmapItems();
  return <RoadmapClient items={items} />;
}
