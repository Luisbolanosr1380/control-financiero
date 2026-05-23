import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { revalidatePath } from 'next/cache';
import { getAnaliticaIngresos } from '@/lib/db/analitica';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { guardarAnalisis, calcularCostoUSD } from '@/lib/db/ai-analisis';
import { Q } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODELO = 'gemini-2.5-flash';

function labelMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${meses[m - 1]} ${y}`;
}

export async function POST() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(
      { ok: false, error: 'Falta GOOGLE_GENERATIVE_AI_API_KEY en .env.local' },
      { status: 500 },
    );
  }

  try {
    const t0 = Date.now();
    const [analitica, retencion] = await Promise.all([
      getAnaliticaIngresos(),
      getAnalisisClientes(),
    ]);
    const tCalc = Date.now() - t0;

    // ===== Serializar los insights del sistema (números confiables) =====
    const insights = serializarInsights(analitica, retencion);

    // ===== Prompt =====
    const system = `Sos el CFO/asesor de una empresa de servicios profesionales en Guatemala. Hablás con el DUEÑO, que NO es financiero. Hablás en español, "vos", directo, sin jerga, en oraciones cortas.

REGLAS ESTRICTAS:
- Usá SOLO los números que aparecen en los INSIGHTS abajo. NO inventes, NO estimes, NO calcules cifras nuevas.
- Si un dato no está, no lo menciones.
- Nombrá clientes y servicios específicos en las acciones — el dueño quiere saber A QUIÉN llamar y QUÉ atacar.
- RESPETÁ las advertencias metodológicas. Importante:
  · No hay histórico de años previos → una caída en diciembre/temporada baja puede ser estacionalidad, NO crisis. No lo llames "crisis" si no hay forma de saberlo.
  · "Apagados" de los últimos 3 meses son PROVISIONALES: un cliente sin facturar 1-2 meses puede estar en su ciclo normal. Usá los apagados CONFIABLES (>3 meses sin volver) para conclusiones fuertes.
  · Los meses con monto 0 al inicio son "sin datos" (anteriores al registro), no caídas reales.
- No uses "Q" como sufijo de número (ej: "100Q"). Siempre prefijo: "Q100".

JERARQUÍA DE LA CONCLUSIÓN (clave para el diagnóstico):
- ANTES de redactar, mirá la variación por servicio en su conjunto. Si hay líneas estratégicas creciendo y otras cayendo, el TITULAR es que el problema está LOCALIZADO en un servicio específico, NO que el negocio entero cae. Decilo así en la PRIMERA FRASE del diagnóstico.
- Si todas las líneas estratégicas caen, recién ahí el titular es una caída general.
- Líneas ESTRATÉGICAS: Poligrafia, Socioeconomicos, TalentTrackAI (y Administrativo si tiene actividad). Estas se mencionan por nombre y se comparan entre sí.
- "Otros" = ingresos SIN CLASIFICAR (categoría residual de centros pequeños o sin asignar). NO la pongas al mismo nivel ni junto a las estratégicas. Si tiene una caída/crecimiento relevante, mencionalo APARTE como observación, no como protagonista del diagnóstico.

NATURALEZA DE LOS SERVICIOS (crítico para no sobre-contar fugas):
- TalentTrackAI = reclutamiento, POR PROYECTO/episódico. Un cliente pide candidatos hoy (Q25-30K típico) y puede pasar 3-4 meses sin pedir. Eso es NORMAL, no es fuga. No asumas que un cliente de TalentTrack "se fue" por no facturar unos meses.
- Polígrafo y Socioeconómico = RECURRENTES (mes a mes). Ahí dejar de facturar SÍ es fuga real y hay que accionar.
- Administrativo = por proyecto / interno; tratalo como TalentTrack.
- Cuando un cliente aparece como FUGA o EN RIESGO en los insights, mirá su "naturalezaDominante": si es 'proyecto', NO lo trates como fuga (es episódico). Si es 'recurrente', sí es fuga real.

CONTEXTO COMERCIAL POR CLIENTE:
- Algunos clientes incluyen una nota "Contexto:" debajo. Es información cualitativa (razón conocida de la salida, vínculos personales, situación del cliente). USALA: si dice por qué se fue alguien, reflejalo en tu lectura. Si no hay contexto, no inventes uno.`;

    const userPrompt = `INSIGHTS DEL SISTEMA (estos son los números a usar):

${insights}

---

Redactá un análisis en español claro con la siguiente estructura exacta en Markdown:

## Diagnóstico
3 a 4 frases. La PRIMERA frase es el titular jerarquizado (¿problema general o localizado? — ver la regla de JERARQUÍA arriba). Las siguientes 2-3 dan el contexto: qué servicio cae, qué crece, concentración. NO uses la palabra "crisis" si los datos no lo justifican. "Otros" no es protagonista; mencionalo aparte si corresponde.

