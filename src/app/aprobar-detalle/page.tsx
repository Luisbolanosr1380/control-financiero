import type { Metadata } from 'next';
import { AprobarDetalleClient } from '@/components/aprobar-detalle/aprobar-detalle-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Detalle de servicios · revisar y aprobar', robots: { index: false, follow: false, noarchive: true, nocache: true } };

/**
 * DETALLE DIGITAL (029) · página pública del cliente. Sin sesión, sin el shell de la app, sin Clerk ni recursos de
 * terceros (lo decide el layout raíz por el header del middleware). El token va en el fragmento (#…): el navegador
 * nunca lo manda al servidor en la URL, así que no queda en logs ni en referers; el cliente lo manda en el POST.
 * El GET nunca consume el link ni cambia el estado: solo esta página vacía.
 */
export default function AprobarDetallePage() {
  return <AprobarDetalleClient />;
}
