/**
 * DETALLE DE FACTURACIÓN (pre-liquidación) — PURO (sin IO).
 * Estados: borrador → enviada → aprobada → facturada; anulada libera los expedientes.
 * El documento imprimible se arma desde los expedientes del detalle: una línea por
 * proceso (un COMPLETO muestra sus componentes), monto sin IVA; lo que no tenga
 * precio o haya dejado de ser facturable NO rompe el documento: se marca como
 * "no incluido" y el total refleja solo lo incluido.
 */
import { dimTexto, precioConIva, round2, totalesFel } from '@/lib/tarifario/canon';
import type { ExpedienteLocal, PruebaLocal } from './tipos';
import { resultadoLegible } from './situacion';

export type EstadoDetalle = 'borrador' | 'enviada' | 'con_observaciones' | 'aprobada' | 'facturada' | 'anulada';
export type CanalAprobacion = 'correo' | 'link' | 'otro';

export const ETIQUETA_ESTADO_DETALLE: Record<EstadoDetalle, string> = {
  borrador: 'Borrador', enviada: 'Enviada al cliente', con_observaciones: 'Con observaciones del cliente', aprobada: 'Aprobada por el cliente', facturada: 'Facturada', anulada: 'Anulada',
};
export const BADGE_ESTADO_DETALLE: Record<EstadoDetalle, string> = {
  borrador: 'badge-mute', enviada: 'badge-warn', con_observaciones: 'badge-wine', aprobada: 'badge-olive', facturada: 'badge-outline', anulada: 'badge-wine',
};

const TRANSICIONES: Record<EstadoDetalle, EstadoDetalle[]> = {
  borrador: ['enviada', 'anulada'], enviada: ['aprobada', 'con_observaciones', 'anulada'], con_observaciones: ['enviada', 'anulada'], aprobada: ['facturada', 'anulada'], facturada: [], anulada: [],
};
export const transicionValida = (de: EstadoDetalle, a: EstadoDetalle): boolean => TRANSICIONES[de]?.includes(a) ?? false;

export interface DetalleFacturacion {
  id: string; fuente: string; clienteId: string | null; nit: string; correlativo: string; estado: EstadoDetalle;
  subtotal: number; iva: number; total: number; expedientes: number; /** 024: pruebas reservadas */ pruebas: number;
  creadoPor: string; createdAt: string;
  enviadaEn: string | null; enviadaPor: string;
  aprobadaEn: string | null; aprobadoPor: string; aprobadoCanal: CanalAprobacion | null;
  facturaId: string | null; facturaAppId: string | null; noFactura: string | null; facturadoEn: string | null;
  anuladaEn: string | null; anuladaPor: string; motivoAnulacion: string;
  notas: string; updatedAt: string | null;
  /** 028: título del corte (qué incluye) y a quién va dirigido del lado del cliente; opcionales. */
  titulo: string; dirigidoA: string;
  /** 029: versión enviada al cliente, destinatarios del último envío, quién respondió y la firma / huella si aprobó por link. */
  version: number; destinatarios: string[];
  respondidoEn: string | null; respondidoPorNombre: string; respondidoPorCargo: string; respondidoPorCorreo: string;
  firmaPng: string | null; documentoHash: string | null;
}

