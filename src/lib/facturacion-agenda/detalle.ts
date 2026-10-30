/**
 * DETALLE DE FACTURACIÓN (pre-liquidación) — PURO (sin IO).
 * Estados: borrador → enviada → aprobada → facturada; anulada libera los expedientes.
 * El documento imprimible se arma desde los expedientes del detalle: una línea por
 * proceso (un COMPLETO muestra sus componentes), monto sin IVA; lo que no tenga
 * precio o haya dejado de ser facturable NO rompe el documento: se marca como
 * "no incluido" y el total refleja solo lo incluido.
 */
import { dimTexto, conIva, round2 } from '@/lib/tarifario/canon';
import type { ExpedienteLocal, PruebaLocal } from './tipos';
import { resultadoLegible } from './situacion';

export type EstadoDetalle = 'borrador' | 'enviada' | 'aprobada' | 'facturada' | 'anulada';
export type CanalAprobacion = 'correo' | 'link' | 'otro';

export const ETIQUETA_ESTADO_DETALLE: Record<EstadoDetalle, string> = {
  borrador: 'Borrador', enviada: 'Enviada al cliente', aprobada: 'Aprobada por el cliente', facturada: 'Facturada', anulada: 'Anulada',
};
export const BADGE_ESTADO_DETALLE: Record<EstadoDetalle, string> = {
  borrador: 'badge-mute', enviada: 'badge-warn', aprobada: 'badge-olive', facturada: 'badge-outline', anulada: 'badge-wine',
};

const TRANSICIONES: Record<EstadoDetalle, EstadoDetalle[]> = {
  borrador: ['enviada', 'anulada'], enviada: ['aprobada', 'anulada'], aprobada: ['facturada', 'anulada'], facturada: [], anulada: [],
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
}

export interface LineaDetalle {
  idExterno: string; /** 024: la prueba (facturacion_componente.id) */ componenteId: string; persona: string; puesto: string; fechaIngreso: string | null;
  servicio: string; /** 024: resultado legible para el cliente ("Polígrafo — aprobó") */ resultado: string; /** texto auxiliar (vacío en el cobro por prueba) */ componentes: string;
  categoria: string; territorio: string; monto: number;
  incluido: boolean; motivo: string;
}

export interface DocumentoDetalle { lineas: LineaDetalle[]; incluidas: LineaDetalle[]; faltantes: LineaDetalle[]; subtotal: number; iva: number; total: number }

/**
 * Arma el documento (024): UNA LÍNEA POR PRUEBA reservada en el detalle (persona + prueba + resultado).
 * Solo las pruebas con resultado cobrable y precio suman; las demás quedan marcadas con el motivo.
 * `pruebas` = las reservadas en el detalle; `expedientes` da persona / puesto / fecha.
 */
export function documentoDetalle(expedientes: readonly ExpedienteLocal[], pruebas: readonly PruebaLocal[]): DocumentoDetalle {
  const porId = new Map(expedientes.map(e => [e.idExterno, e]));
  const lineas: LineaDetalle[] = pruebas.map(p => {
    const e = porId.get(p.idExterno);
    const incluido = p.situacion === 'cobra' && p.estadoTarifa === 'resuelta' && (p.montoCalculado ?? 0) > 0 && !!e && !e.eliminado;
    const motivo = incluido ? '' : !e || e.eliminado ? 'eliminado en la Agenda' : p.situacion === 'no_cobra' ? `no se cobra (${p.motivo || 'cerrado'})` : p.situacion === 'pendiente' ? `sin resultado todavía (${p.estadoPrueba || 'pendiente'})` : p.estadoTarifa === 'sin_tarifa' ? 'sin tarifa' : p.estadoTarifa === 'cliente_sin_mapear' ? 'cliente sin mapear' : p.estadoTarifa.startsWith('excluido') ? 'no se factura por este flujo' : 'sin precio';
    return {
      idExterno: p.idExterno, componenteId: p.id, persona: e?.persona || p.idExterno, puesto: e?.puesto ?? '', fechaIngreso: e?.fechaIngreso ?? null,
      servicio: p.servicio, resultado: resultadoLegible(p.servicio, p.estadoPrueba), componentes: '',
      categoria: dimTexto(p.categoria), territorio: dimTexto(p.territorio), monto: incluido ? round2(p.montoCalculado ?? 0) : 0, incluido, motivo,
    };
  });
  const incluidas = lineas.filter(l => l.incluido), faltantes = lineas.filter(l => !l.incluido);
  const subtotal = round2(incluidas.reduce((s, l) => s + l.monto, 0));
  const { iva, total } = conIva(subtotal);
  return { lineas, incluidas, faltantes, subtotal, iva, total };
}
