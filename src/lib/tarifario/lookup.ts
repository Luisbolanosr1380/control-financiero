/**
 * TARIFARIO · Motor de lookup — PURO (sin IO).
 *
 * Desde un expediente de la Agenda (empresa o NIT + tipo de prueba +
 * categoría + territorio) resuelve el precio SIN IVA pactado con el
 * cliente. Reglas:
 *  - El cliente se identifica por NIT; si el expediente solo trae el nombre
 *    de la empresa (así viene de la Agenda), se resuelve por alias: el
 *    nombre o la razón social del catálogo de clientes, o el alias que el
 *    tarifario guarda tras " / " en la razón social ("ABIRSA / ZVI, KLEIN").
 *  - Variantes de grafía → canónicas (canon.ts).
 *  - Sin territorio en el expediente: si el precio es el mismo en
 *    METROPOLITANA y DEPARTAMENTAL se resuelve igual (es lo común); si
 *    difiere → "ambigua" y hay que indicarlo.
 *  - Q0 = "sin tarifa" (no gratis): se devuelve como tal, nunca como precio.
 *  - COMPLETO = POLIGRAFO + SOCIOECONOMICO: se resuelven los dos y se suman.
 *  - Varias tarifas activas para la misma llave canónica (duplicado con
 *    distinta grafía): mismo monto → ok con aviso; distinto → ambigua.
 *  - FORMAS DE PRECIO (canon.ts): matriz (categoría × territorio, como arriba),
 *    por territorio (SOCIO EMPRESARIAL: ignora la categoría del expediente) y
 *    único (INFORNET: ignora categoría y territorio). Para las formas sin
 *    categoría, que el expediente venga sin categoría NO es "sin tarifa".
 */
import { nitComparable, nitEsPlaceholder } from '@/lib/clientes/nit';
import { canonCategoria, canonTerritorio, canonTipoPrueba, conIva, esSinTarifa, formaPrecio, llaveTarifa, normalizarTexto, usaCategoria, usaTerritorio } from './canon';

export interface Tarifa {
  id: string;
  nit: string;
  razonSocial: string;
  tipoPrueba: string;
  categoria: string;
  territorio: string;
  /** Sin IVA. 0 = sin tarifa definida. */
  monto: number;
  anio: string;
  aprobadoPor: string;
  aprobadoEn: string | null;
  activo: boolean;
  /** Última modificación de la fila (fallback de "precio desde" cuando no hay historial ni año). */
  updatedAt?: string | null;
}

export interface Expediente {
  nit?: string | null;
  /** Nombre de la empresa tal como está en la Agenda (si no hay NIT). */
  empresa?: string | null;
  tipoPrueba: string;
  categoria: string;
  territorio?: string | null;
}

/** Alias conocido → NIT (catálogo de clientes + alias del tarifario). */
export interface AliasCliente { nombre: string; nit: string | null | undefined }

export type ResultadoLookup =
  | { estado: 'ok'; nit: string; monto: number; iva: number; total: number; tarifa: Tarifa; componentes?: Tarifa[]; aprobada: boolean; avisos: string[] }
  | { estado: 'sin_tarifa'; nit: string; tarifa: Tarifa; componentes?: Tarifa[]; mensaje: string }
  | { estado: 'ambigua'; nit: string; candidatas: Tarifa[]; mensaje: string }
  | { estado: 'no_encontrada'; nit: string; candidatas: Tarifa[]; mensaje: string }
  | { estado: 'cliente_no_identificado'; mensaje: string };

/**
 * Forma base de un nombre de empresa para comparar: sin acentos ni
 * puntuación, sin sufijos societarios (S.A., SOCIEDAD ANONIMA, LTDA…).
 * "PRODUCTOS AVICOLAS, S.A." y "PRODUCTOS AVICOLAS" quedan iguales.
 */
