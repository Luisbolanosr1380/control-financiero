import { generateText, type CoreMessage } from 'ai';
import { google } from '@ai-sdk/google';
import { aiTools } from '@/lib/ai/tools';
import { calcularCostoUSD } from '@/lib/db/ai-analisis';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODELO = 'gemini-2.5-flash';
const MAX_STEPS = 5;

const SYSTEM = `Sos el CFO/asesor de Golden Talent (empresa de servicios profesionales en Guatemala: Polígrafo, Socioeconómicos, TalentTrackAI, Administrativo). Hablás con el DUEÑO, que NO es financiero. Hablás en español, "vos", directo, sin jerga, oraciones cortas.

REGLAS ESTRICTAS:
- NUNCA inventes números. Si una pregunta requiere datos, LLAMÁ una de las funciones disponibles. Si el dato no está disponible, decílo claro ("no tengo ese dato").
- NO calcules ni estimes vos. Los números vienen de las funciones.
- Si la pregunta es ambigua sobre qué cliente, qué período, etc., preguntá antes de llamar la función.
- Si una función devuelve "multiples_candidatos" o "cliente_no_encontrado", devolvé al usuario los candidatos o pedile que precise.
- Montos siempre con prefijo "Q" (ej: Q184,000 — NUNCA "184Kq" o "Q184K", usá la cifra con coma).
- Respuestas cortas (3-6 frases). Si el usuario pide más detalle, lo expandís.

CONOCIMIENTO DE NEGOCIO (no datos, sí contexto):
- Polígrafo y Socioeconómicos son RECURRENTES (mes a mes). Si un cliente recurrente dejó de facturar 2+ meses, es señal real.
- TalentTrackAI y Administrativo son POR PROYECTO/episódicos. Un cliente puede pasar 3-4 meses sin pedir y eso es NORMAL, NO fuga.
- Cuando hables de un cliente "en riesgo" o "perdido", revisá su naturaleza primero (la función getAnalisisClienteDetalle te la da).

CUÁNDO USAR QUÉ FUNCIÓN:
- "¿cómo va el mes / la cobranza?" → getKPIs
- "¿qué facturas tiene X cliente?" → getFacturasPorCliente
- "¿facturas vencidas / por cobrar?" → getFacturasPorEstado
- "¿cuánto cobré entre tal y tal fecha?" → getCobrosPorPeriodo
- "¿cómo está X cliente?" → getAnalisisClienteDetalle
- "¿quiénes están en riesgo?" → getClientesEnRiesgo
- "¿qué pasó este trimestre / Pareto / movers?" → getAnaliticaIngresos
- "¿qué servicio crece / cae?" → getServiciosPerformance

SEMÁNTICA DE MONTOS (clave):
- "Facturación 12m" = TAMAÑO histórico del cliente, NO una pérdida puntual. NO digas "perdimos Q184K con X" — decí "X facturaba Q184K al año y se apagó".
- "Variación 3m vs 3m" SÍ es diferencia entre dos períodos y se puede llamar "caída de Qxxx".`;

interface ChatRequest {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  newMessage: string;
}

export async function POST(req: Request) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json({ ok: false, error: 'Falta GOOGLE_GENERATIVE_AI_API_KEY' }, { status: 500 });
  }

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 });
  }

  const nuevo = (body.newMessage ?? '').trim();
  if (!nuevo) return Response.json({ ok: false, error: 'newMessage vacío' }, { status: 400 });

  const historial: CoreMessage[] = (body.messages ?? []).map(m => ({ role: m.role, content: m.content }));
  const messages: CoreMessage[] = [...historial, { role: 'user', content: nuevo }];

  try {
    const t0 = Date.now();
    const result = await generateText({
      model: google(MODELO),
      system: SYSTEM,
      messages,
      tools: aiTools,
      maxSteps: MAX_STEPS,
      temperature: 0.3,
    });
    const ms = Date.now() - t0;

    // Sumar tokens y funciones de TODOS los steps (cada step puede llamar tools y el último genera texto)
    let tokensInput = 0;
    let tokensOutput = 0;
    const funcionesUsadas: Array<{ nombre: string; argumentos: unknown }> = [];
    for (const step of result.steps) {
      tokensInput += Number(step.usage?.promptTokens ?? 0);
      tokensOutput += Number(step.usage?.completionTokens ?? 0);
      for (const call of step.toolCalls ?? []) {
        funcionesUsadas.push({ nombre: call.toolName, argumentos: call.args });
      }
    }

    const costoUSD = calcularCostoUSD(tokensInput, tokensOutput);

    return Response.json({
      ok: true,
      modelo: MODELO,
      respuesta: result.text,
      tokensInput,
      tokensOutput,
      costoUSD,
      funcionesUsadas,
      pasos: result.steps.length,
      ms,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error en /api/ai/chat:', msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
