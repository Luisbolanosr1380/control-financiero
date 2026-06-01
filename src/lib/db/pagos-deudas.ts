// ============================================================
// Registro de pagos contra deudas (F-028)
//
// La tabla PAGOS_PROVEEDORES ya existe en Airtable; los campos
// Metodo, Referencia y Comprobante se agregaron antes de esta feature.
//
// Cuenta_Banco es singleSelect (no link a BANCOS): la UI pide el `name`
// de una opción del singleSelect — Stark mantiene las opciones en
// Airtable.
//
// DECISIÓN clave: `Monto_Pago` registra SOLO el CAPITAL del pago (la
// porción que reduce el saldo). El interés, mora y comisión van en sus
// propios campos. Así el rollup `Total_Pagado` de DEUDAS suma solo
// capital y el `Saldo_Pendiente` (formula = Monto_GTQ - Total_Pagado)
// queda correcto sin tocar fórmulas de Airtable.
//
// Para que la UI muestre "Monto total del pago" como capital + intereses
// + mora + comisión, sumamos los 4 campos al leer (ver getPagosPorDeuda).
// ============================================================

import { airtable, USE_MOCK, TABLES } from './airtable';
import { getDeudaPorId, type Deuda } from './deudas';
import { getBancos, type Banco } from './bancos';

export type MetodoPagoDeuda =
  | 'Transferencia'
  | 'Cheque'
  | 'Efectivo'
  | 'Tarjeta'
  | 'Domiciliado'
  | 'Compensación';

export type MonedaPago = 'GTQ' | 'USD';

const FP = {
  DEUDA:        'Deuda',
  FECHA:        'Fecha_Pago',
  CUENTA_BANCO: 'Cuenta_Banco',
  MONEDA:       'Moneda',
  TIPO_CAMBIO:  'Tipo_Cambio',
  MONTO_PAGO:   'Monto_Pago',        // ← guarda solo CAPITAL (ver comentario arriba)
  MONTO_COMI:   'Monto_Comision',
  MONTO_MORA:   'Monto_Mora',
  MONTO_INT:    'Monto_Interes',
  METODO:       'Metodo',
  REFERENCIA:   'Referencia',
  ESTADO:       'Estado',
  NOTAS:        'Notas',
  COMPROBANTE:  'Comprobante',
} as const;

// ============================================================
// Tipos públicos
// ============================================================

export interface RegistrarPagoInput {
  deudaId: string;
  fecha: string;                    // YYYY-MM-DD
  montoTotal: number;               // capital + interés + mora + comisión
  desglose?: {
    capital: number;
    interes?: number;
    mora?: number;
    comision?: number;
  };
  metodo: MetodoPagoDeuda;
  referencia?: string;
  cuentaBancoName: string;          // name del singleSelect Cuenta_Banco
  moneda?: MonedaPago;              // default GTQ
  tipoCambio?: number;              // default 1
  notas?: string;
}

export type RegistrarPagoResult =
  | { ok: true;  pagoId: string; deudaActualizada: { saldoPendiente: number; totalPagado: number; pctAvance: number; estadoDeuda: string }; mensaje: string }
  | { ok: false; error: string };

export interface PagoDeuda {
  id: string;
  deudaId: string;
  fecha: string;
  montoTotal: number;               // capital + interés + mora + comisión (derivado al leer)
  capital: number;
  interes: number;
  mora: number;
  comision: number;
  metodo: string;
  referencia: string;
  cuentaBancoName: string;
  moneda: string;
  tipoCambio: number;
  estado: string;
  notas: string;
}

// ============================================================
// Helpers de lectura
// ============================================================