## Qué accionar esta semana
Lista de hasta 5 acciones concretas, **ORDENADAS POR IMPACTO ECONÓMICO** (la del cliente o servicio que más plata movía, primero). CADA UNA debe nombrar un cliente, servicio o métrica específica. Empezá cada acción con un verbo ("Llamar a…", "Revisar…", "Blindar…"). Al lado del nombre poné el monto en juego entre paréntesis cuando esté disponible (ej: "Llamar a BANRURAL (Q184,744 perdidos)").

## Alertas
Hasta 3 riesgos a vigilar. Mencioná datos concretos.

## Qué está funcionando bien
Hasta 3 puntos positivos para no perder de vista.

No incluyas otras secciones ni preámbulo. Empezá directamente con "## Diagnóstico".`;

    const t1 = Date.now();
    const { text, usage } = await generateText({
      model: google(MODELO),
      system,
      prompt: userPrompt,
      temperature: 0.4,
    });
    const tAI = Date.now() - t1;

    const tokensInput  = Number(usage?.promptTokens     ?? 0);
    const tokensOutput = Number(usage?.completionTokens ?? 0);
    const duracionSeg  = (tCalc + tAI) / 1000;
    const costoUSD     = calcularCostoUSD(tokensInput, tokensOutput);

    // Persistir el análisis (si falla, devolvemos el texto igual — no perderlo)
    let registroId: string | undefined;
    try {
      const reg = await guardarAnalisis({
        texto: text,
        modelo: MODELO,
        tokensInput,
        tokensOutput,
        duracionSeg,
      });
      registroId = reg.id;
      revalidatePath('/ai');
    } catch (e) {
      console.error('Error guardando análisis AI en Airtable:', e);
    }

    return Response.json({
      ok: true,
      modelo: MODELO,
      generadoEn: new Date().toISOString(),
      ms: { calculos: tCalc, ai: tAI, total: tCalc + tAI },
      tokens: { promptTokens: tokensInput, completionTokens: tokensOutput, totalTokens: tokensInput + tokensOutput },
      costoUSD,
      registroId,
      persistido: !!registroId,
      analisis: text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error generando análisis AI:', msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

function serializarInsights(
  a: Awaited<ReturnType<typeof getAnaliticaIngresos>>,
  retencion: Awaited<ReturnType<typeof getAnalisisClientes>>,
): string {
  const sec: string[] = [];

  // Mapa custId → metadata cualitativa (naturaleza dominante + contexto comercial)
  const meta = new Map(retencion.map(r => [r.custId, {
    naturaleza: r.naturalezaDominante,
    contexto: r.contextoComercial,
  }]));
  const tag = (custId: string): string => {
    const m = meta.get(custId);
    if (!m) return '';
    const natTag = m.naturaleza === 'proyecto' ? ' [POR PROYECTO]'
                 : m.naturaleza === 'mixto'    ? ' [MIXTO]'
                 : ' [RECURRENTE]';
    const ctx = m.contexto ? `\n    Contexto: ${m.contexto.replace(/\s+/g, ' ').trim()}` : '';
    return natTag + ctx;
  };

  // 1) Serie mensual y mes de quiebre
  sec.push('### Facturación mensual (12 meses)');
  const serie = a.serieMensualTotal.map(s => `  - ${labelMes(s.mes)}: ${s.monto === 0 ? 'sin datos' : Q(s.monto)}`).join('\n');
  sec.push(serie);
  if (a.mesPico)  sec.push(`Mes pico: ${labelMes(a.mesPico.mes)} (${Q(a.mesPico.monto)}).`);
  if (a.mesValle) sec.push(`Mes valle (con datos): ${labelMes(a.mesValle.mes)} (${Q(a.mesValle.monto)}).`);
  if (a.mesQuiebre) sec.push(`Mayor caída mes a mes: ${labelMes(a.mesQuiebre.mes)}, cayó ${Q(a.mesQuiebre.caidaQ)} (${a.mesQuiebre.caidaPct.toFixed(1)}%) vs el mes anterior.`);

  // 2) Variación por servicio
  sec.push('\n### Variación por servicio (últimos 3 meses vs los 3 anteriores)');
  for (const v of a.variacionPorServicio) {
    const dir = v.variacionQ > 0 ? '↑' : v.variacionQ < 0 ? '↓' : '=';
    sec.push(`- ${v.servicio}: reciente ${Q(v.reciente)} vs base ${Q(v.base)} (${dir} ${v.variacionPct.toFixed(1)}%, Δ ${Q(v.variacionQ)})`);
  }

  // 3) Top clientes que cayeron (con split)
  sec.push('\n### Top clientes que CAYERON (3m recientes vs 3m base)');
  const cayeronTodo = a.moversClientes.cayeron.filter(m => m.reciente <= 1 && m.variacionPct <= -99);
  const cayeronParcial = a.moversClientes.cayeron.filter(m => !(m.reciente <= 1 && m.variacionPct <= -99));
  if (cayeronTodo.length) {
    sec.push('Se fueron del todo (sin facturación reciente):');
    for (const m of cayeronTodo.slice(0, 6)) sec.push(`  - ${m.nombre}${tag(m.custId)}: facturaba ${Q(m.base)} → 0 · última factura ${m.ultimaFactura}`);
  }
  if (cayeronParcial.length) {
    sec.push('Bajaron pero siguen facturando:');
    for (const m of cayeronParcial.slice(0, 6)) sec.push(`  - ${m.nombre}${tag(m.custId)}: ${Q(m.base)} → ${Q(m.reciente)} (${m.variacionPct.toFixed(0)}%)`);
  }

  // 4) Top clientes que crecieron
  sec.push('\n### Top clientes que CRECIERON');
  for (const m of a.moversClientes.crecieron.slice(0, 6)) {
    const flag = m.base === 0 ? ' (nuevo)' : '';
    sec.push(`- ${m.nombre}${flag}${tag(m.custId)}: ${Q(m.base)} → ${Q(m.reciente)} (+${Q(m.variacionQ)})`);
  }

  // 5) Clientes apagados — separar confiables vs provisionales (últimos 3 buckets)
  sec.push('\n### Apagados por mes (clientes con su última factura en ese mes)');
  const bucketsConDatos = a.clientesApagadosPorMes.filter(b => b.cantidad > 0 || b.montoPerdido > 0);
  const provisionalDesde = a.clientesApagadosPorMes.length - 3;
  for (let i = 0; i < a.clientesApagadosPorMes.length; i++) {
    const b = a.clientesApagadosPorMes[i];
    if (b.cantidad === 0) continue;
    const tag = i >= provisionalDesde ? ' (PROVISIONAL — últimos 3 meses)' : ' (confiable)';
    sec.push(`- ${labelMes(b.mes)}: ${b.cantidad} cliente${b.cantidad === 1 ? '' : 's'}${tag}`);
  }
  if (bucketsConDatos.length === 0) sec.push('Sin apagados en la ventana.');

  // 6) Clientes en riesgo (retención) — solo recurrentes/mixtos. Los proyecto-dominantes
  // van en una sección aparte ("episódicos") para no confundir ciclo normal con fuga.
  sec.push('\n### Clientes en riesgo REALES (recurrentes que dejaron de facturar)');
  const riesgo = retencion
    .filter(c =>
      (c.clasificacion === 'perdido' || c.clasificacion === 'en_riesgo' || c.clasificacion === 'en_declive')
      && c.naturalezaDominante !== 'proyecto',
    )
    .sort((x, y) => y.montoPromedio - x.montoPromedio)
    .slice(0, 8);
  if (riesgo.length === 0) sec.push('Sin clientes recurrentes en riesgo.');
  for (const c of riesgo) {
    const ctx = c.contextoComercial ? `\n    Contexto: ${c.contextoComercial.replace(/\s+/g, ' ').trim()}` : '';
    sec.push(`- ${c.nombre} [${c.clasificacion}]: facturaba ${Q(c.montoPromedio)}/mes, lleva ${c.mesesSinFacturar.toFixed(1)} meses sin facturar (su ritmo normal: ~${c.intervaloNormal?.toFixed(1) ?? '?'} m).${ctx}`);
  }

  // Clientes episódicos relevantes (proyecto-dominantes con caída fuerte): información,
  // NO como fuga. Solo los que tenían facturación base y bajaron mucho.
  const episodicosConSenal = retencion
    .filter(c => c.naturalezaDominante === 'proyecto' && c.clasificacion === 'en_declive')
    .sort((x, y) => y.montoPromedio - x.montoPromedio)
    .slice(0, 5);
  if (episodicosConSenal.length > 0) {
    sec.push('\n### Clientes EPISÓDICOS (por proyecto) con señal — NO es fuga, pero vale la pena monitorear');
    for (const c of episodicosConSenal) {
      const ctx = c.contextoComercial ? `\n    Contexto: ${c.contextoComercial.replace(/\s+/g, ' ').trim()}` : '';
      sec.push(`- ${c.nombre}: facturó ${Q(c.montoBase)} en los 3 meses base, ${Q(c.montoReciente)} en los recientes. Cliente por demanda — la inactividad puede ser ciclo normal.${ctx}`);
    }
  }

  // 7) Concentración (Pareto)
  sec.push('\n### Concentración de ingresos');
  sec.push(`- Top 5 clientes: ${a.concentracion.top5pct.toFixed(1)}% del total.`);
  sec.push(`- Top 10 clientes: ${a.concentracion.top10pct.toFixed(1)}% del total.`);
  sec.push(`- Top 20 clientes: ${a.concentracion.top20pct.toFixed(1)}% del total.`);
  sec.push(`- ${a.concentracion.clientes80pct} clientes (de ${a.concentracion.totalClientes}) acumulan el 80% — los "intocables".`);
  sec.push('Top 5 cuentas (por facturación 12m):');
  for (const c of a.concentracion.top5) sec.push(`  - ${c.nombre}: ${Q(c.monto)} (${c.pctDelTotal.toFixed(1)}%)`);

  return sec.join('\n');
}
