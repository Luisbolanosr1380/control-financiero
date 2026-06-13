/**
 * F-052.1 — Motor de sugerencia de centro de costo.
 *
 * Patrón "AI sugiere, humano decide", análogo a F-052 (sugerencia de
 * cuenta contable). Mismo bucle de aprendizaje pasivo: al aprobar el
 * gasto, la cuenta y CC finalmente elegidos se persisten como
 * `cuenta_gasto_habitual` y `centro_costo_habitual` del proveedor.
 *
 * Jerarquía (primera fuente con match válido gana):
 *
 *   1. memoria       — PROVEEDORES.centro_costo_habitual del proveedor.
 *   2. recurrente    — OBLIGACIÓN_RECURRENTE activa del proveedor con
 *                      centro_costo seteado.
 *   3. derivacion    — fuerte señal heurística: la cuenta de gasto
 *                      ELEGIDA (o sugerida por F-052) determina el CC
 *                      por prefijo de código. Ej: 5-1-3-x → Poligrafia.
 *                      Va DESPUÉS de memoria/recurrente porque la
 *                      memoria del proveedor es más confiable cuando
 *                      Stark la corrigió en una factura previa.
 *   4. ia            — Gemini structured con el proveedor + la cuenta
 *                      elegida + la lista de CCs activos.
 *   5. sin sugerencia.
 *
 * NUNCA sugerimos "Pendiente" (es el catch-all manual para los casos
 * donde el operativo no sabe; un sistema que lo sugiere por default
 * lo elige siempre y rompe la analítica por línea).
 *
 * Las fuentes 1-3 son instantáneas y gratis: solo se llama a Gemini si
 * ninguna resolvió. En la práctica F-052 + derivación cubren el 90%
 * de los gastos recurrentes (renta → Administrativo, hosting → memoria
 * del proveedor, costos de producción → derivación).
 */

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

import { airtable } from '@/lib/db/airtable';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import {
  PROVEEDORES_TABLE_ID,
  PROVEEDORES_FIELDS,
} from '@/lib/airtable/proveedores-fields';
import {
  OBLIGACIONES_RECURRENTES_TABLE_ID,
  OBLIGACIONES_RECURRENTES_FIELDS,
} from '@/lib/airtable/obligaciones-recurrentes-fields';

/* =========================================================================
 * Tipos públicos
 * ========================================================================= */

export type OrigenSugerenciaCC =
  | 'memoria'
  | 'recurrente'
  | 'derivacion'
  | 'ia'
  | null;

export interface SugerenciaCentroCosto {
  centroCostoId: string | null;
  nombre: string | null;
  origen: OrigenSugerenciaCC;
  /** 0..1. Fuentes locales devuelven 1; IA reporta su confianza. */
  confianza: number;
  /** Solo cuando origen='ia'. Tooltip para humanos. */
  razon?: string;
}

