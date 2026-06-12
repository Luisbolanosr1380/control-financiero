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
 * F-BF-002d: monto atribuible al filtro de centros de costo. Sin
 * filtro, devuelve el TOTAL completo. Con filtro, suma solo las
 * porciones de la factura cuyo CC esté en el set.
 *
 * Una factura puede tener líneas en varios CCs (multi-servicio): si
 * filtramos por Polígrafos, solo entra el monto polígrafos, NO el
 * total de la factura.
 */
function montoSegunFiltro(i: InvoiceLiviano, ccSet: Set<string> | null): number {
  if (!ccSet) return i.total;
  let s = 0;
  for (const [cc, m] of Object.entries(i.montoPorCC)) {
    if (ccSet.has(cc)) s += m;
  }
  return s;
}

/**
 * Calcula top N clientes a partir de las livianas ya filtradas al rango
 * deseado. Devuelve también el total del rango y los conteos de
 * válidas vs anuladas para que el caller (UI o Auros) dé contexto.
 *
 * F-BF-002d: `centroCostoIds` opcional — si viene, las facturas se
 * agregan solo por su porción correspondiente a esos CCs. Facturas
 * cuya porción filtrada sea 0 quedan fuera del cálculo (y de
 * numFacturasValidas). Las anuladas/refacturadas se cuentan en
 * numAnuladas si tienen al menos $1 atribuible al filtro.
 */
export function computeTopClientesRango(
  livianas: InvoiceLiviano[],
  clientes: ClienteMin[],
  topN = 5,
  centroCostoIds?: readonly string[],
): TopClientesResultado {
  const ccSet = centroCostoIds && centroCostoIds.length > 0 ? new Set(centroCostoIds) : null;

  const validasConMonto = livianas
    .filter(i => !esAnuladaORefacturada(i.estadoBruto))
    .map(i => ({ i, monto: montoSegunFiltro(i, ccSet) }))
    .filter(x => x.monto > 0);

  const anuladasConMonto = livianas
    .filter(i =>  esAnuladaORefacturada(i.estadoBruto))
    .map(i => ({ i, monto: montoSegunFiltro(i, ccSet) }))
    .filter(x => x.monto > 0);

  const totalFacturadoRango = validasConMonto.reduce((s, x) => s + x.monto, 0);

  const byId = new Map<string, { monto: number; n: number }>();
  for (const { i, monto } of validasConMonto) {
    const k = i.custId || '__sin_cliente__';
    const b = byId.get(k) ?? { monto: 0, n: 0 };
    b.monto += monto;
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
    numFacturasValidas: validasConMonto.length,
    numAnuladas:        anuladasConMonto.length,
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
 *
 * F-BF-002d: si `centroCostoIds` viene, suma solo la porción
 * atribuible a esos CCs (consistente con computeTopClientesRango).
 */
export function resumenFacturadoCliente(
  custId: string,
  livianas: InvoiceLiviano[],
  centroCostoIds?: readonly string[],
): { montoQ: number; numFacturas: number; numAnuladas: number } {
  const ccSet = centroCostoIds && centroCostoIds.length > 0 ? new Set(centroCostoIds) : null;
  const delCliente = livianas.filter(i => i.custId === custId);

  const validas = delCliente
    .filter(i => !esAnuladaORefacturada(i.estadoBruto))
    .map(i => montoSegunFiltro(i, ccSet))
    .filter(m => m > 0);
  const anuladas = delCliente
    .filter(i =>  esAnuladaORefacturada(i.estadoBruto))
    .map(i => montoSegunFiltro(i, ccSet))
    .filter(m => m > 0);

  return {
    montoQ:      validas.reduce((s, m) => s + m, 0),
    numFacturas: validas.length,
    numAnuladas: anuladas.length,
  };
}

/* =========================================================================
 * F-BF-002d — Resolución de "líneas de negocio" → centros de costo IDs.
 * Match parcial case-insensitive sin acentos:
 *  "poligrafos"        → "Poligrafia"
 *  "socioeconomicos"   → "Socioeconomicos"
 *  "talenttrack" / "tt"→ "TalentTrackAI"
 *  "ventas"            → si existe un CC con "ventas" en el nombre
 *
 * Devolvemos los IDs resueltos + los nombres no encontrados (para que
 * Auros pueda desambiguar mostrando los disponibles).
 * ========================================================================= */

interface CentroCostoMin {
  id: string;
  nombre: string;
  activo?: boolean;
}

export interface LineasResueltas {
  /** Por cada input del usuario, el resultado: matched (1 CC ganador) o lista de candidatos. */
  porInput: Array<
    | { input: string; ok: true;  centroCostoId: string; centroCostoNombre: string; candidatos?: never }
    | { input: string; ok: false; centroCostoId?: never; centroCostoNombre?: never; candidatos: Array<{ id: string; nombre: string }> }
  >;
  /** Set de IDs efectivos (los matched). Si ninguno matcheó, vacío. */
  centroCostoIds: string[];
  /** Lista de centros activos para mostrar al usuario si hubo no-matched. */
  disponibles: Array<{ id: string; nombre: string }>;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function resolverLineasNegocio(
  inputs: readonly string[],
  centros: readonly CentroCostoMin[],
): LineasResueltas {
  const activos = centros.filter(c => c.activo !== false);
  const porNombre = activos.map(c => ({ id: c.id, nombre: c.nombre, norm: normalizar(c.nombre) }));

  const porInput: LineasResueltas['porInput'] = [];
  const ids = new Set<string>();

  for (const raw of inputs) {
    const q = normalizar(raw);
    if (!q) continue;

    // Exacto > startsWith > includes. También cubre el alias "tt" → talenttrack.
    const exactos    = porNombre.filter(c => c.norm === q);
    const startsWith = porNombre.filter(c => c.norm.startsWith(q));
    const includes   = porNombre.filter(c => c.norm.includes(q) || q.includes(c.norm));

    const ganador = exactos[0] ?? (startsWith.length === 1 ? startsWith[0] : undefined)
                              ?? (includes.length   === 1 ? includes[0]   : undefined);

    if (ganador) {
      porInput.push({ input: raw, ok: true, centroCostoId: ganador.id, centroCostoNombre: ganador.nombre });
      ids.add(ganador.id);
    } else {
      const candidatos = (startsWith.length ? startsWith : includes).slice(0, 6)
        .map(c => ({ id: c.id, nombre: c.nombre }));
      porInput.push({ input: raw, ok: false, candidatos });
    }
  }

  return {
    porInput,
    centroCostoIds: [...ids],
    disponibles: activos.map(c => ({ id: c.id, nombre: c.nombre })),
  };
}
