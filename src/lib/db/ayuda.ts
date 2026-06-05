/**
 * F-046 — Centro de Ayuda.
 *
 * Backend para artículos de ayuda. Tabla AYUDA en Airtable; lectura pública
 * a todos los usuarios autenticados, escritura solo para admin (gateado en
 * las server actions, no acá).
 *
 * Búsqueda: full-text en titulo + descripcion + contenido en JS (Airtable no
 * tiene full-text decente). Volumen esperado bajo (decenas de artículos),
 * filtrar in-memory es suficiente. Si crece, agregar índice por palabra.
 *
 * Tags contextuales: campo single-line en Airtable con valores comma-separated.
 * Se parsea a `string[]` al leer. El HelpButton busca por tag exacto
 * (case-insensitive, normalizando espacios).
 *
 * Slugs: únicos en toda la tabla. Validados en `crearArticulo` antes del
 * create — race aceptable (volumen bajo, throughput menor).
 */

import { airtable, USE_MOCK, TABLES } from './airtable';
import { obtenerDateTimeHoyGuatemala } from '../utils/fechas';

/* ============================================================
 * Tipos públicos
 * ============================================================ */

export const CATEGORIAS_AYUDA = [
  'Facturación',
  'Cobros y Retenciones',
  'Empleados y Planilla',
  'Deudas y Pasivos',
  'Notas de Crédito',
  'Conceptos contables',
] as const;

export type CategoriaAyuda = (typeof CATEGORIAS_AYUDA)[number];

export interface Articulo {
  id: string;
  titulo: string;
  slug: string;
  categoria: CategoriaAyuda;
  descripcionCorta: string;
  contenido: string;
  orden: number;
  activo: boolean;
  tagsContextuales: string[];
  fechaCreacion: string;
  fechaModificacion: string;
  modificadoPor?: string;
}

export interface ArticulosFiltros {
  categoria?: CategoriaAyuda;
  search?: string;
  soloActivos?: boolean;          // default true
}

/* ============================================================
 * Mapeo Airtable
 * ============================================================ */

const FA = {
  TITULO:           'Titulo',
  SLUG:             'Slug',
  CATEGORIA:        'Categoria',
  DESC_CORTA:       'Descripcion_Corta',
  CONTENIDO:        'Contenido',
  ORDEN:            'Orden',
  ACTIVO:           'Activo',
  TAGS:             'Tags_Contextuales',
  FECHA_CREACION:   'Fecha_Creacion',
  FECHA_MOD:        'Fecha_Modificacion',
  MODIFICADO_POR:   'Modificado_Por',
} as const;

