import { exigirPagina } from '@/lib/auth/guard';
import { getDatosBandeja } from '@/lib/db/cobranza';
import { getDatosRecordatorios } from '@/lib/db/cobranza-recordatorios';
import { BandejaClient } from '@/components/cobranza/bandeja-client';

export const dynamic = 'force-dynamic';

/** CENTRO DE COBROS (033) · «Hoy»: la bandeja de trabajo. ver_cobranza = admin, contador y cobranza. */
export default async function CobranzaPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const { email, rol } = await exigirPagina('ver_cobranza');
  const { todos } = await searchParams;
  const soloMios = todos === '1' ? false : rol === 'cobranza' ? true : undefined;
  // 035: la bandeja también arma los recordatorios propuestos de hoy (en paralelo) y los muestra como atajo
  const [datos, rec] = await Promise.all([getDatosBandeja({ email, rol, soloMios }), getDatosRecordatorios({ email, rol, soloMios })]);
  return <BandejaClient datos={datos} email={email} recordatorios={rec.disponible ? rec.resumen : null} />;
}
