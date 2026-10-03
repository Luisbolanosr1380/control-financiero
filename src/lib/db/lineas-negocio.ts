// ============================================================
// FIX-DASHBOARD-ANALITICA-HIT — Líneas de negocio derivadas de la base.
//
// PRINCIPIO MULTI-EMPRESA: toda "línea de negocio" / "servicio" que se
// muestre en cualquier pantalla sale de los centros_costo ACTIVOS de la
// base DE ESTE deploy. Cero listas fijas de Golden. (Verificado: los
// activos de Golden son exactamente sus 4 líneas históricas, así este
// mecanismo reproduce Golden tal cual; HIT trae sus 6 propias.)
//
// Los colores de las líneas históricas de Golden se conservan (fidelidad
// visual); cualquier nombre nuevo recibe un color estable por hash.
// ============================================================

import { getCentrosCosto, type Naturaleza } from './centros';

export interface ServicioNegocio {
  id: string;
  nombre: string;
  naturaleza: Naturaleza | null;
}

/** Centros de costo ACTIVOS de la base del deploy = las líneas/servicios del negocio. */
export async function getServiciosActivos(): Promise<ServicioNegocio[]> {
  const centros = await getCentrosCosto();
  return centros
    .filter(c => c.activo && c.nombre.trim())
    .map(c => ({ id: c.id, nombre: c.nombre.trim(), naturaleza: c.naturaleza }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Colores fijos para los nombres históricos (Golden no cambia de look)…
const COLOR_FIJO: Record<string, string> = {
  'Poligrafia':      'var(--line-poligrafo)',
  'Poligrafia Xela': 'var(--line-poligrafo)',
  'Socioeconomicos': 'var(--line-socio)',
  'TalentTrackAI':   'var(--line-talenttrack)',
  'Administrativo':  'var(--line-ventas)',
  'Otros':           'var(--ink-4)',
};
// …y paleta estable por hash para cualquier línea nueva (HIT u otras).
const PALETA = ['#1d4ed8', '#0f766e', '#6d28d9', '#b45309', '#9f1239', '#4d7c0f', '#0e7490', '#86198f'];

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function colorServicio(nombre: string): string {
  if (COLOR_FIJO[nombre]) return COLOR_FIJO[nombre];
  let h = 0;
  for (const ch of norm(nombre)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return PALETA[h % PALETA.length];
}

// Abreviaturas históricas; para nombres nuevos, iniciales o primeros chars.
const ABREV_FIJA: Record<string, string> = {
  'Poligrafia':      'Polí',
  'Poligrafia Xela': 'PolíX',
  'Socioeconomicos': 'Socio',
  'TalentTrackAI':   'TT',
  'Administrativo':  'Admin',
};
export function abrevServicio(nombre: string): string {
  if (ABREV_FIJA[nombre]) return ABREV_FIJA[nombre];
  const palabras = nombre.trim().split(/\s+/).filter(w => w.length > 2);
  if (palabras.length >= 2) return palabras.map(w => w[0].toUpperCase()).join('');
  return nombre.slice(0, 5);
}

/**
 * Bloque de texto para los prompts de AI (Auros / análisis semanal):
 * describe las líneas DE ESTA EMPRESA con su naturaleza, en vez de las
 * reglas quemadas de Golden ("Polígrafo recurrente, TalentTrack proyecto").
 */
export function describirLineasParaPrompt(servicios: ServicioNegocio[]): string {
  if (servicios.length === 0) return 'Esta empresa todavía no tiene líneas de negocio (centros de costo) configuradas.';
  const recurrentes = servicios.filter(s => s.naturaleza === 'recurrente').map(s => s.nombre);
  const proyecto    = servicios.filter(s => s.naturaleza === 'proyecto').map(s => s.nombre);
  const sinNat      = servicios.filter(s => s.naturaleza === null).map(s => s.nombre);
  const partes = [
    `Líneas de negocio ACTIVAS de esta empresa (centros de costo): ${servicios.map(s => s.nombre).join(', ')}.`,
    recurrentes.length
      ? `- RECURRENTES (facturan mes a mes): ${recurrentes.join(', ')}. En estas, un cliente que deja de facturar 2+ meses es señal REAL de fuga y hay que accionar.`
      : null,
    proyecto.length
      ? `- POR PROYECTO (episódicas): ${proyecto.join(', ')}. Un cliente puede pasar 3-4 meses sin pedir y es NORMAL, NO es fuga.`
      : null,
    sinNat.length
      ? `- Sin naturaleza definida: ${sinNat.join(', ')} (no asumas si son recurrentes o por proyecto).`
      : null,
    `- "Otros" = ingresos sin clasificar (residual). No lo trates al nivel de las líneas reales.`,
  ];
  return partes.filter(Boolean).join('\n');
}
