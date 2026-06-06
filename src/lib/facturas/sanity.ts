/**
 * F-049.2 PARTE C — Sanity checks de los datos extraídos.
 *
 * Reglas duras que bloquean la creación del record en FACTURAS_IN si la
 * extracción produjo algo absurdo. Mejor reportar error explícito que
 * persistir basura que después hay que limpiar (principio del brief:
 * "Información mal es peor que falta").
 *
 * Las reglas son intencionalmente estrictas. Casos legítimos que las
 * disparen revelan fails de OCR o problemas de fuente — todos requieren
 * revisión humana antes de continuar.
 */

import type { FacturaExtraida } from './gemini-extractor';

export interface SanityResult {
  ok: boolean;
  motivo?: string;
}

/** Umbral conservador para detectar confusión con NITs u otros IDs largos. */
const TOTAL_THRESHOLD_MAX = 100_000_000;

/** NITs guatemaltecos típicos van de 7 a 9 dígitos (algunos viejos pueden ser 5-6 pero son raros). */
const NIT_MIN_DIGITOS = 7;
const NIT_MAX_DIGITOS = 9;

/** Tolerancia para subtotal + iva ≈ total. */
const TOLERANCIA_SUMA = 0.02;

/** Edad máxima razonable de una factura. */
const ANTIGUEDAD_MAX_ANIOS = 5;

export function validarSanidad(extraida: FacturaExtraida): SanityResult {
  const d = extraida.datos;

  // 1. Total > 0.
  if (!d.total || d.total <= 0) {
    return { ok: false, motivo: 'Total debe ser mayor a 0.' };
  }

  // 2. Total no puede ser absurdo (probable confusión con NIT/UUID).
  if (d.total > TOTAL_THRESHOLD_MAX) {
    return {
      ok: false,
      motivo: `Total Q${d.total.toLocaleString('en-US')} excede el threshold razonable (Q${TOTAL_THRESHOLD_MAX.toLocaleString('en-US')}). Probable confusión con NIT u otro número de identificación.`,
    };
  }

  // 3. NIT del proveedor con formato GT válido.
  if (!d.proveedor_nit || d.proveedor_nit.trim().length === 0) {
    return { ok: false, motivo: 'NIT del proveedor vacío.' };
  }
  const nitClean = d.proveedor_nit.replace(/[^0-9]/g, '');
  if (nitClean.length < NIT_MIN_DIGITOS || nitClean.length > NIT_MAX_DIGITOS) {
    return {
      ok: false,
      motivo: `NIT con formato inválido: "${d.proveedor_nit}" (esperado ${NIT_MIN_DIGITOS}-${NIT_MAX_DIGITOS} dígitos).`,
    };
  }

  // 4. Fecha en formato canónico, no futura, no muy antigua.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha_emision)) {
    return { ok: false, motivo: `Formato de fecha inválido: "${d.fecha_emision}" (esperado YYYY-MM-DD).` };
  }
  // Parseo manual a Date local (evita el shift UTC de `new Date("YYYY-MM-DD")`).
  const [y, m, day] = d.fecha_emision.split('-').map(Number);
  const fecha = new Date(y, m - 1, day);
  if (Number.isNaN(fecha.getTime())) {
    return { ok: false, motivo: `Fecha inválida: "${d.fecha_emision}".` };
  }
  const hoy = new Date();
  if (fecha > hoy) {
    return { ok: false, motivo: `Fecha futura: ${d.fecha_emision}.` };
  }
  const minimoAceptable = new Date(hoy);
  minimoAceptable.setFullYear(hoy.getFullYear() - ANTIGUEDAD_MAX_ANIOS);
  if (fecha < minimoAceptable) {
    return { ok: false, motivo: `Fecha demasiado antigua (>${ANTIGUEDAD_MAX_ANIOS} años): ${d.fecha_emision}.` };
  }

  // 5. subtotal + iva ≈ total (si el subtotal se reportó explícito).
  if (d.subtotal != null) {
    const calculado = d.subtotal + d.iva;
    if (Math.abs(calculado - d.total) > TOLERANCIA_SUMA) {
      return {
        ok: false,
        motivo: `Inconsistencia: subtotal (${d.subtotal}) + iva (${d.iva}) = ${calculado.toFixed(2)} ≠ total (${d.total}).`,
      };
    }
  }

  // 6. Proveedor con nombre legible.
  if (!d.proveedor_nombre || d.proveedor_nombre.trim().length < 3) {
    return { ok: false, motivo: `Proveedor con nombre inválido: "${d.proveedor_nombre}".` };
  }

  return { ok: true };
}
