import { redirect } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { getSesion } from '@/lib/auth/guard';
import { tiposCaptura } from '@/lib/movil/secciones';
import { getClientes } from '@/lib/db/clientes';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { getBancosActivos } from '@/lib/db/bancos';
import { getFacturasPendientesCobro } from '@/lib/db/facturas-pendientes';
import { TZ_GUATEMALA } from '@/lib/utils/fechas';
import { CapturaMovil } from '@/components/movil/captura-movil';

export const dynamic = 'force-dynamic';

/**
 * Captura rápida con la cámara. Cada tipo usa la server action de alta que
 * ya existe (con su permiso en la primera línea):
 *  · gasto   → procesarFacturasAction (bandeja de gastos, queda Pendiente de revisión)
 *  · factura → crearFacturaAction (la foto queda como adjunto)
 *  · cobro   → registrarCobroAction (la foto queda como constancia)
 * Solo se cargan las opciones de los tipos que el rol puede registrar.
 */
export default async function CapturaPage() {
  const { rol } = await getSesion();
  const tipos = tiposCaptura(rol);
  if (tipos.length === 0) redirect('/m');

  const [clientes, centros, bancos, pendientes] = await Promise.all([
    tipos.includes('factura') ? getClientes().catch(() => []) : Promise.resolve([]),
    tipos.includes('factura') ? getCentrosCostoActivos().catch(() => []) : Promise.resolve([]),
    tipos.includes('cobro') ? getBancosActivos().catch(() => []) : Promise.resolve([]),
    tipos.includes('cobro') ? getFacturasPendientesCobro().then(r => r.filas).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <CapturaMovil
      tipos={tipos}
      hoy={formatInTimeZone(new Date(), TZ_GUATEMALA, 'yyyy-MM-dd')}
      clientes={clientes.map(c => ({ id: c.id, nombre: c.name })).sort((a, b) => a.nombre.localeCompare(b.nombre))}
      centros={centros.map(c => ({ id: c.id, nombre: c.nombre }))}
      bancos={bancos.map(b => ({ id: b.id, nombre: [b.banco, b.nombreCuenta].filter(Boolean).join(' · ') || b.id }))}
      // Las cedidas a factoraje las cobra el financiador: no se ofrecen para cobro propio.
      facturas={pendientes.filter(f => !f.cedida && f.saldo > 0.01).map(f => ({ noFactura: f.noFactura, cliente: f.cliente, saldo: f.saldo, fecha: f.fechaEmision }))}
    />
  );
}
