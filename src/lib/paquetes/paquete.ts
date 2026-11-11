/**
 * PAQUETES PREPAGADOS (034) — PURO (sin IO; va al navegador, al servidor y a los validadores).
 *
 * El cliente paga N pruebas por adelantado (una factura, el anticipo); cada prueba terminada descuenta una del paquete
 * y no se vuelve a facturar. Acá viven los tipos que devuelven las RPC (paquete_resumen / paquete_detalle), el estado
 * EFECTIVO que ve la pantalla (activo / por agotarse / agotado / vence pronto / vencido / cerrado), el umbral por
 * defecto, el espejo TS de `paquete_linea_cubre` (paridad SQL / TS), los textos de banner y badge, los filtros de la
 * lista global y el CSV del detalle.
 */

export type EstadoPaquete = 'activo' | 'agotado' | 'vencido' | 'cerrado';
export type EstadoEfectivo = EstadoPaquete | 'por_agotarse' | 'vence_pronto';
export const DIAS_VENCE_PRONTO = 30;

export interface PaqueteLinea {
  id: string; servicio: string; categoria: string; territorio: string | null;
  cantidad: number; precioUnitario: number; usadas: number; remanente: number;
  avisoUmbralEn: string | null; agotadoEn: string | null;
}
export interface Paquete {
  id: string; correlativo: string; nit: string; clienteId: string | null; cliente: string | null; nombre: string;
  fechaInicio: string; venceEn: string | null; estado: EstadoPaquete;
  noFactura: string | null; facturaId: string | null; facturaAppId: string | null;
  umbralAviso: number; retroactivoConfirmado: boolean; retroPendientes: number;
  notas: string; creadoPor: string; createdAt: string; updatedAt: string | null;
  cerradoPor: string | null; cerradoMotivo: string | null; cerradoEn: string | null;
  lineas: PaqueteLinea[];
}
export interface ConsumoPaquete {
  id: string; lineaId: string; componenteId: string; fecha: string; revertidoEn: string | null; motivoReversion: string | null;
  fechaResultado: string | null; servicio: string; categoria: string; territorio: string; estadoPrueba: string; situacion: string;
  persona: string; solicitante: string; puesto: string; idExterno: string; expedienteId: string; detalleId: string | null; noFactura: string | null;
}
export interface PaqueteDetalle { paquete: Paquete; consumos: ConsumoPaquete[] }

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const sn = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** Normaliza el jsonb de paquete_resumen (numerics llegan como string). */
export function parsePaquete(raw: unknown): Paquete {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lineas = Array.isArray(r.lineas) ? (r.lineas as Record<string, unknown>[]) : [];
  return {
    id: s(r.id), correlativo: s(r.correlativo), nit: s(r.nit), clienteId: sn(r.cliente_id), cliente: sn(r.cliente), nombre: s(r.nombre),
    fechaInicio: s(r.fecha_inicio).slice(0, 10), venceEn: sn(r.vence_en)?.slice(0, 10) ?? null, estado: (s(r.estado) || 'activo') as EstadoPaquete,
    noFactura: sn(r.no_factura), facturaId: sn(r.factura_id), facturaAppId: sn(r.factura_app_id),
    umbralAviso: n(r.umbral_aviso), retroactivoConfirmado: !!r.retroactivo_confirmado, retroPendientes: n(r.retro_pendientes),
    notas: s(r.notas), creadoPor: s(r.creado_por), createdAt: s(r.created_at), updatedAt: sn(r.updated_at),
    cerradoPor: sn(r.cerrado_por), cerradoMotivo: sn(r.cerrado_motivo), cerradoEn: sn(r.cerrado_en),
    lineas: lineas.map(l => ({ id: s(l.id), servicio: s(l.servicio), categoria: s(l.categoria), territorio: sn(l.territorio), cantidad: n(l.cantidad), precioUnitario: n(l.precio_unitario), usadas: n(l.usadas), remanente: n(l.remanente), avisoUmbralEn: sn(l.aviso_umbral_en), agotadoEn: sn(l.agotado_en) })),
  };
}
export function parseConsumo(raw: unknown): ConsumoPaquete {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: s(r.id), lineaId: s(r.linea_id), componenteId: s(r.componente_id), fecha: s(r.fecha), revertidoEn: sn(r.revertido_en), motivoReversion: sn(r.motivo_reversion),
    fechaResultado: sn(r.fecha_resultado), servicio: s(r.servicio), categoria: s(r.categoria), territorio: s(r.territorio), estadoPrueba: s(r.estado_prueba), situacion: s(r.situacion),
    persona: s(r.persona), solicitante: s(r.solicitante), puesto: s(r.puesto), idExterno: s(r.id_externo), expedienteId: s(r.expediente_id), detalleId: sn(r.detalle_id), noFactura: sn(r.no_factura),
  };
}

