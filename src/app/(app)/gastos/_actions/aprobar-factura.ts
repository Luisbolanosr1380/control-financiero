'use server';

/**
 * F-050 — Server action: aprobar una FACTURA_IN y crear GASTO + ASIENTO.
 *
 * Pipeline (humano-en-loop):
 *   1. Validar inputs obligatorios según método de pago.
 *   2. Cargar FACTURA_IN y validar estatus = "Pendiente".
 *   3. Resolver proveedor (buscarOCrearProveedor).
 *   4. Si Contado: confirmar BANCO con cuenta contable configurada.
 *   5. Resolver período contable (devengo).
 *   6. Generar ASIENTO + PARTIDAS (balanceado).
 *   7. Crear GASTO con todas las referencias.
 *   8. Actualizar FACTURA_IN.estatus → "Aprobada" + gasto_creado.
 *   9. (F-050.1) Si metodoPago = Contado: crear MOVIMIENTO_BANCARIO
 *      fail-soft (si falla, NO rollback — el GASTO es la fuente de verdad
 *      contable; el movimiento es solo conciliación).
 *
 * ROLLBACK: si falla GASTO o el update de FACTURA_IN, eliminamos ASIENTO
 * + PARTIDAS para no dejar contabilidad colgando sin documento fuente.
 * Tras crear el GASTO y actualizar FACTURA_IN, NO hacemos rollback de
 * fallos en MOVIMIENTOS_BANCARIOS (paso 9): logueamos warning y seguimos.
 */

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { airtable } from '@/lib/db/airtable';
import { obtenerDateTimeHoyGuatemala } from '@/lib/utils/fechas';
import {
  FACTURAS_IN_TABLE_ID,
  FACTURAS_IN_FIELDS,
} from '@/lib/airtable/facturas-in-fields';
import { GASTOS_TABLE_ID, GASTOS_FIELDS, type MetodoPagoGasto, type TipoOperativo } from '@/lib/airtable/gastos-fields';
import {
  ASIENTOS_TABLE_ID,
  PARTIDAS_TABLE_ID,
} from '@/lib/airtable/asientos-fields';
import {
  MOVIMIENTOS_BANCARIOS_TABLE_ID,
  MOVIMIENTOS_BANCARIOS_FIELDS,
} from '@/lib/airtable/movimientos-bancarios-fields';
import { buscarOCrearProveedor } from '@/lib/gastos/services/buscar-o-crear-proveedor';
import { PROVEEDORES_TABLE_ID, PROVEEDORES_FIELDS } from '@/lib/airtable/proveedores-fields';
import { findRecordById, selectValue } from '@/lib/airtable/find-by-id';
import { resolverPeriodoContable } from '@/lib/gastos/services/resolver-periodo-contable';
import { generarAsientoFacturaCompra } from '@/lib/gastos/services/generar-asiento-factura-compra';
import { composerDescripcion } from '@/lib/gastos/services/composer-descripcion';

export interface AprobarFacturaInput {
  facturaInId: string;
  proveedorId?: string;
  proveedorDatosParaCrear?: {
    nombre: string;
    nit: string;
    email?: string;
    telefono?: string;
    direccion?: string;
  };
  centroCostoId: string;
  categoriaGastoId: string;
  tipoOperativo: TipoOperativo;
  metodoPago: MetodoPagoGasto;
  bancoId?: string;
  fechaPago?: string;
  fechaVencimiento?: string;
  referenciaPago?: string;
  proveedorEsInternacional?: boolean;
  datosCorregidos?: {
    proveedorNombre?: string;
    proveedorNit?: string;
    serie?: string;
    numero?: string;
    fechaEmision?: string;
    base?: number;
    iva?: number;
    total?: number;
    moneda?: 'Q' | 'USD';
    tipoCambio?: number;
  };
}