function categoriaFromAirtable(v: unknown): CategoriaAyuda {
  const s = String(v ?? '').trim();
  if ((CATEGORIAS_AYUDA as readonly string[]).includes(s)) return s as CategoriaAyuda;
  return 'Conceptos contables';
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Parsea "tag1, tag2,tag-3" → ["tag1","tag2","tag-3"]. */
function parseTags(raw: unknown): string[] {
  return String(raw ?? '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Normaliza un tag para comparación case+accent-insensitive. */
function normalizarTag(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function recordToArticulo(r: { id: string; fields: Record<string, unknown> }): Articulo {
  const f = r.fields;
  return {
    id: r.id,
    titulo: String(f[FA.TITULO] ?? '').trim(),
    slug: String(f[FA.SLUG] ?? '').trim(),
    categoria: categoriaFromAirtable(f[FA.CATEGORIA]),
    descripcionCorta: String(f[FA.DESC_CORTA] ?? ''),
    contenido: String(f[FA.CONTENIDO] ?? ''),
    orden: num(f[FA.ORDEN]),
    activo: Boolean(f[FA.ACTIVO]),
    tagsContextuales: parseTags(f[FA.TAGS]),
    fechaCreacion: String(f[FA.FECHA_CREACION] ?? ''),
    fechaModificacion: String(f[FA.FECHA_MOD] ?? ''),
    modificadoPor: f[FA.MODIFICADO_POR] ? String(f[FA.MODIFICADO_POR]) : undefined,
  };
}

/* ============================================================
 * Lectura
 * ============================================================ */

/** Normaliza para búsqueda full-text: lowercase + sin acentos. */
function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export async function getArticulos(filtros: ArticulosFiltros = {}): Promise<Articulo[]> {
  const soloActivos = filtros.soloActivos !== false;   // default true
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(TABLES.AYUDA).select().all();
    let articulos = records.map(r => recordToArticulo({ id: r.id, fields: r.fields as Record<string, unknown> }));

    if (soloActivos)            articulos = articulos.filter(a => a.activo);
    if (filtros.categoria)      articulos = articulos.filter(a => a.categoria === filtros.categoria);
    if (filtros.search?.trim()) {
      const q = normalizarTexto(filtros.search.trim());
      articulos = articulos.filter(a => {
        const haystack = normalizarTexto(`${a.titulo} ${a.descripcionCorta} ${a.contenido}`);
        return haystack.includes(q);
      });
    }

    // Orden por categoría + orden numérico + titulo.
    const ORDEN_CATEGORIAS = new Map(CATEGORIAS_AYUDA.map((c, i) => [c, i]));
    articulos.sort((a, b) => {
      const oa = ORDEN_CATEGORIAS.get(a.categoria) ?? 99;
      const ob = ORDEN_CATEGORIAS.get(b.categoria) ?? 99;
      if (oa !== ob) return oa - ob;
      if (a.orden !== b.orden) return a.orden - b.orden;
      return a.titulo.localeCompare(b.titulo);
    });
    return articulos;
  } catch (err) {
    // Fail-soft: tabla AYUDA no existe o sin permisos.
    console.warn('F-046: getArticulos() falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getArticuloPorSlug(slug: string): Promise<Articulo | null> {
  if (!slug) return null;
  const todos = await getArticulos({ soloActivos: true });
  return todos.find(a => a.slug === slug) ?? null;
}

export async function getArticulosPorTag(tag: string): Promise<Articulo[]> {
  const q = normalizarTag(tag);
  if (!q) return [];
  const todos = await getArticulos({ soloActivos: true });
  return todos.filter(a => a.tagsContextuales.some(t => normalizarTag(t) === q));
}

/* ============================================================
 * Mutaciones (gateadas por admin en server actions)
 * ============================================================ */

export interface CrearArticuloInput {
  titulo: string;
  slug: string;
  categoria: CategoriaAyuda;
  descripcionCorta: string;
  contenido: string;
  orden?: number;
  activo?: boolean;
  tagsContextuales?: string[];
}

export type EditarArticuloInput = Partial<CrearArticuloInput>;

export interface ArticuloMutationResult {
  ok: boolean;
  articuloId?: string;
  slug?: string;
  error?: string;
}

const MIN_CONTENIDO = 50;

/** "Cómo emitir factura" → "como-emitir-factura". */
export function generarSlug(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function slugYaExiste(slug: string, excluirId?: string): Promise<boolean> {
  if (!airtable) return false;
  const records = await airtable(TABLES.AYUDA).select().all();
  return records.some(r => {
    if (excluirId && r.id === excluirId) return false;
    return String(r.fields[FA.SLUG] ?? '').trim() === slug;
  });
}

export async function crearArticulo(input: CrearArticuloInput, usuarioEmail: string): Promise<ArticuloMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  const titulo = input.titulo?.trim();
  const slug = input.slug?.trim();
  if (!titulo) return { ok: false, error: 'El título es requerido.' };
  if (!slug)   return { ok: false, error: 'El slug es requerido.' };
  if (!(CATEGORIAS_AYUDA as readonly string[]).includes(input.categoria)) {
    return { ok: false, error: 'Categoría inválida.' };
  }
  if ((input.contenido ?? '').trim().length < MIN_CONTENIDO) {
    return { ok: false, error: `El contenido debe tener al menos ${MIN_CONTENIDO} caracteres.` };
  }

  try {
    if (await slugYaExiste(slug)) {
      return { ok: false, error: `Ya existe un artículo con el slug "${slug}". Elegí otro.` };
    }

    const ahora = obtenerDateTimeHoyGuatemala();
    type AField = string | number | boolean | undefined;
    const fields: Record<string, AField> = {
      [FA.TITULO]:         titulo,
      [FA.SLUG]:           slug,
      [FA.CATEGORIA]:      input.categoria,
      [FA.DESC_CORTA]:     (input.descripcionCorta ?? '').trim(),
      [FA.CONTENIDO]:      input.contenido,
      [FA.ORDEN]:          input.orden ?? 100,
      [FA.ACTIVO]:         input.activo ?? true,
      [FA.TAGS]:           (input.tagsContextuales ?? []).join(', '),
      [FA.FECHA_CREACION]: ahora,
      [FA.FECHA_MOD]:      ahora,
      [FA.MODIFICADO_POR]: usuarioEmail,
    };
    const created = await airtable(TABLES.AYUDA).create(fields);
    return { ok: true, articuloId: created.id, slug };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function editarArticulo(id: string, cambios: EditarArticuloInput, usuarioEmail: string): Promise<ArticuloMutationResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  try {
    if (cambios.slug !== undefined) {
      const slugLimpio = cambios.slug.trim();
      if (!slugLimpio) return { ok: false, error: 'El slug no puede quedar vacío.' };
      if (await slugYaExiste(slugLimpio, id)) {
        return { ok: false, error: `Ya existe otro artículo con el slug "${slugLimpio}".` };
      }
    }
    if (cambios.categoria && !(CATEGORIAS_AYUDA as readonly string[]).includes(cambios.categoria)) {
      return { ok: false, error: 'Categoría inválida.' };
    }
    if (cambios.contenido !== undefined && cambios.contenido.trim().length < MIN_CONTENIDO) {
      return { ok: false, error: `El contenido debe tener al menos ${MIN_CONTENIDO} caracteres.` };
    }

    type AField = string | number | boolean | undefined;
    const fields: Record<string, AField> = {};
    if (cambios.titulo !== undefined)             fields[FA.TITULO]      = cambios.titulo.trim();
    if (cambios.slug !== undefined)               fields[FA.SLUG]        = cambios.slug.trim();
    if (cambios.categoria !== undefined)          fields[FA.CATEGORIA]   = cambios.categoria;
    if (cambios.descripcionCorta !== undefined)   fields[FA.DESC_CORTA]  = cambios.descripcionCorta.trim();
    if (cambios.contenido !== undefined)          fields[FA.CONTENIDO]   = cambios.contenido;
    if (cambios.orden !== undefined)              fields[FA.ORDEN]       = cambios.orden;
    if (cambios.activo !== undefined)             fields[FA.ACTIVO]      = cambios.activo;
    if (cambios.tagsContextuales !== undefined)   fields[FA.TAGS]        = cambios.tagsContextuales.join(', ');

    fields[FA.FECHA_MOD]      = obtenerDateTimeHoyGuatemala();
    fields[FA.MODIFICADO_POR] = usuarioEmail;

    await airtable(TABLES.AYUDA).update([{ id, fields }]);
    return { ok: true, articuloId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function desactivarArticulo(id: string, usuarioEmail: string): Promise<ArticuloMutationResult> {
  return editarArticulo(id, { activo: false }, usuarioEmail);
}
