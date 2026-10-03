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
import { getSesion } from '@/lib/auth/guard';
import { IntercompanyPreviewClient } from '@/components/intercompany/preview-client';

export const dynamic = 'force-dynamic';

export default async function AdminIntercompanyPage() {
  const { email, rol } = await getSesion();
  if (rol !== 'admin') {
    redirect('/no-acceso');
  }

  return <IntercompanyPreviewClient />;
}
