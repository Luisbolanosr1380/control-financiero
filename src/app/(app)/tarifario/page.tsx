import { exigirPagina } from '@/lib/auth/guard';
import { antiguedadesTarifario, getTarifario, historialDisponible, tarifarioDisponible, umbralEstancada } from '@/lib/db/tarifario';
import { resumenPorEmpresa } from '@/lib/tarifario/resumen';
import { TarifarioClient } from '@/components/tarifario/tarifario-client';

export const dynamic = 'force-dynamic';

/**
 * Tarifario MAESTRO: una fila por empresa (NIT) con semáforo y tarifas estancadas; "Ver todas" recupera el listado
 * plano. Ver: 'ver'; editar: 'catalogos'. La antigüedad del precio sale de la bitácora (015) o del año de la tarifa.
 */
export default async function TarifarioPage() {
  await exigirPagina('ver');
  const disponible = await tarifarioDisponible();
  const tarifas = disponible ? await getTarifario() : [];
  const [antiguedad, conHistorial] = disponible ? await Promise.all([antiguedadesTarifario(tarifas), historialDisponible()]) : [{}, false];
  return (
    <TarifarioClient
      disponible={disponible}
      historialDisponible={conHistorial}
      tarifas={tarifas}
      empresas={resumenPorEmpresa(tarifas, antiguedad)}
      antiguedad={antiguedad}
      umbralMeses={umbralEstancada()}
    />
  );
}
