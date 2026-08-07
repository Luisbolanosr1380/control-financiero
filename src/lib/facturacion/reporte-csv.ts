/**
 * F-REPORTE-FACTURACION (ajuste) — Export del reporte: resumen + detalle
 * en un solo archivo.
 *
 * Función PURA compartida por la UI (/reportes/facturacion → botón
 * Exportar CSV) y por el validador (scripts/validate-reporte-facturacion.ts),
 * para que lo que se valida sea EXACTAMENTE lo que se descarga.
 *
 * Estructura del archivo (dos bloques, misma convención de consolidación
 * que la app: 820 facturas, no 980 líneas; sin anuladas/refacturadas):
 *
 *   BLOQUE 1 — RESUMEN: encabezado (período + filtros), totales
 *   (total/# facturas/ticket/subtotal/IVA/excluidas), resumen por
 *   cliente y por centro de costo.
 *
 *   BLOQUE 2 — DETALLE: una fila por factura (No./Fecha/Cliente/Línea/
 *   Subtotal/IVA/Total/Estado), mismo orden que la vista (fecha desc),
 *   con fila de TOTALES al pie que cuadra con el resumen.
 *
 * El dataset de entrada viene de getFacturasReporte() → fetchAll
 * PAGINADO. Nunca armar este export desde un .select() directo de
 * supabase-js: trunca en 1,000 filas en silencio (hoy hay 980 líneas,
 * al borde del límite).
 *
 * El caller agrega el BOM ('﻿') al descargar — acá solo texto.
 */

import type { FacturaFiltrada } from './reporte';
import { totalesReporte, reportePorCliente, reportePorCentroCosto } from './reporte';

export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ESTADO_LABEL: Record<string, string> = {
  cobrado:         'Cobrada',
  cobrado_parcial: 'Cobrado parcial',
  emitida:         'Emitida',
  pendiente:       'Pendiente',
  otro:            'Otro',
};

export interface ContextoExport {
  /** Ej. "Enero 2026 — Marzo 2026" o "Histórico completo". */
  etiquetaPeriodo: string;
  /** Ej. "Génesis · Poligrafia" o "Todos los clientes y líneas". */
  filtrosHumanos: string;
  nomCliente: (id: string) => string;
  nomCentro: (id: string) => string;
  /** Filtro de CC activo — el detalle lista solo las líneas de esos centros. */
  centroCostoIds: readonly string[];
  /** Anuladas/refacturadas excluidas dentro del filtro (se informan, no se suman). */
  numAnuladas: number;
}

export function construirCsvReporte(filtradas: readonly FacturaFiltrada[], ctx: ContextoExport): string {
  const tot = totalesReporte(filtradas);
  const porCliente = reportePorCliente(filtradas);
  const porCC = reportePorCentroCosto(filtradas, ctx.centroCostoIds);
  const fila = (...campos: Array<string | number>) => campos.map(csvEscape).join(',');

  const lineas: string[] = [];

  /* ── BLOQUE 1 · RESUMEN ─────────────────────────────────────── */
  lineas.push(fila('Reporte de facturación emitida'));
  lineas.push(fila('Período:', ctx.etiquetaPeriodo));
  lineas.push(fila('Filtros:', ctx.filtrosHumanos));
  lineas.push('');
  lineas.push(fila('TOTALES'));
  lineas.push(fila('Total facturado Q', tot.totalQ.toFixed(2)));
  lineas.push(fila('No. facturas', tot.numFacturas));
  lineas.push(fila('Ticket promedio Q', tot.ticketPromedioQ.toFixed(2)));
  lineas.push(fila('Subtotal Q', tot.subtotalQ.toFixed(2)));
  lineas.push(fila('IVA Q', tot.ivaQ.toFixed(2)));
  lineas.push(fila('Anuladas/refacturadas excluidas', ctx.numAnuladas));
  lineas.push('');
  lineas.push(fila('RESUMEN POR CLIENTE'));
  lineas.push(fila('Cliente', 'No. facturas', 'Total Q', '% del total'));
  for (const g of porCliente) {
    lineas.push(fila(ctx.nomCliente(g.key), g.numFacturas, g.montoQ.toFixed(2), g.pct.toFixed(1)));
  }
  lineas.push('');
  lineas.push(fila('RESUMEN POR CENTRO DE COSTO'));
  lineas.push(fila('Centro de costo', 'No. facturas', 'Total Q', '% del total'));
  for (const g of porCC) {
    lineas.push(fila(ctx.nomCentro(g.key), g.numFacturas, g.montoQ.toFixed(2), g.pct.toFixed(1)));
  }
  lineas.push('');

  /* ── BLOQUE 2 · DETALLE POR FACTURA ─────────────────────────── */
  const ccSet = ctx.centroCostoIds.length > 0 ? new Set(ctx.centroCostoIds) : null;
  const detalle = [...filtradas].sort((a, b) =>
    b.f.fecha.localeCompare(a.f.fecha) || b.f.noFactura.localeCompare(a.f.noFactura));

  lineas.push(fila('DETALLE POR FACTURA'));
  lineas.push(fila('No. factura', 'Fecha', 'Cliente', 'Centro de costo', 'Subtotal Q', 'IVA Q', 'Total Q', 'Estado'));
  for (const x of detalle) {
    const centros = [...new Set(
      x.f.lineasCC
        .filter(l => !ccSet || ccSet.has(l.ccId))
        .map(l => ctx.nomCentro(l.ccId)),
    )].join(' + ');
    lineas.push(fila(
      x.f.noFactura,
      x.f.fecha || '—',
      ctx.nomCliente(x.f.custId),
      centros || '—',
      x.subtotalQ.toFixed(2),
      x.ivaQ.toFixed(2),
      x.totalQ.toFixed(2),
      ESTADO_LABEL[x.f.estadoBruto] ?? x.f.estadoBruto,
    ));
  }
  lineas.push(fila('TOTALES', '', '', '', tot.subtotalQ.toFixed(2), tot.ivaQ.toFixed(2), tot.totalQ.toFixed(2), ''));

  return lineas.join('\n');
}

/** "facturacion_genesis_poligrafia_2026-01-01_a_2026-03-31.csv" */
export function nombreArchivoExport(args: {
  clienteSlugs: readonly string[];
  centroSlugs: readonly string[];
  desde?: string;
  hasta?: string;
}): string {
  const slug = (s: string) => s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const filtro = [...args.clienteSlugs, ...args.centroSlugs].map(slug).filter(Boolean).join('_') || 'todos';
  const periodo = args.desde || args.hasta
    ? `${args.desde || 'inicio'}_a_${args.hasta || 'hoy'}`
    : 'historico';
  return `facturacion_${filtro}_${periodo}.csv`;
}
