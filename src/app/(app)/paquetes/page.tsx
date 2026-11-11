import { Suspense } from 'react';
import { exigirPagina } from '@/lib/auth/guard';
import { listarPaquetes, paquetesDisponibles } from '@/lib/db/paquetes';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { PaquetesLista } from '@/components/paquetes/paquetes-lista';

export const dynamic = 'force-dynamic';

/**
 * PAQUETES PREPAGADOS (034) · lista global: todos los paquetes con cliente, líneas, % usado, remanente, valor del remanente
 * y vencimiento; filtros activos / por agotarse / agotados / vencidos en la URL (`f`). Ver: 'ver' (cobranza también).
 */
export default async function PaquetesPage() {
  await exigirPagina('ver');
  const disponible = await paquetesDisponibles();
  const paquetes = disponible ? await listarPaquetes() : [];
  return <Suspense fallback={null}><PaquetesLista paquetes={paquetes} hoy={obtenerFechaHoyGuatemala()} disponible={disponible} /></Suspense>;
}
