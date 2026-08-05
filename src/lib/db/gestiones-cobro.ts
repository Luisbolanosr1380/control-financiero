// ============================================================
// F-COBRANZA: Bitácora de gestión de cobro (reemplaza el Excel).
//
// Cada contacto de cobranza queda registrado: quién llamó, cuándo,
// por qué canal, con quién habló, qué dijo el cliente y qué fecha
// de pago prometió. La gestión es POR CLIENTE; la tabla puente
// gestion_facturas referencia facturas específicas con promesa
// propia opcional ("la 1053 el 15, la 1067 el 20").
//
// Tabla NUEVA (supabase/05_cobranza.sql) — nunca existió en
// Airtable, así que no hay rama legacy. Gate: writeSource('cobranza')
// para escribir, dataSource('gestiones_cobro') para leer.
// ============================================================

import { dataSource, writeSource } from '../config/data-source';
import { fetchAll, supabase } from '../supabase/client';
import { insertar, uuidRequerido } from '../supabase/writes';

export const CANALES_GESTION = ['Llamada', 'WhatsApp', 'Email', 'Visita', 'Otro'] as const;
export type CanalGestion = (typeof CANALES_GESTION)[number];

export interface GestionCobro {
  id: string;                     // id de app ('sbw…')
  custId: string;                 // id de app del cliente (rec…/sbw…)
  fechaGestion: string;           // YYYY-MM-DD
  usuario: string;
  canal: CanalGestion;
  contactoCliente?: string;
  comentario: string;
  fechaPagoPromesa?: string;      // YYYY-MM-DD
  proximoSeguimiento?: string;    // YYYY-MM-DD
  facturas: Array<{ facturaId: string; noFactura: string; fechaPromesa?: string }>;
  createdAt: string;              // ISO
}

export interface CrearGestionCobroInput {
  custId: string;                 // id de app del cliente
  usuario: string;                // email del logueado (lo pone la action)
  canal: CanalGestion;
  contactoCliente?: string;
  comentario: string;
  fechaGestion?: string;          // default hoy (server)
  fechaPagoPromesa?: string;
  proximoSeguimiento?: string;
  facturas?: Array<{ facturaId: string; fechaPromesa?: string }>;  // ids de app
}

export type CrearGestionCobroResult =
  | { ok: true; gestionId: string; mensaje: string }
  | { ok: false; error: string };

/** Resumen por cliente/factura para las columnas del tablero de pendientes. */
export interface ResumenGestiones {
  porCliente: Record<string, {
    ultimaGestion: string;          // YYYY-MM-DD del último contacto
    diasDesdeUltima: number;
    numGestiones: number;
    fechaPagoPromesa?: string;      // promesa de la gestión más reciente que tenga una
    promesaVencida: boolean;
    proximoSeguimiento?: string;
  }>;
  /** Promesa específica por factura (id de app) — pisa a la del cliente en la fila. */
  porFactura: Record<string, { fechaPromesa: string; promesaVencida: boolean }>;
}

interface RowGestion {
  id: string;
  airtable_id: string;
  fecha_gestion: string;
  usuario: string;
  canal: string;
  contacto_cliente: string | null;
  comentario: string;
  fecha_pago_promesa: string | null;
  proximo_seguimiento: string | null;
  created_at: string;
  cliente: { airtable_id: string } | null;
  facturas: Array<{
    fecha_pago_promesa_factura: string | null;
    factura: { airtable_id: string; no_factura: string | null } | null;
  }>;
}

const SELECT_GESTION =
  '*, cliente:clientes(airtable_id), ' +
  'facturas:gestion_facturas(fecha_pago_promesa_factura, factura:facturas_clientes(airtable_id, no_factura))';

function rowToGestion(r: RowGestion): GestionCobro {
  return {
    id: r.airtable_id,
    custId: r.cliente?.airtable_id ?? '',
    fechaGestion: r.fecha_gestion,
    usuario: r.usuario,
    canal: (CANALES_GESTION as readonly string[]).includes(r.canal) ? r.canal as CanalGestion : 'Otro',
    contactoCliente: r.contacto_cliente ?? undefined,
    comentario: r.comentario,
    fechaPagoPromesa: r.fecha_pago_promesa ?? undefined,
    proximoSeguimiento: r.proximo_seguimiento ?? undefined,
    facturas: (r.facturas ?? [])
      .filter(f => f.factura)
      .map(f => ({
        facturaId: f.factura!.airtable_id,
        noFactura: f.factura!.no_factura ?? f.factura!.airtable_id,
        fechaPromesa: f.fecha_pago_promesa_factura ?? undefined,
      })),
    createdAt: r.created_at,
  };
}

function hoyISO(): string {
  // Fecha Guatemala (UTC-6) — misma convención que el resto del sistema.
  return new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
}

