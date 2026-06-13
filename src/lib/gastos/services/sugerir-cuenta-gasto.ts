/**
 * F-052 — Motor de sugerencia de cuenta contable de gasto.
 *
 * Patrón "AI sugiere, humano decide": el modal de revisión de F-050 abre
 * con la cuenta más probable PRE-SELECCIONADA + badge de origen. Stark
 * confirma o corrige. La corrección entrena pasivamente la memoria del
 * proveedor (F-052 PARTE B en aprobar-factura).
 *
 * Jerarquía (primera fuente que produce match con confianza válida gana):
 *
 *   1. PROVEEDORES.CUENTA_GASTO_HABITUAL del proveedor → memoria.
 *   2. OBLIGACIONES_RECURRENTES.cuenta_contable de una obligación activa
 *      del mismo proveedor → obligación recurrente.
 *   3. Match exacto de nombre de proveedor contra el nombre de una cuenta
 *      de SaaS (Airtable, Make, Zapier, etc.) → catálogo.
 *   4. Gemini structured: nombre + descripción + líneas + catálogo entero
 *      en el prompt → IA.
 *   5. Sin sugerencia.
 *
 * Cuando una fuente local (1-3) resuelve, NO llamamos a Gemini — ahorra
 * tokens y latencia en los casos comunes (>80% del volumen real).
 *
 * Llamado SOLO desde server actions (no exportar tools del browser).
 */

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

import { airtable } from '@/lib/db/airtable';
import { getCuentasGasto, type Cuenta } from '@/lib/db/cuentas';
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

export type OrigenSugerencia =
  | 'memoria'        // PROVEEDORES.cuenta_gasto_habitual
  | 'recurrente'     // OBLIGACIONES_RECURRENTES.cuenta_contable
  | 'catalogo'       // match exacto SaaS
  | 'ia'             // Gemini structured
  | null;            // sin sugerencia

export interface SugerenciaCuenta {
  /** record-id de la cuenta sugerida (referencia a CUENTAS), o null si no hay sugerencia. */
  cuentaId: string | null;
  /** Código contable (ej "6-3-1") cuando hay sugerencia. */
  codigo: string | null;
  /** Nombre legible de la cuenta. */
  nombre: string | null;
  /** Origen de la sugerencia. */
  origen: OrigenSugerencia;
  /** 0..1. Las fuentes locales devuelven 1; IA reporta su confianza. */
  confianza: number;
  /** Texto corto para tooltip (solo cuando origen='ia'). */
  razon?: string;
}

export interface SugerirCuentaInput {
  /** record-id de PROVEEDORES (si ya existe). */
  proveedorId?: string;
  proveedorNombre: string;
  proveedorNit?: string;
  /** Texto crudo del OCR / descripción libre del documento. */
  descripcion?: string;
  /** Si la factura tiene desglose por línea, pasarlo para enriquecer el prompt. */
  lineas?: string[];
}

/* =========================================================================
 * Catálogo SaaS de match exacto
 *
 * Pares "nombre normalizado del proveedor" → "fragmento del nombre de la
 * cuenta a buscar". El match es: si el nombre normalizado del proveedor
 * incluye el alias Y el nombre de una cuenta hoja incluye el fragmento,
 * gana esa cuenta.
 *
 * Mantener la lista corta: solo SaaS de gasto recurrente obvio. Stark
 * agrega más vía CUENTA_GASTO_HABITUAL del proveedor (fuente 1).
 * ========================================================================= */

const CATALOGO_SAAS: ReadonlyArray<{ aliasProveedor: string; cuentaIncluye: string }> = [
  { aliasProveedor: 'airtable',         cuentaIncluye: 'airtable'   },
  { aliasProveedor: 'make.com',         cuentaIncluye: 'make'       },
  { aliasProveedor: 'make integromat',  cuentaIncluye: 'make'       },
  { aliasProveedor: 'zapier',           cuentaIncluye: 'zapier'     },
  { aliasProveedor: 'twilio',           cuentaIncluye: 'twilio'     },
  { aliasProveedor: 'google workspace', cuentaIncluye: 'workspace'  },
  { aliasProveedor: 'google cloud',     cuentaIncluye: 'google'     },
  { aliasProveedor: 'miniextensions',   cuentaIncluye: 'miniextensions' },
  { aliasProveedor: 'softr',            cuentaIncluye: 'softr'      },
  { aliasProveedor: 'openai',           cuentaIncluye: 'openai'     },
  { aliasProveedor: 'anthropic',        cuentaIncluye: 'anthropic'  },
  { aliasProveedor: 'vercel',           cuentaIncluye: 'vercel'     },
];

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/* =========================================================================
 * Helpers de Airtable (lectura sin escritura)
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

/**
 * Lee CUENTA_GASTO_HABITUAL de un proveedor por record-id, una sola
 * llamada con returnFieldsByFieldId.
 */
