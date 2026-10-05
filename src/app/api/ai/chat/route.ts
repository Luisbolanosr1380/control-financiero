import { generateText, type CoreMessage } from 'ai';
import { google } from '@ai-sdk/google';
import { aiTools } from '@/lib/ai/tools';
import { calcularCostoUSD } from '@/lib/db/ai-analisis';
import { getSesion } from '@/lib/auth/guard';
import { tienePermiso, getLimiteAuros } from '@/lib/auth/permissions';
import { registrarUsoAuros, getConsumoMensual } from '@/lib/db/uso-auros';
import { getServiciosActivos, describirLineasParaPrompt } from '@/lib/db/lineas-negocio';
import { buildSystemPrompt, hoyGuatemala } from '@/lib/ai/system-prompt';
import { cifrasNuevas } from '@/lib/ai/guardas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODELO = 'gemini-2.5-flash';
const MAX_STEPS = 8;

interface ChatRequest {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  newMessage: string;
}

export async function POST(req: Request) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json({ ok: false, error: 'Falta GOOGLE_GENERATIVE_AI_API_KEY' }, { status: 500 });
  }

  // ──────────────────────────────────────────────────────────
  // F-030: control de permisos + rate limit por rol
  // ──────────────────────────────────────────────────────────
  const { email, rol } = await getSesion();
  if (!rol) {
    return Response.json({ ok: false, error: 'NO_AUTORIZADO', mensaje: 'Tu correo no está autorizado para usar este sistema.' }, { status: 401 });
  }
  if (!tienePermiso(rol, 'aurosChat')) {
    return Response.json(
      { ok: false, error: 'SIN_PERMISO', mensaje: 'Tu rol no incluye acceso a Auros. Hablá con Stark si necesitás permisos.' },
      { status: 403 },
    );
  }
  const limite = getLimiteAuros(rol);
  let consumoActual = 0;
  if (Number.isFinite(limite)) {
    consumoActual = await getConsumoMensual(email);
    if (consumoActual >= limite) {
      const hoy = new Date();
      const proximo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
      const mesNombre = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][proximo.getMonth()];
      return Response.json(
        {
          ok: false,
          error: 'LIMITE_ALCANZADO',
          mensaje: `Llegaste al límite de ${limite} consultas este mes. Se renueva el 1 de ${mesNombre}.`,
          consumoActual,
          limite,
        },
        { status: 429 },
      );
    }
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
    // FIX-DASHBOARD-ANALITICA-HIT: las líneas y su naturaleza entran al
    // prompt desde los CCs activos de la base del deploy (fail-soft).
    const lineasPrompt = await getServiciosActivos()
      .then(describirLineasParaPrompt)
      .catch(() => describirLineasParaPrompt([]));
    const consultar = (sinRazonamiento = false) => generateText({
      model: google(MODELO),
      system: buildSystemPrompt(hoyGuatemala(), lineasPrompt),
      messages,
      tools: aiTools,
      maxSteps: MAX_STEPS,
      temperature: 0.3,
      // Las respuestas vacías de gemini-2.5-flash vienen del modo "thinking": el reintento va sin él.
      ...(sinRazonamiento ? { providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } } : {}),
    });
    let result = await consultar();
    let pasosForzados: typeof result.steps = [];
    let mensajesTurno: CoreMessage[] = messages;
    const sinTools = () => result.steps.every(st => (st.toolCalls ?? []).length === 0);
    // Gemini a veces devuelve una respuesta vacía (stop, sin texto ni tools): un reintento.
    if (!result.text.trim() && sinTools()) result = await consultar(true);
    // "NUNCA inventás números", en código: cifras que no salen de ninguna tool de este turno
    // ni de la conversación previa → se fuerza una ronda de tools y se redacta de nuevo.
    if (sinTools() && cifrasNuevas(result.text, historial).length > 0) {
      console.warn('Auros: montos sin tools — se fuerza una ronda de tools', JSON.stringify({ cifras: cifrasNuevas(result.text, historial).slice(0, 5) }));
      const forzado = await generateText({
        model: google(MODELO), system: buildSystemPrompt(hoyGuatemala(), lineasPrompt),
        messages, tools: aiTools, toolChoice: 'required', maxSteps: 1, temperature: 0.3,
      });
      pasosForzados = forzado.steps;
      mensajesTurno = [...messages, ...forzado.response.messages];
      result = await generateText({
        model: google(MODELO), system: buildSystemPrompt(hoyGuatemala(), lineasPrompt),
        messages: mensajesTurno, tools: aiTools, maxSteps: MAX_STEPS - 1, temperature: 0.3,
      });
    }
    // Si el último paso fue una llamada a tool (se agotaron los pasos), no hay texto:
    // un paso final SIN tools redacta la respuesta con los datos ya obtenidos.
    let texto = result.text.trim();
    let pasoFinal: Awaited<ReturnType<typeof generateText>> | null = null;
    if (!texto && [...pasosForzados, ...result.steps].some(st => (st.toolCalls ?? []).length > 0)) {
      pasoFinal = await generateText({
        model: google(MODELO),
        system: buildSystemPrompt(hoyGuatemala(), lineasPrompt),
        messages: [...mensajesTurno, ...result.response.messages],
        temperature: 0.3,
      });
      texto = pasoFinal.text.trim();
    }
    if (!texto) {
      console.warn('Auros: respuesta vacía', JSON.stringify({
        finishReason: (pasoFinal ?? result).finishReason,
        pasos: result.steps.map(st => ({ fin: st.finishReason, tools: (st.toolCalls ?? []).map(c => c.toolName), chars: st.text.length })),
      }));
    }
    const ms = Date.now() - t0;

    // Sumar tokens y funciones de TODOS los steps (cada step puede llamar tools y el último genera texto)
    let tokensInput = 0;
    let tokensOutput = 0;
    const funcionesUsadas: Array<{ nombre: string; argumentos: unknown }> = [];
    for (const step of [...pasosForzados, ...result.steps, ...(pasoFinal?.steps ?? [])]) {
      tokensInput += Number(step.usage?.promptTokens ?? 0);
      tokensOutput += Number(step.usage?.completionTokens ?? 0);
      for (const call of step.toolCalls ?? []) {
        funcionesUsadas.push({ nombre: call.toolName, argumentos: call.args });
      }
    }

    const costoUSD = calcularCostoUSD(tokensInput, tokensOutput);

    // Tracking (F-030 parte D): se hace después de la consulta exitosa.
    // No await del race con la respuesta — si falla no rompe la UX.
    await registrarUsoAuros({
      email,
      tipo: 'chat',
      tokensIn: tokensInput,
      tokensOut: tokensOutput,
      costoUsd: costoUSD,
      durSeg: ms / 1000,
      queryPreview: nuevo,
    });

    const consumoMensual = consumoActual + 1;
    return Response.json({
      ok: true,
      modelo: MODELO,
      respuesta: texto,
      tokensInput,
      tokensOutput,
      costoUSD,
      funcionesUsadas,
      pasos: pasosForzados.length + result.steps.length + (pasoFinal ? 1 : 0),
      ms,
      consumoMensual,
      limite: Number.isFinite(limite) ? limite : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error en /api/ai/chat:', msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