/** 029: respuesta del cliente a una línea (una por versión) y lo que Golden contestó. */
export interface RespuestaDetalle { id: string; version: number; componenteId: string; decision: 'aprobado' | 'correccion' | 'proximo_mes' | 'no_aplica'; nota: string; respuestaGolden: string; createdAt: string }
export const ETIQUETA_DECISION_DETALLE: Record<RespuestaDetalle['decision'], string> = { aprobado: 'Aprobado', correccion: 'Corrección', proximo_mes: 'Cobrar el próximo mes', no_aplica: 'No aplica' };
export const BADGE_DECISION_DETALLE: Record<RespuestaDetalle['decision'], string> = { aprobado: 'badge-olive', correccion: 'badge-wine', proximo_mes: 'badge-warn', no_aplica: 'badge-mute' };
/** Primer día del mes siguiente (YYYY-MM-DD, Guatemala) para "cobrar el próximo mes". */
export function primerDiaMesSiguiente(hoy: Date = new Date()): string {
  const gt = new Date(hoy.toLocaleString('en-US', { timeZone: 'America/Guatemala' }));
  const y = gt.getFullYear(), m = gt.getMonth() + 1;
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
/** ¿La prueba está diferida a una fecha futura (hoy < diferida_hasta)? */
export const diferidaVigente = (diferidaHasta: string | null | undefined, hoy: string): boolean => !!diferidaHasta && hoy < diferidaHasta.slice(0, 10);

export interface LineaDetalle {
  idExterno: string; /** 024: la prueba (facturacion_componente.id) */ componenteId: string; persona: string; puesto: string; fechaIngreso: string | null;
  /** 028: quién pidió la evaluación del lado del cliente, normalizado (trim + mayúsculas, como en el filtro); '' si no vino. */ solicitante: string;
  servicio: string; /** 024: resultado legible para el cliente ("Polígrafo — aprobó") */ resultado: string; /** texto auxiliar (vacío en el cobro por prueba) */ componentes: string;
  categoria: string; territorio: string; /** sin IVA (tarifa) */ monto: number; /** 030: precio con IVA de la prueba (el que va en la factura), = precioConIva(monto) */ montoConIva: number;
  incluido: boolean; motivo: string;
}

/** 030: total = Σ precio con IVA por prueba; subtotal (base) = round2(total / 1.12); iva = total − base (regla FEL). */
export interface DocumentoDetalle { lineas: LineaDetalle[]; incluidas: LineaDetalle[]; faltantes: LineaDetalle[]; subtotal: number; iva: number; total: number }

/**
 * Arma el documento (024): UNA LÍNEA POR PRUEBA reservada en el detalle (persona + prueba + resultado).
 * Solo las pruebas con resultado cobrable y precio suman; las demás quedan marcadas con el motivo.
 * `pruebas` = las reservadas en el detalle; `expedientes` da persona / puesto / fecha.
 */
/** Orden del documento (pedido del CFO): fecha de ingreso, luego persona, luego prueba (polígrafo antes que socio). Sin fecha, al final. La huella no depende del orden. */
export function ordenLineas(a: { fechaIngreso: string | null; persona: string; servicio: string }, b: { fechaIngreso: string | null; persona: string; servicio: string }): number {
  const fa = a.fechaIngreso ?? '9999', fb = b.fechaIngreso ?? '9999';
  return fa.localeCompare(fb) || a.persona.localeCompare(b.persona, 'es') || a.servicio.localeCompare(b.servicio, 'es');
}

export function documentoDetalle(expedientes: readonly ExpedienteLocal[], pruebas: readonly PruebaLocal[]): DocumentoDetalle {
  const porId = new Map(expedientes.map(e => [e.idExterno, e]));
  const lineas: LineaDetalle[] = pruebas.map(p => {
    const e = porId.get(p.idExterno);
    const incluido = p.situacion === 'cobra' && p.estadoTarifa === 'resuelta' && (p.montoCalculado ?? 0) > 0 && !!e && !e.eliminado;
    const motivo = incluido ? '' : !e || e.eliminado ? 'eliminado en la Agenda' : p.situacion === 'no_cobra' ? `no se cobra (${p.motivo || 'cerrado'})` : p.situacion === 'pendiente' ? `sin resultado todavía (${p.estadoPrueba || 'pendiente'})` : p.estadoTarifa === 'sin_tarifa' ? 'sin tarifa' : p.estadoTarifa === 'cliente_sin_mapear' ? 'cliente sin mapear' : p.estadoTarifa.startsWith('excluido') ? 'no se factura por este flujo' : 'sin precio';
    return {
      idExterno: p.idExterno, componenteId: p.id, persona: e?.persona || p.idExterno, puesto: e?.puesto ?? '', fechaIngreso: e?.fechaIngreso ?? null, solicitante: String(e?.solicitante ?? '').replace(/\s+/g, ' ').trim().toUpperCase(),
      servicio: p.servicio, resultado: resultadoLegible(p.servicio, p.estadoPrueba), componentes: '',
      categoria: dimTexto(p.categoria), territorio: dimTexto(p.territorio), monto: incluido ? round2(p.montoCalculado ?? 0) : 0, montoConIva: incluido ? precioConIva(p.montoCalculado ?? 0) : 0, incluido, motivo,
    };
  });
  lineas.sort(ordenLineas);
  const incluidas = lineas.filter(l => l.incluido), faltantes = lineas.filter(l => !l.incluido);
  // 030: como la FEL: suma de precios con IVA, base por división, IVA por resta
  const { base: subtotal, iva, total } = totalesFel(incluidas.map(l => l.monto));
  return { lineas, incluidas, faltantes, subtotal, iva, total };
}
