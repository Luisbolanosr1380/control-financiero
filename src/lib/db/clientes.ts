import { airtable, USE_MOCK, TABLES } from './airtable';
import { dataSource, writeSource } from '../config/data-source';
import { sbClientesRecords } from '../supabase/records';
import { insertar, actualizarPorAppId, rpc } from '../supabase/writes';
import { CUSTOMERS } from '../mock-data';
import type { Customer } from '../types';
import type { FieldSet } from 'airtable';
import { buscarNitDuplicado, nitComparable, nitEsPlaceholder, AVISO_NIT } from '../clientes/nit';
import { limpiarAliases } from '../clientes/buscar';
import { nitNuevoAceptable, resumenMovidas, type CambioNitResult, type CodigoCambioNit, type MovidasNit, type ObjetivoNit } from '../clientes/cambiar-nit';
export { resumenMovidas, type CambioNitOk, type CambioNitError, type CambioNitResult, type ChoqueTarifa, type CodigoCambioNit, type MovidasNit, type ObjetivoNit } from '../clientes/cambiar-nit';

// Campos reales de la tabla CLIENTES en Airtable
const FC = {
  NOMBRE:       'Nombre de la Empresa',
  RAZON_SOCIAL: 'Razón social',
  NIT:          'NIt',
  EMAIL:        'Email cobros',
  DIAS_CREDITO: 'Dias Credito',
  CONTEXTO:     'Contexto_Comercial',
  ACTIVO:       'Activo',
  // 020 (solo Supabase; en Airtable nunca existieron)
  NOMBRE_COMERCIAL: 'Nombre comercial',
  ALIASES:          'Aliases',
} as const;

function recordToCustomer(record: { id: string; fields: FieldSet }): Customer {
  const f = record.fields;
  const nombre = String(f[FC.NOMBRE] ?? f[FC.RAZON_SOCIAL] ?? '').trim();
  const contexto = String(f[FC.CONTEXTO] ?? '').trim();
  const razonSocial = String(f[FC.RAZON_SOCIAL] ?? '').trim();
  const nombreComercial = String(f[FC.NOMBRE_COMERCIAL] ?? '').trim();
  const aliasesRaw = f[FC.ALIASES];
  const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.map(a => String(a ?? '').trim()).filter(Boolean) : [];
  return {
    id:           record.id,
    name:         nombre,
    short:        nombre,
    nit:          String(f[FC.NIT] ?? ''),
    contact:      '',
    email:        String(f[FC.EMAIL] ?? ''),
    phone:        '',
    credit:       Number(f[FC.DIAS_CREDITO] ?? 0),
    totalBalance: 0,
    vencido:      0,
    avgPayDays:   0,
    onTimeRate:   0,
    contextoComercial: contexto || undefined,
    activo:       typeof f[FC.ACTIVO] === 'boolean' ? Boolean(f[FC.ACTIVO]) : undefined,
    razonSocial:  razonSocial || undefined,
    nombreComercial: nombreComercial || undefined,
    aliases:      aliases.length ? aliases : undefined,
  };
}

export async function getClientes(): Promise<Customer[]> {
  if (dataSource('clientes') === 'supabase') {
    try {
      const records = await sbClientesRecords();
      return records.map(r => recordToCustomer({ id: r.id, fields: r.fields as FieldSet }));
    } catch (err) {
      console.error('Error fetching clientes (supabase):', err);
      return CUSTOMERS;
    }
  }
  if (USE_MOCK || !airtable) return CUSTOMERS;

  try {
    // F-034: sin maxRecords — `.all()` agota todas las páginas.
    const records = await airtable(TABLES.CLIENTES)
      .select()
      .all();
    return records.map(r => recordToCustomer({ id: r.id, fields: r.fields }));
  } catch (err) {
    console.error('Error fetching clientes:', err);
    return CUSTOMERS;
  }
}

export async function getCliente(id: string): Promise<Customer | null> {
  const clientes = await getClientes();
  return clientes.find(c => c.id === id) ?? null;
}

// ============================================================
// FIX-CLIENTES-ALTA: crear cliente desde la app.
// El alta NUNCA existió acá — se hacía a mano en la interfaz de
// Airtable. Por eso no hay rama legacy: escribe SOLO a Supabase,
// gateado por la operación 'facturacion' (dueña del cliente: si
// facturación rollbackea a Airtable, el alta se bloquea para no
// crear clientes invisibles al backend que emite la factura).
// ============================================================

