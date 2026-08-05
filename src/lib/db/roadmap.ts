// ============================================================
// F-ROADMAP: Control de Roadmap (solo admin) — el tablero personal
// del dueño: qué está hecho, qué sigue y en qué orden.
//
// Tabla nueva (supabase/06_roadmap.sql), nace en Supabase — sin rama
// Airtable. Lectura: dataSource('roadmap_items'); escritura: gate por
// la operación 'sistema' (contenido administrativo, como ayuda).
// Coherente con "no se borra": descartar = estado Descartado.
// ============================================================

import { dataSource, writeSource } from '../config/data-source';
import { fetchAll, supabase } from '../supabase/client';
import { insertar, actualizarPorAppId } from '../supabase/writes';

export const ESTADOS_ROADMAP = ['Idea', 'Pendiente', 'En progreso', 'Hecho', 'Pausado', 'Descartado'] as const;
export type EstadoRoadmap = (typeof ESTADOS_ROADMAP)[number];

export const PRIORIDADES_ROADMAP = ['Alta', 'Media', 'Baja'] as const;
export type PrioridadRoadmap = (typeof PRIORIDADES_ROADMAP)[number];

// Sugerencias para el datalist del form — la categoría es texto libre.
export const CATEGORIAS_ROADMAP_SUGERIDAS = [
  'Contable', 'Financiero', 'Multi-empresa', 'Facturación/Cobros', 'Gastos', 'Ayuda', 'General',
] as const;

export interface RoadmapItem {
  id: string;                    // id de app ('sbw…')
  titulo: string;
  descripcion?: string;
  categoria: string;
  estado: EstadoRoadmap;
  prioridad: PrioridadRoadmap;
  impacto?: string;
  orden: number;
  fechaObjetivo?: string;        // YYYY-MM-DD
  fechaHecho?: string;           // ISO — sellada al marcar Hecho
  notas?: string;
  createdAt: string;
}

export interface CrearRoadmapItemInput {
  titulo: string;
  descripcion?: string;
  categoria?: string;
  estado?: EstadoRoadmap;
  prioridad?: PrioridadRoadmap;
  impacto?: string;
  orden?: number;
  fechaObjetivo?: string;
  notas?: string;
}

export type EditarRoadmapItemInput = Partial<CrearRoadmapItemInput>;

export type RoadmapMutationResult =
  | { ok: true; itemId: string; mensaje: string }
  | { ok: false; error: string };

interface RowRoadmap {
  airtable_id: string;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  estado: string;
  prioridad: string;
  impacto: string | null;
  orden: number | null;
  fecha_objetivo: string | null;
  fecha_hecho: string | null;
  notas: string | null;
  created_at: string;
}

function rowToItem(r: RowRoadmap): RoadmapItem {
  return {
    id: r.airtable_id,
    titulo: r.titulo,
    descripcion: r.descripcion ?? undefined,
    categoria: r.categoria || 'General',
    estado: (ESTADOS_ROADMAP as readonly string[]).includes(r.estado) ? r.estado as EstadoRoadmap : 'Idea',
    prioridad: (PRIORIDADES_ROADMAP as readonly string[]).includes(r.prioridad) ? r.prioridad as PrioridadRoadmap : 'Media',
    impacto: r.impacto ?? undefined,
    orden: Number(r.orden ?? 100),
    fechaObjetivo: r.fecha_objetivo ?? undefined,
    fechaHecho: r.fecha_hecho ?? undefined,
    notas: r.notas ?? undefined,
    createdAt: r.created_at,
  };
}

const PRIO_PESO: Record<PrioridadRoadmap, number> = { Alta: 0, Media: 1, Baja: 2 };

/** Todos los ítems (incluye Descartado — la UI decide qué mostrar). */
export async function getRoadmapItems(): Promise<RoadmapItem[]> {
  if (dataSource('roadmap_items') !== 'supabase') return [];
  try {
    const rows = await fetchAll<RowRoadmap>('roadmap_items');
    return rows.map(rowToItem).sort((a, b) =>
      PRIO_PESO[a.prioridad] - PRIO_PESO[b.prioridad] || a.orden - b.orden || a.createdAt.localeCompare(b.createdAt));
  } catch (err) {
    console.error('Error leyendo roadmap:', err);
    return [];
  }
}

