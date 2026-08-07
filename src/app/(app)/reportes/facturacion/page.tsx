/**
 * F-REPORTE-FACTURACION — Reporte de facturación emitida (análisis de ventas).
 *
 * Server component: trae el dataset COMPLETO de facturas consolidadas
 * (~1100 líneas, volumen chico) + catálogos, y delega al client. Todos
 * los filtros (período, cliente, línea, estado) y agrupaciones corren
 * en memoria del client — cambio de filtro instantáneo y el comparativo
 * vs período anterior no necesita re-fetch.
 *
 * OJO: esto es facturación EMITIDA (ventas), no cobranza. La vista de
 * pendientes de cobro vive en /facturacion/pendientes.
 */

import { getFacturasReporte } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getCentrosCosto } from '@/lib/db/centros';
import { FacturacionReporteClient } from '@/components/reportes/facturacion-reporte-client';

export const revalidate = 60;

export default async function ReporteFacturacionPage() {
  const [facturas, clientes, centros] = await Promise.all([
    getFacturasReporte(),
    getClientes(),
    getCentrosCosto(),
  ]);

  return (
    <FacturacionReporteClient
      facturas={facturas}
      clientes={clientes.map(c => ({ id: c.id, name: c.name }))}
      centros={centros.map(c => ({ id: c.id, nombre: c.nombre, activo: c.activo }))}
    />
  );
}
