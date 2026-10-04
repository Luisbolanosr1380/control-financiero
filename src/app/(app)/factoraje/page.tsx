import { exigirPagina } from '@/lib/auth/guard';
import { factorajeDisponible, getFactorajes, type Factoraje } from '@/lib/db/factoraje';
import { getAcreedores } from '@/lib/db/deudas';
import { getCentrosCosto } from '@/lib/db/centros';
import { GENERAR_ASIENTO_FACTORAJE } from '@/lib/factoraje/asiento-config';
import { FactorajeClient } from '@/components/factoraje/factoraje-client';

export const dynamic = 'force-dynamic';

/**
 * FACTORAJE — facturas cedidas a financiadores. Ver: todos los roles; las
 * acciones validan su propio permiso en el servidor (actions.ts).
 */
export default async function FactorajePage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await exigirPagina('ver');
  const { f } = await searchParams;
  const disponible = await factorajeDisponible();
  let factorajes: Factoraje[] = [];
  if (disponible) {
    try { factorajes = await getFactorajes(); } catch { factorajes = []; }
  }
  const [acreedores, centros] = await Promise.all([
    getAcreedores().catch(() => []),
    getCentrosCosto().catch(() => []),
  ]);
  return (
    <FactorajeClient
      disponible={disponible}
      factorajes={factorajes}
      seleccionadoId={f ?? null}
      acreedores={acreedores}
      centros={centros.map(c => ({ id: c.id, nombre: c.nombre }))}
      asientoHabilitado={GENERAR_ASIENTO_FACTORAJE}
    />
  );
}
