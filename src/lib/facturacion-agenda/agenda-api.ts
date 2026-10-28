/**
 * FACTURACIÓN AGENDA · Cliente HTTP del API de Facturación de la Agenda.
 *
 * Reglas del contrato (docs 27/28-oct-2026 y brief §1):
 *  - La llave va SOLO en el header `x-api-key`. Nunca en la URL, el log ni un error.
 *  - Reintentos con backoff ante 429 / 503 (y 500 solo en lecturas: un 500 en
 *    POST /facturas o /lote puede haber escrito parcialmente y trae
 *    actualizados/fallo/pendientes). Un 409 NUNCA se reintenta: es una decisión.
 *  - Cada llamada queda en `facturacion_log` vía `log` (acción, ruta sin
 *    secretos, status, detalle del error). El cuerpo no se guarda.
 *  - `fetchImpl` inyectable: las pruebas corren contra un doble del API.
 */
import type { ExpedienteAgenda } from './tipos';

export interface PaginaExpedientes { expedientes: ExpedienteAgenda[]; total: number; pagina: number; porPagina: number; paginas: number }
export interface ExpedienteFactura { id: string; monto?: number; siActualizadoEn?: string }
export interface FacturaAgendaBody { numeroFactura: string; fechaFactura: string; statusCobro?: string; estatusPago?: string; expedientes: ExpedienteFactura[] }
export interface ItemLote { id: string; statusCobro?: string | null; estatusPago?: string | null; monto?: number | null; numeroFactura?: string | null; fechaFactura?: string | null; cobroMegapaca?: number | null; siActualizadoEn?: string }
export interface RespuestaEscritura { actualizados?: number | unknown[]; expedientes?: ExpedienteAgenda[]; factura?: { numeroFactura: string; fechaFactura: string }; fallo?: unknown; pendientes?: unknown; error?: string; detalles?: unknown; expediente?: ExpedienteAgenda }

export class AgendaApiError extends Error {
  constructor(public status: number, public body: unknown, public ruta: string) {
    super(`Agenda ${status} en ${ruta}: ${resumirCuerpo(body)}`);
    this.name = 'AgendaApiError';
  }
}

export interface LogSaliente {
  accion: string; metodo: string; ruta: string; expedientes?: string[];
  statusHttp: number | null; ok: boolean; detalle?: string; duracionMs: number;
}

export interface AgendaApiOpciones {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  log?: (l: LogSaliente) => Promise<void> | void;
  esperar?: (ms: number) => Promise<void>;
  maxIntentos?: number;
  timeoutMs?: number;
}

/** Texto corto y sin secretos de un cuerpo de error: `error` + `detalles`. */
export function resumirCuerpo(body: unknown): string {
  if (body === null || body === undefined || body === '') return '';
  if (typeof body === 'string') return body.slice(0, 300);
  const b = body as Record<string, unknown>;
  const partes: string[] = [];
  if (typeof b.error === 'string') partes.push(b.error);
  if (Array.isArray(b.detalles)) partes.push(b.detalles.map(d => { const x = d as Record<string, unknown>; return [x.campo, x.problema ?? x.id ?? x.mensaje].filter(Boolean).join(': '); }).join(' · '));
  if (b.actualizados !== undefined) partes.push(`actualizados=${JSON.stringify(b.actualizados)}`);
  if (b.fallo !== undefined) partes.push(`fallo=${JSON.stringify(b.fallo)}`);
  if (b.pendientes !== undefined) partes.push(`pendientes=${JSON.stringify(b.pendientes)}`);
  if (!partes.length) partes.push(JSON.stringify(b));
  return partes.join(' · ').slice(0, 400);
}

const REINTENTAR_LECTURA = [429, 500, 503];
const REINTENTAR_ESCRITURA = [429, 503];