export interface AprobarFacturaResult {
  ok: boolean;
  gastoId?: string;
  asientoId?: string;
  asientoRef?: string;
  proveedorEsNuevo?: boolean;
  periodoAjustado?: boolean;
  error?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function validarInput(input: AprobarFacturaInput): string | null {
  if (!input.facturaInId) return 'facturaInId requerido.';
  if (!input.centroCostoId) return 'Centro de costo requerido.';
  if (!input.categoriaGastoId) return 'Cuenta contable de gasto requerida.';
  if (input.tipoOperativo !== 'Operativo' && input.tipoOperativo !== 'No Operativo') {
    return 'tipoOperativo debe ser "Operativo" o "No Operativo".';
  }
  if (input.metodoPago === 'Contado') {
    if (!input.bancoId) return 'Banco requerido para método de pago Contado.';
    if (!input.fechaPago) return 'Fecha de pago requerida para método de pago Contado.';
  } else if (input.metodoPago === 'Plazo') {
    if (!input.fechaVencimiento) return 'Fecha de vencimiento requerida para método de pago Plazo.';
  } else {
    return 'metodoPago debe ser "Contado" o "Plazo".';
  }
  if (!input.proveedorId && !input.proveedorDatosParaCrear) {
    return 'Se requiere proveedorId existente o proveedorDatosParaCrear.';
  }
  return null;
}

interface FacturaInData {
  recordId: string;
  estatus: string;
  proveedorNombre: string;
  proveedorNit: string;
  serie: string;
  numero: string;
  fechaEmision: string;
  base: number;
  iva: number;
  total: number;
  moneda: 'Q' | 'USD';
}

async function leerFacturaIn(facturaInId: string): Promise<FacturaInData> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  // F-050.3: `.find()` NO acepta returnFieldsByFieldId — lee por nombre.
  // Acceder por field ID devolvía undefined → estatus="" silencioso.
  // findRecordById usa select+RECORD_ID() para leer por field ID.
  const r = await findRecordById(FACTURAS_IN_TABLE_ID, facturaInId);
  if (!r) throw new Error(`FACTURA_IN ${facturaInId} no encontrada.`);
  const f = r.fields;
  return {
    recordId: r.id,
    estatus:           selectValue(f[FACTURAS_IN_FIELDS.estatus]),
    proveedorNombre:   String(f[FACTURAS_IN_FIELDS.proveedor_nombre] ?? '').trim(),
    proveedorNit:      String(f[FACTURAS_IN_FIELDS.proveedor_nit]    ?? '').trim(),
    serie:             String(f[FACTURAS_IN_FIELDS.serie]            ?? '').trim(),
    numero:            String(f[FACTURAS_IN_FIELDS.numero]           ?? '').trim(),
    fechaEmision:      String(f[FACTURAS_IN_FIELDS.fecha_emision]    ?? '').trim(),
    base:              Number(f[FACTURAS_IN_FIELDS.subtotal]         ?? 0),
    iva:               Number(f[FACTURAS_IN_FIELDS.iva]              ?? 0),
    total:             Number(f[FACTURAS_IN_FIELDS.total]            ?? 0),
    moneda:            (selectValue(f[FACTURAS_IN_FIELDS.moneda]) || 'Q') as 'Q' | 'USD',
  };
}