const arrFirst = (v: unknown): string => Array.isArray(v) ? String(v[0] ?? '') : '';
const selectName = (v: unknown): string => {
  if (v && typeof v === 'object' && 'name' in (v as object)) return String((v as { name: unknown }).name ?? '');
  return typeof v === 'string' ? v : '';
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => v == null ? '' : String(v);

function pagoFromRecord(r: { id: string; fields: Record<string, unknown> }): PagoDeuda {
  const f = r.fields;
  const capital  = num(f[FP.MONTO_PAGO]);
  const interes  = num(f[FP.MONTO_INT]);
  const mora     = num(f[FP.MONTO_MORA]);
  const comision = num(f[FP.MONTO_COMI]);
  return {
    id: r.id,
    deudaId: arrFirst(f[FP.DEUDA]),
    fecha: str(f[FP.FECHA]),
    montoTotal: capital + interes + mora + comision,
    capital,
    interes,
    mora,
    comision,
    metodo: selectName(f[FP.METODO]),
    referencia: str(f[FP.REFERENCIA]),
    cuentaBancoName: selectName(f[FP.CUENTA_BANCO]),
    moneda: selectName(f[FP.MONEDA]) || 'GTQ',
    tipoCambio: num(f[FP.TIPO_CAMBIO]) || 1,
    estado: selectName(f[FP.ESTADO]),
    notas: str(f[FP.NOTAS]),
  };
}

// ============================================================
// API pública
// ============================================================

/**
 * Registra un pago contra una deuda. "Todo o nada":
 *  - Si la creación del record falla → no se afecta la deuda.
 *  - Como Total_Pagado/Saldo_Pendiente/Num_Pagos/Estado_Deuda son rollups y
 *    fórmulas en DEUDAS, Airtable los recalcula automáticamente cuando se
 *    crea/borra un record en PAGOS_PROVEEDORES vinculado.
 */
export async function registrarPagoDeuda(input: RegistrarPagoInput): Promise<RegistrarPagoResult> {
  if (USE_MOCK || !airtable) return { ok: false, error: 'Airtable no está configurado.' };

  // 1) Validaciones básicas de input
  if (!input.deudaId)        return { ok: false, error: 'Deuda es requerida.' };
  if (!input.fecha)          return { ok: false, error: 'Fecha del pago es requerida.' };
  if (!input.metodo)         return { ok: false, error: 'Método de pago es requerido.' };
  if (!input.cuentaBancoName) return { ok: false, error: 'Cuenta bancaria es requerida.' };
  if (!(input.montoTotal > 0)) return { ok: false, error: 'El monto debe ser mayor a 0.' };
  if ((input.metodo === 'Transferencia' || input.metodo === 'Cheque') && !input.referencia?.trim()) {
    return { ok: false, error: `La referencia es requerida para método ${input.metodo}.` };
  }

  // 2) Cargar deuda y validar estado + saldo
  const deuda = await getDeudaPorId(input.deudaId);
  if (!deuda) return { ok: false, error: 'No se encontró la deuda.' };
  if (/liquidada/i.test(deuda.estadoDeuda)) {
    return { ok: false, error: 'La deuda ya está liquidada — no admite más pagos.' };
  }

  // 3) Desglose o modo simple (100% capital)
  let capital: number, interes: number, mora: number, comision: number;
  if (input.desglose) {
    capital  = input.desglose.capital;
    interes  = input.desglose.interes  ?? 0;
    mora     = input.desglose.mora     ?? 0;
    comision = input.desglose.comision ?? 0;
    if (capital < 0 || interes < 0 || mora < 0 || comision < 0) {
      return { ok: false, error: 'Los desgloses no pueden ser negativos.' };
    }
    const suma = capital + interes + mora + comision;
    if (Math.abs(suma - input.montoTotal) > 0.01) {
      return { ok: false, error: `El desglose suma Q${suma.toFixed(2)} pero el monto total declarado es Q${input.montoTotal.toFixed(2)}.` };
    }
  } else {
    capital = input.montoTotal;
    interes = 0; mora = 0; comision = 0;
  }

  // 4) Validar que el capital no exceda el saldo pendiente (con tolerancia)
  if (capital > deuda.saldoPendiente + 0.01) {
    return { ok: false, error: `El capital del pago (Q${capital.toFixed(2)}) excede el saldo pendiente (Q${deuda.saldoPendiente.toFixed(2)}).` };
  }

  // 5) Crear el record en PAGOS_PROVEEDORES
  const moneda     = (input.moneda ?? 'GTQ') as MonedaPago;
  const tipoCambio = input.tipoCambio ?? 1;
  try {
    // El cliente airtable acepta string | number | boolean | array — usamos un cast plano.
    type AField = string | number | boolean | string[] | undefined;
    const fields: Record<string, AField> = {
      [FP.DEUDA]:        [input.deudaId],
      [FP.FECHA]:        input.fecha,
      [FP.MONTO_PAGO]:   capital,         // ← solo CAPITAL (ver header del módulo)
      [FP.MONTO_INT]:    interes,
      [FP.MONTO_MORA]:   mora,
      [FP.MONTO_COMI]:   comision,
      [FP.METODO]:       input.metodo,
      [FP.CUENTA_BANCO]: input.cuentaBancoName,
      [FP.MONEDA]:       moneda,
      [FP.TIPO_CAMBIO]:  tipoCambio,
      [FP.ESTADO]:       'Pendiente',
    };
    if (input.referencia?.trim()) fields[FP.REFERENCIA] = input.referencia.trim();
    if (input.notas?.trim())       fields[FP.NOTAS]      = input.notas.trim();

    const created = await airtable(TABLES.PAGOS_PROVEEDORES).create(fields);

    // 6) Calcular nuevos KPIs (Airtable los recalcula solo, devolvemos cifra
    //    estimada para feedback inmediato — la página revalidará el cache).
    const nuevoSaldo  = Math.max(0, deuda.saldoPendiente - capital);
    const nuevoPagado = deuda.totalPagado + capital;
    const nuevoPct    = deuda.montoOriginal > 0 ? (nuevoPagado / deuda.montoOriginal) * 100 : 0;
    const nuevoEstado = nuevoSaldo <= 0.01 ? 'Liquidada' : deuda.estadoDeuda;

    return {
      ok: true,
      pagoId: created.id,
      deudaActualizada: {
        saldoPendiente: nuevoSaldo,
        totalPagado:    nuevoPagado,
        pctAvance:      nuevoPct,
        estadoDeuda:    nuevoEstado,
      },
      mensaje: nuevoSaldo <= 0.01
        ? `Pago de Q${capital.toFixed(2)} registrado. La deuda quedó liquidada.`
        : `Pago de Q${capital.toFixed(2)} registrado. Nuevo saldo: Q${nuevoSaldo.toFixed(2)}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error registrando pago de deuda:', msg);
    return { ok: false, error: `No se pudo registrar el pago en Airtable: ${msg}` };
  }
}

/** Borra un pago de PAGOS_PROVEEDORES. Para uso de tests / corrección. */
export async function eliminarPagoDeuda(pagoId: string): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK || !airtable) return { ok: false, error: 'Airtable no está configurado.' };
  try {
    await airtable(TABLES.PAGOS_PROVEEDORES).destroy([pagoId]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Historial de pagos de una deuda, ordenados por fecha desc.
 * Filtramos en JS porque ARRAYJOIN({Deuda}) en Airtable devuelve display
 * names (la fórmula Clave_Deuda), no record IDs — un filterByFormula con
 * FIND no encuentra nada (verificado en smoke).
 */
export async function getPagosPorDeuda(deudaId: string): Promise<PagoDeuda[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const recs = await airtable(TABLES.PAGOS_PROVEEDORES)
      .select({ maxRecords: 5000 })
      .all();
    const pagos = recs
      .map(r => pagoFromRecord({ id: r.id, fields: r.fields as Record<string, unknown> }))
      .filter(p => p.deudaId === deudaId);
    pagos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return pagos;
  } catch (err) {
    console.error('Error fetching pagos por deuda:', err);
    return [];
  }
}

/** Consolida todos los pagos hechos a un acreedor (sumando todas sus deudas). */
export async function getPagosPorAcreedor(acreedorId: string): Promise<PagoDeuda[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    // 1) Record IDs de deudas del acreedor — filtramos en JS por la misma
    //    razón que arriba (ARRAYJOIN devuelve display names).
    const deudasRecs = await airtable(TABLES.DEUDAS)
      .select({ fields: ['Acreedor'], maxRecords: 500 })
      .all();
    const deudaIds = new Set<string>();
    for (const r of deudasRecs) {
      const a = (r.fields as Record<string, unknown>).Acreedor;
      if (Array.isArray(a) && a.includes(acreedorId)) deudaIds.add(r.id);
    }
    if (deudaIds.size === 0) return [];

    // 2) Traer todos los pagos y quedarnos con los de esas deudas
    const pagosRecs = await airtable(TABLES.PAGOS_PROVEEDORES)
      .select({ maxRecords: 5000 })
      .all();
    const pagos = pagosRecs
      .map(r => pagoFromRecord({ id: r.id, fields: r.fields as Record<string, unknown> }))
      .filter(p => deudaIds.has(p.deudaId));
    pagos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return pagos;
  } catch (err) {
    console.error('Error fetching pagos por acreedor:', err);
    return [];
  }
}

/** Últimos pagos hechos en cualquier deuda, con enriquecimiento (acreedor / deuda) para el feed. */
export interface PagoEnriquecido extends PagoDeuda {
  acreedorId: string;
  acreedorNombre: string;
  deudaNombre: string;
}

export async function getPagosRecientes(limite = 20): Promise<PagoEnriquecido[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const pagosRecs = await airtable(TABLES.PAGOS_PROVEEDORES)
      .select({ maxRecords: 5000 })
      .all();
    const pagos = pagosRecs.map(r => pagoFromRecord({ id: r.id, fields: r.fields as Record<string, unknown> }));
    pagos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const top = pagos.slice(0, limite);

    // Hidratamos las deudas y acreedores referenciados
    const deudaIds = [...new Set(top.map(p => p.deudaId).filter(Boolean))];
    const deudasById = new Map<string, Deuda>();
    await Promise.all(deudaIds.map(async id => {
      const d = await getDeudaPorId(id);
      if (d) deudasById.set(id, d);
    }));

    return top.map(p => {
      const d = deudasById.get(p.deudaId);
      return {
        ...p,
        acreedorId:     d?.acreedorId ?? '',
        acreedorNombre: d?.acreedorNombre ?? '',
        deudaNombre:    d?.nombreDeuda ?? '',
      };
    });
  } catch (err) {
    console.error('Error fetching pagos recientes:', err);
    return [];
  }
}

/**
 * Helpers de UI: las cuentas de banco que se pueden usar al registrar
 * un pago vienen del singleSelect `Cuenta_Banco` de PAGOS_PROVEEDORES.
 * Por defecto solo hay una opción (BANRURAL Cta. Monetaria); las
 * agrega Stark en Airtable. Esta función las lee del schema dinámicamente.
 */
export async function getCuentasBancoParaPago(): Promise<string[]> {
  // Para no requerir Meta API, devolvemos las opciones que existen en
  // los records (vacío si nunca hubo pagos). Esto SIEMPRE produce las
  // que Stark realmente ha usado.
  if (USE_MOCK || !airtable) return [];
  try {
    const recs = await airtable(TABLES.PAGOS_PROVEEDORES)
      .select({ fields: ['Cuenta_Banco'], maxRecords: 5000 })
      .all();
    const opts = new Set<string>();
    for (const r of recs) {
      const v = (r.fields as Record<string, unknown>).Cuenta_Banco;
      const name = selectName(v);
      if (name) opts.add(name);
    }
    return [...opts].sort();
  } catch {
    return [];
  }
}

/**
 * Conveniencia: cuentas activas de BANCOS, por si la UI quiere ofrecer
 * un sub-set rico. NOTA: el campo donde se guardará en PAGOS_PROVEEDORES
 * es un singleSelect, así que el name elegido debe coincidir EXACTO con
 * una opción válida del singleSelect. Por ahora no la usamos directamente
 * — el modal usa el set de `getCuentasBancoParaPago()` para evitar
 * desincronización.
 */
export async function getBancosActivosParaUI(): Promise<Banco[]> {
  return (await getBancos()).filter(b => b.activo);
}