export async function crearGestionCobro(input: CrearGestionCobroInput): Promise<CrearGestionCobroResult> {
  if (writeSource('cobranza') !== 'supabase') {
    return { ok: false, error: 'La bitácora de cobranza requiere el backend Supabase.' };
  }
  const comentario = (input.comentario ?? '').trim();
  if (!comentario)          return { ok: false, error: 'El comentario es requerido — es el corazón de la bitácora.' };
  if (!input.custId)        return { ok: false, error: 'Cliente requerido.' };
  if (!input.usuario)       return { ok: false, error: 'Usuario requerido.' };
  if (!(CANALES_GESTION as readonly string[]).includes(input.canal)) {
    return { ok: false, error: `Canal inválido: "${input.canal}".` };
  }

  try {
    const clienteUuid = await uuidRequerido('clientes', input.custId, 'crearGestionCobro.cliente');
    const res = await insertar('gestiones_cobro', {
      cliente_id: clienteUuid,
      fecha_gestion: input.fechaGestion || hoyISO(),
      usuario: input.usuario.toLowerCase().trim(),
      canal: input.canal,
      contacto_cliente: input.contactoCliente?.trim() || null,
      comentario,
      fecha_pago_promesa: input.fechaPagoPromesa || null,
      proximo_seguimiento: input.proximoSeguimiento || null,
    });

    if (input.facturas?.length) {
      const sb = supabase();
      if (!sb) throw new Error('Supabase no está configurado.');
      const puentes = [];
      for (const f of input.facturas) {
        puentes.push({
          gestion_id: res.id,
          factura_id: await uuidRequerido('facturas_clientes', f.facturaId, 'crearGestionCobro.factura'),
          fecha_pago_promesa_factura: f.fechaPromesa || null,
        });
      }
      const { error } = await sb.from('gestion_facturas').insert(puentes);
      if (error) throw new Error(`gestion_facturas: ${error.message}`);
    }
    return { ok: true, gestionId: res.airtable_id, mensaje: 'Gestión registrada.' };
  } catch (err) {
    return { ok: false, error: `No se pudo registrar la gestión: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Histórico completo de un cliente, más reciente arriba. */
export async function getGestionesCliente(custId: string): Promise<GestionCobro[]> {
  if (dataSource('gestiones_cobro') !== 'supabase') return [];
  try {
    const sb = supabase();
    if (!sb) return [];
    const clienteUuid = await uuidRequerido('clientes', custId, 'getGestionesCliente');
    const { data, error } = await sb.from('gestiones_cobro')
      .select(SELECT_GESTION)
      .eq('cliente_id', clienteUuid)
      .order('fecha_gestion', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as RowGestion[]).map(rowToGestion);
  } catch (err) {
    console.error('Error leyendo gestiones del cliente:', err);
    return [];
  }
}

/** Todas las gestiones (para la tool de Auros y el resumen del tablero). */
export async function getGestionesCobro(): Promise<GestionCobro[]> {
  if (dataSource('gestiones_cobro') !== 'supabase') return [];
  try {
    const rows = await fetchAll<RowGestion>('gestiones_cobro', { select: SELECT_GESTION });
    return rows.map(rowToGestion)
      .sort((a, b) => b.fechaGestion.localeCompare(a.fechaGestion) || b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    console.error('Error leyendo gestiones de cobro:', err);
    return [];
  }
}

/** Resumen por cliente y por factura para las columnas de /facturacion/pendientes. */
export async function getResumenGestiones(): Promise<ResumenGestiones> {
  const gestiones = await getGestionesCobro();   // ya viene más reciente primero
  const hoy = hoyISO();
  const porCliente: ResumenGestiones['porCliente'] = {};
  const porFactura: ResumenGestiones['porFactura'] = {};

  for (const g of gestiones) {
    if (g.custId) {
      const agg = porCliente[g.custId];
      if (!agg) {
        porCliente[g.custId] = {
          ultimaGestion: g.fechaGestion,
          diasDesdeUltima: Math.max(0, Math.round((new Date(`${hoy}T00:00:00`).getTime() - new Date(`${g.fechaGestion}T00:00:00`).getTime()) / 86_400_000)),
          numGestiones: 1,
          fechaPagoPromesa: g.fechaPagoPromesa,
          promesaVencida: !!g.fechaPagoPromesa && g.fechaPagoPromesa < hoy,
          proximoSeguimiento: g.proximoSeguimiento,
        };
      } else {
        agg.numGestiones++;
        // La promesa vigente es la de la gestión MÁS RECIENTE que tenga una.
        if (!agg.fechaPagoPromesa && g.fechaPagoPromesa) {
          agg.fechaPagoPromesa = g.fechaPagoPromesa;
          agg.promesaVencida = g.fechaPagoPromesa < hoy;
        }
        if (!agg.proximoSeguimiento && g.proximoSeguimiento) agg.proximoSeguimiento = g.proximoSeguimiento;
      }
    }
    for (const f of g.facturas) {
      const promesa = f.fechaPromesa ?? g.fechaPagoPromesa;
      if (promesa && !porFactura[f.facturaId]) {
        porFactura[f.facturaId] = { fechaPromesa: promesa, promesaVencida: promesa < hoy };
      }
    }
  }
  return { porCliente, porFactura };
}
