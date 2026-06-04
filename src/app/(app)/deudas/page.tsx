import { getDeudas, getKPIsDeudas, getAcreedores, type CategoriaPasivo } from '@/lib/db/deudas';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { DeudasClient } from '@/components/deudas/deudas-client';

export const revalidate = 60;

const CATEGORIAS_VALIDAS: readonly CategoriaPasivo[] = [
  'externa', 'socios', 'empleados', 'ex_empleados', 'asesores_relacionados',
];

export default async function DeudasPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string }>;
}) {
  const { categoria } = await searchParams;
  const initialCategoria: CategoriaPasivo | '' =
    CATEGORIAS_VALIDAS.includes(categoria as CategoriaPasivo) ? (categoria as CategoriaPasivo) : '';

  const [deudas, kpis, acreedores, centros] = await Promise.all([
    getDeudas(),
    getKPIsDeudas(),
    getAcreedores(),
    getCentrosCostoActivos(),
  ]);
  const vigentes = deudas.filter(d => d.saldoPendiente > 0);
  const centrosUI = centros.map(c => ({ id: c.id, nombre: c.nombre }));
  return (
    <DeudasClient
      deudas={vigentes}
      kpis={kpis}
      acreedores={acreedores}
      centros={centrosUI}
      initialCategoria={initialCategoria}
    />
  );
}
