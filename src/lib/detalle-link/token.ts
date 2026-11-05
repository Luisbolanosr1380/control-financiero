/**
 * DETALLE DIGITAL (029) · token del link y referencias opacas — SOLO SERVIDOR.
 *
 * Token: 32 bytes aleatorios en base64url (43 caracteres). En la base se guarda SOLO su sha256; el token en claro
 * existe una vez, en el link del correo (y nunca en logs). Referencia de línea: HMAC-SHA256(DETALLE_LINK_SECRET,
 * token_hash || componente_id) truncado a 16 bytes base64url: el navegador identifica las líneas por esa ref y el
 * servidor recalcula el mapa ref → componente desde la base. Si el secreto se rota, los links abiertos dejan de
 * servir (y eso está bien).
 */
import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const generarToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
export const tokenValido = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{40,48}$/.test(t);

/** Secreto propio del link (DETALLE_LINK_SECRET, solo servidor). '' si no está configurado. */
export const secretoLink = (env: NodeJS.ProcessEnv = process.env): string => String(env.DETALLE_LINK_SECRET ?? '').trim();
export const linkConfigurado = (env: NodeJS.ProcessEnv = process.env): boolean => secretoLink(env).length >= 16;

export function refDeLinea(tokenHash: string, componenteId: string, secreto: string = secretoLink()): string {
  if (secreto.length < 16) throw new Error('Falta DETALLE_LINK_SECRET en este deploy (mínimo 16 caracteres).');
  return createHmac('sha256', secreto).update(`${tokenHash}|${componenteId}`, 'utf8').digest().subarray(0, 16).toString('base64url');
}

/**
 * 031: hash de la red de una petición: sha256(ip + DETALLE_LINK_SECRET) truncado a 16. Distingue «otra red» sin guardar
 * la IP. Una IP desconocida (sin x-forwarded-for) no se hashea: null, para no agrupar desconocidos como «misma red».
 */
export function hashIp(ip: string | null | undefined, secreto: string = secretoLink()): string | null {
  const v = String(ip ?? '').trim();
  if (!v || v === 'desconocida' || secreto.length < 16) return null;
  return createHash('sha256').update(`${v}|${secreto}`, 'utf8').digest('hex').slice(0, 16);
}

export const igualSeguro = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
