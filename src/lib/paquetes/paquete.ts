/**
 * PAQUETES PREPAGADOS (034) — PURO (sin IO; va al navegador, al servidor y a los validadores).
 *
 * El cliente paga N pruebas por adelantado (una factura, el anticipo); cada prueba terminada descuenta una del paquete
 * y no se vuelve a facturar. Acá viven los tipos que devuelven las RPC (paquete_resumen / paquete_detalle), el estado
 * EFECTIVO que ve la pantalla (activo / por agotarse / agotado / vence pronto / vencido / cerrado), el umbral por
 * defecto, el espejo TS de `paquete_linea_cubre` (paridad SQL / TS), los textos de banner y badge, los filtros de la
 * lista global y el CSV del detalle. 036: un paquete lo pueden usar varios NIT (titular + adicionales): nitsDe, la etiqueta
 * «Compartido · titular: …» y el subtotal de usadas por NIT.
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
  /** 036: razón social del titular (la de la factura del anticipo). */
  razonSocial: string | null;
  /** 036: NIT ADICIONALES que también consumen (grupo de empresas). `nit` sigue siendo el titular. */
  nitsAdicionales: NitAdicional[];
  /** 036: pruebas descontadas vigentes por NIT (titular y adicionales; también de un NIT que ya se quitó y cuyas pruebas se mantuvieron). */
  usadasPorNit: Record<string, number>;
}
export interface NitAdicional { nit: string; nombre: string | null; razonSocial: string | null; agregadoPor: string | null; agregadoEn: string | null }
export interface ConsumoPaquete {
  id: string; lineaId: string; componenteId: string; fecha: string; revertidoEn: string | null; motivoReversion: string | null;
  fechaResultado: string | null; servicio: string; categoria: string; territorio: string; estadoPrueba: string; situacion: string;
  persona: string; solicitante: string; puesto: string; idExterno: string; expedienteId: string; detalleId: string | null; noFactura: string | null;
  /** 036: NIT y empresa (razón social) a la que pertenece la prueba. */
  nit: string; empresa: string;
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
    razonSocial: sn(r.razon_social),
    nitsAdicionales: (Array.isArray(r.nits_adicionales) ? (r.nits_adicionales as Record<string, unknown>[]) : []).map(x => ({ nit: s(x.nit), nombre: sn(x.nombre), razonSocial: sn(x.razon_social), agregadoPor: sn(x.agregado_por), agregadoEn: sn(x.agregado_en) })).filter(x => x.nit),
    usadasPorNit: Object.fromEntries(Object.entries((r.usadas_por_nit && typeof r.usadas_por_nit === 'object' ? r.usadas_por_nit : {}) as Record<string, unknown>).map(([k, v]) => [k, n(v)])),
    lineas: lineas.map(l => ({ id: s(l.id), servicio: s(l.servicio), categoria: s(l.categoria), territorio: sn(l.territorio), cantidad: n(l.cantidad), precioUnitario: n(l.precio_unitario), usadas: n(l.usadas), remanente: n(l.remanente), avisoUmbralEn: sn(l.aviso_umbral_en), agotadoEn: sn(l.agotado_en) })),
  };
}
export function parseConsumo(raw: unknown): ConsumoPaquete {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: s(r.id), lineaId: s(r.linea_id), componenteId: s(r.componente_id), fecha: s(r.fecha), revertidoEn: sn(r.revertido_en), motivoReversion: sn(r.motivo_reversion),
    fechaResultado: sn(r.fecha_resultado), servicio: s(r.servicio), categoria: s(r.categoria), territorio: s(r.territorio), estadoPrueba: s(r.estado_prueba), situacion: s(r.situacion),
    persona: s(r.persona), solicitante: s(r.solicitante), puesto: s(r.puesto), idExterno: s(r.id_externo), expedienteId: s(r.expediente_id), detalleId: sn(r.detalle_id), noFactura: sn(r.no_factura),
    nit: s(r.nit), empresa: s(r.empresa),
  };
}

