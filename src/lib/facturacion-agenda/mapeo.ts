/**
 * FACTURACIÓN AGENDA · Mapeo expediente → tarifario y factura — PURO (sin IO).
 *
 * Reglas cerradas con el CFO (brief Fase B, §2 y §3):
 *  - Cola = terminado, no cancelado, no eliminado, sin factura y con el cobro
 *    todavía PENDIENTE / sin estado del lado de la Agenda.
 *  - PSICOMETRICAS se excluye por completo (trato aparte): ni como "sin tarifa".
 *  - El PRECIO sale del `tipoPrueba` de la fila, NUNCA de `procesoSolicitado`
 *    (fix "COMPLETO doble"): la Agenda parte un COMPLETO en DOS expedientes
 *    (uno POLIGRAFO, otro SOCIOECONOMICO, ambos con procesoSolicitado =
 *    COMPLETO). Cada fila cobra SOLO su servicio; entre las dos suman el
 *    completo. La suma solo nace de una LISTA en tipoPrueba ("POLIGRAFO,
 *    SOCIOECONOMICO" = completo entero en un registro). "COMPLETO" suelto no
 *    es un servicio → sin tarifa (dato a limpiar en la Agenda).
 *    procesoSolicitado solo decide cuando la fila no trae tipoPrueba y nombra
 *    UN servicio ("SOLO POLIGRAFO").
 *  - categoría ← categoriaPrueba (canon). null → "sin tarifa".
 *  - territorio ← deptoVisita: GUATEMALA → METROPOLITANA; cualquier otro →
 *    DEPARTAMENTAL; vacío → el motor resuelve si el precio es igual en ambos.
 *  - cliente ← empresa.id vía cliente_externo; sin mapeo → "cliente sin mapear".
 *  - Precio del tarifario SIN IVA; IVA 12 %. No se reimplementa el motor.
 */
import { canonCategoria, canonTipoPrueba, conIva, formaPrecio, normalizarTexto, round2, usaCategoria } from '@/lib/tarifario/canon';
import { resolverTarifa, type Tarifa } from '@/lib/tarifario/lookup';
import { nitComparable } from '@/lib/clientes/nit';
import { ESTADOS_EXCLUIDOS, STATUS_COBRO_POR_FACTURAR, type ComponentePrecio, type EstadoTarifa, type ExpedienteAgenda, type ExpedienteLocal } from './tipos';

const compacto = (s: string | null | undefined) => normalizarTexto(s).replace(/[^A-Z0-9]/g, '');

/** PSICOMETRICAS (y sus grafías) no se factura individual: se excluye por completo. */
export function esPsicometrica(exp: Pick<ExpedienteAgenda, 'tipoPrueba' | 'procesoSolicitado'>): boolean {
  return compacto(exp.tipoPrueba).includes('PSICOMETRIC') || compacto(exp.procesoSolicitado).includes('PSICOMETRIC');
}

/** deptoVisita → territorio del tarifario. '' si no viene (polígrafos no tienen visita). */
export function territorioDesdeDepto(depto: string | null | undefined): '' | 'METROPOLITANA' | 'DEPARTAMENTAL' {
  const c = compacto(depto);
  if (!c) return '';
  if (c === 'GUATEMALA' || c === 'GT' || c.startsWith('GUATEMALA') || c.startsWith('CIUDAD') || c.startsWith('METRO')) return 'METROPOLITANA';
  return 'DEPARTAMENTAL';
}

/**
 * Servicios que cobra la fila, a partir de su `tipoPrueba`:
 *  - un servicio ("POLIGRAFO") → ese y nada más, aunque procesoSolicitado diga
 *    COMPLETO (la otra mitad es su propia fila);
 *  - una lista ("POLIGRAFO, SOCIOECONOMICO") → cada servicio, sin repetir;
 *    el token "COMPLETO" dentro de la lista no cuenta ("COMPLETO, SOCIOECONOMICO"
 *    = solo socio);
 *  - sin tipoPrueba utilizable → procesoSolicitado solo si nombra UN servicio
 *    ("SOLO POLIGRAFO"); "COMPLETO" suelto → [] (sin tarifa).
 */
export function serviciosDe(tipoPrueba: string | null | undefined, procesoSolicitado: string | null | undefined): string[] {
  const partes = String(tipoPrueba ?? '').split(/[,+/;]|\s+Y\s+/i).map(canonTipoPrueba).filter(t => t && t !== 'COMPLETO');
  const unicos = [...new Set(partes)];
  if (unicos.length) return unicos;
  const p = canonTipoPrueba(procesoSolicitado);
  return p && p !== 'COMPLETO' ? [p] : [];
}