export interface CrearClienteInput {
  nombreEmpresa: string;            // requerido
  razonSocial?: string;             // la que va en la factura
  nit?: string;                     // formato Guatemala o 'CF'
  cuentaCxc?: string;               // default '1-1-3-1' (los 316 existentes)
  emailCobros?: string;
  correoCobro?: string;             // email secundario
  whatsappCobros?: string;
  diasCredito?: number;             // default 30
  periodicidadFactura?: string;     // ej. "25 de cada mes"
  fechaFacturacion?: number;        // día del mes (1-31)
  instruccionesCobro?: string;
  contextoComercial?: string;
  activo?: boolean;                 // default true
  /** 020: marca / nombre comercial (opcional; solo para ubicarlo). */
  nombreComercial?: string;
  /** 020: otros nombres / marcas (opcional). */
  aliases?: string[];
  /** AVISO-NIT: el usuario ya vio el aviso de NIT repetido y quiere crear igual. */
  confirmarNitDuplicado?: boolean;
}

export interface NitDuplicado { clienteId: string; nombre: string }

export type CrearClienteResult =
  | { ok: true; clienteId: string; mensaje: string }
  | { ok: false; error: string; /** presente cuando solo falta la confirmación del NIT repetido */ nitDuplicado?: NitDuplicado };

/**
 * AVISO-NIT: otro cliente ACTIVO con el mismo NIT (solo dígitos/letras,
 * mayúsculas). Vacío, "0" y "CF" nunca avisan. `excluirId` = el cliente que
 * se está editando.
 */
export async function verificarNitCliente(nit: string, excluirId?: string): Promise<NitDuplicado | null> {
  const dup = buscarNitDuplicado(nit, await getClientes(), excluirId);
  return dup ? { clienteId: dup.id, nombre: dup.name } : null;
}

const normClienteTxt = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** NIT sin espacios/guiones, mayúscula (el dígito verificador puede ser K). */
const normNit = (s: string) => s.replace(/[\s-]+/g, '').toUpperCase();

/** NIT guatemalteco: dígitos + verificador (número o K), o 'CF' consumidor final. */
export function nitValido(nit: string): boolean {
  const n = normNit(nit);
  return n === 'CF' || /^\d{2,12}[0-9K]$/.test(n);
}

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

