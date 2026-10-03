import { exigirPagina } from '@/lib/auth/guard';
import { getBancosConciliacion, getCuentasAjuste, getDatosConciliacion } from '@/lib/db/conciliacion';
import { rangoDePreset } from '@/components/common/periodo-selector';
import { ConciliacionClient } from '@/components/conciliacion/conciliacion-client';

export const dynamic = 'force-dynamic';

/**
 * CONCILIACIÓN BANCARIA — por banco y período. Ver: todos los roles;
 * las acciones validan su propio permiso en el servidor.
 */
export default async function ConciliacionPage({
  searchParams,
}: {
  searchParams: Promise<{ banco?: string; desde?: string; hasta?: string }>;
}) {
  await exigirPagina('ver');
  const sp = await searchParams;
  const def = rangoDePreset('este_mes');
  const fechaOk = (f?: string) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null);
  const desde = fechaOk(sp.desde) ?? def.desde;
  const hasta = fechaOk(sp.hasta) ?? def.hasta;

  const [datos, bancos, cuentas] = await Promise.all([
    getDatosConciliacion(sp.banco ?? null, desde, hasta),
    getBancosConciliacion().catch(() => []),
    getCuentasAjuste().catch(() => []),
  ]);

  return <ConciliacionClient datos={datos} bancos={bancos} cuentas={cuentas} desde={desde} hasta={hasta} />;
}
