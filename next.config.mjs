/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '8mb',
    },
  },
  // PWA: el service worker se revalida siempre (si no, una versión vieja
  // puede quedar pegada en el teléfono).
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      // DETALLE DIGITAL (029): página pública del cliente y su endpoint: sin caché, sin referer, sin indexar, sin CORS.
      { source: '/aprobar-detalle(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] },
      { source: '/api/aprobar-detalle(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex' }, { key: 'X-Content-Type-Options', value: 'nosniff' }] },
    ];
  },
};

export default nextConfig;
