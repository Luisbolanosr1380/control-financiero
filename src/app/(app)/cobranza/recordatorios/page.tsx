import { exigirPagina, getSesion } from '@/lib/auth/guard';
import { getDatosRecordatorios } from '@/lib/db/cobranza-recordatorios';
import { RecordatoriosClient } from '@/components/cobranza/recordatorios-client';

export const dynamic = 'force-dynamic';

/**
 * CENTRO DE COBROS · PR 2 (035) · recordatorios PROPUESTOS: borradores armados hoy según las reglas (por vencer, vencida,
 * promesa incumplida, confirmación de promesa). La persona revisa, corrige y presiona «Enviar» (uno o seleccionados):
 * nada sale sin esa acción. ver_cobranza = admin, contador y cobranza; enviar = gestionar_cobranza.
 */
export default async function RecordatoriosPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const { email, rol } = await exigirPagina('ver_cobranza');
  const [{ todos }, sesion] = await Promise.all([searchParams, getSesion()]);
  const datos = await getDatosRecordatorios({ email, nombre: sesion.nombre, rol, soloMios: todos === '1' ? false : rol === 'cobranza' ? true : undefined });
  return <RecordatoriosClient datos={datos} email={email} />;
}
