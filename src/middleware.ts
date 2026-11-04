import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/no-acceso',
  '/api/cron(.*)',
  '/api/webhook(.*)',   // FACTURACIÓN AGENDA: avisos firmados por HMAC (la firma es la auth)
]);
// DETALLE DIGITAL (029): la página pública del cliente y su endpoint NO pasan por Clerk (ni handshake ni cookies):
// el link lleva su propio token (en el fragmento #) y la RPC valida todo. El layout raíz lee el header para no cargar
// ClerkProvider ni el service worker en esa página (nada de terceros).
const isRutaPublicaCliente = createRouteMatcher(['/aprobar-detalle(.*)', '/api/aprobar-detalle(.*)']);

const conClerk = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  if (isRutaPublicaCliente(req)) {
    const h = new Headers(req.headers); h.set('x-ruta-publica', '1');
    return NextResponse.next({ request: { headers: h } });
  }
  return conClerk(req, ev);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
