/**
 * SEGUIMIENTO DE COBRO A LA VISTA (Facturación) · reglas PURAS, sin IO: va al navegador y al servidor.
 *
 * El CFO trabaja la cobranza desde Facturación y ahí no veía promesas ni notas. Acá vive lo que se muestra por factura
 * en la columna «Cobranza» de la lista y en la sección «Seguimiento de cobro» de la factura:
 *  - el estado de cobro calculado (espejo de cobranza_estado_factura, 033) a partir de los eventos del cliente;
 *  - el BADGE según el caso (Paga hoy, Promesa 15-nov, Promesa incumplida, En disputa, Pide documentos, Dice que pagó,
 *    Seguimiento hoy / atrasado, Sin gestión), con todos los que aplican para el `title`;
 *  - la última nota en una línea («3-nov · Llamada a Liseth: pide contraseña»);
 *  - los filtros rápidos (chips) y el KPI «Promesas de esta semana».
 * Un evento que no nombra facturas aplica a todas las del cliente (misma regla que el SQL).
 */
import { ETIQUETA_CANAL, ETIQUETA_RESULTADO, diasEntre, estadoFactura, sumarDias, type CanalCobranza, type EstadoFactura, type EstadoPromesa, type ResultadoGestion, type TipoEvento } from './estado';

/** Lo mínimo de un evento de cobranza para calcular la columna (EventoCobranza del servidor es asignable). */
export interface EventoLite {
  id: string; clienteUuid: string; tipo: TipoEvento; fecha: string; facturas: string[];
  canal?: CanalCobranza | null; resultado?: ResultadoGestion | null; comentario?: string; contactoNombre?: string; contactoTexto?: string; creadoPor?: string;
  monto?: number | null; fechaPromesa?: string | null; promesaEstado?: EstadoPromesa | null; proximoSeguimiento?: string | null; seguimientoHechoEn?: string | null;
}
/** Lo mínimo de una factura abierta. `clienteUuid` enlaza con los eventos. */
export interface FacturaBase { noFactura: string; clienteUuid: string | null; fechaEmision: string; diasCredito: number; cobrada: boolean; parcial: boolean; viva?: boolean }

export type ClaveBadge = 'paga_hoy' | 'promesa_incumplida' | 'seguimiento_atrasado' | 'seguimiento_hoy' | 'dice_que_pago' | 'en_disputa' | 'pide_documentos' | 'promesa' | 'sin_gestion';
export interface BadgeCobranza { clave: ClaveBadge; texto: string; cls: string }
export interface NotaCobranza { fecha: string; canal: CanalCobranza; contacto: string; texto: string; autor: string; eventoId: string }
export interface SeguimientoFactura {
  estado: EstadoFactura;
  /** el principal (el primero por prioridad) y todos los que aplican */ badge: BadgeCobranza | null; badges: BadgeCobranza[];
  promesa: { id: string; fecha: string; monto: number | null; estado: EstadoPromesa } | null;
  proximoSeguimiento: string | null;
  ultimaNota: NotaCobranza | null;
  /** fecha del último evento de cobranza que cubre la factura (gestión, promesa o correo), o null */ ultimoEvento: string | null;
}

