import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { empresaConfig } from '@/lib/config/empresa';
import { getFichaCobranza } from '@/lib/db/cobranza';
import { HistorialImprimible } from '@/components/cobranza/historial-imprimible';

export const dynamic = 'force-dynamic';

/** CENTRO DE COBROS (033) · historial de cobranza de un cliente para imprimir / PDF (gerencia, reclamos). Con sesión (ver_cobranza). */
export default async function ImprimirCobranzaPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPagina('ver_cobranza');
  const { id } = await params;
  const ficha = await getFichaCobranza(decodeURIComponent(id));
  if (!ficha) notFound();
  const emp = empresaConfig();
  return <HistorialImprimible ficha={ficha} emisor={{ nombre: emp.nombreLegal || emp.nombre, logoUrl: emp.logoUrl }} />;
}
