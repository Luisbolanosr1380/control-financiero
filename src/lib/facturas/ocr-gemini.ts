/**
 * F-049 — OCR de factura PDF con Gemini 2.5 Flash vía Vercel AI SDK.
 *
 * Por qué no structured output del modelo: el parser DTE/genérico de
 * PARTE B ya tiene lógica probada (portada del Apps Script) para extraer
 * totales, IVA, fechas en español y casos borde de centavos. Pedir
 * structured output movería esa responsabilidad al modelo, que es menos
 * confiable y opaco. Acá Gemini solo hace transcripción.
 *
 * El SDK acepta PDF como `file` part — Gemini multimodal lo lee nativamente.
 */

import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

const MODELO_OCR = 'gemini-2.5-flash';

const PROMPT_OCR =
  'Extrae TODO el texto visible de este PDF de factura guatemalteca. ' +
  'Preserva el orden de líneas tal como aparecen visualmente. NO interpretes, ' +
  'NO resumas, NO categorices, NO agregues etiquetas tuyas. Solo extrae el texto crudo. ' +
  'Incluye números, etiquetas, datos del emisor y receptor, total, IVA, subtotal, ' +
  'fecha, serie y número de DTE. Responde con SOLO el texto extraído, sin ' +
  'comentarios ni prefijos como "Aquí está el texto:" ni similares.';

export interface ResultadoOCR {
  ok: boolean;
  texto?: string;
  tokensInput?: number;
  tokensOutput?: number;
  error?: string;
}

/**
 * Llama a Gemini con el PDF como input multimodal y devuelve el texto
 * transcripto + metadata de tokens para tracking opcional posterior.
 *
 * No falla nunca con throw — captura todo y retorna { ok: false, error }
 * para que el caller decida si reportar como error del archivo o reintentar.
 */
export async function extraerTextoDeFactura(pdfBuffer: Buffer): Promise<ResultadoOCR> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { ok: false, error: 'GOOGLE_GENERATIVE_AI_API_KEY no configurada en el server.' };
  }

  try {
    const result = await generateText({
      model: google(MODELO_OCR),
      temperature: 0,
      maxTokens: 16000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT_OCR },
            {
              type: 'file',
              data: pdfBuffer,
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
    });

    const texto = (result.text ?? '').trim();
    if (!texto) {
      return { ok: false, error: 'Gemini devolvió respuesta vacía.' };
    }

    return {
      ok: true,
      texto,
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