/* ── 036 · un paquete que usan varios NIT ── */
/** Todos los NIT que consumen del paquete: el titular primero y después los adicionales. Igual que paquete_nits en SQL. */
export const nitsDe = (p: Pick<Paquete, 'nit' | 'nitsAdicionales'>): string[] => [p.nit, ...(p.nitsAdicionales ?? []).map(x => x.nit).filter(x => x && x !== p.nit)];
export const esCompartido = (p: Pick<Paquete, 'nitsAdicionales'>): boolean => (p.nitsAdicionales ?? []).length > 0;
/** Nombre corto de una razón social para etiquetas: «SAGRACO, S.A.» → «SAGRACO». */
export const nombreCorto = (razon: string | null | undefined): string => String(razon ?? '').replace(/[,\s]+(S\.?\s?A\.?|SOCIEDAD AN[OÓ]NIMA|LTDA\.?|LIMITADA|S\.?\s?R\.?\s?L\.?)\s*\.?\s*$/i, '').trim();
/** «Compartido · titular: SAGRACO (1083171)»: la etiqueta del paquete visto desde un NIT adicional. */
export const etiquetaCompartido = (p: Pick<Paquete, 'nit' | 'cliente' | 'razonSocial'>): string => `Compartido · titular: ${nombreCorto(p.razonSocial) || p.cliente || 'NIT'} (${p.nit})`;
/** Nombre con el que se muestra un NIT del paquete (titular o adicional): razón social, si no el nombre, si no el NIT. */
export function nombreDeNit(p: Pick<Paquete, 'nit' | 'cliente' | 'razonSocial' | 'nitsAdicionales'>, nit: string): string {
  if (nit === p.nit) return p.razonSocial || p.cliente || nit;
  const a = (p.nitsAdicionales ?? []).find(x => x.nit === nit);
  return a?.razonSocial || a?.nombre || nit;
}
/** «1083171 +1» de la lista global: el titular y cuántos más; `title` con los demás. */
export const tituloNits = (p: Pick<Paquete, 'nit' | 'cliente' | 'razonSocial' | 'nitsAdicionales'>): string => (p.nitsAdicionales ?? []).map(a => `${a.razonSocial || a.nombre || 'sin cliente'} (${a.nit})`).join(' · ');
export interface SubtotalNit { nit: string; empresa: string; usadas: number; titular: boolean; vigente: boolean }
/**
 * Subtotal de pruebas descontadas (vigentes) por NIT: el titular, cada adicional (aunque lleve 0) y, si quedaron pruebas
 * mantenidas de un NIT que ya se quitó, también ese NIT (`vigente: false`). Titular primero, después por alta.
 */
export function subtotalesPorNit(d: PaqueteDetalle): SubtotalNit[] {
  const p = d.paquete, vig = d.consumos.filter(c => !c.revertidoEn);
  const cuenta = new Map<string, number>(); const emp = new Map<string, string>();
  for (const c of vig) { cuenta.set(c.nit, (cuenta.get(c.nit) ?? 0) + 1); if (c.empresa) emp.set(c.nit, c.empresa); }
  const del = nitsDe(p);
  const out: SubtotalNit[] = del.map(nit => ({ nit, empresa: nombreDeNit(p, nit) || emp.get(nit) || nit, usadas: cuenta.get(nit) ?? 0, titular: nit === p.nit, vigente: true }));
  for (const [nit, usadas] of cuenta) if (!del.includes(nit)) out.push({ nit, empresa: emp.get(nit) || nit || 'sin NIT', usadas, titular: false, vigente: false });
  return out;
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
  const lineas = [['paquete', 'linea', 'persona', 'solicitante', 'puesto', 'expediente', 'fecha_resultado', 'resultado', 'servicio', 'categoria', 'territorio', 'estado_consumo', 'revertido_en', 'motivo_reversion', 'nit', 'empresa'].join(',')];
  const nombreLinea = new Map(d.paquete.lineas.map(l => [l.id, etiquetaLinea(l)]));
  for (const c of d.consumos) lineas.push([d.paquete.correlativo, nombreLinea.get(c.lineaId) ?? c.lineaId, c.persona, c.solicitante, c.puesto, c.idExterno, c.fechaResultado?.slice(0, 10) ?? '', c.estadoPrueba, c.servicio, c.categoria, c.territorio, c.revertidoEn ? 'revertido' : 'descontado', c.revertidoEn?.slice(0, 10) ?? '', c.motivoReversion ?? '', c.nit, c.empresa].map(celda).join(','));
  lineas.push('');
  lineas.push(['linea', 'cantidad', 'usadas', 'remanente', 'precio_unitario_sin_iva', 'valor_remanente'].join(','));
  for (const l of d.paquete.lineas) lineas.push([etiquetaLinea(l), l.cantidad, l.usadas, l.remanente, l.precioUnitario, Math.round(l.remanente * l.precioUnitario * 100) / 100].map(celda).join(','));
  if (esCompartido(d.paquete) || subtotalesPorNit(d).length > 1) {
    lineas.push('');
    lineas.push(['nit', 'empresa', 'usadas'].join(','));
    for (const t of subtotalesPorNit(d)) lineas.push([t.nit, t.empresa, t.usadas].map(celda).join(','));
  }
  return `﻿${lineas.join('\n')}\n`;
}
