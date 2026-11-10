import { NextResponse, type NextRequest } from 'next/server';
import { validarEnvioCliente, mensajePublico } from '@/lib/detalle-link/publico';
import { tokenValido } from '@/lib/detalle-link/token';
import { abrirLinkPublico, avisarRespuesta, dentroDelLimite, responderLinkPublico } from '@/lib/db/detalle-link';

export const dynamic = 'force-dynamic';

/**
 * DETALLE DIGITAL (029) · único endpoint público del cliente. SOLO POST, JSON, con tope de tamaño, Origin propio,
 * sin CORS. Dos acciones: `abrir` (lee: nunca consume el link ni cambia el estado) y `responder` (un solo uso).
 * El token viaja en el cuerpo (nunca en la URL ni en los logs); todo se revalida en la base. Errores genéricos.
 */
const TOPE_CUERPO = 300 * 1024;
const JSON_NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: JSON_NO_STORE });
const ipDe = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'desconocida';

function origenPropio(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const propio = new URL(req.url).origin;
  const permitidos = new Set([propio, ...String(process.env.APP_URL ?? '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)]);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) permitidos.add(`https://${host}`); if (host?.startsWith('localhost') || host?.startsWith('127.')) permitidos.add(`http://${host}`);
  return permitidos.has(origin);
}

export async function POST(req: NextRequest) {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return responder({ error: 'Este link ya no es válido.' }, 415);
  if (!origenPropio(req)) return responder({ error: 'Este link ya no es válido.' }, 403);
  const largo = Number(req.headers.get('content-length') ?? 0);
  if (largo > TOPE_CUERPO) return responder({ error: 'La respuesta es demasiado grande.' }, 413);
  const texto = await req.text();
  if (texto.length > TOPE_CUERPO) return responder({ error: 'La respuesta es demasiado grande.' }, 413);
  let cuerpo: Record<string, unknown>;
  try { cuerpo = JSON.parse(texto); if (!cuerpo || typeof cuerpo !== 'object') throw new Error(); } catch { return responder({ error: 'Este link ya no es válido.' }, 400); }
  const ip = ipDe(req);
  const accion = String(cuerpo.accion ?? '');
  const token = typeof cuerpo.token === 'string' ? cuerpo.token.trim() : '';
  if (!tokenValido(token)) return responder({ estado: 'invalido', error: 'Este link ya no es válido.' }, 200);
  // honeypot: un bot que llena el campo oculto recibe 200 y no pasa nada
  if (typeof cuerpo.empresa_web === 'string' && cuerpo.empresa_web.trim()) return responder({ ok: true });
  const tokenClave = token.slice(0, 12);

  if (accion === 'abrir') {
    if (!(await dentroDelLimite(`abrir:ip:${ip}`, 30, 60))) return responder({ error: 'Demasiados intentos. Probá de nuevo en un minuto.' }, 429);
    // 031: la apertura se registra con el hash de la red y el dispositivo / navegador (derivados acá, en el servidor)
    const a = await abrirLinkPublico(token, { ip, userAgent: (req.headers.get('user-agent') ?? '').slice(0, 600) });
    if (a.estado === 'invalido' || a.estado === 'nueva_version') return responder({ estado: a.estado, error: a.estado === 'nueva_version' ? mensajePublico('LINK_NUEVA_VERSION') : mensajePublico('LINK_INVALIDO') });
    return responder({ estado: a.estado, detalle: a.detalle });
  }
  if (accion === 'responder') {
    if (!(await dentroDelLimite(`responder:ip:${ip}`, 10, 60)) || !(await dentroDelLimite(`responder:token:${tokenClave}`, 5, 60))) return responder({ error: 'Demasiados intentos. Probá de nuevo en un minuto.' }, 429);
    const v = validarEnvioCliente(cuerpo);
    if (!v.ok) return responder({ error: v.error }, 400);
    const r = await responderLinkPublico(v.envio, { ip, userAgent: (req.headers.get('user-agent') ?? '').slice(0, 600) });
    if (!r.ok) return responder({ error: r.error }, 409);
    // aviso de vuelta a Finanzas (fail-soft, no bloquea la respuesta al cliente)
    const base = String(process.env.APP_URL ?? '').trim().replace(/\/$/, '') || new URL(req.url).origin;
    if (r.detalleId) await avisarRespuesta(r.detalleId, r, base);
    return responder({ ok: true, estado: r.estado, observaciones: r.observaciones });
  }
  return responder({ error: 'Este link ya no es válido.' }, 400);
}

export function GET() { return responder({ error: 'Método no permitido.' }, 405); }
export function OPTIONS() { return new NextResponse(null, { status: 405, headers: JSON_NO_STORE }); }
