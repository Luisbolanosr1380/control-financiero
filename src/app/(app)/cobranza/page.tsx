import { exigirPagina } from '@/lib/auth/guard';
import { getDatosBandeja } from '@/lib/db/cobranza';
import { BandejaClient } from '@/components/cobranza/bandeja-client';

export const dynamic = 'force-dynamic';

/** CENTRO DE COBROS (033) · «Hoy»: la bandeja de trabajo. ver_cobranza = admin, contador y cobranza. */
export default async function CobranzaPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const { email, rol } = await exigirPagina('ver_cobranza');
  const { todos } = await searchParams;
  const datos = await getDatosBandeja({ email, rol, soloMios: todos === '1' ? false : rol === 'cobranza' ? true : undefined });
  return <BandejaClient datos={datos} email={email} />;
}