export interface SugerirCentroCostoInput {
  /** record-id de PROVEEDORES (si ya existe). */
  proveedorId?: string;
  proveedorNombre: string;
  proveedorNit?: string;
  /** Texto crudo del OCR / descripción libre. */
  descripcion?: string;
  /**
   * F-052.1: cuenta contable ya elegida o sugerida por F-052. Es la
   * señal más fuerte después de memoria/recurrente — por eso entra al
   * input acá. El caller pasa el código (ej "5-1-3-2") y/o el nombre.
   */
  cuentaCodigo?: string;
  cuentaNombre?: string;
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

function arrFirst(v: unknown): string {
  if (Array.isArray(v) && v.length > 0) {
    const x = v[0];
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && 'id' in (x as object)) {
      return String((x as { id?: unknown }).id ?? '');
    }
  }
  return '';
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/* =========================================================================
 * Catch-all "Pendiente" — nunca sugerir
 * ========================================================================= */

/**
 * Detecta el CC catch-all "Pendiente" por nombre. NO usamos su recordId
 * hardcoded para evitar romper si Stark lo renombra o recrea — el match
 * por nombre normalizado es robusto y declarativo.
 */
function esPendiente(nombre: string): boolean {
  return normalizar(nombre) === 'pendiente';
}

/* =========================================================================
 * F-052.1: mapeo cuenta → CC por prefijo de código
 *
 * Heurística declarativa: las cuentas de costo directo (5-1-3, 5-1-4)
 * apuntan a su línea de negocio respectiva. Las de administración
 * general (6-1, 6-4, 6-5, 6-7) van a Administrativo. Las de outsourcing
 * (5-1-1) y ventas/marketing (6-2) NO tienen CC fijo: el caller cae a
 * memoria/IA. Match contra el set de CCs por nombre normalizado:
 * si Stark renombra "Poligrafía" a "Polígrafo", se busca y resuelve
 * sin tocar este código.
 * ========================================================================= */

interface ReglaDerivacion {
  /** Prefijo del código contable, incluido el guión final ("5-1-3-"). */
  prefijoCodigo?: string;
  /** Tokens de nombre de cuenta que también disparan la regla (fallback). */
  tokensNombreCuenta?: readonly string[];
  /** Nombre del CC al que apunta (matched por normalización). */
  centroCostoNombre: string;
}

const REGLAS_DERIVACION: ReadonlyArray<ReglaDerivacion> = [
  // Costos directos por línea de negocio.
  { prefijoCodigo: '5-1-3-', tokensNombreCuenta: ['poligraf'],     centroCostoNombre: 'Poligrafia' },
  { prefijoCodigo: '5-1-4-', tokensNombreCuenta: ['socio'],        centroCostoNombre: 'Socioeconomicos' },
  { prefijoCodigo: '5-1-5-', tokensNombreCuenta: ['talent'],       centroCostoNombre: 'TalentTrackAI' },
  // Gastos generales de administración.
  { prefijoCodigo: '6-1-',                                          centroCostoNombre: 'Administrativo' },
  { prefijoCodigo: '6-4-',                                          centroCostoNombre: 'Administrativo' },
  { prefijoCodigo: '6-5-',                                          centroCostoNombre: 'Administrativo' },
  { prefijoCodigo: '6-7-',                                          centroCostoNombre: 'Administrativo' },
  // 5-1-1 (outsourcing) y 6-2 (ventas/marketing): NO se derivan — caen
  // a memoria/IA porque el CC depende del cliente final atendido.
];

interface CentroCostoMin { id: string; nombre: string }

function buscarCentroPorNombre(nombre: string, centros: readonly CentroCostoMin[]): CentroCostoMin | undefined {
  const q = normalizar(nombre);
  if (!q) return undefined;
  return centros.find(c => normalizar(c.nombre) === q)
      ?? centros.find(c => normalizar(c.nombre).includes(q));
}

function derivarCCDesdeCuenta(
  cuentaCodigo: string | undefined,
  cuentaNombre: string | undefined,
  centros: readonly CentroCostoMin[],
): CentroCostoMin | undefined {
  const codigo = (cuentaCodigo ?? '').trim();
  const nombreN = normalizar(cuentaNombre ?? '');

  for (const regla of REGLAS_DERIVACION) {
    const matchCodigo = !!regla.prefijoCodigo && codigo.startsWith(regla.prefijoCodigo);
    const matchNombre = (regla.tokensNombreCuenta ?? []).some(t => nombreN.includes(t));
    if (!matchCodigo && !matchNombre) continue;
    const cc = buscarCentroPorNombre(regla.centroCostoNombre, centros);
    if (cc) return cc;
  }
  return undefined;
}

/* =========================================================================
 * Lecturas locales
 * ========================================================================= */

async function leerCentroHabitualProveedor(proveedorId: string): Promise<string | null> {
  if (!airtable || !proveedorId) return null;
  try {
    const records = await airtable(PROVEEDORES_TABLE_ID)
      .select({
        returnFieldsByFieldId: true,
        filterByFormula: `RECORD_ID() = '${proveedorId}'`,
        maxRecords: 1,
      })
      .all();
    if (records.length === 0) return null;
    const link = (records[0].fields as Record<string, unknown>)[PROVEEDORES_FIELDS.centro_costo_habitual];
    return arrFirst(link) || null;
  } catch (err) {
    console.warn('F-052.1 leerCentroHabitualProveedor falló:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function centroDeObligacionRecurrente(proveedorId: string): Promise<string | null> {
  if (!airtable || !proveedorId) return null;
  try {
    const records = await airtable(OBLIGACIONES_RECURRENTES_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const activo = Boolean(f[OBLIGACIONES_RECURRENTES_FIELDS.activo]);
      if (!activo) continue;
      const provId = arrFirst(f[OBLIGACIONES_RECURRENTES_FIELDS.proveedor]);
      if (provId !== proveedorId) continue;
      const ccId = arrFirst(f[OBLIGACIONES_RECURRENTES_FIELDS.centro_costo]);
      if (ccId) return ccId;
    }
    return null;
  } catch (err) {
    console.warn('F-052.1 centroDeObligacionRecurrente falló:', err instanceof Error ? err.message : err);
    return null;
  }
}

/* =========================================================================
 * Fuente 4 — Gemini structured
 * ========================================================================= */

const MODELO_SUGERENCIA = 'gemini-2.5-flash';

const SugerenciaCCIAOutputSchema = z.object({
  centro_costo_nombre: z
    .string()
    .describe('Nombre EXACTO de UNO de los CCs del catálogo provisto. Case-sensitive. Si dudás, elegí el más conservador del set.'),
  confianza: z.number().min(0).max(1)
    .describe('0-1. Si la descripción es genérica o no hay señal clara, bajá la confianza por debajo de 0.5.'),
  razon: z.string()
    .describe('Una oración corta para tooltip humano. Ej: "Hosting general → Administrativo".'),
});

const SYSTEM_PROMPT_CC = `Sos un contador asistiendo a clasificar facturas por línea de negocio (centro de costo) en Golden Talent Guatemala.

Tarea: dado el proveedor, la descripción y la cuenta contable ya elegida, devolver el CENTRO DE COSTO más probable del catálogo provisto.

Reglas:
- Elegí el nombre EXACTO de uno de los CCs del catálogo (case-sensitive).
- "Pendiente" es catch-all manual: NUNCA lo sugieras. Si nada encaja con certeza, bajá la confianza por debajo de 0.4 y elegí el CC más conservador del resto.
- Pistas de mapeo (heurística):
    · Costos directos de Polígrafos (5-1-3) → Poligrafia.
    · Costos directos de Socioeconómicos (5-1-4) → Socioeconomicos.
    · Costos directos de TalentTrack (5-1-5) → TalentTrackAI.
    · Administración general (6-1, 6-4, 6-5, 6-7), gastos legales,
      financieros, ISR → Administrativo.
    · Outsourcing (5-1-1) y Ventas/Marketing (6-2) dependen del proyecto:
      si la descripción no especifica cliente, conservá baja confianza.
- La 'razon' va al tooltip; sé directo y SECO. Ej: "Renta general → Administrativo".`;

interface ResultadoGemini {
  ok: boolean;
  centroNombre?: string;
  confianza?: number;
  razon?: string;
}

async function sugerirConGemini(
  input: SugerirCentroCostoInput,
  centros: readonly CentroCostoMin[],
): Promise<ResultadoGemini> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return { ok: false };
  if (centros.length === 0) return { ok: false };

  // Filtramos "Pendiente" del set ofrecido a Gemini — nunca queremos
  // que lo sugiera. Si por error lo hace, el validador post-fetch
  // lo descarta también.
  const sugeribles = centros.filter(c => !esPendiente(c.nombre));
  const catalogoTxt = sugeribles.map(c => `- ${c.nombre}`).join('\n');

  const detalle = [
    `Proveedor: ${input.proveedorNombre || '(sin nombre)'}`,
    input.proveedorNit ? `NIT: ${input.proveedorNit}` : null,
    input.cuentaCodigo || input.cuentaNombre
      ? `Cuenta contable elegida: ${input.cuentaCodigo ?? ''}${input.cuentaCodigo && input.cuentaNombre ? ' · ' : ''}${input.cuentaNombre ?? ''}`
      : null,
    input.descripcion ? `Descripción / OCR:\n${input.descripcion.slice(0, 1500)}` : null,
  ].filter(Boolean).join('\n');

  try {
    const result = await generateObject({
      model: google(MODELO_SUGERENCIA),
      schema: SugerenciaCCIAOutputSchema,
      system: SYSTEM_PROMPT_CC,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `Catálogo de centros de costo (uno por línea):\n${catalogoTxt}\n\n---\n\nFactura a clasificar:\n${detalle}\n\nDevolvé el nombre exacto + confianza + razón breve.`,
      }],
    });
    return {
      ok: true,
      centroNombre: result.object.centro_costo_nombre.trim(),
      confianza:    result.object.confianza,
      razon:        result.object.razon,
    };
  } catch (err) {
    console.warn('F-052.1 sugerirConGemini falló:', err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

/* =========================================================================
 * API pública
 * ========================================================================= */

const sinSugerencia = (): SugerenciaCentroCosto => ({
  centroCostoId: null, nombre: null, origen: null, confianza: 0,
});

function asSugerencia(
  cc: CentroCostoMin,
  origen: Exclude<OrigenSugerenciaCC, null | 'ia'>,
): SugerenciaCentroCosto {
  return { centroCostoId: cc.id, nombre: cc.nombre, origen, confianza: 1 };
}

export async function sugerirCentroCosto(input: SugerirCentroCostoInput): Promise<SugerenciaCentroCosto> {
  const centros = await getCentrosCostoActivos();
  if (centros.length === 0) return sinSugerencia();
  const byId = new Map(centros.map(c => [c.id, c]));

  // Fuente 1 — memoria del proveedor.
  if (input.proveedorId) {
    const memoriaId = await leerCentroHabitualProveedor(input.proveedorId);
    if (memoriaId) {
      const cc = byId.get(memoriaId);
      // Guardrail: si la memoria es "Pendiente" la ignoramos para no
      // perpetuar un mal seteo histórico.
      if (cc && !esPendiente(cc.nombre)) return asSugerencia(cc, 'memoria');
    }
  }

  // Fuente 2 — obligación recurrente.
  if (input.proveedorId) {
    const recId = await centroDeObligacionRecurrente(input.proveedorId);
    if (recId) {
      const cc = byId.get(recId);
      if (cc && !esPendiente(cc.nombre)) return asSugerencia(cc, 'recurrente');
    }
  }

  // Fuente 3 — derivación desde la cuenta sugerida/elegida.
  const ccDerivado = derivarCCDesdeCuenta(input.cuentaCodigo, input.cuentaNombre, centros);
  if (ccDerivado && !esPendiente(ccDerivado.nombre)) return asSugerencia(ccDerivado, 'derivacion');

  // Fuente 4 — Gemini.
  const ia = await sugerirConGemini(input, centros);
  if (!ia.ok || !ia.centroNombre) return sinSugerencia();

  const cc = buscarCentroPorNombre(ia.centroNombre, centros);
  if (!cc) {
    console.warn(`F-052.1 IA devolvió CC inexistente: "${ia.centroNombre}"`);
    return sinSugerencia();
  }
  if (esPendiente(cc.nombre)) {
    // Defensa extra: si pese a la instrucción Gemini eligió Pendiente,
    // descartamos. Es preferible "sin sugerencia" a forzar al usuario
    // a corregir el catch-all.
    return sinSugerencia();
  }

  return {
    centroCostoId: cc.id,
    nombre:        cc.nombre,
    origen:        'ia',
    confianza:     ia.confianza ?? 0,
    razon:         ia.razon,
  };
}

/* =========================================================================
 * F-052.1 — aprendizaje pasivo
 * ========================================================================= */

export async function aprenderCentroHabitualProveedor(args: {
  proveedorId: string;
  centroCostoId: string;
}): Promise<boolean> {
  if (!airtable) return false;
  if (!args.proveedorId || !args.centroCostoId) return false;
  try {
    // No persistimos "Pendiente" como hábito — esa elección NUNCA es
    // intencional como memoria del proveedor.
    const centros = await getCentrosCostoActivos();
    const cc = centros.find(c => c.id === args.centroCostoId);
    if (cc && esPendiente(cc.nombre)) return false;

    const actual = await leerCentroHabitualProveedor(args.proveedorId);
    if (actual === args.centroCostoId) return false;

    type AField = string[] | undefined;
    await (airtable(PROVEEDORES_TABLE_ID).update as unknown as (
      records: Array<{ id: string; fields: Record<string, AField> }>,
    ) => Promise<unknown>)([{
      id: args.proveedorId,
      fields: { [PROVEEDORES_FIELDS.centro_costo_habitual]: [args.centroCostoId] },
    }]);
    return true;
  } catch (err) {
    console.warn('F-052.1 aprenderCentroHabitualProveedor falló:', err instanceof Error ? err.message : err);
    return false;
  }
}
