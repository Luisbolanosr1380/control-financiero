/**
 * F-051 — Proyección de OBLIGACIONES_RECURRENTES a EventoFlujo[].
 *
 * Reglas por frecuencia:
 *  - Mensual:   un evento por cada mes en el horizonte, día = min(DIA_PAGO,
 *               último día del mes).
 *  - Quincenal: día 15 y último día de cada mes.
 *  - Bimestral / Trimestral / Anual: usar MES_REFERENCIA como ancla y
 *               sumar 2 / 3 / 12 meses entre eventos. Si falta MES_REFERENCIA,
 *               cae al mes actual como ancla (degradación visible: la fecha
 *               estará pero el usuario verá que el día queda raro).
 *
 * Constructor local de Date (lección F-041): `new Date(y, m, d)` interpreta
 * en zona local del proceso. Para el horizonte usamos componentes de fecha
 * (Y-M-D) calculados como strings ISO; nunca `toISOString` sobre un Date
 * construido localmente porque introduce shift UTC.
 */

import type { ObligacionRecurrente } from './obligaciones';
import type { EventoFlujo } from './types';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Día YYYY-MM-DD sumando `dias` a una fecha ISO. Constructor local, sin UTC shift. */
function sumarDias(isoFecha: string, dias: number): string {
  const [y, m, d] = isoFecha.split('-').map(Number);
  const f = new Date(y, m - 1, d);
  f.setDate(f.getDate() + dias);
  return `${f.getFullYear()}-${pad2(f.getMonth() + 1)}-${pad2(f.getDate())}`;
}

function ultimoDiaMes(anio: number, mesIdx0: number): number {
  // mesIdx0 = 0..11. `new Date(y, m+1, 0)` = día 0 del mes siguiente = último día del actual.
  return new Date(anio, mesIdx0 + 1, 0).getDate();
}

function clampDia(anio: number, mesIdx0: number, diaPago: number): number {
  const max = ultimoDiaMes(anio, mesIdx0);
  if (diaPago < 1) return 1;
  if (diaPago > max) return max;
  return diaPago;
}

function isoLocal(anio: number, mesIdx0: number, dia: number): string {
  return `${anio}-${pad2(mesIdx0 + 1)}-${pad2(dia)}`;
}

/** Suma `n` meses a una fecha; el día se clamp-ea al último día del mes destino. */
function sumarMeses(anio: number, mesIdx0: number, dia: number, n: number): { anio: number; mesIdx0: number; dia: number } {
  const total = mesIdx0 + n;
  const nuevoAnio = anio + Math.floor(total / 12);
  const nuevoMes = ((total % 12) + 12) % 12;
  return { anio: nuevoAnio, mesIdx0: nuevoMes, dia: clampDia(nuevoAnio, nuevoMes, dia) };
}

function descripcionEvento(o: ObligacionRecurrente): string {
  const sufijo = o.tipo === 'Otro' ? '' : ` (${o.tipo.toLowerCase()})`;
  return `${o.nombre}${sufijo}`;
}

function eventoDesde(o: ObligacionRecurrente, fecha: string): EventoFlujo {
  return {
    fecha,
    tipo: 'egreso',
    fuente: 'recurrente',
    descripcion: descripcionEvento(o),
    monto: o.montoEstimado,
    prioridad: o.prioridad,
    esEstimado: true,
    linkId: o.id,
    linkTipo: 'obligacion',
  };
}

