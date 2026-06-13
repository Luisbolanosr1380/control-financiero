/**
 * F-056.1 — Vista de preview del asiento de recuperación intercompany.
 *
 * Solo admin. Sirve para que Stark / el contador prueben distintos
 * montos y márgenes ANTES de prender el flag GENERAR_ASIENTO_INTERCOMPANY.
 *
 * No escribe a libros — el componente Preview muestra exactamente lo que
 * se generaría con el margen configurado. Cuando el contador valide,
 * solo hay que poner el flag en true en intercompany-config.ts.
 */

import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { IntercompanyPreviewClient } from '@/components/intercompany/preview-client';

export const dynamic = 'force-dynamic';

export default async function AdminIntercompanyPage() {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);
  if (rol !== 'admin') {
    redirect('/no-acceso');
  }

  return <IntercompanyPreviewClient />;
}
