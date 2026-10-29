/**
 * DETALLE DE FACTURACIÓN (pre-liquidación) — PURO (sin IO).
 * Estados: borrador → enviada → aprobada → facturada; anulada libera los expedientes.
 * El documento imprimible se arma desde los expedientes del detalle: una línea por
 * proceso (un COMPLETO muestra sus componentes), monto sin IVA; lo que no tenga
 * precio o haya dejado de ser facturable NO rompe el documento: se marca como
 * "no incluido" y el total refleja solo lo incluido.
 */
import { dimTexto, conIva, round2 } from '@/lib/tarifario/canon';
import type { ExpedienteLocal } from './tipos';

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
  subtotal: number; iva: number; total: number; expedientes: number;
  creadoPor: string; createdAt: string;
  enviadaEn: string | null; enviadaPor: string;
  aprobadaEn: string | null; aprobadoPor: string; aprobadoCanal: CanalAprobacion | null;
  facturaId: string | null; facturaAppId: string | null; noFactura: string | null; facturadoEn: string | null;
  anuladaEn: string | null; anuladaPor: string; motivoAnulacion: string;
  notas: string; updatedAt: string | null;
}

export interface LineaDetalle {
  idExterno: string; persona: string; puesto: string; fechaIngreso: string | null;
  servicio: string; /** texto de los componentes (COMPLETO = polígrafo + socio) */ componentes: string;
  categoria: string; territorio: string; monto: number;
  incluido: boolean; motivo: string;
}

export interface DocumentoDetalle { lineas: LineaDetalle[]; incluidas: LineaDetalle[]; faltantes: LineaDetalle[]; subtotal: number; iva: number; total: number }

/** Arma el documento: solo las resueltas con precio suman; las demás quedan marcadas. */
export function documentoDetalle(expedientes: readonly ExpedienteLocal[]): DocumentoDetalle {
  const lineas: LineaDetalle[] = expedientes.map(e => {
    const partes = e.componentes.length ? e.componentes : [];
    const incluido = e.estadoTarifa === 'resuelta' && (e.montoCalculado ?? 0) > 0 && !e.eliminado && !e.cancelado;
    const motivo = incluido ? '' : e.eliminado ? 'eliminado en la Agenda' : e.cancelado ? 'cancelado' : e.estadoTarifa === 'sin_tarifa' ? 'sin tarifa' : e.estadoTarifa === 'cliente_sin_mapear' ? 'cliente sin mapear' : e.estadoTarifa.startsWith('excluido') ? 'no se factura por este flujo' : 'sin precio';
    const cat = partes.length ? partes.map(p => dimTexto(p.categoria)).filter(x => x !== '—')[0] ?? '—' : dimTexto(e.categoriaCanon);
    const ter = partes.length ? partes.map(p => dimTexto(p.territorio)).filter(x => x !== '—')[0] ?? '—' : (e.territorioResuelto ? dimTexto(e.territorioResuelto) : '—');
    return {
      idExterno: e.idExterno, persona: e.persona || e.idExterno, puesto: e.puesto, fechaIngreso: e.fechaIngreso,
      servicio: e.tipoCobrado || e.tipoPrueba || '—',
      componentes: partes.length > 1 ? partes.map(p => `${p.tipoPrueba} Q${Number(p.monto).toFixed(2)}`).join(' + ') : '',
      categoria: cat, territorio: ter, monto: incluido ? round2(e.montoCalculado ?? 0) : 0, incluido, motivo,
    };
  });
  const incluidas = lineas.filter(l => l.incluido), faltantes = lineas.filter(l => !l.incluido);
  const subtotal = round2(incluidas.reduce((s, l) => s + l.monto, 0));
  const { iva, total } = conIva(subtotal);
  return { lineas, incluidas, faltantes, subtotal, iva, total };
}
