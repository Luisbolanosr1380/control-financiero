/**
 * F-BF-002c — Agregación de top clientes por rango.
 *
 * Una sola fuente de verdad reusada por:
 *  - Card "Top Clientes del mes" en /facturacion (F-BF-002b).
 *  - Auros tool `topClientes(desde, hasta, limite)`.
 *  - Auros tool `facturadoCliente(nombre, desde, hasta)`.
 *
 * Entrada: dataset liviano (InvoiceLiviano[]) ya filtrado al rango por
 * server, + lista de clientes para resolver nombre/short. Sin IO acá:
 * el caller decide cómo obtener las facturas (por mes, por rango, por
 * cliente, etc.).
 *
 * Reglas:
 *  - Excluye estados 'anulado' y 'refacturado' del total facturado y
 *    del ranking, pero reporta `numAnuladas` aparte (incluye también
 *    refacturadas en ese contador, porque el usuario rara vez las
 *    distingue cuando pregunta "¿qué pasó con las que cancelaste?").
 *  - Si `totalRango` es 0, `porcentaje` queda en 0 para evitar divide-by-zero.
 */

import type { InvoiceLiviano } from '@/lib/db/facturas';

export interface TopClienteItem {
  custId: string;
  nombre: string;
  /** Para truncado elegante en la UI: `short` del Customer si existe. */
  nombreCorto: string;
  /** SUM(TOTAL) en GTQ, excluyendo anuladas y refacturadas. */
  montoQ: number;
  numFacturas: number;
  /** Participación 0–100 sobre el total facturado válido del rango. */
  porcentaje: number;
}

export interface TopClientesResultado {
  items: TopClienteItem[];
  /** Total facturado válido del rango (excluye anuladas/refacturadas). */
  totalFacturadoRango: number;
  /** Cantidad de facturas que entran al cálculo. */
  numFacturasValidas: number;
  /** Facturas excluidas (anuladas + refacturadas) — para que Auros las mencione si > 0. */
  numAnuladas: number;
}

interface ClienteMin {
  id: string;
  name: string;
  short?: string;
}

function esAnuladaORefacturada(estadoBruto: string): boolean {
  return estadoBruto === 'anulado' || estadoBruto === 'refacturado';
}

/**
 * Calcula top N clientes a partir de las livianas ya filtradas al rango
 * deseado. Devuelve también el total del rango y los conteos de
 * válidas vs anuladas para que el caller (UI o Auros) dé contexto.
 */
export function computeTopClientesRango(
  livianas: InvoiceLiviano[],
  clientes: ClienteMin[],
  topN = 5,
): TopClientesResultado {
  const validas  = livianas.filter(i => !esAnuladaORefacturada(i.estadoBruto));
  const anuladas = livianas.filter(i =>  esAnuladaORefacturada(i.estadoBruto));
  const totalFacturadoRango = validas.reduce((s, i) => s + i.total, 0);

  const byId = new Map<string, { monto: number; n: number }>();
  for (const i of validas) {
    const k = i.custId || '__sin_cliente__';
    const b = byId.get(k) ?? { monto: 0, n: 0 };
    b.monto += i.total;
    b.n += 1;
    byId.set(k, b);
  }
  const nameById = new Map(clientes.map(c => [c.id, { name: c.name, short: c.short || c.name }]));

  const items: TopClienteItem[] = [...byId.entries()]
    .map(([custId, v]) => {
      const meta = nameById.get(custId);
      return {
        custId,
        nombre:      meta?.name  ?? custId,
        nombreCorto: meta?.short ?? meta?.name ?? custId,
        montoQ:      v.monto,
        numFacturas: v.n,
        porcentaje:  totalFacturadoRango > 0 ? (v.monto / totalFacturadoRango) * 100 : 0,
      };
    })
    .sort((a, b) => b.montoQ - a.montoQ)
    .slice(0, Math.max(1, topN));

  return {
    items,
    totalFacturadoRango,
    numFacturasValidas: validas.length,
    numAnuladas:        anuladas.length,
  };
}

/**
 * Match parcial case-insensitive de un cliente. Devuelve el id si hay
 * 1 match (exacto o parcial), o la lista de candidatos para
 * desambiguar. Quita acentos para que "genesis" matchee "GÉNESIS".
 */
export function resolverClienteAmbiguo(
  nombre: string,
  clientes: ClienteMin[],
): { id: string | null; nombreEncontrado: string | null; candidatos: Array<{ id: string; name: string }> } {
  const normalizar = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const q = normalizar(nombre);
  if (!q) return { id: null, nombreEncontrado: null, candidatos: [] };

  const exactos = clientes.filter(c =>
    normalizar(c.name) === q || normalizar(c.short ?? '') === q,
  );
  if (exactos.length === 1) {
    return { id: exactos[0].id, nombreEncontrado: exactos[0].name, candidatos: [] };
  }

  const parciales = clientes.filter(c =>
    normalizar(c.name).includes(q) || normalizar(c.short ?? '').includes(q),
  );
  if (parciales.length === 1) {
    return { id: parciales[0].id, nombreEncontrado: parciales[0].name, candidatos: [] };
  }

  return {
    id: null,
    nombreEncontrado: null,
    candidatos: parciales.slice(0, 6).map(c => ({ id: c.id, name: c.name })),
  };
}

/**
 * Resumen de facturado a un cliente específico en el rango (usa los
 * mismos filtros: excluye anuladas/refacturadas).
 */
export function resumenFacturadoCliente(
  custId: string,
  livianas: InvoiceLiviano[],
): { montoQ: number; numFacturas: number; numAnuladas: number } {
  const delCliente = livianas.filter(i => i.custId === custId);
  const validas    = delCliente.filter(i => !esAnuladaORefacturada(i.estadoBruto));
  const anuladas   = delCliente.filter(i =>  esAnuladaORefacturada(i.estadoBruto));
  return {
    montoQ:      validas.reduce((s, i) => s + i.total, 0),
    numFacturas: validas.length,
    numAnuladas: anuladas.length,
  };
}
