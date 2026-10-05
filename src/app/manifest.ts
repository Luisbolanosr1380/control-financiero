import type { MetadataRoute } from 'next';
import { empresaConfig } from '@/lib/config/empresa';

// /manifest.webmanifest — el middleware no lo protege (extensión excluida del
// matcher), así el navegador lo lee antes del login.
export default function manifest(): MetadataRoute.Manifest {
  const e = empresaConfig();
  return {
    id: '/m',
    name: `${e.nombreApp} · ${e.nombreSistema}`,
    short_name: e.nombreApp,
    description: `${e.nombreSistema} de ${e.nombre}: Auros y captura de documentos desde el teléfono.`,
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F4EFE3',
    theme_color: e.colorMarca,
    lang: 'es',
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Auros', url: '/m/auros', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
      { name: 'Capturar documento', url: '/m/captura', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
