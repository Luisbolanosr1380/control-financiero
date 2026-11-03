/**
 * MAPA DE PRECIOS (027) · tipos, parseo de la RPC `precios_mapa`, filtros, CSV y la MISMA regla en TS
 * (para que el validador compare la RPC contra una implementación independiente). Puro: sin I/O.
 *
 * Reglas (brief del CFO): solo pruebas `cobra` con tarifa resuelta (> 0) de expedientes vigentes con NIT,
 * ingresadas en el rango; montos SIN IVA. Benchmark = mediana entre clientes del precio promedio de cada
 * cliente por (servicio, categoría; nula = 'UNICA'). indice = producción / producción a mercado; brecha =
 * max(mercado − producción, 0). Cuadrante por (pruebas ≥ umbral_vol, indice ≥ umbral_idx).
 */

export const CUADRANTES = ['Estrellas', 'Volumen con descuento', 'Premium de nicho', 'Por revisar'] as const;
export type Cuadrante = (typeof CUADRANTES)[number];

export const COLOR_CUADRANTE: Record<Cuadrante, string> = {
  'Estrellas': '#3D7A4E',
  'Volumen con descuento': '#8A2A2A',
  'Premium de nicho': '#2B3A6B',
  'Por revisar': '#B8801C',
};

export const DESCRIPCION_CUADRANTE: Record<Cuadrante, string> = {
  'Estrellas': 'Mucho volumen y precio en la mediana o arriba: cuidar.',
  'Volumen con descuento': 'Mucho volumen con precio debajo de la mediana: acá está la brecha.',
  'Premium de nicho': 'Poco volumen y buen precio: crecer sin bajar precio.',
  'Por revisar': 'Poco volumen y precio bajo: revisar la relación.',
};

export interface ClienteMapa {
  cliente: string; nit: string;
  pruebas: number; poligrafos: number; socios: number;
  produccion: number; produccion_mercado: number; indice: number; brecha: number; precio_efectivo: number;
  cuadrante: Cuadrante;
}
export interface FranjaMapa { servicio: string; orden: 1 | 2 | 3; franja: 'Bajo' | 'Medio' | 'Alto'; p25: number | null; p75: number | null; clientes: number; pruebas: number; produccion: number }
export interface ReferenciaMapa { servicio: string; categoria: string | null; clientes: number; minimo: number; p25: number; mediana: number; p75: number; maximo: number; pruebas: number; precio_real: number | null }
export interface ServicioMapa { servicio: string; pruebas: number; produccion: number; precio_promedio: number }
export interface CuadranteResumen { cuadrante: Cuadrante; clientes: number; pruebas: number; produccion: number; brecha: number; pct_clientes: number; pct_pruebas: number; pct_produccion: number; pct_brecha: number }
export interface ResumenMapa {
  produccion: number; pruebas: number; clientes: number; brecha: number;
  top5: number; top10: number; top20: number;
  mayor_cliente: ClienteMapa | null; mayor_brecha: ClienteMapa | null; mayor_indice: ClienteMapa | null;
  cuadrantes: CuadranteResumen[];
}
export interface ParametrosMapa { desde: string; hasta: string | null; umbral_vol: number; umbral_idx: number; hoy: string }
export interface MapaPrecios { parametros: ParametrosMapa; clientes: ClienteMapa[]; franjas: FranjaMapa[]; referencias: ReferenciaMapa[]; servicios: ServicioMapa[]; resumen: ResumenMapa }

// ── Parseo ─────────────────────────────────────────────────────────────────────────────────────
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const nOpc = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const esCuadrante = (v: unknown): v is Cuadrante => (CUADRANTES as readonly string[]).includes(String(v));
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function parseCliente(r: Record<string, unknown>): ClienteMapa {
  return {
    cliente: txt(r.cliente), nit: txt(r.nit), pruebas: n(r.pruebas), poligrafos: n(r.poligrafos), socios: n(r.socios),
    produccion: n(r.produccion), produccion_mercado: n(r.produccion_mercado), indice: n(r.indice), brecha: n(r.brecha), precio_efectivo: n(r.precio_efectivo),
    cuadrante: esCuadrante(r.cuadrante) ? r.cuadrante : 'Por revisar',
  };
}

