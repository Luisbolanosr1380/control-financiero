import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { getFichaCobranza } from '@/lib/db/cobranza';
import { FichaCobranzaClient } from '@/components/cobranza/ficha-client';

export const dynamic = 'force-dynamic';

/** CENTRO DE COBROS (033) · ficha de cobranza del cliente (id de app del cliente, el mismo de /clientes/[id]). */
export default async function FichaCobranzaPage({ params }: { params: Promise<{ id: string }> }) {
  const { email } = await exigirPagina('ver_cobranza');
  const { id } = await params;
  const ficha = await getFichaCobranza(decodeURIComponent(id));
  if (!ficha) notFound();
  return <FichaCobranzaClient ficha={ficha} email={email} />;
}