function proyectarMensual(o: ObligacionRecurrente, desde: string, hasta: string): EventoFlujo[] {
  const out: EventoFlujo[] = [];
  const [ya, ma, da] = desde.split('-').map(Number);
  const [yh, mh, dh] = hasta.split('-').map(Number);
  // Recorremos mes a mes desde el mes de `desde` hasta el mes de `hasta`.
  let y = ya, m = ma - 1;
  while (y < yh || (y === yh && m <= mh - 1)) {
    const dia = clampDia(y, m, o.diaPago);
    const fecha = isoLocal(y, m, dia);
    // Filtrar al rango exacto.
    if (
      (y > ya || (y === ya && (m > ma - 1 || (m === ma - 1 && dia >= da)))) &&
      (y < yh || (y === yh && (m < mh - 1 || (m === mh - 1 && dia <= dh))))
    ) {
      out.push(eventoDesde(o, fecha));
    }
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

function proyectarQuincenal(o: ObligacionRecurrente, desde: string, hasta: string): EventoFlujo[] {
  const out: EventoFlujo[] = [];
  const [ya, ma] = desde.split('-').map(Number);
  const [yh, mh] = hasta.split('-').map(Number);
  let y = ya, m = ma - 1;
  while (y < yh || (y === yh && m <= mh - 1)) {
    const candidatos = [15, ultimoDiaMes(y, m)];
    for (const dia of candidatos) {
      const fecha = isoLocal(y, m, dia);
      if (fecha >= desde && fecha <= hasta) {
        out.push(eventoDesde(o, fecha));
      }
    }
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

function proyectarConAncla(o: ObligacionRecurrente, desde: string, hasta: string, mesesPorCiclo: number): EventoFlujo[] {
  // Ancla: mesReferencia si existe; si no, mes-año de `desde`.
  const ancla = o.mesReferencia && /^\d{4}-\d{2}/.test(o.mesReferencia)
    ? o.mesReferencia.slice(0, 7)
    : desde.slice(0, 7);
  const [anclaY, anclaM] = ancla.split('-').map(Number);
  const out: EventoFlujo[] = [];
  // Caminamos hacia adelante desde la ancla en saltos de `mesesPorCiclo`.
  let cursor = { anio: anclaY, mesIdx0: anclaM - 1, dia: clampDia(anclaY, anclaM - 1, o.diaPago) };
  // Si el cursor cae antes del horizonte, lo avanzamos hasta entrar al rango.
  const maxIter = 240;  // 20 años x 12 — defensivo.
  let i = 0;
  while (i < maxIter) {
    const fecha = isoLocal(cursor.anio, cursor.mesIdx0, cursor.dia);
    if (fecha > hasta) break;
    if (fecha >= desde) {
      out.push(eventoDesde(o, fecha));
    }
    cursor = sumarMeses(cursor.anio, cursor.mesIdx0, o.diaPago, mesesPorCiclo);
    i++;
  }
  return out;
}

/**
 * Genera todos los EventoFlujo de una obligación dentro del horizonte
 * [fechaDesde, fechaHasta] inclusive. Si la obligación NO está activa,
 * devuelve [].
 */
export function proyectarObligacion(o: ObligacionRecurrente, fechaDesde: string, fechaHasta: string): EventoFlujo[] {
  if (!o.activo) return [];
  if (!(o.montoEstimado > 0)) return [];
  if (!(o.diaPago >= 1 && o.diaPago <= 31)) return [];

  switch (o.frecuencia) {
    case 'Mensual':    return proyectarMensual(o, fechaDesde, fechaHasta);
    case 'Quincenal':  return proyectarQuincenal(o, fechaDesde, fechaHasta);
    case 'Bimestral':  return proyectarConAncla(o, fechaDesde, fechaHasta, 2);
    case 'Trimestral': return proyectarConAncla(o, fechaDesde, fechaHasta, 3);
    case 'Anual':      return proyectarConAncla(o, fechaDesde, fechaHasta, 12);
    default:           return [];
  }
}

export function proyectarObligaciones(obligaciones: ObligacionRecurrente[], fechaDesde: string, fechaHasta: string): EventoFlujo[] {
  const out: EventoFlujo[] = [];
  for (const o of obligaciones) {
    out.push(...proyectarObligacion(o, fechaDesde, fechaHasta));
  }
  return out;
}

export { sumarDias };