export function parseMapa(raw: unknown): MapaPrecios {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p = (o.parametros ?? {}) as Record<string, unknown>;
  const rs = (o.resumen ?? {}) as Record<string, unknown>;
  const cli = (v: unknown): ClienteMapa | null => (v && typeof v === 'object' ? parseCliente(v as Record<string, unknown>) : null);
  return {
    parametros: { desde: txt(p.desde), hasta: p.hasta ? txt(p.hasta) : null, umbral_vol: n(p.umbral_vol), umbral_idx: n(p.umbral_idx), hoy: txt(p.hoy) },
    clientes: arr(o.clientes).map(parseCliente),
    franjas: arr(o.franjas).map(r => ({ servicio: txt(r.servicio), orden: (n(r.orden) as 1 | 2 | 3), franja: (txt(r.franja) as FranjaMapa['franja']), p25: nOpc(r.p25), p75: nOpc(r.p75), clientes: n(r.clientes), pruebas: n(r.pruebas), produccion: n(r.produccion) })),
    referencias: arr(o.referencias).map(r => ({ servicio: txt(r.servicio), categoria: r.categoria === null || r.categoria === undefined ? null : txt(r.categoria), clientes: n(r.clientes), minimo: n(r.minimo), p25: n(r.p25), mediana: n(r.mediana), p75: n(r.p75), maximo: n(r.maximo), pruebas: n(r.pruebas), precio_real: nOpc(r.precio_real) })),
    servicios: arr(o.servicios).map(r => ({ servicio: txt(r.servicio), pruebas: n(r.pruebas), produccion: n(r.produccion), precio_promedio: n(r.precio_promedio) })),
    resumen: {
      produccion: n(rs.produccion), pruebas: n(rs.pruebas), clientes: n(rs.clientes), brecha: n(rs.brecha),
      top5: n(rs.top5), top10: n(rs.top10), top20: n(rs.top20),
      mayor_cliente: cli(rs.mayor_cliente), mayor_brecha: cli(rs.mayor_brecha), mayor_indice: cli(rs.mayor_indice),
      cuadrantes: arr(rs.cuadrantes).map(r => ({ cuadrante: esCuadrante(r.cuadrante) ? r.cuadrante : 'Por revisar', clientes: n(r.clientes), pruebas: n(r.pruebas), produccion: n(r.produccion), brecha: n(r.brecha), pct_clientes: n(r.pct_clientes), pct_pruebas: n(r.pct_pruebas), pct_produccion: n(r.pct_produccion), pct_brecha: n(r.pct_brecha) })),
    },
  };
}

// ── Filtros (search params) ────────────────────────────────────────────────────────────────────
export interface FiltrosMapa { desde: string; hasta: string; umbralVol: number; umbralIdx: number }
export const UMBRAL_VOL_DEFECTO = 60;
export const UMBRAL_IDX_DEFECTO = 1;
export const fechaValida = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Por defecto: el año en curso completo (brief: "2026 completo"), umbrales 60 pruebas e índice 1.00. */
export function filtrosPorDefecto(hoy: Date): FiltrosMapa {
  const anio = hoy.getFullYear();
  return { desde: `${anio}-01-01`, hasta: `${anio}-12-31`, umbralVol: UMBRAL_VOL_DEFECTO, umbralIdx: UMBRAL_IDX_DEFECTO };
}

/** Lee ?desde&hasta&vol&idx con validación; lo inválido cae al defecto; hasta < desde → hasta = desde. */
export function filtrosDesdeParams(sp: Record<string, string | string[] | undefined>, hoy: Date): FiltrosMapa {
  const def = filtrosPorDefecto(hoy);
  const uno = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const desde = fechaValida(uno('desde')) ? uno('desde')! : def.desde;
  const hasta0 = fechaValida(uno('hasta')) ? uno('hasta')! : def.hasta;
  const vol = Number(uno('vol')); const idx = Number(uno('idx'));
  return {
    desde, hasta: hasta0 < desde ? desde : hasta0,
    umbralVol: Number.isInteger(vol) && vol >= 1 && vol <= 100000 ? vol : def.umbralVol,
    umbralIdx: Number.isFinite(idx) && idx > 0 && idx <= 10 ? Math.round(idx * 100) / 100 : def.umbralIdx,
  };
}

export const queryDeFiltros = (f: FiltrosMapa): string => `?desde=${f.desde}&hasta=${f.hasta}&vol=${f.umbralVol}&idx=${f.umbralIdx}`;

// ── IVA, franjas, orden, CSV ───────────────────────────────────────────────────────────────────
export const IVA = 1.12;
export const r2 = (x: number): number => Math.round(x * 100) / 100;
export const r3 = (x: number): number => Math.round(x * 1000) / 1000;
export const conIva = (q: number): number => r2(q * IVA);