/** Umbral de aviso por defecto: el 10 % de la cantidad total o 5, lo que sea mayor (igual que paquete_crear en SQL). */
export const umbralPorDefecto = (cantidadTotal: number): number => Math.max(5, Math.ceil(cantidadTotal * 0.1));

export const totalCantidad = (p: Pick<Paquete, 'lineas'>): number => p.lineas.reduce((a, l) => a + l.cantidad, 0);
export const totalUsadas = (p: Pick<Paquete, 'lineas'>): number => p.lineas.reduce((a, l) => a + l.usadas, 0);
export const totalRemanente = (p: Pick<Paquete, 'lineas'>): number => p.lineas.reduce((a, l) => a + l.remanente, 0);
/** Valor del remanente (sin IVA) = Σ remanente × precio unitario: el pasivo por anticipos. */
export const valorRemanente = (p: Pick<Paquete, 'lineas'>): number => Math.round(p.lineas.reduce((a, l) => a + l.remanente * l.precioUnitario, 0) * 100) / 100;
export const porcentajeUsado = (p: Pick<Paquete, 'lineas'>): number => { const t = totalCantidad(p); return t ? Math.round((totalUsadas(p) / t) * 100) : 0; };

const diaUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** Días hasta el vencimiento (negativo = ya venció); null sin vencimiento. */
export const diasParaVencer = (p: Pick<Paquete, 'venceEn'>, hoy: string): number | null => (p.venceEn ? Math.round((diaUTC(p.venceEn) - diaUTC(hoy)) / 86_400_000) : null);
/** Alguna línea con remanente dentro del umbral (y no en cero). */
export const porAgotarse = (p: Pick<Paquete, 'lineas' | 'umbralAviso'>): boolean => p.lineas.some(l => l.remanente > 0 && l.remanente <= p.umbralAviso);

/**
 * Estado efectivo para badges y filtros: cerrado y vencido mandan; agotado si no queda nada; «vence pronto» a 30 días con
 * remanente; «por agotarse» si alguna línea bajó del umbral; si no, activo. (El `estado` guardado lo mantiene la RPC.)
 */
export function estadoEfectivo(p: Pick<Paquete, 'estado' | 'lineas' | 'umbralAviso' | 'venceEn'>, hoy: string): EstadoEfectivo {
  if (p.estado === 'cerrado') return 'cerrado';
  const d = diasParaVencer(p, hoy);
  if (p.estado === 'vencido' || (d !== null && d < 0)) return 'vencido';
  if (totalRemanente(p) === 0) return 'agotado';
  if (d !== null && d <= DIAS_VENCE_PRONTO) return 'vence_pronto';
  if (porAgotarse(p)) return 'por_agotarse';
  return 'activo';
}
export const ETIQUETA_ESTADO: Record<EstadoEfectivo, string> = { activo: 'Activo', por_agotarse: 'Por agotarse', agotado: 'Agotado', vence_pronto: 'Vence pronto', vencido: 'Vencido', cerrado: 'Cerrado' };
export const BADGE_ESTADO: Record<EstadoEfectivo, string> = { activo: 'badge-olive', por_agotarse: 'badge-warn', agotado: 'badge-wine', vence_pronto: 'badge-warn', vencido: 'badge-wine', cerrado: 'badge-mute' };

export type FiltroPaquetes = 'todos' | 'activos' | 'por_agotarse' | 'agotados' | 'vencidos';
export const FILTROS_PAQUETES: readonly FiltroPaquetes[] = ['activos', 'por_agotarse', 'agotados', 'vencidos', 'todos'];
export const ETIQUETA_FILTRO: Record<FiltroPaquetes, string> = { todos: 'Todos', activos: 'Activos', por_agotarse: 'Por agotarse', agotados: 'Agotados', vencidos: 'Vencidos' };
export const esFiltroPaquetes = (v: unknown): v is FiltroPaquetes => typeof v === 'string' && (FILTROS_PAQUETES as readonly string[]).includes(v);
export function pasaFiltro(p: Paquete, f: FiltroPaquetes, hoy: string): boolean {
  const e = estadoEfectivo(p, hoy);
  switch (f) {
    case 'activos': return e === 'activo' || e === 'por_agotarse' || e === 'vence_pronto';
    case 'por_agotarse': return e === 'por_agotarse' || (e === 'vence_pronto' && porAgotarse(p));
    case 'agotados': return e === 'agotado';
    case 'vencidos': return e === 'vencido';
    default: return true;
  }
}

