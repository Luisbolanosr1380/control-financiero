/**
 * CORREO SALIENTE · Resend por su API REST (fetch, sin dependencia nueva) — SOLO SERVIDOR.
 *
 * Config: RESEND_API_KEY (solo servidor; nunca en código, logs ni repo), RESEND_FROM (default
 * facturacion@golden-talent.com), FACTURACION_AVISO_CORREO (casilla principal que recibe los avisos de vuelta) y FACTURACION_AVISO_CC (copia).
 * Sin llave: `modo: 'sin_llave'` y la pantalla ofrece "copiar link". Con CORREO_MOCK=1 (pruebas) no se habla con
 * Resend: el correo se arma igual y se devuelve como enviado con id 'mock-…' (queda en `ultimosMock` para inspección).
 */
import 'server-only';

export interface CorreoSaliente { para: string[]; cc?: string[]; respuestaA?: string; asunto: string; html: string; texto: string }
export type ResultadoCorreo = { ok: true; modo: 'resend' | 'mock'; id: string } | { ok: false; modo: 'sin_llave' | 'resend'; error: string };

export interface ConfigCorreo { apiKey: string; from: string; avisoA: string[]; avisoCc: string[]; mock: boolean }

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const correosValidos = (xs: readonly (string | null | undefined)[]): string[] => [...new Set(xs.map(x => String(x ?? '').trim().toLowerCase()).filter(x => CORREO.test(x)))];

export function configCorreo(env: NodeJS.ProcessEnv = process.env): ConfigCorreo {
  return {
    apiKey: String(env.RESEND_API_KEY ?? '').trim(),
    from: String(env.RESEND_FROM ?? '').trim() || 'facturacion@golden-talent.com',
    avisoA: correosValidos(String(env.FACTURACION_AVISO_CORREO ?? '').split(/[,;]/)),
    /** copia (CC) del aviso de vuelta: FACTURACION_AVISO_CC, uno o varios separados por coma */
    avisoCc: correosValidos(String(env.FACTURACION_AVISO_CC ?? '').split(/[,;]/)),
    mock: /^(1|true|on|yes)$/i.test(String(env.CORREO_MOCK ?? '').trim()),
  };
}
export const correoConfigurado = (env: NodeJS.ProcessEnv = process.env): boolean => { const c = configCorreo(env); return c.mock || c.apiKey.length > 0; };

/** Último correo armado en modo mock (pruebas). */
export const ultimosMock: Array<CorreoSaliente & { from: string; id: string; en: string }> = [];

export async function enviarCorreo(c: CorreoSaliente, env: NodeJS.ProcessEnv = process.env): Promise<ResultadoCorreo> {
  const cfg = configCorreo(env);
  const para = correosValidos(c.para); const cc = correosValidos(c.cc ?? []);
  if (!para.length) return { ok: false, modo: cfg.apiKey ? 'resend' : 'sin_llave', error: 'Sin destinatarios válidos.' };
  if (cfg.mock) {
    const id = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    ultimosMock.push({ ...c, para, cc, from: cfg.from, id, en: new Date().toISOString() });
    if (ultimosMock.length > 50) ultimosMock.splice(0, ultimosMock.length - 50);
    return { ok: true, modo: 'mock', id };
  }
  if (!cfg.apiKey) return { ok: false, modo: 'sin_llave', error: 'Correo no configurado (falta RESEND_API_KEY).' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: para, cc: cc.length ? cc : undefined, reply_to: c.respuestaA && CORREO.test(c.respuestaA) ? c.respuestaA : undefined, subject: c.asunto, html: c.html, text: c.texto }),
      signal: AbortSignal.timeout(15_000),
    });
    const cuerpo = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!r.ok) return { ok: false, modo: 'resend', error: `Resend ${r.status}: ${cuerpo.message ?? cuerpo.name ?? 'error'}` };
    return { ok: true, modo: 'resend', id: String(cuerpo.id ?? '') };
  } catch (e) {
    return { ok: false, modo: 'resend', error: e instanceof Error ? e.message : String(e) };
  }
}
