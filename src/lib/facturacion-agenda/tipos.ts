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
  /** 024 (doc 29-oct): estado de cada prueba. null = el proceso no lleva esa prueba o todavía no tiene estado. */
  estadoPoligrafo?: string | null;
  estadoSocio?: string | null;
  /** 025: fechaResultadoPoligrafo / fechaResultadoSocio (nombres TENTATIVOS) se leen por `CAMPO_FECHA_RESULTADO` (fecha-resultado.ts), no por nombre acá. */
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
export type WritebackEstado = 'omitido' | 'pendiente' | 'confirmado' | 'conflicto' | 'error' | 'parcial';

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
  parcial: 'Cobro parcial: se facturó una prueba y falta otra; no se escribe a la Agenda hasta completar',
};

/** 024: situación de una prueba (componente) según el estado que manda la Agenda. */
export type Situacion = 'cobra' | 'pendiente' | 'no_cobra';
/** 025: de dónde salió la fecha de resultado de una prueba (ver fecha-resultado.ts). */
export type FuenteFechaResultado = 'agenda' | 'fecha_entrega' | 'detectado' | 'sin_dato';

/** 024: una PRUEBA de un expediente (facturacion_componente): lo que se cobra, se espera o no se cobra, con su precio y su factura. */
export interface PruebaLocal {
  id: string;
  expedienteId: string;
  idExterno: string;
  /** Servicio canónico (POLIGRAFO, SOCIOECONOMICO, FEE VISITA SOCIO CANCELADO, INFORNET…). */
  servicio: string;
  /** Texto de la Agenda que decidió (estadoPoligrafo / estadoSocio / statusProceso). */
  estadoPrueba: string;
  situacion: Situacion;
  motivo: string;
  categoria: string;
  territorio: string;
  /** Sin IVA, DE LA TARIFA. null si no está resuelta. Para cobrar se usa `montoEfectivo(p)`, nunca este campo directo (037). */
  montoCalculado: number | null;
  /** 037: precio especial de esta prueba, sin IVA (null / ausente = se cobra la tarifa). El sync nunca lo pisa. */
  montoAjustado?: number | null;
  /** 037: por qué se cobra distinto a la tarifa, si el motivo se le muestra al cliente (PDF / link), quién y cuándo. */
  ajusteMotivo?: string;
  ajusteMotivoCliente?: boolean;
  ajustadoPor?: string | null;
  ajustadoEn?: string | null;
  estadoTarifa: EstadoTarifa;
  detalleTarifa: string;
  tarifarioId: string | null;
  aprobada: boolean | null;
  /** Reserva en un detalle de facturación (null o un detalle anulado = libre). */
  detalleId: string | null;
  facturaId: string | null;
  noFactura: string | null;
  facturadoEn: string | null;
  facturadoPor: string | null;
  /** 025: cuándo tuvo resultado (ISO) y de dónde salió. null = pendiente o sin dato (nunca se inventa). */
  fechaResultado: string | null;
  fechaResultadoFuente: FuenteFechaResultado | null;
  /** 029: el cliente pidió cobrarla el próximo mes (YYYY-MM-DD): marca y filtro de pantalla, la cola no cambia. */
  diferidaHasta?: string | null;
  /** 034: cubierta por un paquete prepagado (consumo vigente): sale de la cola, no entra a un detalle ni a una factura; va a la Agenda con el número del anticipo. */
  cubiertaPor?: CubiertaPorPaquete | null;
}

/** 034: el consumo vigente que cubre la prueba. */
export interface CubiertaPorPaquete { consumoId: string; paqueteId: string; correlativo: string; noFactura: string | null; precioUnitario: number; fecha: string }

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
  /** 022: true si la fecha de ingreso es anterior al `facturar_desde` del cliente (corte de arranque): fuera de la cola, sigue en la data. Se anota al leer (no se guarda). */
  arranqueExcluido?: boolean;
  montoExterno: number | null;
  numeroFacturaExterno: string | null;
  fechaFacturaExterno: string | null;
  cobroMegapaca: number | null;
  costoVisita: number | null;
  /** Sin IVA, del tarifario: la suma de TODOS los servicios de la fila (resolución de precio, sin mirar estados). null si no está resuelta. */
  montoCalculado: number | null;
  estadoTarifa: EstadoTarifa;
  detalleTarifa: string;
  componentes: ComponentePrecio[];
  /** 024: estado de cada prueba tal como lo manda la Agenda. */
  estadoPoligrafo: string | null;
  estadoSocio: string | null;
  /** 025: fechas de resultado que manda la Agenda por expediente (espejo; null si todavía no las manda). */
  fechaResultadoPoligrafo: string | null;
  fechaResultadoSocio: string | null;
  /** 024: las PRUEBAS del expediente (facturacion_componente): la cola, el detalle y la factura van por acá. */
  pruebas: PruebaLocal[];
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
  /** 022: fecha de arranque de la facturación por este flujo ('YYYY-MM-DD'). Los expedientes con fecha de ingreso ANTERIOR quedan fuera de la cola (histórico ya cubierto, p. ej. provisión). null = sin corte. */
  facturarDesde: string | null;
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
  /** 024: prueba (componente) facturada y su resultado legible. */
  componenteId: string | null;
  resultado: string;
}

/** Estados de cobro de la Agenda que siguen "por facturar". El resto ya se resolvió del lado de Golden. */
export const STATUS_COBRO_POR_FACTURAR = ['', 'PENDIENTE', 'SIN_STATUS'] as const;

/**
 * 037 · MONTO EFECTIVO de una prueba (sin IVA): el precio especial si lo tiene; si no, la tarifa.
 * Espejo de `coalesce(monto_ajustado, monto_calculado)` en SQL. Todo lo que cobra (cola, detalle, link, factura,
 * write-back) pasa por acá.
 */
export const montoEfectivo = (p: { montoCalculado: number | null; montoAjustado?: number | null }): number | null => p.montoAjustado ?? p.montoCalculado;
/** 037: ¿la prueba tiene un precio especial vigente? */
export const tienePrecioEspecial = (p: { montoAjustado?: number | null }): boolean => p.montoAjustado !== null && p.montoAjustado !== undefined;
/** 037: motivos sugeridos del precio especial; `cliente` = el motivo se le muestra al cliente en el PDF y en el link. */
export const MOTIVOS_PRECIO_ESPECIAL: ReadonlyArray<{ texto: string; cliente: boolean }> = [
  { texto: 'Proceso incompleto: faltó papelería', cliente: true },
  { texto: 'Precio pactado con el cliente', cliente: false },
  { texto: 'Cortesía parcial', cliente: false },
];
/** 037: por defecto solo los motivos «Proceso incompleto…» son de tipo cliente (misma regla que la RPC cuando no se le indica). */
export const motivoEsDeCliente = (motivo: string): boolean => /^proceso incompleto/i.test(motivo.trim());
/** 037: del monto que escribe la persona (sin IVA o con IVA) al monto sin IVA que se guarda: con IVA → round(x / 1.12, 2). */
export const montoSinIvaDe = (monto: number, base: 'sin_iva' | 'con_iva'): number => Math.round((base === 'con_iva' ? monto / 1.12 : monto) * 100 + Number.EPSILON) / 100;
