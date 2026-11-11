/**
 * IDENTIFICAR PAGO — lo que carga /cobros/identificar (servidor, SOLO LECTURA).
 *
 * Reusa las tres lecturas del #51 (facturas con cliente, cobros, NC) y su consolidación: el SALDO es el mismo de la
 * búsqueda por monto (total − cobros activos − NC activas; la retención ya registrada es un cobro activo con su monto,
 * así que ya está descontada). De los mismos cobros sale el PERFIL DE RETENCIÓN de cada cliente (tasa más frecuente
 * sobre el IVA de la línea). Nada se escribe ni se persiste.
 */
import { dataSource } from '@/lib/config/data-source';
import { estadoFacturaCanon } from '@/lib/facturacion-agenda/estado-factura';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { consolidarParaBusqueda, leerFilasBusqueda, n, type FilaCobro, type FilaFactura, type FilaNc } from './facturas-buscar';
import { perfilesRetencion, type FacturaIdentificable, type PerfilRetencion, type RegistroRetencion } from '@/lib/cobros/identificar';

export interface DatosIdentificar {
  hoy: string;
  /** facturas abiertas: vivas, no cobradas (026) y con saldo */ facturas: FacturaIdentificable[];
  /** perfil de retención por cliente (id de la app) */ perfiles: Record<string, PerfilRetencion>;
  /** cuántos cobros con retención respaldan los perfiles */ cobrosConRetencion: number;
  ms: number; error?: string;
}

/** Arma facturas abiertas + perfiles a partir de las filas crudas (puro; el validador y la medición en Golden lo usan con filas propias). */
export function datosDesdeFilas(filas: FilaFactura[], cobros: FilaCobro[], ncs: FilaNc[], hoy: string): Omit<DatosIdentificar, 'ms' | 'error'> {
  const facturas: FacturaIdentificable[] = consolidarParaBusqueda(filas, cobros, ncs, hoy)
    .filter(f => !f.cobrada && f.estado !== 'anulada' && f.estado !== 'refacturada' && f.saldo > 0.005)
    .map(f => ({
      id: f.id, noFactura: f.noFactura, clienteId: f.clienteId ?? '', cliente: f.clienteNombre || f.clienteNombres?.[0] || f.clienteId || '—', nit: f.nit,
      fechaEmision: f.fechaEmision, fechaVencimiento: f.fechaVencimiento, diasVencida: f.diasVencida,
      total: f.total, iva: f.iva, cobrado: f.cobrado, ncs: f.ncs, saldo: f.saldo, lineas: f.lineas,
      estado: f.estado === 'parcial' || f.estado === 'pendiente' || f.estado === 'emitida' ? f.estado : 'otro',
    }));
  // perfil de retención: cobros ACTIVOS con retención, unidos a su línea (IVA y subtotal de la línea, cliente de la factura)
  const linea = new Map(filas.map(f => [f.id, f]));
  const regs: RegistroRetencion[] = [];
  let cobrosConRetencion = 0;
  for (const c of cobros) {
    const retIva = n(c.monto_retencion_iva), retIsr = n(c.monto_retencion_isr);
    if (retIva <= 0.005 && retIsr <= 0.005) continue;
    if (!c.factura_id || estadoFacturaCanon(c.estado_cobro) === 'ANULADO') continue;
    const l = linea.get(c.factura_id);
    if (!l) continue;
    cobrosConRetencion++;
    const iva = n(l.iva), total = n(l.total);
    regs.push({ clienteId: l.cliente?.airtable_id ?? l.cliente_id ?? '', retIva, retIsr, ivaLinea: iva > 0 ? iva : total - total / 1.12, subtotalLinea: l.subtotal != null ? n(l.subtotal) : total - iva });
  }
  return { hoy, facturas, perfiles: perfilesRetencion(regs), cobrosConRetencion };
}

export async function getDatosIdentificar(): Promise<DatosIdentificar> {
  const hoy = obtenerFechaHoyGuatemala();
  if (dataSource('facturas_clientes') !== 'supabase') return { hoy, facturas: [], perfiles: {}, cobrosConRetencion: 0, ms: 0, error: 'Identificar pago solo está disponible con las facturas en Supabase.' };
  const t0 = Date.now();
  try {
    const { filas, cobros, ncs } = await leerFilasBusqueda();
    return { ...datosDesdeFilas(filas, cobros, ncs, hoy), ms: Date.now() - t0 };
  } catch (e) {
    console.error('getDatosIdentificar:', e instanceof Error ? e.message : String(e));
    return { hoy, facturas: [], perfiles: {}, cobrosConRetencion: 0, ms: Date.now() - t0, error: 'No se pudieron cargar las facturas abiertas: probá de nuevo.' };
  }
}
