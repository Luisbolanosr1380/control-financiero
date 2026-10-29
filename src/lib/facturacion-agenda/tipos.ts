/**
 * FACTURACIÓN AGENDA (Fase B) · Tipos — PURO (sin IO).
 *
 * `ExpedienteAgenda` es el expediente tal como lo manda la API de Facturación
 * de la Agenda de Golden (docs 27-oct y 28-oct-2026). `ExpedienteLocal` es el
 * espejo guardado en `facturacion_expediente` (migración 016), ya clasificado
 * contra el tarifario.
 */

export const FUENTE_AGENDA = 'agenda' as const;

/** Lo que manda la Agenda por cada expediente. Campos nuevos no rompen: se guarda `raw`. */
export interface ExpedienteAgenda {
  id: string;
  nombre?: string | null;
  dpi?: string | null;
  correo?: string | null;
  empresa?: { id?: string | null; nombre?: string | null } | null;
  puesto?: string | null;
  /** Categoría de prueba (doc 28-oct). `categoria` es el alias viejo del doc 27-oct. */
  categoriaPrueba?: string | null;
  categoria?: string | null;
  deptoVisita?: string | null;
  solicitante?: string | null;
  fechaIngreso?: string | null;
  tipoPrueba?: string | null;
  procesoSolicitado?: string | null;
  statusProceso?: string | null;
  terminado?: boolean | null;
  cancelado?: boolean | null;
  fechaEntrega?: string | null;
  cobro?: {
    statusCobro?: string | null;
    estatusPago?: string | null;
    monto?: number | null;
    numeroFactura?: string | null;
    fechaFactura?: string | null;
    cobroMegapaca?: number | null;
    costoVisita?: number | null;
  } | null;
  enVistaFacturacion?: boolean | null;
  grupoFacturacion?: string | null;
  url?: string | null;
  eliminado?: boolean | null;
  creadoEn?: string | null;
  actualizadoEn?: string | null;
}

export type EstadoTarifa = 'resuelta' | 'sin_tarifa' | 'cliente_sin_mapear' | 'excluido_psicometrica' | 'excluido_no_factura';
/** Estados que nunca entran a la cola ni se cotizan: solo se cuentan. */
export const ESTADOS_EXCLUIDOS: readonly EstadoTarifa[] = ['excluido_psicometrica', 'excluido_no_factura'];
export type WritebackEstado = 'omitido' | 'pendiente' | 'confirmado' | 'conflicto' | 'error';

export const ETIQUETA_ESTADO_TARIFA: Record<EstadoTarifa, string> = {
  resuelta: 'Precio resuelto',
  sin_tarifa: 'Sin tarifa',
  cliente_sin_mapear: 'Cliente sin mapear',
  excluido_psicometrica: 'Psicométricas (trato aparte)',
  excluido_no_factura: 'No se factura (interno / no aplica)',
};

export const ETIQUETA_WRITEBACK: Record<WritebackEstado, string> = {
  omitido: 'Sin enviar a la Agenda (flag apagado)',
  pendiente: 'Factura creada, falta confirmar en Agenda',
  confirmado: 'Confirmado en Agenda',
  conflicto: 'Conflicto: el expediente cambió en la Agenda',
  error: 'Error al escribir en la Agenda',
};

/** Un servicio dentro del precio resuelto (un COMPLETO trae dos). Monto SIN IVA. */
export interface ComponentePrecio {
  tipoPrueba: string;
  categoria: string;
  territorio: string;
  monto: number;
  tarifarioId: string;
  aprobada: boolean;
}

/** Espejo local del expediente (facturacion_expediente). */
export interface ExpedienteLocal {
  id: string;
  fuente: string;
  idExterno: string;
  empresaIdExterno: string;
  empresaNombreExterno: string;
  nitResuelto: string | null;
  clienteId: string | null;
  persona: string;
  puesto: string;
  solicitante: string;
  tipoPrueba: string;
  categoriaPrueba: string;
  procesoSolicitado: string;
  deptoVisita: string;
  tipoCobrado: string;
  categoriaCanon: string;
  territorioResuelto: string;
  fechaIngreso: string | null;
  fechaEntrega: string | null;
  statusProceso: string;
  terminado: boolean;
  cancelado: boolean;
  eliminado: boolean;
  enVistaFacturacion: boolean | null;
  statusCobroExterno: string | null;
  estatusPagoExterno: string | null;
  montoExterno: number | null;
  numeroFacturaExterno: string | null;
  fechaFacturaExterno: string | null;
  cobroMegapaca: number | null;
  costoVisita: number | null;
  /** Sin IVA, del tarifario. null si no está resuelta. */
  montoCalculado: number | null;
  estadoTarifa: EstadoTarifa;
  detalleTarifa: string;
  componentes: ComponentePrecio[];
  creadoEnExterno: string | null;
  actualizadoEnExterno: string | null;
  /** El `actualizadoEn` tal cual lo mandó la Agenda (para `siActualizadoEn`: la base lo reformatea). */
  actualizadoEnExternoCrudo: string | null;
  facturaId: string | null;
  facturaAppId: string | null;
  noFactura: string | null;
  facturadoEn: string | null;
  facturadoPor: string | null;
  writebackEstado: WritebackEstado | null;
  writebackDetalle: string | null;
  writebackEn: string | null;
  cobroWritebackEstado: string | null;
  cobroWritebackDetalle: string | null;
  /** 019: detalle de facturación (pre-liquidación) que lo reserva. */
  detalleId: string | null;
  updatedAt: string | null;
}

/** Mapeo empresa de la Agenda → cliente de financiero (cliente_externo). */
export interface ClienteExterno {
  id: string;
  fuente: string;
  empresaIdExterno: string;
  empresaNombreExterno: string;
  /** NIT comparable (solo dígitos y letras). */
  nit: string;
  clienteId: string | null;
  activo: boolean;
  creadoPor: string;
  /** 018: la empresa NO se factura por este flujo (interna / intercompany / reclutamiento = Fase A). Sus expedientes quedan 'excluido_no_factura'. */
  noFactura: boolean;
  motivoNoFactura: string;
}

/** Empresa marcada como "no se factura" (pestaña "No se facturan"). */
export interface EmpresaNoFactura { empresaIdExterno: string; empresaNombreExterno: string; motivo: string; expedientes: number; marcadoPor: string; marcadoEn: string | null }

export interface SyncEstado {
  fuente: string;
  ultimoActualizadoEn: string | null;
  ultimaCorrida: string | null;
  ultimoResultado: string;
  expedientesLeidos: number | null;
  corridas: number;
}

/** Lo que cubre una factura (factura_detalle_expediente). */
export interface DetalleFacturaExpediente {
  id: string;
  noFactura: string;
  idExterno: string;
  tipoPrueba: string;
  categoria: string;
  territorio: string;
  /** Sin IVA. */
  monto: number;
  centroCostoId: string | null;
  centroNombre: string;
  persona: string;
}

/** Estados de cobro de la Agenda que siguen "por facturar". El resto ya se resolvió del lado de Golden. */
export const STATUS_COBRO_POR_FACTURAR = ['', 'PENDIENTE', 'SIN_STATUS'] as const;
