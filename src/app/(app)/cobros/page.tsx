import { getCobrosPagina, getCobrosCompletos } from '@/lib/db/cobros';
import { getClientes } from '@/lib/db/clientes';
import { CobrosListClient } from '@/components/cobros/cobros-list-client';

export const revalidate = 30;

export default async function CobrosPage() {
  // F-033: traemos los cobros completos (no solo el count) en paralelo con la
  // paginación. Eso habilita el header agregado bajo filtros sin round-trips.
  const [pagina, cobrosCompletos, clientes] = await Promise.all([
    getCobrosPagina({ limit: 50 }),
    getCobrosCompletos(),
    getClientes(),
  ]);
  return (
    <CobrosListClient
      initialCobros={pagina.cobros}
      initialHayMas={pagina.hayMas}
      initialUltimaFecha={pagina.ultimaFecha}
      cobrosCompletos={cobrosCompletos}
      clientes={clientes}
    />
  );
}
