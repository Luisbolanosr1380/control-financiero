/**
 * F-049.2 — Extractor de factura con Gemini 2.5 Flash + structured output.
 *
 * Reemplaza el flujo OCR-plain-text + regex parser por una llamada
 * `generateObject` con `responseSchema` (Zod). Gemini entiende facturas
 * DTE como dominio y devuelve los campos ya estructurados + un puntaje de
 * confianza autorreportado + notas para revisión humana.
 *
 * El parser regex (`src/lib/facturas/parsers/`) NO se elimina — se mantiene
 * como validación cruzada (PARTE B). Si las dos rutas coinciden en NIT,
 * total, fecha, serie y número, marcamos `datos_normalizados_ok=true` para
 * que F-050 sepa qué facturas pueden auto-aprobarse.
 *
 * Defensa en profundidad: aplicamos `normalizeGreekToLatin` sobre el
 * `texto_ocr_completo` que devuelve Gemini antes de validarlo con el regex,
 * por si el modelo aún devuelve algún glifo griego ambiguo (F-049.1).
 */

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { normalizeGreekToLatin } from './parsers/utils';

const MODELO_EXTRACTOR = 'gemini-2.5-flash';

/* ============================================================
 * Schema Zod
 * ============================================================ */

export const FacturaExtraidaSchema = z.object({
  texto_ocr_completo: z
    .string()
    .describe('Texto crudo extraído del PDF, preservando saltos de línea entre secciones del documento.'),

  datos: z.object({
    proveedor_nombre: z
      .string()
      .describe('Razón social completa del EMISOR de la factura. Ej: "ALTCAP, SOCIEDAD ANONIMA". NO incluir dirección. NO confundir con el certificador.'),

    proveedor_nit: z
      .string()
      .describe('NIT del EMISOR (Guatemala), solo dígitos sin guiones. NUNCA el NIT del certificador (ej. INFILE). NUNCA el NIT del receptor/cliente.'),

    cliente_nit: z
      .string()
      .describe('NIT del receptor (cliente). "CF" si es consumidor final. Cadena vacía si no aparece.'),

    serie: z
      .string()
      .describe('Serie del DTE (ej: "0F2B17BF" o "001"). Cadena vacía si la factura no es DTE y no tiene serie.'),

    numero: z
      .string()
      .describe('Número correlativo del DTE (ej: "3896724043"). Cadena vacía si no aplica.'),

    fecha_emision: z
      .string()
      .describe('Fecha de emisión en formato YYYY-MM-DD. Solo la fecha, sin hora. Si no es legible, cadena vacía.'),

    moneda: z
      .enum(['Q', 'USD'])
      .describe('"Q" para quetzales (GTQ), "USD" para dólares.'),

    subtotal: z
      .number()
      .nullable()
      .describe('Subtotal antes de IVA. Null si el documento no lo separa explícitamente.'),

    iva: z
      .number()
      .describe('Monto del IVA. 0 si la factura es exenta (art. 7 Ley del IVA o similar).'),

    total: z
      .number()
      .describe('Total a pagar (subtotal + IVA + otros impuestos). DEBE ser un monto razonable comparable a los items. NUNCA un NIT u otro número de identificación.'),

    tipo_doc: z
      .enum(['Factura GT (DTE)', 'Factura GT'])
      .describe('"Factura GT (DTE)" si tiene "Número de DTE" o "Nit Emisor" explícito. "Factura GT" para facturas genéricas no-DTE.'),
  }),

  confianza: z
    .number()
    .min(0)
    .max(1)
    .describe('Qué tan seguro estás de la extracción (0-1). Considera: ¿los campos extraídos son consistentes? ¿están claros en el documento? Si dudas en algún campo crítico (total, NIT), baja la confianza.'),

  notas: z
    .string()
    .optional()
    .describe('Notas si algo es ambiguo o necesita revisión humana. Ej: "OCR de baja calidad en sección de items"; "el total parece consistente con IVA 12% pero el subtotal no aparece explícito".'),
});

export type FacturaExtraida = z.infer<typeof FacturaExtraidaSchema>;

/* ============================================================
 * Prompt experto
 * ============================================================ */

const SYSTEM_PROMPT = `Eres un experto en facturas DTE (Documentos Tributarios Electrónicos) de Guatemala emitidas por SAT.

Estructura típica de un DTE guatemalteco:
- Cabecera: Razón social del emisor + NIT Emisor
- Identificación: Serie + Número de DTE + NÚMERO DE AUTORIZACIÓN (UUID)
- Cliente: NIT Receptor + Nombre Receptor + Dirección
- Fecha y hora de emisión
- Moneda (GTQ/Q o USD)
- Detalle de items con cantidades, precios unitarios, descuentos
- Sección TOTALES con: Subtotal, IVA (12% o 0 si exenta), Total
- Pie: Datos del certificador (NIT del certificador NO es el del emisor)

REGLAS CRÍTICAS:
1. El NIT del CERTIFICADOR (al final del documento, ej: "INFILE, S.A. NIT: 12521337") NO es el NIT del emisor. Solo extraer NIT del EMISOR (al inicio).
2. El nombre del RECEPTOR NO es el proveedor. El proveedor es el EMISOR.
3. Si la factura es exenta de IVA (art. 7 Ley del IVA), iva=0 pero el total debe seguir siendo el monto real cobrado, NO el NIT del certificador.
4. El TOTAL debe ser un monto razonable. Si parece extraño (muy grande o muy pequeño comparado con los items), probablemente confundiste con un NIT u otro número de identificación.
5. Si no puedes determinar un campo con certeza, baja la confianza global.

Output: JSON con texto_ocr_completo, datos estructurados, confianza (0-1), notas.`;

/* ============================================================
 * Función pública
 * ============================================================ */

export interface ResultadoExtractor {
  ok: boolean;
  extraida?: FacturaExtraida;
  error?: string;
  tokensInput?: number;
  tokensOutput?: number;
}

export async function extraerFacturaConGemini(pdfBuffer: Buffer): Promise<ResultadoExtractor> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { ok: false, error: 'GOOGLE_GENERATIVE_AI_API_KEY no configurada en el server.' };
  }

  try {
    const result = await generateObject({
      model: google(MODELO_EXTRACTOR),
      schema: FacturaExtraidaSchema,
      system: SYSTEM_PROMPT,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extrae los datos de esta factura DTE guatemalteca.' },
            {
              type: 'file',
              data: pdfBuffer,
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
    });

    // F-049.1: defensa en profundidad — normaliza griegos en el texto OCR
    // que persistiremos y compararemos con el regex. Los campos estructurados
    // (datos.proveedor_nombre etc.) ya vienen latinos casi siempre porque
    // Gemini en modo structured entiende contexto, pero el texto crudo
    // puede traer mezclas.
    const extraida: FacturaExtraida = {
      ...result.object,
      texto_ocr_completo: normalizeGreekToLatin(result.object.texto_ocr_completo),
    };

    return {
      ok: true,
      extraida,
      tokensInput: result.usage?.promptTokens,
      tokensOutput: result.usage?.completionTokens,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
