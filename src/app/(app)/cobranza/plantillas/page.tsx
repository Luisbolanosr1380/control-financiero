import { exigirPagina } from '@/lib/auth/guard';
import { getPlantillas, getReglas } from '@/lib/db/cobranza-recordatorios';
import { PlantillasClient } from '@/components/cobranza/plantillas-client';

export const dynamic = 'force-dynamic';

/**
 * CENTRO DE COBROS · PR 2 (035) · plantillas de los correos de cobranza (asunto y cuerpo con variables), el bloque «Datos
 * para pagar» y las reglas de cuándo se propone cada recordatorio (días, repetición, activa). Ver: ver_cobranza;
 * guardar: configurar_cobranza (admin y contador; la acción vuelve a validar).
 */
export default async function PlantillasCobranzaPage() {
  await exigirPagina('ver_cobranza');
  const [plantillas, { reglas, disponible }] = await Promise.all([getPlantillas(), getReglas()]);
  return <PlantillasClient plantillas={plantillas} reglas={reglas} disponible={disponible && !!plantillas} />;
}