export function crearAgendaApi(o: AgendaApiOpciones) {
  const f = o.fetchImpl ?? fetch;
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const maxIntentos = o.maxIntentos ?? 4;
  const timeoutMs = o.timeoutMs ?? 30_000;

  async function llamar<T>(accion: string, metodo: 'GET' | 'POST' | 'PATCH', ruta: string, args: { query?: Record<string, string | string[] | number | undefined>; body?: unknown; expedientes?: string[]; reintentarEn: number[]; reintentarRed: boolean }): Promise<{ status: number; body: T }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(args.query ?? {})) {
      if (v === undefined || v === '') continue;
      if (Array.isArray(v)) v.forEach(x => qs.append(k, x)); else qs.set(k, String(v));
    }
    const url = `${o.baseUrl}${ruta}${qs.size ? `?${qs}` : ''}`;
    const rutaLog = `${ruta}${qs.size ? `?${qs}` : ''}`;
    let intento = 0;
    for (;;) {
      intento++;
      const t0 = Date.now();
      let status: number | null = null; let body: unknown = null; let redError: string | null = null;
      try {
        const r = await f(url, {
          method: metodo,
          headers: { 'x-api-key': o.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: args.body === undefined ? undefined : JSON.stringify(args.body),
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        });
        status = r.status;
        const texto = await r.text();
        try { body = texto ? JSON.parse(texto) : null; } catch { body = texto; }
      } catch (e) {
        redError = e instanceof Error ? e.message : String(e);
      }
      const ok = status !== null && status >= 200 && status < 300;
      const puedeReintentar = intento < maxIntentos && ((status !== null && args.reintentarEn.includes(status)) || (redError !== null && args.reintentarRed));
      await o.log?.({ accion, metodo, ruta: rutaLog, expedientes: args.expedientes, statusHttp: status, ok, detalle: ok ? undefined : (redError ?? resumirCuerpo(body)) + (puedeReintentar ? ` · reintento ${intento}/${maxIntentos - 1}` : ''), duracionMs: Date.now() - t0 });
      if (ok) return { status: status!, body: body as T };
      if (puedeReintentar) { await esperar(Math.min(8000, 500 * 2 ** (intento - 1)) + Math.floor(Math.random() * 200)); continue; }
      if (redError !== null) throw new AgendaApiError(0, { error: `red: ${redError}` }, rutaLog);
      throw new AgendaApiError(status!, body, rutaLog);
    }
  }

  return {
    /** GET /expedientes con filtros (cambiadosDesde, desde, terminado, porPagina, pagina, incluirEliminados…). */
    listarExpedientes: (query: Record<string, string | string[] | number | undefined>) =>
      llamar<PaginaExpedientes>('listar', 'GET', '/expedientes', { query, reintentarEn: REINTENTAR_LECTURA, reintentarRed: true }).then(r => r.body),
    /** GET /expedientes/{id} → el expediente como está AHORA. */
    leerExpediente: (id: string) =>
      llamar<{ expediente: ExpedienteAgenda }>('leer', 'GET', `/expedientes/${encodeURIComponent(id)}`, { expedientes: [id], reintentarEn: REINTENTAR_LECTURA, reintentarRed: true }).then(r => r.body.expediente),
    /** POST /facturas — todo o nada del lado de la Agenda. 409/404/500 llegan como AgendaApiError (sin reintento). */
    crearFactura: (body: FacturaAgendaBody) =>
      llamar<RespuestaEscritura>('facturar', 'POST', '/facturas', { body, expedientes: body.expedientes.map(e => e.id), reintentarEn: REINTENTAR_ESCRITURA, reintentarRed: false }),
    /** PATCH /expedientes/{id} — solo el cobro. */
    actualizarExpediente: (id: string, body: Omit<ItemLote, 'id'>) =>
      llamar<{ actualizado: boolean; expediente: ExpedienteAgenda }>('patch', 'PATCH', `/expedientes/${encodeURIComponent(id)}`, { body, expedientes: [id], reintentarEn: REINTENTAR_ESCRITURA, reintentarRed: false }),
    /** POST /lote — varios, cada uno con lo suyo; todo o nada. */
    lote: (items: ItemLote[]) =>
      llamar<RespuestaEscritura>('lote', 'POST', '/lote', { body: { items }, expedientes: items.map(i => i.id), reintentarEn: REINTENTAR_ESCRITURA, reintentarRed: false }),
  };
}

export type AgendaApi = ReturnType<typeof crearAgendaApi>;

/** ids de un `actualizados` / `pendientes` / `fallo` de la Agenda (strings u objetos con id). */
export function idsDe(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map(v => typeof v === 'string' ? v : (v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : '')).filter(Boolean);
}