/** Prioridad del badge principal: lo accionable hoy primero. */
export const ORDEN_BADGE: ClaveBadge[] = ['paga_hoy', 'promesa_incumplida', 'seguimiento_atrasado', 'seguimiento_hoy', 'dice_que_pago', 'en_disputa', 'pide_documentos', 'promesa', 'sin_gestion'];
export const DIAS_SIN_GESTION = 7;
const CLS: Record<ClaveBadge, string> = { paga_hoy: 'badge-olive', promesa_incumplida: 'badge-wine', seguimiento_atrasado: 'badge-wine', seguimiento_hoy: 'badge-warn', dice_que_pago: 'badge-outline', en_disputa: 'badge-warn', pide_documentos: 'badge-warn', promesa: 'badge-outline', sin_gestion: 'badge-mute' };

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** «15-nov» (con el año cuando no es el de `hoy`). */
export const fechaCorta = (iso: string, hoy: string): string => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)}-${MESES[Number(m) - 1]}${y !== hoy.slice(0, 4) ? '-' + y : ''}`; };

const cubre = (e: EventoLite, nf: string) => e.facturas.length === 0 || e.facturas.includes(nf);
const porFechaDesc = (a: EventoLite, b: EventoLite) => b.fecha.localeCompare(a.fecha);

/** Estado + badge + nota de UNA factura a partir de los eventos de su cliente (ya filtrados por cliente). */
export function seguimientoDe(f: FacturaBase, eventosCliente: EventoLite[], hoy: string): SeguimientoFactura {
  const evs = eventosCliente.filter(e => cubre(e, f.noFactura)).sort(porFechaDesc);
  const promesas = evs.filter(e => e.tipo === 'promesa' && e.fechaPromesa);
  const gestiones = evs.filter(e => e.tipo === 'gestion');
  const p = promesas[0] ?? null, g = gestiones[0] ?? null;
  const estado = estadoFactura({ fechaEmision: f.fechaEmision, diasCredito: f.diasCredito, cobrada: f.cobrada, parcial: f.parcial, viva: f.viva, ultimaPromesa: p ? { fecha: p.fechaPromesa!, estado: p.promesaEstado ?? 'pendiente' } : null, ultimaGestion: g?.resultado ? { resultado: g.resultado } : null }, hoy);
  const vigente = p && p.promesaEstado === 'pendiente' ? { id: p.id, fecha: p.fechaPromesa!, monto: p.monto ?? null, estado: p.promesaEstado } : null;
  const seg = gestiones.filter(e => e.proximoSeguimiento && !e.seguimientoHechoEn).map(e => e.proximoSeguimiento!).sort()[0] ?? null;
  const nota = gestiones[0] ?? null;
  const ultimo = evs[0]?.fecha.slice(0, 10) ?? null;
  const badges: BadgeCobranza[] = [];
  const add = (clave: ClaveBadge, texto: string) => badges.push({ clave, texto, cls: CLS[clave] });
  if (!estado.cobrada && estado.estado !== 'anulada') {
    if (vigente && vigente.fecha === hoy) add('paga_hoy', 'Paga hoy');
    else if (vigente && vigente.fecha > hoy) add('promesa', `Promesa ${fechaCorta(vigente.fecha, hoy)}`);
    if (estado.modificadores.includes('promesa_incumplida')) add('promesa_incumplida', 'Promesa incumplida');
    if (seg && seg < hoy) add('seguimiento_atrasado', 'Seguimiento atrasado'); else if (seg === hoy) add('seguimiento_hoy', 'Seguimiento hoy');
    if (estado.modificadores.includes('dice_que_pago')) add('dice_que_pago', 'Dice que pagó');
    if (estado.modificadores.includes('en_disputa')) add('en_disputa', 'En disputa');
    if (estado.modificadores.includes('pide_documentos')) add('pide_documentos', 'Pide documentos');
    if (estado.estado === 'vencida' && (!ultimo || diasEntre(ultimo, hoy) >= DIAS_SIN_GESTION) && !vigente) add('sin_gestion', 'Sin gestión');
  }
  badges.sort((a, b) => ORDEN_BADGE.indexOf(a.clave) - ORDEN_BADGE.indexOf(b.clave));
  return {
    estado, badge: badges[0] ?? null, badges, promesa: vigente ?? (p && p.promesaEstado === 'incumplida' ? { id: p.id, fecha: p.fechaPromesa!, monto: p.monto ?? null, estado: p.promesaEstado } : null),
    proximoSeguimiento: seg,
    ultimaNota: nota ? { fecha: nota.fecha, canal: nota.canal ?? 'nota', contacto: nota.contactoNombre || nota.contactoTexto || '', texto: nota.comentario || (nota.resultado ? ETIQUETA_RESULTADO[nota.resultado] : ''), autor: nota.creadoPor ?? '', eventoId: nota.id } : null,
    ultimoEvento: ultimo,
  };
}

/** Todas las facturas de una vez: agrupa los eventos por cliente y calcula cada factura (nada por fila contra la base). */
export function seguimientosPorFactura<T extends FacturaBase>(facturas: T[], eventos: EventoLite[], hoy: string): Record<string, SeguimientoFactura> {
  const porCliente = new Map<string, EventoLite[]>();
  for (const e of eventos) porCliente.set(e.clienteUuid, [...(porCliente.get(e.clienteUuid) ?? []), e]);
  const out: Record<string, SeguimientoFactura> = {};
  for (const f of facturas) out[f.noFactura] = seguimientoDe(f, f.clienteUuid ? porCliente.get(f.clienteUuid) ?? [] : [], hoy);
  return out;
}

/** «3-nov · Llamada a Liseth: pide contraseña» (cortada a `max`; el texto completo va en el title). */
export function textoNota(n: NotaCobranza, hoy: string, max = 70): { corta: string; completa: string } {
  const quien = n.contacto ? ` a ${n.contacto}` : '';
  const completa = `${fechaCorta(n.fecha, hoy)} · ${ETIQUETA_CANAL[n.canal]}${quien}: ${n.texto}${n.autor ? ` — ${n.autor}` : ''}`;
  const base = `${fechaCorta(n.fecha, hoy)} · ${ETIQUETA_CANAL[n.canal]}${quien}: ${n.texto}`;
  return { corta: base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base, completa };
}

/* ───────────── filtros rápidos (chips) y KPI ───────────── */

export const FILTROS_COBRANZA = ['pagan_hoy', 'promesas_semana', 'promesas_incumplidas', 'seguimiento_hoy', 'vencidas_sin_gestion'] as const;
export type FiltroCobranza = (typeof FILTROS_COBRANZA)[number];
export const ETIQUETA_FILTRO_COBRANZA: Record<FiltroCobranza, string> = { pagan_hoy: 'Pagan hoy', promesas_semana: 'Promesas esta semana', promesas_incumplidas: 'Promesas incumplidas', seguimiento_hoy: 'Seguimiento para hoy', vencidas_sin_gestion: 'Vencidas sin gestión' };
export const esFiltroCobranza = (v: unknown): v is FiltroCobranza => (FILTROS_COBRANZA as readonly string[]).includes(String(v));
export const DIAS_SEMANA = 7;

export function pasaFiltroCobranza(s: SeguimientoFactura, filtro: FiltroCobranza, hoy: string): boolean {
  const claves = s.badges.map(b => b.clave);
  switch (filtro) {
    case 'pagan_hoy': return claves.includes('paga_hoy');
    case 'promesas_semana': return !!s.promesa && s.promesa.estado === 'pendiente' && s.promesa.fecha >= hoy && s.promesa.fecha <= sumarDias(hoy, DIAS_SEMANA);
    case 'promesas_incumplidas': return claves.includes('promesa_incumplida');
    case 'seguimiento_hoy': return claves.includes('seguimiento_hoy') || claves.includes('seguimiento_atrasado');
    case 'vencidas_sin_gestion': return claves.includes('sin_gestion');
  }
}

/** «Promesas de esta semana: N · Q…»: promesas pendientes distintas con fecha entre hoy y hoy + 7 (monto prometido, o el saldo de sus facturas si no lo dieron). */
export function kpiPromesasSemana(segs: Record<string, SeguimientoFactura>, saldos: Record<string, number>, hoy: string): { n: number; monto: number } {
  const fin = sumarDias(hoy, DIAS_SEMANA);
  const vistas = new Map<string, number>();
  for (const [nf, s] of Object.entries(segs)) {
    const p = s.promesa; if (!p || p.estado !== 'pendiente' || p.fecha < hoy || p.fecha > fin) continue;
    if (p.monto != null) vistas.set(p.id, p.monto); else vistas.set(p.id, (vistas.get(p.id) ?? 0) + (saldos[nf] ?? 0));
  }
  return { n: vistas.size, monto: Math.round([...vistas.values()].reduce((a, b) => a + b, 0) * 100) / 100 };
}

/* ───────────── pestañas de cartera de Facturación ───────────── */

export type TabCartera = 'cartera_total' | 'por_cobrar' | 'vencidas' | 'pendientes' | 'parciales';
/** Las pestañas de Facturación que muestran toda la cartera abierta (vive acá, en un módulo puro: un server component no puede importar valores de un módulo 'use client'). */
export const TABS_CARTERA: readonly TabCartera[] = ['cartera_total', 'por_cobrar', 'vencidas', 'pendientes', 'parciales'];
export const esTabCartera = (v: unknown): v is TabCartera => (TABS_CARTERA as readonly string[]).includes(String(v));
/** Qué facturas abiertas entran en cada pestaña (mismo criterio que predicadoFiltro de facturas.ts, con la vencida calculada por emisión + crédito, como Pendientes). */
export function filaEnTabCartera(f: { estadoBruto: 'emitida' | 'pendiente' | 'cobrado_parcial'; vencida: boolean }, tab: string): boolean {
  const activa = f.estadoBruto === 'emitida' || f.estadoBruto === 'cobrado_parcial';
  switch (tab) {
    case 'cartera_total': return true;
    case 'por_cobrar': return activa;
    case 'vencidas': return activa && f.vencida;
    case 'pendientes': return f.estadoBruto === 'pendiente';
    case 'parciales': return f.estadoBruto === 'cobrado_parcial';
    default: return false;
  }
}

/* ───────────── orden de la tabla de cartera (viaja en la URL) ───────────── */

export const ORDENES_CARTERA = ['dias', 'factura', 'cliente', 'emision', 'vence', 'total', 'saldo', 'cobranza', 'estado'] as const;
export type OrdenCartera = (typeof ORDENES_CARTERA)[number];
export const esOrdenCartera = (v: unknown): v is OrdenCartera => (ORDENES_CARTERA as readonly string[]).includes(String(v));
export interface FilaOrdenable { noFactura: string; cliente: string; fechaEmision: string; fechaVencimiento: string; diasVencidos: number; total: number; saldo: number; seguimiento: SeguimientoFactura | null }

/** Orden por defecto: días sin pagar, de mayor a menor (como Cobros → Pendientes). Empate: saldo mayor, número. */
export function ordenarCartera<T extends FilaOrdenable>(filas: T[], orden: OrdenCartera, dir: 'asc' | 'desc'): T[] {
  const d = dir === 'asc' ? 1 : -1;
  const prio = (f: T) => { const c = f.seguimiento?.badge?.clave; return c ? ORDEN_BADGE.indexOf(c) : ORDEN_BADGE.length; };
  const cmp = (a: T, b: T): number => {
    switch (orden) {
      case 'factura': return a.noFactura.localeCompare(b.noFactura) * d;
      case 'cliente': return a.cliente.localeCompare(b.cliente, 'es', { sensitivity: 'base' }) * d;
      case 'emision': return a.fechaEmision.localeCompare(b.fechaEmision) * d;
      case 'vence': return a.fechaVencimiento.localeCompare(b.fechaVencimiento) * d;
      case 'total': return (a.total - b.total) * d;
      case 'saldo': return (a.saldo - b.saldo) * d;
      case 'cobranza': return (prio(a) - prio(b)) * (dir === 'desc' ? 1 : -1);   // desc = lo más urgente primero
      case 'estado': return ((a.seguimiento?.estado.diasVencida ?? a.diasVencidos) - (b.seguimiento?.estado.diasVencida ?? b.diasVencidos)) * d;
      default: return (a.diasVencidos - b.diasVencidos) * d;
    }
  };
  return [...filas].sort((a, b) => cmp(a, b) || b.saldo - a.saldo || a.noFactura.localeCompare(b.noFactura));
}
