import { exigirPagina } from '@/lib/auth/guard';
import { getClientes } from '@/lib/db/clientes';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { NuevaFacturaClient } from '@/components/facturas/nueva-factura-client';

export const revalidate = 120;

export default async function NuevaFacturaPage() {
  // F-GESTION-USUARIOS: pantalla completa gateada por rol (las actions revalidan igual).
  await exigirPagina('emitir_factura');
  const [clientes, centros] = await Promise.all([
    getClientes(),
    getCentrosCostoActivos(),
  ]);

  return <NuevaFacturaClient clientes={clientes} centros={centros} />;
}