export async function crearCliente(input: CrearClienteInput): Promise<CrearClienteResult> {
  if (writeSource('facturacion') !== 'supabase') {
    return { ok: false, error: 'El alta de clientes requiere el backend Supabase (facturación está en rollback).' };
  }

  const nombre = (input.nombreEmpresa ?? '').trim();
  if (!nombre) return { ok: false, error: 'El nombre de la empresa es requerido.' };

  const nit = input.nit?.trim() || '';
  if (nit && !nitValido(nit)) {
    return { ok: false, error: `NIT "${nit}" no parece un NIT de Guatemala (dígitos + verificador, ej. 1234567-8) ni 'CF'.` };
  }
  for (const [campo, valor] of [['Email cobros', input.emailCobros], ['Correo cobro', input.correoCobro]] as const) {
    if (valor?.trim() && !emailValido(valor)) return { ok: false, error: `${campo}: "${valor.trim()}" no es un email válido.` };
  }
  if (input.fechaFacturacion !== undefined && (input.fechaFacturacion < 1 || input.fechaFacturacion > 31 || !Number.isInteger(input.fechaFacturacion))) {
    return { ok: false, error: 'El día de facturación debe ser un entero entre 1 y 31.' };
  }
  if (input.diasCredito !== undefined && (input.diasCredito < 0 || !Number.isInteger(input.diasCredito))) {
    return { ok: false, error: 'Los días de crédito deben ser un entero ≥ 0.' };
  }

  // Duplicados (la migración sufrió justo esto). Mismo nombre/razón social
  // (case+acento insensible): candado. Mismo NIT que otro cliente ACTIVO:
  // AVISO con confirmación (no candado: vacío, "0" y "CF" se repiten
  // legítimamente, y hay casos reales de dos clientes con un NIT).
  const existentes = await getClientes();
  const q = normClienteTxt(nombre);
  const qRazon = input.razonSocial?.trim() ? normClienteTxt(input.razonSocial) : '';
  const dupNombre = existentes.find(c => normClienteTxt(c.name) === q || (qRazon !== '' && normClienteTxt(c.name) === qRazon));
  if (dupNombre) return { ok: false, error: `Ya existe un cliente con ese nombre: "${dupNombre.name}".` };
  const dupNit = buscarNitDuplicado(nit, existentes);
  if (dupNit && !input.confirmarNitDuplicado) {
    return { ok: false, error: `${AVISO_NIT(dupNit.name)}. Confirmá para crearlo de todos modos.`, nitDuplicado: { clienteId: dupNit.id, nombre: dupNit.name } };
  }

  // 020: nombre comercial + aliases. Solo se mandan si vienen con valor: así el alta
  // sigue funcionando en una base donde la 020 todavía no está aplicada.
  const nombreComercial = (input.nombreComercial ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const aliases = limpiarAliases(input.aliases, [nombre, input.razonSocial, nombreComercial]);
  const extra020: Record<string, unknown> = {};
  if (nombreComercial) extra020.nombre_comercial = nombreComercial;
  if (aliases.length) extra020.aliases = aliases;

  try {
    const razon = input.razonSocial?.trim() || nombre;
    const res = await insertar('clientes', {
      ...extra020,
      nombre_empresa:       nombre,
      razon_social:         razon,
      etiqueta:             razon,   // en Airtable se autollenaba = razón social
      nit:                  nit || null,
      cuenta_cxc:           input.cuentaCxc?.trim() || '1-1-3-1',
      email_cobros:         input.emailCobros?.trim() || null,
      correo_cobro:         input.correoCobro?.trim() || null,
      whatsapp_cobros:      input.whatsappCobros?.trim() || null,
      dias_credito:         input.diasCredito ?? 30,
      periodicidad_factura: input.periodicidadFactura?.trim() || null,
      fecha_facturacion:    input.fechaFacturacion ?? null,
      instrucciones_cobro:  input.instruccionesCobro?.trim() || null,
      contexto_comercial:   input.contextoComercial?.trim() || null,
      activo:               input.activo ?? true,
    });
    return { ok: true, clienteId: res.airtable_id, mensaje: `Cliente "${nombre}" creado.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (Object.keys(extra020).length && FALTA_020.test(msg)) return { ok: false, error: 'Nombre comercial / marcas requieren la migración 020 en esta base (todavía no está aplicada). Creá el cliente sin esos campos o aplicá la 020.' };
    return { ok: false, error: `No se pudo crear el cliente: ${msg}` };
  }
}

/** La columna de la 020 no existe en la base (PostgREST: "Could not find the 'aliases' column…" / 42703). */
const FALTA_020 = /nombre_comercial|aliases/i;

export interface NombresClienteInput { nombreComercial?: string; aliases?: string[] }
export type NombresClienteResult = { ok: true; nombreComercial: string; aliases: string[]; mensaje: string } | { ok: false; error: string };

/**
 * 020: edita el nombre comercial y los otros nombres / marcas de un cliente existente.
 * No toca el nombre ni la razón social (la que va en la factura). Solo Supabase, mismo
 * gate que el alta.
 */
export async function actualizarNombresCliente(clienteId: string, input: NombresClienteInput): Promise<NombresClienteResult> {
  if (writeSource('facturacion') !== 'supabase') {
    return { ok: false, error: 'Editar clientes requiere el backend Supabase (facturación está en rollback).' };
  }
  const cliente = await getCliente(clienteId);
  if (!cliente) return { ok: false, error: 'El cliente no existe.' };
  const nombreComercial = (input.nombreComercial ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const aliases = limpiarAliases(input.aliases, [cliente.name, cliente.razonSocial, nombreComercial]);
  try {
    await actualizarPorAppId('clientes', clienteId, { nombre_comercial: nombreComercial || null, aliases });
    return { ok: true, nombreComercial, aliases, mensaje: `Nombres de "${cliente.name}" actualizados${aliases.length ? ` · ${aliases.length} marca${aliases.length === 1 ? '' : 's'}` : ''}.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (FALTA_020.test(msg)) return { ok: false, error: 'Falta aplicar la migración 020 (nombre comercial / marcas) en esta base.' };
    return { ok: false, error: `No se pudo actualizar: ${msg}` };
  }
}

// ============================================================
// 023 · CAMBIAR NIT con arrastre. El NIT es la llave de cruce entre el cliente,
// su tarifario (+ bitácora), el mapeo de la Agenda, los expedientes resueltos y
// los detalles de facturación. La RPC `cliente_cambiar_nit` lo cambia en TODO en
// una transacción, con guardas (placeholder/CF, choque de llave del tarifario
// —nunca pisa—, NIT compartido con otro cliente → confirmación explícita) y un
// modo simulación para el resumen del modal. La re-resolución de la cola la hace
// la action (reclasificar por NIT), fuera de la transacción.
// ============================================================

interface RpcMov { clientes: number; tarifario: number; tarifario_historial: number; cliente_externo: number; facturacion_expediente: number; detalle_facturacion: number }
interface RpcCambioNit {
  ok: boolean; codigo?: CodigoCambioNit; error?: string; simulado?: boolean; nit_viejo?: string; nit_nuevo?: string; cliente_id?: string | null; cliente_nombre?: string | null;
  compartido_con?: string | null; destino?: string | null; motivo?: string; movidas?: RpcMov; movera?: RpcMov;
  choques?: { tipo_prueba: string; categoria: string; territorio: string; monto_viejo: number | string; monto_nuevo: number | string }[];
}
const movidasDe = (m?: RpcMov): MovidasNit => ({ clientes: Number(m?.clientes ?? 0), tarifario: Number(m?.tarifario ?? 0), tarifarioHistorial: Number(m?.tarifario_historial ?? 0), clienteExterno: Number(m?.cliente_externo ?? 0), facturacionExpediente: Number(m?.facturacion_expediente ?? 0), detalleFacturacion: Number(m?.detalle_facturacion ?? 0) });

/**
 * Cambia (o simula cambiar, `simular`) el NIT en todas las tablas. Valida en la app lo
 * mismo que la RPC (placeholder, formato) para dar el mensaje sin ir a la base.
 */
export async function cambiarNitCliente(objetivo: ObjetivoNit, nitNuevo: string, actor: string, opts: { forzar?: boolean; simular?: boolean; motivo?: string } = {}): Promise<CambioNitResult> {
  if (writeSource('facturacion') !== 'supabase') return { ok: false, codigo: 'otro', error: 'Cambiar el NIT requiere el backend Supabase (facturación está en rollback).' };
  const clienteId = (objetivo.clienteId ?? '').trim();
  const nitViejo = nitComparable(objetivo.nitViejo);
  if (!clienteId && nitEsPlaceholder(nitViejo)) return { ok: false, codigo: 'nit_viejo_placeholder', error: 'Indicá el cliente o un NIT viejo real (no vacío, 0 ni CF).' };
  const nuevoTxt = (nitNuevo ?? '').trim();
  const nuevo = nitComparable(nuevoTxt);
  if (nitEsPlaceholder(nuevo)) return { ok: false, codigo: 'nit_placeholder', error: 'El NIT nuevo no puede ser vacío, 0 ni CF: tiene que identificar al cliente.' };
  if (!nitValido(nuevoTxt) && !nitNuevoAceptable(nuevo)) return { ok: false, codigo: 'nit_invalido', error: `"${nuevoTxt}" no parece un NIT de Guatemala (dígitos + verificador, ej. 1234567-8) ni 'CF'.` };
  try {
    const r = await rpc<RpcCambioNit>('cliente_cambiar_nit', {
      p_actor: actor, p_nit_nuevo: nuevoTxt, p_cliente_id: clienteId || null, p_nit_viejo: clienteId ? null : nitViejo,
      p_forzar: !!opts.forzar, p_simular: !!opts.simular, p_motivo: (opts.motivo ?? '').trim().replace(/\s+/g, ' ').slice(0, 200) || null,
    }, opts.simular ? [] : ['clientes']);
    if (!r.ok) {
      return {
        ok: false, codigo: r.codigo ?? 'otro', error: r.error ?? 'No se pudo cambiar el NIT.', nitViejo: r.nit_viejo, nitNuevo: r.nit_nuevo, compartidoCon: r.compartido_con ?? null, destino: r.destino ?? null,
        choques: r.choques?.map(c => ({ tipoPrueba: c.tipo_prueba, categoria: c.categoria, territorio: c.territorio, montoViejo: Number(c.monto_viejo), montoNuevo: Number(c.monto_nuevo) })),
        movera: r.movera ? movidasDe(r.movera) : undefined,
      };
    }
    const movidas = movidasDe(r.simulado ? r.movera : r.movidas);
    const quien = r.cliente_nombre ? `"${r.cliente_nombre}"` : `las tarifas del NIT ${r.nit_viejo}`;
    return {
      ok: true, simulado: !!r.simulado, nitViejo: r.nit_viejo ?? nitViejo, nitNuevo: r.nit_nuevo ?? nuevo, clienteId: r.cliente_id ?? null, clienteNombre: r.cliente_nombre ?? null,
      compartidoCon: r.compartido_con ?? null, destino: r.destino ?? null, movidas, motivo: r.motivo,
      mensaje: r.simulado ? `Se moverán: ${resumenMovidas(movidas)}.` : `NIT de ${quien}: ${r.nit_viejo || '(sin NIT)'} → ${r.nit_nuevo}. Movido: ${resumenMovidas(movidas)}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/could not find the function|function .*cliente_cambiar_nit.* does not exist|PGRST202/i.test(msg)) return { ok: false, codigo: 'sin_rpc', error: 'Falta aplicar la migración 023 (cliente_cambiar_nit) en esta base.' };
    return { ok: false, codigo: 'otro', error: `No se pudo cambiar el NIT: ${msg.replace(/^cliente_cambiar_nit: /, '')}` };
  }
}
