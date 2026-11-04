/**
 * DETALLE DIGITAL (029) · lo que ve y manda el navegador del CLIENTE — PURO (sin IO).
 *
 * El DTO público no lleva NADA interno: ni ids de la base, ni NIT / centro de costo / estado de tarifa / ids de la
 * Agenda. Cada línea se identifica por una referencia opaca (`ref`, HMAC que arma el servidor). El cliente solo
 * manda decisión y nota por línea, y los datos de la firma; todo lo demás sale de la base.
 */

export const DECISIONES = ['aprobado', 'correccion', 'proximo_mes', 'no_aplica'] as const;
export type Decision = (typeof DECISIONES)[number];
export const ETIQUETA_DECISION: Record<Decision, string> = { aprobado: 'Aprobado', correccion: 'Corrección', proximo_mes: 'Cobrar el próximo mes', no_aplica: 'No aplica' };
export const DESCRIPCION_DECISION: Record<Decision, string> = {
  aprobado: 'La línea está bien y se cobra.',
  correccion: 'Algo está mal: precio, categoría, la persona no es suya, está duplicada.',
  proximo_mes: 'Está bien, pero la quieren en la factura del mes siguiente.',
  no_aplica: 'No la reconocen o no corresponde cobrarla.',
};
export const esDecision = (v: unknown): v is Decision => (DECISIONES as readonly string[]).includes(String(v));
export const exigeNota = (d: Decision): boolean => d !== 'aprobado';

export interface LineaPublica {
  ref: string; persona: string; puesto: string; solicitante: string; fechaIngreso: string | null;
  servicio: string; resultado: string; categoria: string; territorio: string; /** 030: precio CON IVA de la prueba (como en la factura) */ monto: number;
  /** Respuesta previa (versión anterior) y lo que Golden contestó, para la versión corregida. */
  previa?: { decision: Decision; nota: string; respuestaGolden: string } | null;
  /** Respuesta de esta versión (cuando el link ya se respondió: solo lectura). */
  respuesta?: { decision: Decision; nota: string } | null;
}
export interface DetallePublico {
  estado: 'vigente' | 'respondido';
  correlativo: string; version: number; titulo: string; dirigidoA: string; cliente: string; emisor: string; /** logo servido desde este dominio (o null) */ logoUrl: string | null; notas: string;
  /** 030: total = Σ precios con IVA; subtotal = base sin IVA (total / 1.12); iva = total − base */
  lineas: LineaPublica[]; subtotal: number; iva: number; total: number; expiraEn: string; huella: string;
  /** Si ya se respondió: cómo quedó. */
  resultado?: { estado: 'aprobada' | 'con_observaciones'; respondidoEn: string | null; nombre: string; cargo: string; observaciones: number } | null;
}
export type AperturaPublica = { estado: 'invalido' } | { estado: 'nueva_version' } | { estado: 'vigente' | 'respondido'; detalle: DetallePublico };

export interface RespuestaLineaCliente { ref: string; decision: Decision; nota: string }
export interface FirmaCliente { nombre: string; cargo: string; correo: string; autoriza: boolean; png: string }
export interface EnvioCliente { token: string; respuestas: RespuestaLineaCliente[]; firma: FirmaCliente | null; honeypot?: string }

export const LIMITE_FIRMA_PNG = 200 * 1024;   // caracteres del data URL (≈ bytes)
export const LIMITE_NOTA = 500;