export async function aprobarFacturaAction(input: AprobarFacturaInput): Promise<AprobarFacturaResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };

  // 1) Validación.
  const errorValid = validarInput(input);
  if (errorValid) return { ok: false, error: errorValid };

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'sistema';

  // 2) Cargar FACTURA_IN.
  let factura: FacturaInData;
  try {
    factura = await leerFacturaIn(input.facturaInId);
  } catch (err) {
    return { ok: false, error: `No se pudo cargar FACTURA_IN: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (factura.estatus !== 'Pendiente') {
    return { ok: false, error: `La factura está en estatus "${factura.estatus}". Solo se aprueban Pendientes.` };
  }

  // Datos finales (corregidos por el usuario o crudos del OCR).
  const datos = {
    proveedorNombre: input.datosCorregidos?.proveedorNombre ?? factura.proveedorNombre,
    proveedorNit:    input.datosCorregidos?.proveedorNit    ?? factura.proveedorNit,
    serie:           input.datosCorregidos?.serie           ?? factura.serie,
    numero:          input.datosCorregidos?.numero          ?? factura.numero,
    fechaEmision:    input.datosCorregidos?.fechaEmision    ?? factura.fechaEmision,
    base:            round2(input.datosCorregidos?.base     ?? factura.base),
    iva:             round2(input.datosCorregidos?.iva      ?? factura.iva),
    total:           round2(input.datosCorregidos?.total    ?? factura.total),
    moneda:          input.datosCorregidos?.moneda          ?? factura.moneda,
    tipoCambio:      input.datosCorregidos?.tipoCambio      ?? (factura.moneda === 'USD' ? 0 : 1),
  };
  if (datos.moneda === 'USD' && datos.tipoCambio <= 0) {
    return { ok: false, error: 'Factura en USD requiere tipoCambio > 0 en datosCorregidos.' };
  }
  if (!datos.fechaEmision) {
    return { ok: false, error: 'Fecha de emisión vacía. Corregila en el modal antes de aprobar.' };
  }
  if (!(datos.total > 0)) {
    return { ok: false, error: 'Total debe ser mayor a 0.' };
  }
  // F-050.3: defensa server-side de consistencia aritmética. El modal
  // debería auto-corregir y advertir, pero acá garantizamos que NUNCA se
  // crea un GASTO + ASIENTO con montos que no cuadran. Tolerancia 0.02
  // por redondeo.
  if (Math.abs(datos.base + datos.iva - datos.total) > 0.02) {
    return {
      ok: false,
      error: `Montos inconsistentes: base (${datos.base.toFixed(2)}) + IVA (${datos.iva.toFixed(2)}) ≠ total (${datos.total.toFixed(2)}). Corregir en el modal antes de aprobar.`,
    };
  }

  // 3) Resolver proveedor.
  let proveedor;
  try {
    if (input.proveedorId) {
      // F-050.3: leer por field ID requiere findRecordById (no .find()).
      const r = await findRecordById(PROVEEDORES_TABLE_ID, input.proveedorId);
      const nombreFromRec = r ? String(r.fields[PROVEEDORES_FIELDS.nombre] ?? '') : '';
      proveedor = {
        recordId: input.proveedorId,
        nombre: nombreFromRec || datos.proveedorNombre,
        esNuevo: false,
      };
    } else {
      const datosCrear = input.proveedorDatosParaCrear!;
      proveedor = await buscarOCrearProveedor({
        nit:                 datosCrear.nit,
        nombreSugerido:      datosCrear.nombre,
        emailSugerido:       datosCrear.email,
        telefonoSugerido:    datosCrear.telefono,
        direccionSugerida:   datosCrear.direccion,
      });
    }
  } catch (err) {
    return { ok: false, error: `Error resolviendo proveedor: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 4) (validación banco) — la lectura real está embedded en
  // generarAsientoFacturaCompra → cuentaContableDelBanco. Si Stark olvidó
  // configurar CUENTA_CONTABLE, esa función falla con mensaje claro.

  // 5) Resolver período contable.
  let periodo;
  try {
    periodo = await resolverPeriodoContable(datos.fechaEmision);
  } catch (err) {
    return { ok: false, error: `Error resolviendo período: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 6) Generar asiento.
  const descripcionAsiento = composerDescripcion({
    proveedorNombre: proveedor.nombre,
    serie: datos.serie,
    numero: datos.numero,
    fechaEmision: datos.fechaEmision,
    periodoNota: periodo.notaAjuste,
  });

  let asiento;
  try {
    asiento = await generarAsientoFacturaCompra({
      facturaIn:              { recordId: factura.recordId, numero: datos.numero, serie: datos.serie },
      fechaEmision:           datos.fechaEmision,
      periodo,
      centroCostoId:          input.centroCostoId,
      proveedorId:            proveedor.recordId,
      proveedorNombre:        proveedor.nombre,
      proveedorEsInternacional: input.proveedorEsInternacional ?? false,
      cuentaGastoId:          input.categoriaGastoId,
      baseSinIva:             datos.base,
      iva:                    datos.iva,
      total:                  datos.total,
      moneda:                 datos.moneda,
      tipoCambio:             datos.tipoCambio,
      metodoPago:             input.metodoPago,
      bancoId:                input.bancoId,
      descripcion:            descripcionAsiento,
    });
  } catch (err) {
    return { ok: false, error: `Error generando asiento: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 7) Crear GASTO.
  type AField = string | number | boolean | string[] | undefined;
  const estadoGasto = input.metodoPago === 'Contado' ? 'Pagado' : 'Por pagar';
  const fieldsGasto: Record<string, AField> = {
    [GASTOS_FIELDS.fecha]:             datos.fechaEmision,
    [GASTOS_FIELDS.proveedor]:         [proveedor.recordId],
    [GASTOS_FIELDS.categoria_gasto]:   [input.categoriaGastoId],
    [GASTOS_FIELDS.base]:              datos.base,
    [GASTOS_FIELDS.iva]:               datos.iva,
    [GASTOS_FIELDS.total]:             datos.total,
    [GASTOS_FIELDS.metodo_pago]:       input.metodoPago,
    [GASTOS_FIELDS.centro_costo]:      [input.centroCostoId],
    [GASTOS_FIELDS.estado]:            estadoGasto,
    [GASTOS_FIELDS.asiento]:           [asiento.asientoId],
    [GASTOS_FIELDS.tipo_operativo]:    input.tipoOperativo,
    [GASTOS_FIELDS.factura_in_origen]: [factura.recordId],
    [GASTOS_FIELDS.fecha_aprobacion]:  obtenerDateTimeHoyGuatemala(),
    [GASTOS_FIELDS.aprobado_por]:      email,
  };
  if (input.metodoPago === 'Contado') {
    if (input.bancoId) fieldsGasto[GASTOS_FIELDS.banco] = [input.bancoId];
    if (input.referenciaPago) fieldsGasto[GASTOS_FIELDS.referencia_pago] = input.referenciaPago.trim();
  } else {
    if (input.fechaVencimiento) fieldsGasto[GASTOS_FIELDS.fecha_vencimiento] = input.fechaVencimiento;
  }

  let gastoId: string;
  try {
    const created = (await (airtable(GASTOS_TABLE_ID).create as unknown as (
      records: Array<{ fields: Record<string, AField> }>,
      opts: { typecast: boolean },
    ) => Promise<Array<{ id: string }>>)([{ fields: fieldsGasto }], { typecast: true }));
    gastoId = created[0].id;
  } catch (err) {
    // ROLLBACK: borrar asiento + partidas (el asiento ya quedó creado en
    // generarAsientoFacturaCompra y el rollback de partidas allá fue exitoso).
    try {
      await airtable(PARTIDAS_TABLE_ID).destroy(asiento.partidasIds);
      await airtable(ASIENTOS_TABLE_ID).destroy([asiento.asientoId]);
    } catch {
      // Si el rollback falla, dejamos asiento huérfano — el error original
      // ya menciona que falló GASTO; Stark tendrá que limpiar manual.
    }
    return { ok: false, error: `Error creando GASTO (asiento ${asiento.asientoRef} revertido): ${err instanceof Error ? err.message : String(err)}` };
  }

  // 8) Actualizar FACTURA_IN.
  try {
    await airtable(FACTURAS_IN_TABLE_ID).update([{
      id: factura.recordId,
      fields: {
        [FACTURAS_IN_FIELDS.estatus]:      'Aprobada',
        [FACTURAS_IN_FIELDS.gasto_creado]: [gastoId],
      },
    }], { typecast: true });
  } catch (err) {
    // El GASTO + ASIENTO ya están persistidos. El estatus de la FACTURA_IN
    // no cambió — Stark verá la factura todavía Pendiente con el gasto ya
    // existente. Reportamos error suave para que el UI muestre warning.
    return {
      ok: true,
      gastoId,
      asientoId: asiento.asientoId,
      asientoRef: asiento.asientoRef,
      proveedorEsNuevo: proveedor.esNuevo,
      periodoAjustado: periodo.ajustado,
      error: `GASTO + ASIENTO creados, pero falló actualizar estatus de FACTURA_IN: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 9) F-050.1 — MOVIMIENTO_BANCARIO (solo si Contado). Fail-soft.
  if (input.metodoPago === 'Contado' && input.bancoId && input.fechaPago) {
    const concepto = `Pago factura ${datos.serie}-${datos.numero} a ${proveedor.nombre}`;
    try {
      await (airtable(MOVIMIENTOS_BANCARIOS_TABLE_ID).create as unknown as (
        records: Array<{ fields: Record<string, AField> }>,
        opts: { typecast: boolean },
      ) => Promise<Array<{ id: string }>>)([{
        fields: {
          [MOVIMIENTOS_BANCARIOS_FIELDS.banco]:      [input.bancoId],
          [MOVIMIENTOS_BANCARIOS_FIELDS.fecha]:      input.fechaPago,
          [MOVIMIENTOS_BANCARIOS_FIELDS.tipo]:       'Egreso',  // typecast auto-crea
          [MOVIMIENTOS_BANCARIOS_FIELDS.concepto]:   concepto,
          ...(input.referenciaPago ? { [MOVIMIENTOS_BANCARIOS_FIELDS.referencia]: input.referenciaPago } : {}),
          [MOVIMIENTOS_BANCARIOS_FIELDS.monto]:      datos.total,                 // SIEMPRE POSITIVO
          [MOVIMIENTOS_BANCARIOS_FIELDS.periodo]:    periodo.nombrePeriodo,       // string, no link
          [MOVIMIENTOS_BANCARIOS_FIELDS.conciliado]: false,
          [MOVIMIENTOS_BANCARIOS_FIELDS.asiento]:    [asiento.asientoId],
        },
      }], { typecast: true });
    } catch (err) {
      // F-050.1: si MOVIMIENTOS_BANCARIOS falla DESPUÉS de que GASTO y
      // ASIENTO ya existen, NO hacer rollback del GASTO. El GASTO es la
      // fuente de verdad contable; el movimiento bancario es solo
      // conciliación. Logueamos para diagnóstico.
      console.warn(`F-050.1: MOVIMIENTO_BANCARIO no creado para gasto ${gastoId}:`,
        err instanceof Error ? err.message : err);
    }
  }

  revalidatePath('/gastos');
  return {
    ok: true,
    gastoId,
    asientoId: asiento.asientoId,
    asientoRef: asiento.asientoRef,
    proveedorEsNuevo: proveedor.esNuevo,
    periodoAjustado: periodo.ajustado,
  };
}