/** Texto del servicio cobrado: un servicio, o la lista unida con " + " (completo en un registro). '' si no hay. */
export function tipoCobrado(procesoSolicitado: string | null | undefined, tipoPrueba: string | null | undefined): string {
  return serviciosDe(tipoPrueba, procesoSolicitado).join(' + ');
}

/** La fila es una MITAD de un completo: procesoSolicitado = COMPLETO pero cobra un solo servicio. */
export function esMitadDeCompleto(e: Pick<ExpedienteAgenda, 'tipoPrueba' | 'procesoSolicitado'>): boolean {
  return compacto(e.procesoSolicitado).includes('COMPLET') && serviciosDe(e.tipoPrueba, e.procesoSolicitado).length === 1;
}

/** Categoría del expediente: el doc del 28-oct manda `categoriaPrueba`; `categoria` es el alias viejo. */
export function categoriaDe(exp: Pick<ExpedienteAgenda, 'categoriaPrueba' | 'categoria'>): string {
  return String(exp.categoriaPrueba ?? exp.categoria ?? '').trim();
}

export interface ContextoPrecio {
  /** empresa.id de la Agenda → NIT comparable del cliente de financiero (solo mapeos activos). */
  nitPorEmpresa: ReadonlyMap<string, string>;
  tarifas: readonly Tarifa[];
  /** 018: empresa.id → motivo de las empresas marcadas "no se factura" (gana sobre el mapeo; las psicométricas ganan primero). */
  noFacturaEmpresas?: ReadonlyMap<string, string>;
}

export interface Clasificacion {
  estado: EstadoTarifa;
  nit: string | null;
  tipoCobrado: string;
  categoriaCanon: string;
  territorio: string;
  /** Sin IVA. null si no está resuelta. */
  monto: number | null;
  componentes: ComponentePrecio[];
  detalle: string;
}

/** Clasifica un expediente de la Agenda contra el mapeo de clientes y el tarifario (motor existente). */
export function clasificarExpediente(exp: ExpedienteAgenda, ctx: ContextoPrecio): Clasificacion {
  const servicios = serviciosDe(exp.tipoPrueba, exp.procesoSolicitado);
  const tipo = servicios.join(' + ');
  const cat = canonCategoria(categoriaDe(exp));
  const ter = territorioDesdeDepto(exp.deptoVisita);
  const base = { tipoCobrado: tipo, categoriaCanon: cat, territorio: ter, componentes: [] as ComponentePrecio[] };
  if (esPsicometrica(exp)) return { ...base, estado: 'excluido_psicometrica', nit: null, monto: null, detalle: 'PSICOMETRICAS no se factura individual: trato aparte.' };
  const empresaId = String(exp.empresa?.id ?? '').trim();
  if (empresaId && ctx.noFacturaEmpresas?.has(empresaId)) return { ...base, estado: 'excluido_no_factura', nit: null, monto: null, detalle: `La empresa está marcada como "no se factura" por este flujo (${ctx.noFacturaEmpresas.get(empresaId) || 'interno / no aplica'}).` };
  const nit = empresaId ? (ctx.nitPorEmpresa.get(empresaId) ?? null) : null;
  if (!nit) return { ...base, estado: 'cliente_sin_mapear', nit: null, monto: null, detalle: empresaId ? `La empresa "${exp.empresa?.nombre ?? empresaId}" no está mapeada a un cliente de financiero.` : 'El expediente no trae empresa.' };
  if (!servicios.length) {
    // "COMPLETO" suelto no es un servicio: cada mitad viene en su propia fila con POLIGRAFO o SOCIOECONOMICO.
    const detalle = compacto(exp.procesoSolicitado).includes('COMPLET')
      ? 'La fila dice COMPLETO pero no trae el servicio (tipoPrueba): cada mitad de un completo viene en su propia fila como POLIGRAFO o SOCIOECONOMICO. Dato a revisar en la Agenda; no se cobra a ciegas.'
      : 'El expediente no trae tipo de prueba ni proceso solicitado.';
    return { ...base, estado: 'sin_tarifa', nit, monto: null, detalle };
  }
  // Cada servicio de la fila se cotiza por separado y se SUMA solo si la fila trae varios (lista en tipoPrueba).
  const partes: Tarifa[] = []; const avisos: string[] = [];
  const prefijo = (s: string) => (servicios.length > 1 ? `${s}: ` : '');
  for (const s of servicios) {
    // Solo las formas "matriz" cobran por categoría: SOCIO EMPRESARIAL (por territorio) e INFORNET (único) resuelven sin ella.
    if (usaCategoria(formaPrecio(s)) && !cat) return { ...base, estado: 'sin_tarifa', nit, monto: null, detalle: `${s} se cobra por categoría y el expediente no trae categoría de prueba (PRE EMPLEO / RUTINA / ESPECIFICO).` };
    const r = resolverTarifa(ctx.tarifas, { nit, tipoPrueba: s, categoria: cat, territorio: ter || undefined });
    if (r.estado !== 'ok') return { ...base, estado: 'sin_tarifa', nit, monto: null, detalle: prefijo(s) + r.mensaje };
    partes.push(...(r.componentes ?? [r.tarifa])); avisos.push(...r.avisos);
  }
  const monto = round2(partes.reduce((s, t) => s + Number(t.monto), 0));
  return {
    ...base, estado: 'resuelta', nit, monto,
    componentes: partes.map(t => ({ tipoPrueba: canonTipoPrueba(t.tipoPrueba), categoria: canonCategoria(t.categoria), territorio: normalizarTexto(t.territorio), monto: Number(t.monto), tarifarioId: t.id, aprobada: !!t.aprobadoEn })),
    detalle: [...new Set(avisos)].join(' '),
  };
}

