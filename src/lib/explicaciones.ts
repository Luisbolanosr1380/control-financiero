// ============================================================
// Textos explicativos — lenguaje claro, "vos", sin jerga financiera.
// Personalizan el mensaje con los datos reales del usuario.
// ============================================================

import { Q } from './utils';

const formatPct = (n: number, dec = 1) => `${n.toFixed(dec)}%`;

function labelMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${meses[m - 1]} ${y}`;
}

export const explicar = {
  /* ============== Dashboard · KPIs ============== */
  facturadoTotal: () =>
    'Total facturado en la ventana — excluye anuladas y refacturadas. Es lo que tu empresa "vendió", sin importar si ya entró el dinero.',

  cobradoTotal: () =>
    'Dinero que efectivamente ya entró (Total − saldo pendiente). Si está muy abajo del Facturado, la cobranza viene lenta.',

  porCobrarTotal: () =>
    'Plata que ya facturaste pero todavía no entra a tu cuenta. Si crece mes a mes, la cobranza se está atrasando.',

  vencidoTotal: (numVencidas: number) =>
    `Suma de saldos de facturas que ya pasaron su fecha de vencimiento (${numVencidas} factura${numVencidas === 1 ? '' : 's'}). Atención prioritaria — cuanto más tiempo pasa, más se pone difícil de cobrar.`,

  tasaCobranza: (pct: number) => {
    const lectura = pct >= 90 ? 'Saludable.'
                  : pct >= 75 ? 'Razonable, hay margen para mejorar.'
                  : pct >= 60 ? 'Floja — se acumulan saldos.'
                              : 'Crítica — tu cobranza no está siguiéndole el ritmo a la facturación.';
    return `${formatPct(pct)} de lo facturado ya entró. ${lectura} Como referencia: arriba de 90% es bueno, abajo de 70% requiere acción.`;
  },

  numVencidas: (n: number) =>
    `${n} factura${n === 1 ? '' : 's'} pasaron su fecha de vencimiento y siguen sin cobrarse. Es el contador más accionable: cada una es un cliente al que llamar.`,

  /* ============== Dashboard · secciones ============== */
  lineasNegocio: () =>
    'Cada línea de servicio con su facturado, cobrado y tasa de cobranza. Sirve para ver qué línea es la más sana y cuál arrastra el resto.',

  aging: () =>
    'Cartera distribuida por antigüedad. "+90 días" es lo más difícil de cobrar — cuanto más grande esa franja, peor la salud de la cartera.',

  topDeudores: () =>
    'Los 5 clientes que más te deben. Concentrar la gestión de cobranza acá rinde más que perseguir a muchos chicos.',

  clientesRiesgo: () =>
    'Clientes que facturaban seguido y dejaron de hacerlo. Cada uno se mide contra SU ritmo normal, no un número fijo — por eso un cliente trimestral no salta como uno mensual.',

  evolucion12m: () =>
    'Facturación y cobranza mes a mes. Mirá si las dos curvas crecen juntas: si la facturación sube pero la cobranza no, se está acumulando cartera.',

  alertasAi: () =>
    'Insights generados por el sistema sobre puntos de atención. Cada alerta sugiere una acción concreta.',

  /* ============== Analítica · KPIs ============== */
  mesPico: (mes: string, monto: number) =>
    `${labelMes(mes)} fue tu mejor mes (${Q(monto)}). Sirve como referencia de "techo": ese ritmo es factible, ya lo hiciste.`,

  mesValle: (mes: string, monto: number) =>
    `${labelMes(mes)} fue tu mes más bajo (${Q(monto)}). Mirá qué pasó esos días — feriado, un cliente grande que no facturó, demoras en emisión...`,

  caidaMoMMayor: (mes: string, q: number, pct: number) =>
    `Tu mayor caída de un mes al siguiente fue en ${labelMes(mes)}: ${Q(q)} menos (${formatPct(pct)}). Ojo: si cae en diciembre o temporada baja, puede ser estacionalidad más que un problema real.`,

  promedioMensual: () =>
    'Promedio mensual calculado solo sobre meses con datos. Sirve como vara para comparar el mes actual contra tu propio ritmo histórico.',

  /* ============== Analítica · secciones ============== */
  facturacionMensual: () =>
    'Cómo evolucionó tu facturación mes a mes. Las barras grises son "sin datos" (anteriores al inicio del registro). La barra roja marca el mes de mayor caída.',

  facturacionPorServicio: () =>
    'Cada línea es un servicio (Polígrafo, Socioeconómicos, etc.). Sirve para ver si una caída general es realmente del negocio entero, o solo de un servicio específico.',

  variacionPorServicio: () =>
    'Para cada servicio: cuánto facturó en los últimos 3 meses vs los 3 meses anteriores. Verde = creció. Rojo = cayó. Si uno solo cayó fuerte, ahí está el problema concentrado.',

  servicioCae: (nombre: string, pct: number) =>
    `${nombre} cayó ${formatPct(Math.abs(pct))} mientras otras líneas crecen o se mantienen. La caída no es general — es de este servicio. Acá es donde tenés que enfocar la atención.`,

  clientesCayeron: () =>
    'Top clientes que facturaron menos este trimestre que el anterior. Los separamos en dos: "se fueron del todo" (ya no facturan, hay que recuperar) y "bajaron pero siguen" (acción: blindar la cuenta antes de que se vayan).',

  clientesCrecieron: () =>
    'Top clientes que facturaron MÁS este trimestre. Buen lugar para ver qué tipo de cuenta crece y replicar lo que estás haciendo bien con ellos.',

  clientesApagados: () =>
    'Cuántos clientes tuvieron su última factura en cada mes. Confiables (rojo): >3 meses sin volver = fuga probable. Provisional (ámbar): últimos 3 meses, todavía pueden estar en su ciclo normal de facturación.',

  concentracion: (top10pct: number, clientes80: number, totalClientes: number) =>
    `${formatPct(top10pct)} de tu facturación viene de solo 10 clientes. ${clientes80} de tus ${totalClientes} clientes generan el 80% — esos son los que NO podés perder. Si uno grande se va, se siente fuerte. Lo sano es no depender tanto de pocos.`,

  pareto: (n: number) =>
    `${n} clientes generan el 80% de tus ingresos. Si uno grande se va, se siente. La regla 80/20 dice que enfoques tu atención ahí — pero también es señal de riesgo si esos pocos pesan demasiado.`,
};

/* ============================================================
 * Guía completa para el modal "¿Cómo leer este panel?"
 * Secciones con título + cuerpo, ordenadas como aparecen en /analitica
 * ============================================================ */

export interface GuiaSeccion { titulo: string; cuerpo: string }

export function guiaAnalitica(args: {
  mesPico?: { mes: string; monto: number } | null;
  mesValle?: { mes: string; monto: number } | null;
  mesQuiebre?: { mes: string; caidaQ: number; caidaPct: number } | null;
  peorServicio?: { servicio: string; variacionPct: number } | null;
  concentracion?: { top10pct: number; clientes80pct: number; totalClientes: number };
}): GuiaSeccion[] {
  const secs: GuiaSeccion[] = [
    {
      titulo: 'Para qué sirve este panel',
      cuerpo: 'Diagnóstico profundo de tus ingresos. Si la facturación cayó, este panel responde tres preguntas: ¿cuándo cayó?, ¿qué servicio cayó? y ¿qué clientes cayeron? Con eso sabés dónde actuar.',
    },
    {
      titulo: 'Filtro por servicio',
      cuerpo: 'Arriba podés aislar un servicio (ej. TalentTrackAI) para ver SU curva mensual y descubrir si la caída general viene de un solo lado. "Todos" muestra el total combinado.',
    },
    {
      titulo: 'Mes pico / valle / caída MoM mayor / promedio',
      cuerpo: explicar.promedioMensual() + ' El "Mes pico" es tu techo histórico; el "valle" es lo más bajo; la "caída MoM mayor" señala el quiebre más fuerte de un mes al siguiente — ojo si es estacional.',
    },
    {
      titulo: 'Facturación mensual',
      cuerpo: explicar.facturacionMensual(),
    },
    {
      titulo: 'Facturación por servicio',
      cuerpo: explicar.facturacionPorServicio() + ' ' + explicar.variacionPorServicio(),
    },
    {
      titulo: 'Clientes que cayeron / crecieron',
      cuerpo: explicar.clientesCayeron() + ' ' + explicar.clientesCrecieron(),
    },
    {
      titulo: 'Clientes apagados por mes',
      cuerpo: explicar.clientesApagados(),
    },
    {
      titulo: 'Concentración (Pareto)',
      cuerpo: args.concentracion
        ? explicar.concentracion(args.concentracion.top10pct, args.concentracion.clientes80pct, args.concentracion.totalClientes)
        : explicar.pareto(0),
    },
  ];

  // Insertar resaltados al inicio si hay datos puntuales
  const head: GuiaSeccion[] = [];
  if (args.mesQuiebre) head.push({ titulo: '⚠️ Lo más urgente', cuerpo: explicar.caidaMoMMayor(args.mesQuiebre.mes, args.mesQuiebre.caidaQ, args.mesQuiebre.caidaPct) });
  if (args.peorServicio && args.peorServicio.variacionPct < 0) head.push({ titulo: '🛠️ Servicio que más cayó', cuerpo: explicar.servicioCae(args.peorServicio.servicio, args.peorServicio.variacionPct) });

  return [...head, ...secs];
}
