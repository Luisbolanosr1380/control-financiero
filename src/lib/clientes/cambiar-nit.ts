/**
 * CAMBIAR NIT (023) — tipos y helpers PUROS (sin IO) compartidos por la capa de
 * datos (db/clientes.ts), las actions y el modal (cliente).
 *
 * El NIT es la llave de cruce entre el cliente, su tarifario (+ bitácora), el
 * mapeo de la Agenda, los expedientes resueltos y los detalles de facturación.
 * Corregirlo solo en `clientes` deja tarifas huérfanas en el NIT viejo (pasó con
 * CBC); la RPC `cliente_cambiar_nit` lo cambia en TODO en una transacción.
 */
import { nitComparable, nitEsPlaceholder } from './nit';

/** Filas por tabla (lo que se movió, o lo que se movería en la simulación). */
export interface MovidasNit { clientes: number; tarifario: number; tarifarioHistorial: number; clienteExterno: number; facturacionExpediente: number; detalleFacturacion: number }
export interface ChoqueTarifa { tipoPrueba: string; categoria: string; territorio: string; montoViejo: number; montoNuevo: number }
export type CodigoCambioNit = 'nit_placeholder' | 'nit_invalido' | 'nit_viejo_placeholder' | 'cliente_no_existe' | 'cliente_ambiguo' | 'nit_igual' | 'tarifa_choque' | 'nit_compartido' | 'sin_rpc' | 'otro';

/** Objetivo: por cliente (id de la app) o por NIT viejo (tarifas huérfanas en un NIT sin cliente, el caso CBC). */
export interface ObjetivoNit { clienteId?: string; nitViejo?: string }

export interface CambioNitOk {
  ok: true; simulado: boolean; nitViejo: string; nitNuevo: string;
  clienteId: string | null; clienteNombre: string | null;
  /** Otros clientes activos que ya tenían el NIT nuevo (NIT compartido, confirmado con `forzar`). */
  compartidoCon: string | null;
  /** Clientes activos que ya tienen el NIT nuevo (con objetivo por NIT: a quién pasan las tarifas). */
  destino: string | null;
  movidas: MovidasNit; motivo?: string; reclasificados?: number; mensaje: string;
}
export interface CambioNitError {
  ok: false; codigo: CodigoCambioNit; error: string;
  nitViejo?: string; nitNuevo?: string; compartidoCon?: string | null; destino?: string | null; choques?: ChoqueTarifa[]; movera?: MovidasNit;
}
export type CambioNitResult = CambioNitOk | CambioNitError;

/** Misma regla que `nitValido` sobre el NIT comparable: dígitos + verificador (número o K). CF y placeholders no sirven como llave. */
export const nitNuevoAceptable = (nit: string | null | undefined): boolean => {
  const n = nitComparable(nit);
  return !nitEsPlaceholder(n) && /^[0-9]{2,12}[0-9K]$/.test(n);
};

const pl = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/** Texto corto del arrastre: "11 tarifas (+ 20 renglones de histórico), 2 empresas de la Agenda, 14 expedientes, 1 detalle de facturación". */
export function resumenMovidas(m: MovidasNit): string {
  const partes: string[] = [];
  if (m.tarifario) partes.push(pl(m.tarifario, 'tarifa', 'tarifas') + (m.tarifarioHistorial ? ` (+ ${pl(m.tarifarioHistorial, 'renglón', 'renglones')} de histórico)` : ''));
  if (m.clienteExterno) partes.push(pl(m.clienteExterno, 'empresa de la Agenda', 'empresas de la Agenda'));
  if (m.facturacionExpediente) partes.push(pl(m.facturacionExpediente, 'expediente', 'expedientes'));
  if (m.detalleFacturacion) partes.push(pl(m.detalleFacturacion, 'detalle de facturación', 'detalles de facturación'));
  return partes.length ? partes.join(', ') : 'nada más que el cliente (no hay tarifas, mapeos ni expedientes en el NIT actual)';
}

/** Filas del resumen del modal (etiqueta + cantidad), solo las tablas con algo. */
export function filasMovidas(m: MovidasNit): Array<{ tabla: string; n: number }> {
  return [
    { tabla: 'Cliente', n: m.clientes },
    { tabla: 'Tarifas', n: m.tarifario },
    { tabla: 'Histórico de precios', n: m.tarifarioHistorial },
    { tabla: 'Empresas de la Agenda mapeadas', n: m.clienteExterno },
    { tabla: 'Expedientes resueltos a este NIT', n: m.facturacionExpediente },
    { tabla: 'Detalles de facturación', n: m.detalleFacturacion },
  ].filter(f => f.n > 0);
}