/** Número con el que el paquete va a la Agenda: «F-123 (PAQ-0001)» si ya tiene factura, si no «PAQ-0001». Igual que paquete_token en SQL. */
export const tokenPaquete = (p: Pick<Paquete, 'correlativo' | 'noFactura'>): string => (p.noFactura && p.noFactura.trim() ? `${p.noFactura.trim()} (${p.correlativo})` : p.correlativo);

const canon = (v: string | null | undefined): string => String(v ?? '').trim().toUpperCase();
/** Espejo TS de paquete_linea_cubre: mismo servicio, misma categoría (o UNICA = cualquiera), territorio solo si la línea lo fija. */
export function lineaCubre(l: { servicio: string; categoria: string; territorio: string | null }, c: { servicio: string; categoria: string; territorio: string }): boolean {
  if (canon(l.servicio) !== canon(c.servicio)) return false;
  const lc = canon(l.categoria), lt = canon(l.territorio);
  if (lc && lc !== 'UNICA' && lc !== canon(c.categoria)) return false;
  if (lt && lt !== 'UNICA' && lt !== canon(c.territorio)) return false;
  return true;
}

/** «Polígrafo pre empleo», «Socioeconómico rutina · Metropolitana», «Psicométricas». */
export function etiquetaLinea(l: Pick<PaqueteLinea, 'servicio' | 'categoria' | 'territorio'>, nombreServicio?: (s: string) => string): string {
  const base = nombreServicio ? nombreServicio(l.servicio) : l.servicio.charAt(0) + l.servicio.slice(1).toLowerCase();
  const cat = canon(l.categoria) && canon(l.categoria) !== 'UNICA' ? ` ${l.categoria.toLowerCase()}` : '';
  const t = l.territorio ?? '';
  const ter = canon(t) && canon(t) !== 'UNICA' ? ` · ${t.charAt(0) + t.slice(1).toLowerCase()}` : '';
  return `${base}${cat}${ter}`;
}

const fechaCorta = (iso: string | null): string => { if (!iso) return ''; const m = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']; return `${Number(iso.slice(8, 10))}-${m[Number(iso.slice(5, 7)) - 1]}${iso.slice(0, 4) !== String(new Date().getFullYear()) ? `-${iso.slice(0, 4)}` : ''}`; };
/** Banner de Por facturar: «Paquete PAQ-0001 · Polígrafo pre empleo: 37 restantes de 100 · vence 31-dic». */
export function textoBanner(p: Paquete, nombreServicio?: (s: string) => string): string {
  const lineas = p.lineas.map(l => `${etiquetaLinea(l, nombreServicio)}: ${l.remanente} restantes de ${l.cantidad}`).join(' · ');
  return `Paquete ${p.correlativo} · ${lineas}${p.venceEn ? ` · vence ${fechaCorta(p.venceEn)}` : ''}`;
}
/** Resumen corto «Usadas 63 de 100 · Restan 37». */
export const textoUsadas = (p: Pick<Paquete, 'lineas'>): string => `Usadas ${totalUsadas(p)} de ${totalCantidad(p)} · Restan ${totalRemanente(p)}`;

const celda = (v: unknown): string => { const x = v === null || v === undefined ? '' : String(v); return /[",;\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
/** CSV del detalle del paquete: una fila por prueba descontada (y las reversiones), más las líneas al pie. */
export function csvDetalle(d: PaqueteDetalle): string {
  const lineas = [['paquete', 'linea', 'persona', 'solicitante', 'puesto', 'expediente', 'fecha_resultado', 'resultado', 'servicio', 'categoria', 'territorio', 'estado_consumo', 'revertido_en', 'motivo_reversion'].join(',')];
  const nombreLinea = new Map(d.paquete.lineas.map(l => [l.id, etiquetaLinea(l)]));
  for (const c of d.consumos) lineas.push([d.paquete.correlativo, nombreLinea.get(c.lineaId) ?? c.lineaId, c.persona, c.solicitante, c.puesto, c.idExterno, c.fechaResultado?.slice(0, 10) ?? '', c.estadoPrueba, c.servicio, c.categoria, c.territorio, c.revertidoEn ? 'revertido' : 'descontado', c.revertidoEn?.slice(0, 10) ?? '', c.motivoReversion ?? ''].map(celda).join(','));
  lineas.push('');
  lineas.push(['linea', 'cantidad', 'usadas', 'remanente', 'precio_unitario_sin_iva', 'valor_remanente'].join(','));
  for (const l of d.paquete.lineas) lineas.push([etiquetaLinea(l), l.cantidad, l.usadas, l.remanente, l.precioUnitario, Math.round(l.remanente * l.precioUnitario * 100) / 100].map(celda).join(','));
  return `﻿${lineas.join('\n')}\n`;
}