function validar(input: CrearRoadmapItemInput | EditarRoadmapItemInput): string | null {
  if (input.estado !== undefined && !(ESTADOS_ROADMAP as readonly string[]).includes(input.estado)) {
    return `Estado inválido: "${input.estado}".`;
  }
  if (input.prioridad !== undefined && !(PRIORIDADES_ROADMAP as readonly string[]).includes(input.prioridad)) {
    return `Prioridad inválida: "${input.prioridad}".`;
  }
  return null;
}

export async function crearRoadmapItem(input: CrearRoadmapItemInput): Promise<RoadmapMutationResult> {
  if (writeSource('sistema') !== 'supabase') return { ok: false, error: 'El roadmap requiere el backend Supabase.' };
  const titulo = (input.titulo ?? '').trim();
  if (!titulo) return { ok: false, error: 'El título es requerido.' };
  const invalido = validar(input);
  if (invalido) return { ok: false, error: invalido };

  try {
    const estado = input.estado ?? 'Idea';
    const res = await insertar('roadmap_items', {
      titulo,
      descripcion: input.descripcion?.trim() || null,
      categoria: input.categoria?.trim() || 'General',
      estado,
      prioridad: input.prioridad ?? 'Media',
      impacto: input.impacto?.trim() || null,
      orden: input.orden ?? 100,
      fecha_objetivo: input.fechaObjetivo || null,
      fecha_hecho: estado === 'Hecho' ? new Date().toISOString() : null,
      notas: input.notas?.trim() || null,
    });
    return { ok: true, itemId: res.airtable_id, mensaje: `"${titulo}" agregado al roadmap.` };
  } catch (err) {
    return { ok: false, error: `No se pudo crear el ítem: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function editarRoadmapItem(itemId: string, cambios: EditarRoadmapItemInput): Promise<RoadmapMutationResult> {
  if (writeSource('sistema') !== 'supabase') return { ok: false, error: 'El roadmap requiere el backend Supabase.' };
  const invalido = validar(cambios);
  if (invalido) return { ok: false, error: invalido };
  if (cambios.titulo !== undefined && !cambios.titulo.trim()) return { ok: false, error: 'El título no puede quedar vacío.' };

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (cambios.titulo !== undefined)        patch.titulo = cambios.titulo.trim();
    if (cambios.descripcion !== undefined)   patch.descripcion = cambios.descripcion.trim() || null;
    if (cambios.categoria !== undefined)     patch.categoria = cambios.categoria.trim() || 'General';
    if (cambios.prioridad !== undefined)     patch.prioridad = cambios.prioridad;
    if (cambios.impacto !== undefined)       patch.impacto = cambios.impacto.trim() || null;
    if (cambios.orden !== undefined)         patch.orden = cambios.orden;
    if (cambios.fechaObjetivo !== undefined) patch.fecha_objetivo = cambios.fechaObjetivo || null;
    if (cambios.notas !== undefined)         patch.notas = cambios.notas.trim() || null;
    if (cambios.estado !== undefined) {
      patch.estado = cambios.estado;
      // Sello al marcar Hecho; al salir de Hecho se limpia (volvió a estar vivo).
      if (cambios.estado === 'Hecho') {
        const sb = supabase();
        const { data } = sb ? await sb.from('roadmap_items').select('fecha_hecho').eq('airtable_id', itemId).single() : { data: null };
        patch.fecha_hecho = (data as { fecha_hecho: string | null } | null)?.fecha_hecho ?? new Date().toISOString();
      } else {
        patch.fecha_hecho = null;
      }
    }
    await actualizarPorAppId('roadmap_items', itemId, patch);
    return { ok: true, itemId, mensaje: 'Ítem actualizado.' };
  } catch (err) {
    return { ok: false, error: `No se pudo actualizar: ${err instanceof Error ? err.message : String(err)}` };
  }
}
