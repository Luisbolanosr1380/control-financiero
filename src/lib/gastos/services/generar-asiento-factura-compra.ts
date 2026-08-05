/**
 * F-050 — Generador de ASIENTO + PARTIDAS para una factura de compra.
 *
 * Casos contables:
 *   A · CONTADO → 3 partidas: Dr Gasto, Dr IVA (si > 0), Cr Banco.
 *   B · PLAZO   → 3 partidas: Dr Gasto, Dr IVA (si > 0), Cr CxP Proveedor
 *                  (nacional o internacional según `proveedorEsInternacional`).
 *
 * Si la partida de IVA es 0, NO se crea para no ensuciar el libro mayor.
 *
 * Balance: sum(debe) === sum(haber). Safety net al final con tolerancia
 * 0.01 (redondeo); si no balancea, ROLLBACK (eliminar ASIENTO + PARTIDAS)
 * y throw. No debería pasar si la aritmética está bien, pero la prevención
 * es barata.
 *
 * Sin transacciones reales en Airtable. El rollback se hace borrando los
 * records creados en orden inverso. Si el rollback mismo falla, el caller
 * recibe el error encadenado y debe limpiar manualmente desde Airtable.
 */

import { airtable } from '@/lib/db/airtable';
import {
  ASIENTOS_TABLE_ID,
  ASIENTOS_FIELDS,
  PARTIDAS_TABLE_ID,
  PARTIDAS_FIELDS,
  type OrigenAsiento,
} from '@/lib/airtable/asientos-fields';
import { BANCOS_TABLE_ID, BANCOS_FIELDS } from '@/lib/airtable/bancos-fields';
import { CUENTAS_SISTEMA } from '@/lib/contabilidad/cuentas-sistema';
import type { PeriodoResolucion } from './resolver-periodo-contable';

export interface GenerarAsientoInput {
  facturaIn: { recordId: string; numero: string; serie: string };
  fechaEmision: string;          // YYYY-MM-DD
  periodo: PeriodoResolucion;
  centroCostoId: string;
  proveedorId: string;
  proveedorNombre: string;
  proveedorEsInternacional: boolean;
  cuentaGastoId: string;
  baseSinIva: number;
  iva: number;
  total: number;
  moneda: 'Q' | 'USD';
  tipoCambio: number;
  metodoPago: 'Contado' | 'Plazo';
  bancoId?: string;
  descripcion: string;
}

