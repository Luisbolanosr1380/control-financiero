import { getRetencionesAgregadas } from '@/lib/db/retenciones';
import { RetencionesClient } from '@/components/retenciones/retenciones-client';

export const revalidate = 60;

export default async function RetencionesPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string }>;
}) {
  const { anio: anioParam } = await searchParams;
  const anio = Number(anioParam) || new Date().getFullYear();
  const data = await getRetencionesAgregadas(anio);
  return <RetencionesClient data={data} />;
}