async function leerCuentaHabitualProveedor(proveedorId: string): Promise<string | null> {
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
    const link = (records[0].fields as Record<string, unknown>)[PROVEEDORES_FIELDS.cuenta_gasto_habitual];
    return arrFirst(link) || null;
  } catch (err) {
    console.warn('F-052 leerCuentaHabitualProveedor falló:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Busca una obligación recurrente activa cuyo proveedor sea el dado, y
 * devuelve su cuenta_contable si existe.
 */
async function cuentaDeObligacionRecurrente(proveedorId: string): Promise<string | null> {
  if (!airtable || !proveedorId) return null;
  try {
    // Volumen bajo (<100 obligaciones esperadas) → leemos todo y filtramos en JS.
    const records = await airtable(OBLIGACIONES_RECURRENTES_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const activo = Boolean(f[OBLIGACIONES_RECURRENTES_FIELDS.activo]);
      if (!activo) continue;
      const provId = arrFirst(f[OBLIGACIONES_RECURRENTES_FIELDS.proveedor]);
      if (provId !== proveedorId) continue;
      const cuentaId = arrFirst(f[OBLIGACIONES_RECURRENTES_FIELDS.cuenta_contable]);
      if (cuentaId) return cuentaId;
    }
    return null;
  } catch (err) {
    console.warn('F-052 cuentaDeObligacionRecurrente falló:', err instanceof Error ? err.message : err);
    return null;
  }
}

/* =========================================================================
 * Fuente 4 — Gemini structured
 * ========================================================================= */

const MODELO_SUGERENCIA = 'gemini-2.5-flash';

const SugerenciaIAOutputSchema = z.object({
  codigo_cuenta: z
    .string()
    .describe('Código contable de UNA cuenta del catálogo provisto (ej "6-3-1"). DEBE existir en el catálogo. Si dudás, elegí "Otros gastos" del set.'),
  confianza: z
    .number()
    .min(0)
    .max(1)
    .describe('0-1. Si los datos del proveedor o la descripción son ambiguos, bajá la confianza por debajo de 0.5.'),
  razon: z
    .string()
    .describe('Máximo 1 oración corta explicando por qué esa cuenta. Para el tooltip humano. Sin justificar de más.'),
});

const SYSTEM_PROMPT_SUGERENCIA = `Sos un contador guatemalteco asistiendo a clasificar facturas de gasto/costo.
Recibís: (1) datos del proveedor (nombre, NIT, descripción / OCR), y (2) el catálogo COMPLETO de cuentas hoja de costo/gasto del plan de cuentas (códigos 5- y 6-).

Tarea: devolver el código de UNA cuenta del catálogo que MEJOR clasifica el gasto. Reglas:
- DEBÉS elegir un código que exista EXACTAMENTE en el catálogo dado (con su guión y formato).
- Preferí la cuenta MÁS ESPECÍFICA disponible. Si hay "Hosting y Dominios" y "Otros gastos", y la factura es de hosting, elegí la primera.
- Si hay ambigüedad real (proveedor genérico, descripción vaga), bajá la confianza por debajo de 0.5 — el humano decide.
- NO inventes códigos. Si NADA del catálogo encaja razonablemente, elegí la cuenta "Otros gastos" o equivalente del set y poné confianza ≤ 0.4.
- La 'razon' debe ser una oración SECA: "Hosting → 6-3-6 Hosting y Dominios" (no justifiques de más).`;

interface ResultadoGemini {
  ok: boolean;
  codigo?: string;
  confianza?: number;
  razon?: string;
}

async function sugerirConGemini(input: SugerirCuentaInput, catalogo: Cuenta[]): Promise<ResultadoGemini> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { ok: false };
  }
  if (catalogo.length === 0) return { ok: false };

  // Catálogo serializado para el prompt: "codigo · nombre" uno por línea.
  // Hojas postables 5-/6-, ya filtradas por getCuentasGasto. ~90 líneas
  // — bajo presupuesto de tokens.
  const catalogoTxt = catalogo
    .map(c => `${c.codigo} · ${c.nombre}`)
    .join('\n');

  const detalleProveedor = [
    `Nombre: ${input.proveedorNombre || '(sin nombre)'}`,
    input.proveedorNit ? `NIT: ${input.proveedorNit}` : null,
    input.descripcion ? `Descripción / OCR:\n${input.descripcion.slice(0, 1500)}` : null,
    input.lineas && input.lineas.length > 0
      ? `Líneas:\n- ${input.lineas.slice(0, 20).map(l => l.trim()).filter(Boolean).join('\n- ')}`
      : null,
  ].filter(Boolean).join('\n');

  try {
    const result = await generateObject({
      model: google(MODELO_SUGERENCIA),
      schema: SugerenciaIAOutputSchema,
      system: SYSTEM_PROMPT_SUGERENCIA,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `Catálogo de cuentas hoja (código · nombre):\n${catalogoTxt}\n\n---\n\nFactura a clasificar:\n${detalleProveedor}\n\nDevolvé el código exacto del catálogo + confianza + razón breve.`,
      }],
    });
    return {
      ok: true,
      codigo:    result.object.codigo_cuenta.trim(),
      confianza: result.object.confianza,
      razon:     result.object.razon,
    };
  } catch (err) {
    console.warn('F-052 sugerirConGemini falló:', err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

/* =========================================================================
 * API pública del motor
 * ========================================================================= */

const sinSugerencia = (): SugerenciaCuenta => ({
  cuentaId: null, codigo: null, nombre: null, origen: null, confianza: 0,
});

function asSugerencia(c: Cuenta, origen: Exclude<OrigenSugerencia, null | 'ia'>): SugerenciaCuenta {
  return {
    cuentaId: c.id,
    codigo:   c.codigo,
    nombre:   c.nombre,
    origen,
    confianza: 1,
  };
}

/**
 * Devuelve la sugerencia jerárquica. Las fuentes locales (1-3) son
 * instantáneas; solo se llama a Gemini si ninguna resuelve. El catálogo
 * de cuentas se pasa como parámetro para poder cachearlo del lado del
 * caller (cargar-opciones-modal ya lo trae).
 */
export async function sugerirCuentaGasto(input: SugerirCuentaInput): Promise<SugerenciaCuenta> {
  const cuentas = await getCuentasGasto();
  if (cuentas.length === 0) return sinSugerencia();
  const byId = new Map(cuentas.map(c => [c.id, c]));

  // Fuente 1 — memoria del proveedor.
  if (input.proveedorId) {
    const memoriaId = await leerCuentaHabitualProveedor(input.proveedorId);
    if (memoriaId) {
      const cuenta = byId.get(memoriaId);
      if (cuenta) return asSugerencia(cuenta, 'memoria');
    }
  }

  // Fuente 2 — obligación recurrente activa.
  if (input.proveedorId) {
    const recurrenteId = await cuentaDeObligacionRecurrente(input.proveedorId);
    if (recurrenteId) {
      const cuenta = byId.get(recurrenteId);
      if (cuenta) return asSugerencia(cuenta, 'recurrente');
    }
  }

  // Fuente 3 — catálogo SaaS por nombre.
  const provN = normalizar(input.proveedorNombre);
  if (provN) {
    for (const entry of CATALOGO_SAAS) {
      if (!provN.includes(entry.aliasProveedor)) continue;
      const cuenta = cuentas.find(c => normalizar(c.nombre).includes(entry.cuentaIncluye));
      if (cuenta) return asSugerencia(cuenta, 'catalogo');
    }
  }

  // Fuente 4 — Gemini.
  const ia = await sugerirConGemini(input, cuentas);
  if (!ia.ok || !ia.codigo) return sinSugerencia();

  const cuenta = cuentas.find(c => c.codigo === ia.codigo);
  if (!cuenta) {
    // Defensa: si Gemini inventó un código que no existe, descartamos
    // toda la sugerencia. No queremos pre-seleccionar algo inválido.
    console.warn(`F-052 IA devolvió código inexistente: "${ia.codigo}"`);
    return sinSugerencia();
  }

  return {
    cuentaId: cuenta.id,
    codigo:   cuenta.codigo,
    nombre:   cuenta.nombre,
    origen:   'ia',
    confianza: ia.confianza ?? 0,
    razon:    ia.razon,
  };
}

/* =========================================================================
 * F-052 PARTE B — aprendizaje pasivo
 *
 * Cuando Stark aprueba un gasto, si la cuenta finalmente elegida difiere
 * de CUENTA_GASTO_HABITUAL del proveedor, actualizamos el campo. La
 * próxima factura del mismo proveedor sugiere por fuente 1 (memoria).
 * ========================================================================= */

/**
 * Idempotente: si el proveedor ya tiene la misma cuenta como habitual,
 * no escribe. Fail-soft: si Airtable falla, log + return false.
 */
export async function aprenderCuentaHabitualProveedor(args: {
  proveedorId: string;
  cuentaId: string;
}): Promise<boolean> {
  if (!airtable) return false;
  if (!args.proveedorId || !args.cuentaId) return false;
  try {
    const actual = await leerCuentaHabitualProveedor(args.proveedorId);
    if (actual === args.cuentaId) return false;

    type AField = string[] | undefined;
    await (airtable(PROVEEDORES_TABLE_ID).update as unknown as (
      records: Array<{ id: string; fields: Record<string, AField> }>,
    ) => Promise<unknown>)([{
      id: args.proveedorId,
      fields: { [PROVEEDORES_FIELDS.cuenta_gasto_habitual]: [args.cuentaId] },
    }]);
    return true;
  } catch (err) {
    console.warn('F-052 aprenderCuentaHabitualProveedor falló:', err instanceof Error ? err.message : err);
    return false;
  }
}