export interface AsientoGenerado {
  asientoId: string;
  asientoRef: string;
  partidasIds: string[];
  totalDebe: number;
  totalHaber: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Correlativo FC-YYYY-MM-NNN. Race aceptable (volumen bajo); si dos
 * aprobaciones simultáneas piden el mismo correlativo, una de las dos
 * tendrá un duplicado humanamente detectable. F-050.1 puede mejorar con
 * tabla CONTROL_CORRELATIVOS si es necesario.
 */
async function siguienteAsientoRef(periodoNombre: string): Promise<string> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const prefijo = `FC-${periodoNombre}-`;
  const all = await airtable(ASIENTOS_TABLE_ID)
    .select({
      returnFieldsByFieldId: true,
      fields: [ASIENTOS_FIELDS.asiento_ref],
    })
    .all();
  let max = 0;
  for (const r of all) {
    const ref = String(r.fields[ASIENTOS_FIELDS.asiento_ref] ?? '');
    if (!ref.startsWith(prefijo)) continue;
    const sufijo = ref.slice(prefijo.length);
    const n = Number(sufijo);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefijo}${String(max + 1).padStart(3, '0')}`;
}

/**
 * Lee BANCOS.cuenta_contable (link a CUENTAS) y devuelve el primer recordId.
 *
 * F-050.2: `airtable(...).find()` NO acepta `returnFieldsByFieldId` y lee
 * por nombre de campo — entonces `fields[fldXXX]` siempre devuelve undefined.
 * Para leer por field ID usamos `.select()` + filterByFormula con `RECORD_ID()`
 * (esa función SÍ existe en la sintaxis de fórmulas, y el operando no es un
 * field reference, así que no aplica la limitación de field IDs en fórmulas).
 * También normalizamos el shape del link (string[] vs `{id}[]`).
 */
async function cuentaContableDelBanco(bancoId: string): Promise<string> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const records = await airtable(BANCOS_TABLE_ID)
    .select({
      returnFieldsByFieldId: true,
      filterByFormula: `RECORD_ID() = '${bancoId}'`,
      maxRecords: 1,
    })
    .all();
  if (records.length === 0) {
    throw new Error(`Banco ${bancoId} no encontrado.`);
  }
  const link = (records[0].fields as Record<string, unknown>)[BANCOS_FIELDS.cuenta_contable];
  let cuentaId: string | undefined;
  if (Array.isArray(link) && link.length > 0) {
    const first = link[0];
    cuentaId = typeof first === 'string'
      ? first
      : (first && typeof first === 'object' && 'id' in (first as object)
          ? String((first as { id?: unknown }).id ?? '')
          : undefined);
  }
  if (!cuentaId) {
    throw new Error(`Banco sin cuenta contable configurada. Stark debe setear CUENTA_CONTABLE en este banco antes de aprobar la factura.`);
  }
  return cuentaId;
}

interface PartidaInput {
  cuenta: string;
  centroCosto: string;
  descripcion: string;
  debe: number;
  haber: number;
  moneda: 'Q' | 'USD';
  tipoCambio: number;
  /**
   * F-050.5: PARTIDAS.periodo es singleLineText (no link). Recibe el
   * NOMBRE del período (ej "2026-06"), NO el recordId. El link al
   * período vive en ASIENTOS.PERIODO (multipleRecordLinks); en
   * PARTIDAS es un campo de texto plano para reporting rápido.
   */
  periodoNombre: string;
  proveedor?: string;
  banco?: string;
}

function fieldsPartida(asientoId: string, p: PartidaInput): Record<string, unknown> {
  type AField = string | number | string[] | undefined;
  const f: Record<string, AField> = {
    [PARTIDAS_FIELDS.asiento]:           [asientoId],
    [PARTIDAS_FIELDS.cuenta]:            [p.cuenta],
    [PARTIDAS_FIELDS.centro_costo]:      [p.centroCosto],
    [PARTIDAS_FIELDS.descripcion_linea]: p.descripcion,
    [PARTIDAS_FIELDS.debe]:              p.debe,
    [PARTIDAS_FIELDS.haber]:             p.haber,
    [PARTIDAS_FIELDS.moneda]:            p.moneda,
    [PARTIDAS_FIELDS.tc]:                p.tipoCambio,
    [PARTIDAS_FIELDS.periodo]:           p.periodoNombre,
  };
  if (p.proveedor) f[PARTIDAS_FIELDS.proveedor] = [p.proveedor];
  if (p.banco)     f[PARTIDAS_FIELDS.banco]     = [p.banco];
  return f as Record<string, unknown>;
}

export async function generarAsientoFacturaCompra(input: GenerarAsientoInput): Promise<AsientoGenerado> {
  // Defensa (auditoría Fase 3): esta es la RUTA AIRTABLE. En modo Supabase
  // la aprobación va por sbAprobarGasto — si alguien llega acá, es un bug.
  const { writeSource } = await import('@/lib/config/data-source');
  if (writeSource('gastos') === 'supabase') {
    throw new Error('generarAsientoFacturaCompra es la ruta Airtable — con WRITE_SOURCE.gastos=supabase usar sbAprobarGasto.');
  }
  if (!airtable) throw new Error('Airtable no está configurado.');

  // 1) Correlativo.
  const asientoRef = await siguienteAsientoRef(input.periodo.nombrePeriodo);
  const origen: OrigenAsiento = 'FACTURA COMPRA';

  // 2) Descripción final con nota de ajuste si aplica.
  const descripcionFinal = input.descripcion;

  // 3) Crear ASIENTO.
  type AField = string | number | string[] | undefined;
  const fieldsAsiento: Record<string, AField> = {
    [ASIENTOS_FIELDS.asiento_ref]:   asientoRef,
    [ASIENTOS_FIELDS.fecha_asiento]: input.fechaEmision,
    [ASIENTOS_FIELDS.periodo]:       [input.periodo.recordId],
    [ASIENTOS_FIELDS.origen]:        origen,
    [ASIENTOS_FIELDS.centro_costo]:  [input.centroCostoId],
    [ASIENTOS_FIELDS.proveedor]:     [input.proveedorId],
    [ASIENTOS_FIELDS.descripcion]:   descripcionFinal,
  };
  if (input.metodoPago === 'Contado' && input.bancoId) {
    fieldsAsiento[ASIENTOS_FIELDS.banco] = [input.bancoId];
  }
  const asientoCreado = (await (airtable(ASIENTOS_TABLE_ID).create as unknown as (
    records: Array<{ fields: Record<string, AField> }>,
    opts: { typecast: boolean },
  ) => Promise<Array<{ id: string }>>)([{ fields: fieldsAsiento }], { typecast: true }));
  const asientoId = asientoCreado[0].id;

  const partidasIds: string[] = [];
  const baseSinIva = round2(input.baseSinIva);
  const iva = round2(input.iva);
  const total = round2(input.total);

  try {
    const partidas: PartidaInput[] = [];

    // Partida 1: Dr Gasto.
    partidas.push({
      cuenta: input.cuentaGastoId,
      centroCosto: input.centroCostoId,
      descripcion: `Compra ${input.proveedorNombre} ${input.facturaIn.serie}-${input.facturaIn.numero}`,
      debe: baseSinIva,
      haber: 0,
      moneda: input.moneda,
      tipoCambio: input.tipoCambio,
      periodoNombre: input.periodo.nombrePeriodo,
      proveedor: input.proveedorId,
    });

    // Partida 2: Dr IVA (solo si iva > 0).
    if (iva > 0) {
      partidas.push({
        cuenta: CUENTAS_SISTEMA.IVA_CREDITO_FISCAL.recordId,
        centroCosto: input.centroCostoId,
        descripcion: `IVA crédito fiscal ${input.facturaIn.serie}-${input.facturaIn.numero}`,
        debe: iva,
        haber: 0,
        moneda: input.moneda,
        tipoCambio: input.tipoCambio,
        periodoNombre: input.periodo.nombrePeriodo,
        proveedor: input.proveedorId,
      });
    }

    // Partida 3: Cr Banco o Cr CxP.
    if (input.metodoPago === 'Contado') {
      if (!input.bancoId) throw new Error('bancoId requerido si metodoPago=Contado.');
      const cuentaBanco = await cuentaContableDelBanco(input.bancoId);
      partidas.push({
        cuenta: cuentaBanco,
        centroCosto: input.centroCostoId,
        descripcion: `Pago a ${input.proveedorNombre}`,
        debe: 0,
        haber: total,
        moneda: input.moneda,
        tipoCambio: input.tipoCambio,
        periodoNombre: input.periodo.nombrePeriodo,
        proveedor: input.proveedorId,
        banco: input.bancoId,
      });
    } else {
      const cuentaCxP = input.proveedorEsInternacional
        ? CUENTAS_SISTEMA.CXP_PROVEEDORES_INTERNACIONALES.recordId
        : CUENTAS_SISTEMA.CXP_PROVEEDORES_NACIONALES.recordId;
      partidas.push({
        cuenta: cuentaCxP,
        centroCosto: input.centroCostoId,
        descripcion: `Por pagar a ${input.proveedorNombre}`,
        debe: 0,
        haber: total,
        moneda: input.moneda,
        tipoCambio: input.tipoCambio,
        periodoNombre: input.periodo.nombrePeriodo,
        proveedor: input.proveedorId,
      });
    }

    // 4) Validar balance ANTES de crear las partidas.
    const totalDebe  = round2(partidas.reduce((s, p) => s + p.debe, 0));
    const totalHaber = round2(partidas.reduce((s, p) => s + p.haber, 0));
    if (Math.abs(totalDebe - totalHaber) > 0.01) {
      throw new Error(`Asiento NO balanceado: debe=${totalDebe} haber=${totalHaber}. Diferencia ${(totalDebe - totalHaber).toFixed(2)}.`);
    }

    // 5) Crear PARTIDAS. Airtable acepta hasta 10 por request; siempre <10
    // en este flujo (max 3 partidas).
    const payloads = partidas.map(p => ({ fields: fieldsPartida(asientoId, p) }));
    const partidasCreadas = (await (airtable(PARTIDAS_TABLE_ID).create as unknown as (
      records: Array<{ fields: Record<string, unknown> }>,
      opts: { typecast: boolean },
    ) => Promise<Array<{ id: string }>>)(payloads, { typecast: true }));
    for (const r of partidasCreadas) partidasIds.push(r.id);

    return { asientoId, asientoRef, partidasIds, totalDebe, totalHaber };
  } catch (err) {
    // ROLLBACK: borrar partidas (si alguna se creó) y el asiento.
    try {
      if (partidasIds.length > 0) await airtable(PARTIDAS_TABLE_ID).destroy(partidasIds);
    } catch (rollbackErr) {
      const msg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      throw new Error(`Error generando asiento: ${err instanceof Error ? err.message : String(err)} · Rollback parcial falló: ${msg}`);
    }
    try {
      await airtable(ASIENTOS_TABLE_ID).destroy([asientoId]);
    } catch (rollbackErr) {
      const msg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      throw new Error(`Error generando asiento: ${err instanceof Error ? err.message : String(err)} · Asiento huérfano ${asientoId} requiere limpieza manual: ${msg}`);
    }
    throw err;
  }
}
