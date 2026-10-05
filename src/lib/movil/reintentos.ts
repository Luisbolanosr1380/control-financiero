/**
 * MÓVIL — envío tolerante a señal intermitente. PURO (el reloj y la espera
 * de conexión se inyectan para poder probarlo).
 *
 * Regla de seguridad contra duplicados:
 *  · Sin conexión ANTES de enviar → se espera a que vuelva y se envía
 *    (nada salió todavía, siempre es seguro).
 *  · Falla de red DURANTE el envío → solo se reintenta solo si la operación
 *    es idempotente (gasto: dedupe por hash; factura: el número no se puede
 *    repetir). Un cobro no lo es: si la respuesta se perdió, el cobro pudo
 *    haberse guardado, así que se avisa en vez de reintentar a ciegas.
 * Las respuestas del servidor (ok o error de negocio) nunca se reintentan.
 */

export const ESPERAS_MS = [2000, 5000, 10000];

export type ResultadoEnvio<T> =
  | { estado: 'ok'; valor: T; intentos: number }
  | { estado: 'error_red'; mensaje: string; intentos: number; posibleGuardado: boolean };

export interface EntornoEnvio {
  enLinea: () => boolean;
  esperarConexion: () => Promise<void>;
  dormir: (ms: number) => Promise<void>;
}

export async function enviarConReintentos<T>(
  enviar: () => Promise<T>,
  opts: { idempotente: boolean; entorno: EntornoEnvio; esperas?: number[]; alEsperar?: (motivo: 'sin_conexion' | 'reintento', intento: number) => void },
): Promise<ResultadoEnvio<T>> {
  const esperas = opts.esperas ?? ESPERAS_MS;
  const { entorno } = opts;
  let intentos = 0;
  for (;;) {
    if (!entorno.enLinea()) {
      opts.alEsperar?.('sin_conexion', intentos);
      await entorno.esperarConexion();
    }
    intentos++;
    try {
      return { estado: 'ok', valor: await enviar(), intentos };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (!opts.idempotente) return { estado: 'error_red', mensaje, intentos, posibleGuardado: true };
      if (intentos > esperas.length) return { estado: 'error_red', mensaje, intentos, posibleGuardado: false };
      opts.alEsperar?.('reintento', intentos);
      await entorno.dormir(esperas[intentos - 1]);
    }
  }
}

/** Entorno real del navegador. */
export function entornoNavegador(): EntornoEnvio {
  return {
    enLinea: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    esperarConexion: () => new Promise<void>(res => window.addEventListener('online', () => res(), { once: true })),
    dormir: ms => new Promise(res => setTimeout(res, ms)),
  };
}