export type ColumnaClientes = keyof Pick<ClienteMapa, 'cliente' | 'nit' | 'pruebas' | 'poligrafos' | 'socios' | 'produccion' | 'produccion_mercado' | 'indice' | 'brecha' | 'precio_efectivo' | 'cuadrante'>;
export const COLUMNAS_CLIENTES: ReadonlyArray<{ k: ColumnaClientes; label: string; num: boolean }> = [
  { k: 'cliente', label: 'Cliente', num: false }, { k: 'nit', label: 'NIT', num: false },
  { k: 'pruebas', label: 'Pruebas', num: true }, { k: 'poligrafos', label: 'Polígrafos', num: true }, { k: 'socios', label: 'Socios', num: true },
  { k: 'produccion', label: 'Producción', num: true }, { k: 'produccion_mercado', label: 'A mercado', num: true },
  { k: 'indice', label: 'Índice', num: true }, { k: 'brecha', label: 'Brecha', num: true }, { k: 'precio_efectivo', label: 'Precio efectivo', num: true },
  { k: 'cuadrante', label: 'Cuadrante', num: false },
];

export function ordenarClientes(clientes: readonly ClienteMapa[], col: ColumnaClientes, dir: 'asc' | 'desc'): ClienteMapa[] {
  const s = dir === 'asc' ? 1 : -1;
  return [...clientes].sort((a, b) => {
    const va = a[col], vb = b[col];
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
    return c !== 0 ? c * s : a.cliente.localeCompare(b.cliente, 'es');
  });
}