export function nombreBase(s: string | null | undefined): string {
  return normalizarTexto(s)
    .replace(/[.,;:'"]/g, ' ')
    .replace(/\b(SOCIEDAD ANONIMA|SOCIEDAD ANÓNIMA|S A|SA|LTDA|LIMITADA|Y CIA|CIA|S DE RL|SRL|INC|CORP)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Alias que el tarifario guarda en la razón social: "RAZÓN / ALIAS" y "RAZÓN (ALIAS)" → ["RAZÓN", "ALIAS"]. */
export function aliasDeRazonSocial(razonSocial: string | null | undefined): string[] {
  const raw = String(razonSocial ?? '');
  const partes = raw.split('/');
  const parentesis = [...raw.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  const sinParentesis = partes.map(p => p.replace(/\([^)]*\)/g, ' '));
  return [...new Set([...partes, ...sinParentesis, ...parentesis].map(nombreBase).filter(Boolean))];
}

/** Índice nombre base → NIT, a partir del catálogo de clientes y del tarifario. */
export function indiceAlias(tarifas: readonly Tarifa[], clientes: readonly AliasCliente[] = []): Map<string, string> {
  const idx = new Map<string, string>();
  const poner = (nombre: string, nit: string | null | undefined) => {
    const n = nombreBase(nombre), k = nitComparable(nit);
    if (n && k && !nitEsPlaceholder(k) && !idx.has(n)) idx.set(n, k);
  };
  for (const c of clientes) poner(c.nombre, c.nit);
  for (const t of tarifas) for (const a of aliasDeRazonSocial(t.razonSocial)) poner(a, t.nit);
  return idx;
}

/** NIT del expediente: directo, o por alias de la empresa. '' si no se identifica (o si hay más de un candidato). */
export function resolverNit(exp: Pick<Expediente, 'nit' | 'empresa'>, alias: ReadonlyMap<string, string>): string {
  const directo = nitComparable(exp.nit);
  if (directo && !nitEsPlaceholder(directo)) return directo;
  const nombre = nombreBase(exp.empresa);
  if (!nombre) return '';
  const exacto = alias.get(nombre);
  if (exacto) return exacto;
  // Tolerancia: la Agenda abrevia o agrega un sufijo ("CREDICHAPIN A"); vale un prefijo por palabras completas,
  // en cualquiera de los dos sentidos, siempre que apunte a UN solo NIT.
  const base = nombre.replace(/\s+[A-Z0-9]$/, '');
  const candidatos = new Set<string>();
  for (const [k, v] of alias) {
    if (k === base || k.startsWith(base + ' ') || base.startsWith(k + ' ') || nombre.startsWith(k + ' ')) candidatos.add(v);
  }
  return candidatos.size === 1 ? [...candidatos][0] : '';
}

function elegir(cands: Tarifa[], nit: string, territorio: string): { ok: Tarifa; avisos: string[] } | { ambigua: Tarifa[]; mensaje: string } | null {
  if (cands.length === 0) return null;
  const porTerritorio = territorio ? cands.filter(c => canonTerritorio(c.territorio) === territorio) : cands;
  if (porTerritorio.length === 0) return null;
  const montos = new Set(porTerritorio.map(c => Number(c.monto)));
  if (montos.size > 1) {
    return { ambigua: porTerritorio, mensaje: territorio
      ? `Hay ${porTerritorio.length} tarifas activas para la misma combinación del NIT ${nit} con montos distintos: corregí el tarifario.`
      : `El precio cambia según el territorio (${porTerritorio.map(c => `${canonTerritorio(c.territorio)} Q${Number(c.monto).toFixed(2)}`).join(' · ')}): indicá METROPOLITANA o DEPARTAMENTAL.` };
  }
  const avisos: string[] = [];
  if (!territorio && new Set(porTerritorio.map(c => canonTerritorio(c.territorio))).size > 1) avisos.push('El expediente no indica territorio; el precio es el mismo en METROPOLITANA y DEPARTAMENTAL.');
  if (porTerritorio.length > 1 && territorio) avisos.push(`La combinación está repetida ${porTerritorio.length} veces en el tarifario (misma tarifa con distinta grafía).`);
  return { ok: porTerritorio[0], avisos };
}

/**
 * Forma 'unico': todas las tarifas activas del tipo valen (aunque alguna legacy traiga categoría/territorio).
 * Las filas en Q0 son "sin tarifa definida", no un precio: si hay UNA con precio y el resto en Q0 (el patrón
 * real de PDA / INSIGHT cargados como matriz de 6 celdas), se usa esa y se avisa que hay que normalizar.
 * Dos o más precios distintos → ambigua. Todas en Q0 → la primera (el motor la reporta como sin tarifa).
 */
function elegirUnico(cands: Tarifa[], nit: string, tp: string): { ok: Tarifa; avisos: string[] } | { ambigua: Tarifa[]; mensaje: string } | null {
  if (cands.length === 0) return null;
  const conPrecio = cands.filter(c => !esSinTarifa(c.monto));
  const montos = new Set(conPrecio.map(c => Number(c.monto)));
  if (montos.size > 1) return { ambigua: conPrecio, mensaje: `${tp} es de precio único por cliente y el NIT ${nit} tiene ${montos.size} montos distintos (${[...montos].map(m => `Q${m.toFixed(2)}`).join(' · ')}): dejá uno solo en el tarifario.` };
  const avisos: string[] = [];
  if (cands.length > 1) avisos.push(`${tp} tiene ${cands.length} filas para el mismo cliente (precio único${conPrecio.length === 1 ? `, ${cands.length - 1} en Q0` : ''}): conviene normalizarlas a una.`);
  return { ok: conPrecio[0] ?? cands[0], avisos };
}

/** Resuelve el precio de un expediente contra el tarifario (solo tarifas activas). */
export function resolverTarifa(tarifas: readonly Tarifa[], exp: Expediente, clientes: readonly AliasCliente[] = []): ResultadoLookup {
  const nit = resolverNit(exp, indiceAlias(tarifas, clientes));
  if (!nit) return { estado: 'cliente_no_identificado', mensaje: exp.empresa ? `No se pudo identificar el NIT de "${exp.empresa}": vinculá la empresa a un cliente con NIT.` : 'El expediente no trae NIT ni empresa.' };
  const delCliente = tarifas.filter(t => t.activo && nitComparable(t.nit) === nit);
  if (delCliente.length === 0) return { estado: 'no_encontrada', nit, candidatas: [], mensaje: `El NIT ${nit} no tiene tarifario cargado.` };

  const tipo = canonTipoPrueba(exp.tipoPrueba), cat = canonCategoria(exp.categoria), ter = canonTerritorio(exp.territorio);
  // 'COMPLETO' acá es un pedido EXPLÍCITO de los dos servicios (lookup manual / canon de "POLIGRAFO, SOCIOECONOMICO").
  // El motor de la Agenda (mapeo.ts) nunca lo pasa: cotiza cada servicio de la fila por separado (fix "COMPLETO doble").
  const tipos = tipo === 'COMPLETO' ? ['POLIGRAFO', 'SOCIOECONOMICO'] : [tipo];
  const partes: Tarifa[] = []; const avisos: string[] = [];
  for (const tp of tipos) {
    const forma = formaPrecio(tp);
    if (usaCategoria(forma) && !cat) return { estado: 'no_encontrada', nit, candidatas: delCliente, mensaje: `${tp} se cobra por categoría y el expediente no trae categoría de prueba (PRE EMPLEO / RUTINA / ESPECIFICO).` };
    const delTipo = delCliente.filter(t => canonTipoPrueba(t.tipoPrueba) === tp);
    const cands = usaCategoria(forma) ? delTipo.filter(t => canonCategoria(t.categoria) === cat) : delTipo;
    const r = forma === 'unico' ? elegirUnico(cands, nit, tp) : elegir(cands, nit, usaTerritorio(forma) ? ter : '');
    if (!r) {
      const etiqueta = usaCategoria(forma) ? `${tp} ${cat}` : tp;
      const sinTerritorio = ter && usaTerritorio(forma) ? cands : [];
      const msg = sinTerritorio.length
        ? `El NIT ${nit} tiene ${etiqueta} pero no en ${ter} (solo ${[...new Set(sinTerritorio.map(t => canonTerritorio(t.territorio)))].join(', ')}).`
        : `El NIT ${nit} no tiene tarifa para ${etiqueta}${ter && usaTerritorio(forma) ? ' ' + ter : ''}${forma === 'unico' ? ' (precio único por cliente)' : forma === 'territorio' ? ' (precio por territorio, sin categoría)' : ''}.`;
      return { estado: 'no_encontrada', nit, candidatas: delCliente, mensaje: msg };
    }
    if ('ambigua' in r) return { estado: 'ambigua', nit, candidatas: r.ambigua, mensaje: r.mensaje };
    partes.push(r.ok); avisos.push(...r.avisos);
  }
  const sinTarifa = partes.find(p => esSinTarifa(p.monto));
  if (sinTarifa) return { estado: 'sin_tarifa', nit, tarifa: sinTarifa, componentes: partes.length > 1 ? partes : undefined, mensaje: `${canonTipoPrueba(sinTarifa.tipoPrueba)} ${canonCategoria(sinTarifa.categoria)} ${canonTerritorio(sinTarifa.territorio)} está en Q0: sin tarifa definida (no es gratis). Hay que pactarla y cargarla.` };
  const monto = partes.reduce((s, p) => s + Number(p.monto), 0);
  const { iva, total } = conIva(monto);
  const aprobada = partes.every(p => !!p.aprobadoEn);
  if (!aprobada) avisos.push('La tarifa no está aprobada en el tarifario.');
  return { estado: 'ok', nit, monto, iva, total, tarifa: partes[0], componentes: partes.length > 1 ? partes : undefined, aprobada, avisos };
}

/** Tarifa activa que ya ocupa la misma llave canónica (para avisar antes de crear/editar). */
export function buscarDuplicado(tarifas: readonly Tarifa[], nueva: { nit: string; tipoPrueba: string; categoria: string; territorio: string }, excluirId?: string): Tarifa | null {
  const k = llaveTarifa(nueva);
  return tarifas.find(t => t.activo && t.id !== excluirId && llaveTarifa(t) === k) ?? null;
}

/** id → true para las tarifas activas cuya llave canónica está repetida (señal en la lista). */
export function tarifasDuplicadas(tarifas: readonly Tarifa[]): Set<string> {
  const porLlave = new Map<string, Tarifa[]>();
  for (const t of tarifas) if (t.activo) { const k = llaveTarifa(t); porLlave.set(k, [...(porLlave.get(k) ?? []), t]); }
  const out = new Set<string>();
  for (const g of porLlave.values()) if (g.length > 1) for (const t of g) out.add(t.id);
  return out;
}