/**
 * true si el cobro del lado de la Agenda sigue pendiente: status de cobro null / '' / PENDIENTE /
 * SIN_STATUS **y** estatus de pago distinto de PAGADO (021). Génesis paga por provisión: el
 * statusCobro queda PENDIENTE pero estatusPago = PAGADO → ya no cuenta como por facturar.
 * null y 'NO PAGADO' SÍ siguen en cola (igualdad exacta con PAGADO, sin tildes/mayúsculas).
 * Misma semántica que facturacion_agenda_cobro_pendiente(s_status, s_pago) en SQL.
 */
export function cobroPendiente(statusCobro: string | null | undefined, estatusPago?: string | null): boolean {
  const s = normalizarTexto(statusCobro).replace(/ /g, '_');
  const statusPendiente = (STATUS_COBRO_POR_FACTURAR as readonly string[]).includes(s) || s === 'SIN_STATUS';
  return statusPendiente && normalizarTexto(estatusPago) !== 'PAGADO';
}

/** Listo para la cola "Por facturar": terminado, vigente, sin factura local y con cobro pendiente (y no pagado) en la Agenda. */
export function enCola(e: Pick<ExpedienteLocal, 'terminado' | 'cancelado' | 'eliminado' | 'estadoTarifa' | 'facturaId' | 'statusCobroExterno' | 'estatusPagoExterno'>): boolean {
  return e.terminado && !e.cancelado && !e.eliminado && !ESTADOS_EXCLUIDOS.includes(e.estadoTarifa) && !e.facturaId && cobroPendiente(e.statusCobroExterno, e.estatusPagoExterno);
}

/** Con precio y en cola (entra al flujo de facturación). */
export const conPrecio = (e: ExpedienteLocal): boolean => enCola(e) && e.estadoTarifa === 'resuelta' && (e.montoCalculado ?? 0) > 0;
/** Se puede meter en un detalle nuevo: con precio, en cola y NO reservado por otro detalle (019). */
export const facturable = (e: ExpedienteLocal): boolean => conPrecio(e) && !e.detalleId;

/** Un expediente de la Agenda → la fila que se guarda (sin id ni timestamps). */
export function expedienteALocal(exp: ExpedienteAgenda, c: Clasificacion): Omit<ExpedienteLocal, 'id' | 'facturaId' | 'facturaAppId' | 'noFactura' | 'facturadoEn' | 'facturadoPor' | 'writebackEstado' | 'writebackDetalle' | 'writebackEn' | 'cobroWritebackEstado' | 'cobroWritebackDetalle' | 'detalleId' | 'updatedAt'> {
  const cobro = exp.cobro ?? {};
  const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const txt = (v: unknown): string => String(v ?? '').trim();
  return {
    fuente: 'agenda',
    idExterno: exp.id,
    empresaIdExterno: txt(exp.empresa?.id),
    empresaNombreExterno: txt(exp.empresa?.nombre),
    nitResuelto: c.nit,
    clienteId: null,
    persona: txt(exp.nombre),
    puesto: txt(exp.puesto),
    solicitante: txt(exp.solicitante),
    tipoPrueba: txt(exp.tipoPrueba),
    categoriaPrueba: categoriaDe(exp),
    procesoSolicitado: txt(exp.procesoSolicitado),
    deptoVisita: txt(exp.deptoVisita),
    tipoCobrado: c.tipoCobrado,
    categoriaCanon: c.categoriaCanon,
    territorioResuelto: c.territorio,
    fechaIngreso: exp.fechaIngreso || null,
    fechaEntrega: exp.fechaEntrega || null,
    statusProceso: txt(exp.statusProceso),
    terminado: !!exp.terminado,
    cancelado: !!exp.cancelado,
    eliminado: !!exp.eliminado,
    enVistaFacturacion: typeof exp.enVistaFacturacion === 'boolean' ? exp.enVistaFacturacion : null,
    statusCobroExterno: cobro.statusCobro ?? null,
    estatusPagoExterno: cobro.estatusPago ?? null,
    montoExterno: num(cobro.monto),
    numeroFacturaExterno: cobro.numeroFactura ?? null,
    fechaFacturaExterno: cobro.fechaFactura ?? null,
    cobroMegapaca: num(cobro.cobroMegapaca),
    costoVisita: num(cobro.costoVisita),
    montoCalculado: c.monto,
    estadoTarifa: c.estado,
    detalleTarifa: c.detalle,
    componentes: c.componentes,
    creadoEnExterno: exp.creadoEn || null,
    actualizadoEnExterno: exp.actualizadoEn || null,
    actualizadoEnExternoCrudo: exp.actualizadoEn || null,
  };
}

