import { exigirPagina } from '@/lib/auth/guard';
import { antiguedadesTarifario, getTarifario, historialDisponible, tarifarioDisponible, umbralEstancada } from '@/lib/db/tarifario';
import { resumenPorEmpresa } from '@/lib/tarifario/resumen';
import { getClientes } from '@/lib/db/clientes';
import { TarifarioClient } from '@/components/tarifario/tarifario-client';

export const dynamic = 'force-dynamic';

/**
 * Tarifario MAESTRO: una fila por empresa (NIT) con semáforo y tarifas estancadas; "Ver todas" recupera el listado
 * plano. Las filas se titulan con el nombre de empresa del cliente activo de ese NIT y se buscan por cualquiera de sus nombres. Ver: 'ver'; editar: 'catalogos'. La antigüedad del precio sale de la bitácora (015) o del año de la tarifa.
 */
export default async function TarifarioPage() {
  await exigirPagina('ver');
  const disponible = await tarifarioDisponible();
  const tarifas = disponible ? await getTarifario() : [];
  const [antiguedad, conHistorial, clientes] = disponible ? await Promise.all([antiguedadesTarifario(tarifas), historialDisponible(), getClientes()]) : [{}, false, []];
  // La lista se titula y se busca por el nombre de empresa del cliente (y su nombre comercial / aliases, 020), no solo por la razón social de la tarifa.
  const clientesTarifario = clientes.map(c => ({ nit: c.nit, name: c.name, razonSocial: c.razonSocial, nombreComercial: c.nombreComercial, aliases: c.aliases, activo: c.activo }));
  return (
    <TarifarioClient
      disponible={disponible}
      historialDisponible={conHistorial}
      tarifas={tarifas}
      empresas={resumenPorEmpresa(tarifas, antiguedad, clientesTarifario)}
      antiguedad={antiguedad}
      umbralMeses={umbralEstancada()}
    />
  );
}
