/**
 * FACTURACIÓN AGENDA · Configuración por deploy (solo servidor).
 *
 * Las llaves viven en env vars del servidor: `FACTURACION_API_KEY_AGENDA`
 * (x-api-key) y `WEBHOOK_SECRET_AGENDA` (whsec_fact_…). Nunca en código, logs,
 * URLs ni en el navegador. Golden las carga por deploy; HIT no las tiene (no
 * hace evaluaciones) y ahí el write-back está SIEMPRE apagado.
 *
 * SOLO SERVIDOR por convención (no lleva 'server-only' para que los validadores
 * corran en node): ningún módulo 'use client' debe importarlo; lo verifica
 * scripts/validate-facturacion-agenda.ts.
 */

export interface ConfigAgenda {
  /** Dirección base del API de Facturación de la Agenda. */
  url: string;
  apiKey: string;
  webhookSecret: string;
  /** FACTURAR_WRITEBACK (default ON). OFF = todo en financiero, nada se escribe a la Agenda. */
  writeback: boolean;
  /** Qué monto se escribe por expediente al facturar: con IVA (como lo registra Golden hoy) o sin IVA. */
  montoModo: 'con_iva' | 'sin_iva';
  /** Primera corrida del sync: `desde=` (fecha de ingreso). */
  desdeInicial: string;
  porPagina: number;
}

export const URL_AGENDA_DEFAULT = 'https://us-central1-lotesycandidatos.cloudfunctions.net/agendaApi/api/facturacion';

const apagado = (v: string | undefined) => /^(off|0|false|no)$/i.test(String(v ?? '').trim());

export function configAgenda(env: NodeJS.ProcessEnv = process.env): ConfigAgenda {
  const slug = String(env.EMPRESA_SLUG ?? 'golden').toLowerCase();
  const writeback = !apagado(env.FACTURAR_WRITEBACK) && slug !== 'hit';
  return {
    url: String(env.FACTURACION_AGENDA_URL ?? URL_AGENDA_DEFAULT).replace(/\/$/, ''),
    apiKey: String(env.FACTURACION_API_KEY_AGENDA ?? '').trim(),
    webhookSecret: String(env.WEBHOOK_SECRET_AGENDA ?? '').trim(),
    writeback,
    montoModo: String(env.FACTURACION_AGENDA_MONTO ?? 'con_iva').toLowerCase() === 'sin_iva' ? 'sin_iva' : 'con_iva',
    desdeInicial: String(env.FACTURACION_AGENDA_DESDE ?? '2026-01-01'),
    porPagina: 200,
  };
}

/** Hay llave: este deploy puede hablar con la Agenda. */
export const agendaConfigurada = (env: NodeJS.ProcessEnv = process.env): boolean => configAgenda(env).apiKey.length > 0;