const texto = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Limpia y valida lo que mandó el navegador. Devuelve error genérico (nunca detalla el interior). */
export function validarEnvioCliente(raw: unknown): { ok: true; envio: EnvioCliente } | { ok: false; error: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  if (!/^[A-Za-z0-9_-]{40,48}$/.test(token)) return { ok: false, error: 'Este link ya no es válido.' };
  if (!Array.isArray(o.respuestas) || o.respuestas.length === 0 || o.respuestas.length > 400) return { ok: false, error: 'Faltan las respuestas.' };
  const respuestas: RespuestaLineaCliente[] = [];
  for (const r of o.respuestas as unknown[]) {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const ref = texto(x.ref, 64); const nota = texto(x.nota, LIMITE_NOTA);
    if (!/^[A-Za-z0-9_-]{16,32}$/.test(ref) || !esDecision(x.decision)) return { ok: false, error: 'Faltan las respuestas.' };
    if (exigeNota(x.decision) && nota.length < 3) return { ok: false, error: 'Falta el motivo en una línea que no está aprobada.' };
    respuestas.push({ ref, decision: x.decision, nota });
  }
  if (new Set(respuestas.map(r => r.ref)).size !== respuestas.length) return { ok: false, error: 'Faltan las respuestas.' };
  const todas = respuestas.every(r => r.decision === 'aprobado');
  let firma: FirmaCliente | null = null;
  if (todas) {
    const f = (o.firma && typeof o.firma === 'object' ? o.firma : {}) as Record<string, unknown>;
    const nombre = texto(f.nombre, 200), cargo = texto(f.cargo, 200), correo = texto(f.correo, 200), png = typeof f.png === 'string' ? f.png : '';
    if (!nombre || !cargo || !correo) return { ok: false, error: 'Para firmar hacen falta nombre, cargo y correo.' };
    if (!CORREO.test(correo)) return { ok: false, error: 'El correo no parece válido.' };
    if (f.autoriza !== true) return { ok: false, error: 'Hay que marcar la casilla de autorización.' };
    if (!png.startsWith('data:image/png;base64,') || png.length < 200) return { ok: false, error: 'Falta la firma dibujada.' };
    if (png.length > LIMITE_FIRMA_PNG) return { ok: false, error: 'La firma es demasiado grande: limpiala y firmá de nuevo.' };
    firma = { nombre, cargo, correo, autoriza: true, png };
  }
  return { ok: true, envio: { token, respuestas, firma, honeypot: typeof o.empresa_web === 'string' ? o.empresa_web : '' } };
}

/** Mensaje genérico para el cliente según lo que dijo la base (nunca el error interno). */
export function mensajePublico(codigo: string): string {
  if (/LINK_NUEVA_VERSION/.test(codigo)) return 'Hay una versión más nueva de este detalle, revisá tu correo.';
  if (/LINK_USADO/.test(codigo)) return 'Este detalle ya fue respondido.';
  if (/DOCUMENTO_CAMBIO/.test(codigo)) return 'El detalle cambió desde que se envió: revisá tu correo, va a llegar una versión nueva.';
  if (/NOTA_OBLIGATORIA/.test(codigo)) return 'Falta el motivo en una línea que no está aprobada.';
  if (/FIRMA_/.test(codigo)) return 'Para firmar hacen falta nombre, cargo, correo, la casilla de autorización y la firma dibujada.';
  if (/RESPUESTAS_NO_CUBREN|DECISION_INVALIDA|RESPUESTAS_INVALIDAS/.test(codigo)) return 'Las respuestas no coinciden con el detalle: recargá la página.';
  return 'Este link ya no es válido.';
}

export const etiquetaResultadoPublico = (servicio: string, estadoPrueba: string | null | undefined): string => {
  const s = String(servicio ?? '').trim();
  const e = String(estadoPrueba ?? '').trim();
  const nombre = s === 'POLIGRAFO' ? 'Polígrafo' : s === 'POLIGRAFO BASIC' ? 'Polígrafo basic' : s === 'SOCIOECONOMICO' ? 'Socioeconómico' : s === 'SOCIOECONOMICO VIRTUAL' ? 'Socioeconómico virtual' : s === 'FEE VISITA SOCIO CANCELADO' ? 'Fee de visita' : s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
  return e ? `${nombre} — ${e.toLowerCase()}` : nombre;
};

/** Huella corta para mostrar ("A1B2 C3D4 E5F6"): los primeros 12 hex del sha256, en grupos de 4. */
export const huellaCorta = (hash: string | null | undefined): string => (hash ? hash.slice(0, 12).replace(/(.{4})(?=.)/g, '$1 ').toUpperCase() : '');