const celda = (v: unknown): string => { const t = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** CSV de la tabla de clientes (sin IVA), con BOM para Excel. */
export function csvClientes(clientes: readonly ClienteMapa[], f?: FiltrosMapa): string {
  const cab = ['cliente', 'nit', 'pruebas', 'poligrafos', 'socios', 'produccion_sin_iva', 'produccion_mercado_sin_iva', 'indice', 'brecha_sin_iva', 'precio_efectivo_sin_iva', 'cuadrante'];
  const filas = clientes.map(c => [c.cliente, c.nit, c.pruebas, c.poligrafos, c.socios, c.produccion, c.produccion_mercado, c.indice, c.brecha, c.precio_efectivo, c.cuadrante].map(celda).join(','));
  const nota = f ? [`# mapa de precios · ingresos ${f.desde} a ${f.hasta} · umbral volumen ${f.umbralVol} · umbral indice ${f.umbralIdx} · montos sin IVA`] : [];
  return '﻿' + [...nota, cab.join(','), ...filas].join('\n');
}

export const etiquetaFecha = (iso: string): string => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`; };

// ── La misma regla en TS (paridad con la RPC) ──────────────────────────────────────────────────
export interface FilaCobro { nit: string; servicio: string; categoria: string | null; monto: number }
export interface FilaTarifa { nit: string; servicio: string; categoria: string | null; monto: number }

/** percentile_cont de Postgres (interpolación lineal) sobre valores ya ordenados o no. */
export function percentil(valores: readonly number[], p: number): number {
  const v = [...valores].sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const pos = (v.length - 1) * p; const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
const avg = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const catKey = (c: string | null): string => c ?? 'UNICA';

export function cuadranteDe(pruebas: number, indice: number, umbralVol: number, umbralIdx: number): Cuadrante {
  if (pruebas >= umbralVol) return indice >= umbralIdx ? 'Estrellas' : 'Volumen con descuento';
  return indice >= umbralIdx ? 'Premium de nicho' : 'Por revisar';
}

/** Benchmark por (servicio, categoría): mediana entre clientes del precio promedio de cada cliente. */
export function benchmark(filas: readonly FilaCobro[]): Map<string, number> {
  const porCliente = new Map<string, number[]>();
  for (const f of filas) { const k = `${f.servicio}|${catKey(f.categoria)}|${f.nit}`; (porCliente.get(k) ?? porCliente.set(k, []).get(k)!).push(f.monto); }
  const promedios = new Map<string, number[]>();
  for (const [k, ms] of porCliente) { const sc = k.slice(0, k.lastIndexOf('|')); (promedios.get(sc) ?? promedios.set(sc, []).get(sc)!).push(avg(ms)); }
  return new Map([...promedios].map(([sc, ps]) => [sc, percentil(ps, 0.5)]));
}

/** `clientes` del Anexo: una fila por NIT con producción > 0, ordenadas por producción desc. */
export function calcularClientes(filas: readonly FilaCobro[], nombres: ReadonlyMap<string, string>, umbralVol: number, umbralIdx: number): ClienteMapa[] {
  const bm = benchmark(filas);
  const por = new Map<string, { pruebas: number; poligrafos: number; socios: number; prod: number; ref: number }>();
  for (const f of filas) {
    const a = por.get(f.nit) ?? { pruebas: 0, poligrafos: 0, socios: 0, prod: 0, ref: 0 };
    a.pruebas++; if (f.servicio.startsWith('POLIGRAFO')) a.poligrafos++; if (f.servicio.startsWith('SOCIO')) a.socios++;
    a.prod += f.monto; a.ref += bm.get(`${f.servicio}|${catKey(f.categoria)}`) ?? 0;
    por.set(f.nit, a);
  }
  return [...por].filter(([, a]) => a.prod > 0).map(([nit, a]) => ({
    cliente: nombres.get(nit) ?? `NIT ${nit}`, nit, pruebas: a.pruebas, poligrafos: a.poligrafos, socios: a.socios,
    produccion: r2(a.prod), produccion_mercado: r2(a.ref), indice: r3(a.prod / a.ref), brecha: r2(Math.max(a.ref - a.prod, 0)), precio_efectivo: r2(a.prod / a.pruebas),
    cuadrante: cuadranteDe(a.pruebas, a.prod / a.ref, umbralVol, umbralIdx),
  })).sort((x, y) => y.produccion - x.produccion || x.nit.localeCompare(y.nit));
}

export function calcularResumen(clientes: readonly ClienteMapa[]): Omit<ResumenMapa, never> {
  const prod = sum(clientes.map(c => c.produccion)), pruebas = sum(clientes.map(c => c.pruebas)), brecha = sum(clientes.map(c => c.brecha));
  const top = (k: number) => (prod > 0 ? Math.round((sum(clientes.slice(0, k).map(c => c.produccion)) / prod) * 1000) / 10 : 0);
  const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : 0);
  const cuadrantes = CUADRANTES.map(q => {
    const cs = clientes.filter(c => c.cuadrante === q);
    const p = r2(sum(cs.map(c => c.produccion))), b = r2(sum(cs.map(c => c.brecha))), pr = sum(cs.map(c => c.pruebas));
    return { cuadrante: q, clientes: cs.length, pruebas: pr, produccion: p, brecha: b, pct_clientes: pct(cs.length, clientes.length), pct_pruebas: pct(pr, pruebas), pct_produccion: pct(p, prod), pct_brecha: pct(b, brecha) };
  }).sort((a, b) => b.produccion - a.produccion || a.cuadrante.localeCompare(b.cuadrante));
  const mayor = (f: (c: ClienteMapa) => number) => (clientes.length ? [...clientes].sort((a, b) => f(b) - f(a) || b.produccion - a.produccion)[0] : null);
  return { produccion: r2(prod), pruebas, clientes: clientes.length, brecha: r2(brecha), top5: top(5), top10: top(10), top20: top(20), mayor_cliente: clientes[0] ?? null, mayor_brecha: mayor(c => c.brecha), mayor_indice: mayor(c => c.indice), cuadrantes };
}

export function calcularServicios(filas: readonly FilaCobro[]): ServicioMapa[] {
  const por = new Map<string, number[]>();
  for (const f of filas) (por.get(f.servicio) ?? por.set(f.servicio, []).get(f.servicio)!).push(f.monto);
  return [...por].map(([servicio, ms]) => ({ servicio, pruebas: ms.length, produccion: r2(sum(ms)), precio_promedio: r2(sum(ms) / ms.length) })).sort((a, b) => b.produccion - a.produccion || a.servicio.localeCompare(b.servicio));
}

export const LINEAS_REFERENCIA: ReadonlyArray<readonly [string, string]> = [['POLIGRAFO', 'PRE EMPLEO'], ['POLIGRAFO', 'RUTINA'], ['POLIGRAFO', 'ESPECIFICO'], ['POLIGRAFO BASIC', 'PRE EMPLEO'], ['SOCIOECONOMICO', 'PRE EMPLEO'], ['SOCIOECONOMICO', 'RUTINA']];

/** Estadísticos del tarifario activo por (servicio, categoría): precio promedio por cliente → min/p25/mediana/p75/max. */
function estadisticosTarifario(tarifas: readonly FilaTarifa[]): Map<string, { clientes: number; minimo: number; p25: number; mediana: number; p75: number; maximo: number }> {
  const porCliente = new Map<string, number[]>();
  for (const t of tarifas) { if (!(t.monto > 0)) continue; const k = `${t.servicio}|${t.categoria ?? ''}|${t.nit}`; (porCliente.get(k) ?? porCliente.set(k, []).get(k)!).push(t.monto); }
  const ps = new Map<string, number[]>();
  for (const [k, ms] of porCliente) { const sc = k.slice(0, k.lastIndexOf('|')); (ps.get(sc) ?? ps.set(sc, []).get(sc)!).push(avg(ms)); }
  return new Map([...ps].map(([sc, v]) => [sc, { clientes: v.length, minimo: Math.min(...v), p25: percentil(v, 0.25), mediana: percentil(v, 0.5), p75: percentil(v, 0.75), maximo: Math.max(...v) }]));
}

export function calcularReferencias(tarifas: readonly FilaTarifa[], filas: readonly FilaCobro[]): ReferenciaMapa[] {
  const st = estadisticosTarifario(tarifas);
  const vol = new Map<string, number[]>();
  for (const f of filas) { const k = `${f.servicio}|${f.categoria ?? ''}`; (vol.get(k) ?? vol.set(k, []).get(k)!).push(f.monto); }
  return LINEAS_REFERENCIA.flatMap(([servicio, categoria]) => {
    const s = st.get(`${servicio}|${categoria}`); if (!s) return [];
    const v = vol.get(`${servicio}|${categoria}`) ?? [];
    return [{ servicio, categoria, clientes: s.clientes, minimo: r2(s.minimo), p25: r2(s.p25), mediana: r2(s.mediana), p75: r2(s.p75), maximo: r2(s.maximo), pruebas: v.length, precio_real: v.length ? r2(sum(v) / v.length) : null }];
  }).sort((a, b) => b.pruebas - a.pruebas || a.servicio.localeCompare(b.servicio) || String(a.categoria).localeCompare(String(b.categoria)));
}

export const franjaDe = (precio: number, p25: number, p75: number): 1 | 2 | 3 => (precio < p25 ? 1 : precio <= p75 ? 2 : 3);
const NOMBRE_FRANJA: Record<1 | 2 | 3, FranjaMapa['franja']> = { 1: 'Bajo', 2: 'Medio', 3: 'Alto' };

/** Franjas preempleo (polígrafo y socio): el precio promedio cobrado a cada cliente contra p25/p75 del tarifario. 6 celdas siempre. */
export function calcularFranjas(tarifas: readonly FilaTarifa[], filas: readonly FilaCobro[]): FranjaMapa[] {
  const st = estadisticosTarifario(tarifas);
  const out: FranjaMapa[] = [];
  for (const servicio of ['POLIGRAFO', 'SOCIOECONOMICO']) {
    const l = st.get(`${servicio}|PRE EMPLEO`);
    const porCliente = new Map<string, number[]>();
    for (const f of filas) if (f.servicio === servicio && f.categoria === 'PRE EMPLEO') (porCliente.get(f.nit) ?? porCliente.set(f.nit, []).get(f.nit)!).push(f.monto);
    for (const orden of [1, 2, 3] as const) {
      const cs = l ? [...porCliente.values()].filter(ms => franjaDe(avg(ms), l.p25, l.p75) === orden) : [];
      out.push({ servicio, orden, franja: NOMBRE_FRANJA[orden], p25: l ? r2(l.p25) : null, p75: l ? r2(l.p75) : null, clientes: cs.length, pruebas: sum(cs.map(ms => ms.length)), produccion: r2(sum(cs.map(ms => sum(ms)))) });
    }
  }
  return out;
}

/** El mapa completo en TS (sin `parametros`), para comparar con la RPC. */
export function calcularMapa(filas: readonly FilaCobro[], tarifas: readonly FilaTarifa[], nombres: ReadonlyMap<string, string>, umbralVol: number, umbralIdx: number): Omit<MapaPrecios, 'parametros'> {
  const clientes = calcularClientes(filas, nombres, umbralVol, umbralIdx);
  return { clientes, resumen: calcularResumen(clientes), servicios: calcularServicios(filas), referencias: calcularReferencias(tarifas, filas), franjas: calcularFranjas(tarifas, filas) };
}
