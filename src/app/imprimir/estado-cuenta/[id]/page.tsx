import { notFound } from 'next/navigation';
import { exigirPagina, getSesion } from '@/lib/auth/guard';
import { empresaConfig } from '@/lib/config/empresa';
import { getEstadoCuenta } from '@/lib/db/cobranza-recordatorios';
import { EstadoCuentaImprimible } from '@/components/cobranza/estado-cuenta-imprimible';

export const dynamic = 'force-dynamic';

/**
 * CENTRO DE COBROS · PR 2 (035) · «Estado de cuenta» del cliente para imprimir / guardar como PDF y mandárselo: fuera del
 * shell, con el logo y el formato del detalle. Saldo REAL por factura (total − cobros − NC), antigüedad, totales, paquetes
 * prepagados con su remanente y los datos para pagar. Con sesión (ver_cobranza).
 */
export default async function ImprimirEstadoCuentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { email } = await exigirPagina('ver_cobranza');
  const [{ id }, sesion] = await Promise.all([params, getSesion()]);
  const datos = await getEstadoCuenta(decodeURIComponent(id), { email, nombre: sesion.nombre });
  if (!datos) notFound();
  const emp = empresaConfig();
  return <EstadoCuentaImprimible ec={datos.ec} emisor={{ nombre: emp.nombreLegal || emp.nombre, nit: emp.nit, direccion: emp.direccion, logoUrl: emp.logoUrl }} volverA={`/cobranza/${encodeURIComponent(datos.ec.cliente.clienteId)}`} />;
}
