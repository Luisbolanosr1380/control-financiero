import { Suspense } from 'react';
import { getDatosIdentificar } from '@/lib/db/identificar-pago';
import { IdentificarClient } from '@/components/cobros/identificar-client';

export const revalidate = 30;

/**
 * IDENTIFICAR PAGO: facturas abiertas con total, saldo (#51) e IVA + perfil de retención de cada cliente (derivado de sus
 * cobros con retención). Solo lectura; la comparación corre en el navegador y el estado (monto, tolerancia, «Buscar
 * sobre») viaja en la URL.
 */
export default async function IdentificarPage() {
  const datos = await getDatosIdentificar();
  return (
    <Suspense fallback={null}>
      <IdentificarClient facturas={datos.facturas} perfiles={datos.perfiles} cobrosConRetencion={datos.cobrosConRetencion} error={datos.error} />
    </Suspense>
  );
}