// ── Factura: líneas por centro de costo + detalle por servicio ──────────────

export interface CentroCostoRef { id: string; nombre: string; activo?: boolean }

/**
 * Centro de costo sugerido para un servicio, por nombre del centro (de la base
 * de ESTE deploy): POLIGRAF* → "Poligrafia" (no Xela); SOCIO* → "Socioeconomicos";
 * INFORNET / VISITA / FORENSE → Socioeconomicos. null si no hay uno claro: el
 * usuario lo elige en el diálogo.
 */
export function centroPorServicio(tipoPrueba: string, centros: readonly CentroCostoRef[]): string | null {
  const activos = centros.filter(c => c.activo !== false);
  const buscar = (pred: (n: string) => boolean) => activos.find(c => pred(compacto(c.nombre)))?.id ?? null;
  const t = compacto(tipoPrueba);
  if (t.includes('POLIGRAF')) return buscar(n => n.includes('POLIGRAF') && !n.includes('XELA')) ?? buscar(n => n.includes('POLIGRAF'));
  if (t.includes('SOCIO') || t.includes('INFORNET') || t.includes('VISITA') || t.includes('FORENSE')) return buscar(n => n.includes('SOCIO'));
  return null;
}

export interface LineaFactura { centroCostoId: string; subtotal: number; iva: number; total: number }
export interface DetalleFactura { idExterno: string; tipoPrueba: string; categoria: string; territorio: string; monto: number; centroCostoId: string; persona: string }

/**
 * Arma la factura de un grupo de expedientes de UN cliente: un renglón de
 * detalle por servicio (una fila con lista "POLIGRAFO + SOCIOECONOMICO" → dos
 * renglones; cada MITAD de un completo ya es su propia fila) y una línea por centro
 * de costo con subtotal (sin IVA) + IVA 12 % + total. `centroDe(tipo)` decide
 * el centro de cada servicio; si devuelve null, se reporta en `sinCentro`.
 */
export function armarFactura(expedientes: readonly ExpedienteLocal[], centroDe: (tipoPrueba: string) => string | null): { lineas: LineaFactura[]; detalle: DetalleFactura[]; subtotal: number; iva: number; total: number; sinCentro: string[] } {
  const detalle: DetalleFactura[] = []; const sinCentro = new Set<string>();
  for (const e of expedientes) {
    const partes = e.componentes.length ? e.componentes : [{ tipoPrueba: e.tipoCobrado, categoria: e.categoriaCanon, territorio: e.territorioResuelto, monto: e.montoCalculado ?? 0 }];
    for (const p of partes) {
      const cc = centroDe(p.tipoPrueba);
      if (!cc) sinCentro.add(p.tipoPrueba);
      detalle.push({ idExterno: e.idExterno, tipoPrueba: p.tipoPrueba, categoria: p.categoria, territorio: p.territorio, monto: round2(Number(p.monto)), centroCostoId: cc ?? '', persona: e.persona });
    }
  }
  const porCentro = new Map<string, number>();
  for (const d of detalle) porCentro.set(d.centroCostoId, round2((porCentro.get(d.centroCostoId) ?? 0) + d.monto));
  const lineas: LineaFactura[] = [...porCentro].map(([centroCostoId, subtotal]) => { const { iva, total } = conIva(subtotal); return { centroCostoId, subtotal, iva, total }; });
  const subtotal = round2(lineas.reduce((s, l) => s + l.subtotal, 0));
  const iva = round2(lineas.reduce((s, l) => s + l.iva, 0));
  const total = round2(lineas.reduce((s, l) => s + l.total, 0));
  return { lineas, detalle, subtotal, iva, total, sinCentro: [...sinCentro] };
}

/** Monto que se escribe de vuelta a la Agenda por expediente: con IVA (como lo registra Golden hoy) o sin IVA. */
export function montoParaAgenda(montoSinIva: number, modo: 'con_iva' | 'sin_iva'): number {
  return modo === 'sin_iva' ? round2(montoSinIva) : conIva(montoSinIva).total;
}

/** NIT comparable del mapeo (mismo criterio que el tarifario). */
export const nitMapeo = (nit: string | null | undefined): string => nitComparable(nit);
