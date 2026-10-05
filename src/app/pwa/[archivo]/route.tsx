import { ImageResponse } from 'next/og';
import { empresaConfig, inicialesEmpresa } from '@/lib/config/empresa';

/**
 * Íconos de la PWA por empresa: /pwa/icon-192.png, /pwa/icon-512.png,
 * /pwa/maskable-512.png y /pwa/apple-180.png. Terminan en .png a propósito:
 * el matcher del middleware excluye esa extensión, así se sirven sin sesión.
 * Con EMPRESA_ICONO_URL (o EMPRESA_LOGO_URL) se usa esa imagen; si no, las
 * iniciales de la empresa sobre su color de marca.
 */
const ARCHIVOS: Record<string, { tam: number; maskable: boolean }> = {
  'icon-192.png': { tam: 192, maskable: false },
  'icon-512.png': { tam: 512, maskable: false },
  'maskable-512.png': { tam: 512, maskable: true },
  'apple-180.png': { tam: 180, maskable: true },
};

export async function GET(_req: Request, { params }: { params: Promise<{ archivo: string }> }) {
  const { archivo } = await params;
  const spec = ARCHIVOS[archivo];
  if (!spec) return new Response('No encontrado', { status: 404 });
  const e = empresaConfig();
  const { tam, maskable } = spec;
  // Maskable: el contenido dentro del 80% central (zona segura del recorte).
  const contenido = Math.round(tam * (maskable ? 0.56 : 0.7));
  const iniciales = inicialesEmpresa(e.nombre);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: e.iconoUrl ? '#FFFFFF' : e.colorMarca,
          borderRadius: maskable ? 0 : Math.round(tam * 0.22),
        }}
      >
        {e.iconoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.iconoUrl} width={contenido} height={contenido} style={{ objectFit: 'contain' }} alt="" />
        ) : (
          <div
            style={{
              display: 'flex', color: '#FBF7EC', fontWeight: 700, letterSpacing: '-0.02em',
              fontSize: Math.round(contenido * (iniciales.length > 2 ? 0.46 : 0.58)),
            }}
          >
            {iniciales}
          </div>
        )}
      </div>
    ),
    { width: tam, height: tam, headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
