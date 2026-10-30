/**
 * FACTURACIÓN AGENDA · COBRO POR PRUEBA — reglas del CFO (29-oct-2026), PURO (sin IO).
 *
 * La unidad que se factura es la PRUEBA (componente), no el expediente. Cada servicio de la
 * fila (`serviciosDe`) recibe una `situacion`:
 *   cobra     → tiene resultado: entra a la cola con su precio
 *   pendiente → esperar (la Agenda todavía no cargó el resultado)
 *   no_cobra  → cerrado sin cobro (no se presentó, cancelado, desiste)
 *
 * Fuente del estado: `estadoPoligrafo` para POLIGRAFO / POLIGRAFO BASIC; `estadoSocio` para
 * SOCIOECONOMICO (incl. VIRTUAL). Se comparan normalizados: mayúsculas, sin espacios de más y
 * sin espacios alrededor de guiones ("SOCIO- EN REVISION" = "SOCIO-EN REVISION", "AUDITADO -QA"
 * = "AUDITADO-QA"). Cualquier otro valor → pendiente + aviso "estado no reconocido" (ej. "APROBO"
 * en el socio es un error de dato).
 *
 * Fallback cuando el campo nuevo viene vacío (doc de la Agenda): expedientes de ANTES de 2026 y
 * filas de UNA sola prueba (las dos filas de Airtable; SOLO POLIGRAFO; mitad de un completo)
 * usan `statusProceso` como estado de esa prueba. Para el SOCIO de un COMPLETO también vale
 * `statusProceso` (una vez que empieza el socio, el estado general es el del socio). Un COMPLETO
 * de 2026 con `estadoPoligrafo` vacío → polígrafo PENDIENTE (nunca se infiere del socio).
 * `statusProceso = CANCELADO` con ambos estados vacíos → todo no cobra.
 *
 * Socio cancelado con la visita/entrevista ya hecha → se cobra un FEE con tarifa propia
 * (servicio `FEE VISITA SOCIO CANCELADO`, forma por territorio) en lugar del socio.
 *
 * Otros servicios (INFORNET, MIDOT, PDA, BACKGROUND CHECK, entrevistas, SOCIO EMPRESARIAL…):
 * como hoy, cobran con `terminado` (cancelado → no cobra; no terminado → pendiente).
 */
import { normalizarTexto } from '@/lib/tarifario/canon';
import type { ExpedienteAgenda } from './tipos';

export type Situacion = 'cobra' | 'pendiente' | 'no_cobra';

export const SERVICIO_FEE = 'FEE VISITA SOCIO CANCELADO';
export const ES_POLIGRAFO = (s: string): boolean => s === 'POLIGRAFO' || s === 'POLIGRAFO BASIC';
export const ES_SOCIO = (s: string): boolean => s === 'SOCIOECONOMICO' || s === 'SOCIOECONOMICO VIRTUAL';
/** Servicios cuya prueba se cobra por su propio estado (no exigen `terminado` del expediente). Igual que facturacion_servicio_por_estado en SQL. */
export const servicioPorEstado = (s: string): boolean => ES_POLIGRAFO(s) || ES_SOCIO(s) || s === SERVICIO_FEE;

/** Normaliza un estado de la Agenda: mayúsculas sin tildes, un solo espacio, sin espacios alrededor de guiones. */
export const normEstado = (v: string | null | undefined): string => normalizarTexto(v).replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();

const POLI_COBRA = ['APROBO', 'NO APROBO', 'APROBO CON PREGUNTA MODIFICADA'];
const SOCIO_COBRA = ['SOCIO-COMPLETO', 'AUDITADO-QA'];
const SOCIO_FEE = ['SOCIO CANCELADO VISITA REALIZADA', 'SOCIOECONOMICO CANCELADO-ENTREVISTA REALIZADA'];
const SOCIO_NO_COBRA = ['SOCIO-CANCELADO'];
const SOCIO_PENDIENTE = ['SOCIO-EN PROCESO', 'SOCIO PRELIMINAR', 'SOCIO-EN REVISION', 'SOCIO EN REVISION SIN VISITA', 'GOLDEN-STANDBY'];
/** Valen para cualquier prueba (también llegan en el socio por el fallback de statusProceso). */
const NO_COBRA_GENERICO = ['NO SE PRESENTO', 'CANCELADO', 'CANCELADA', 'DESISTE'];
const PENDIENTE_GENERICO = ['EN COLA', 'AGENDADO', 'AGENDADA', ''];   // AGENDADA: grafía real en Golden

export interface DecisionPrueba {
  /** Servicio que se cobra (el socio cancelado con visita realizada se vuelve el FEE). */
  servicio: string;
  situacion: Situacion;
  /** Texto de la Agenda que decidió (como llegó). */
  estadoPrueba: string;
  /** Motivo legible (y aviso de estado no reconocido). */
  motivo: string;
  /** El estado no está en la tabla del CFO: pendiente con aviso. */
  noReconocido: boolean;
}

export interface EntradaSituacion extends Pick<ExpedienteAgenda, 'statusProceso' | 'terminado' | 'cancelado' | 'fechaIngreso'> {
  estadoPoligrafo?: string | null;
  estadoSocio?: string | null;
}

const txt = (v: unknown): string => String(v ?? '').trim();
const esPre2026 = (fechaIngreso: string | null | undefined): boolean => !!fechaIngreso && fechaIngreso.slice(0, 4) < '2026';

/** Resultado legible para el cliente: "Polígrafo — aprobó", "Socioeconómico — completo", "Fee visita realizada (socio cancelado)". */
export function resultadoLegible(servicio: string, estadoPrueba: string | null | undefined): string {
  const e = normEstado(estadoPrueba);
  const nombre = NOMBRE_SERVICIO[servicio] ?? servicio;
  if (servicio === SERVICIO_FEE) return e === 'SOCIOECONOMICO CANCELADO-ENTREVISTA REALIZADA' ? 'Fee entrevista realizada (socio cancelado)' : 'Fee visita realizada (socio cancelado)';
  if (ES_POLIGRAFO(servicio)) {
    if (e === 'APROBO') return `${nombre} — aprobó`;
    if (e === 'NO APROBO') return `${nombre} — no aprobó`;
    if (e === 'APROBO CON PREGUNTA MODIFICADA') return `${nombre} — aprobó con pregunta modificada`;
  }
  if (ES_SOCIO(servicio)) {
    if (e === 'SOCIO-COMPLETO') return `${nombre} — completo`;
    if (e === 'AUDITADO-QA') return `${nombre} — auditado QA`;
  }
  return e ? `${nombre} — ${e.toLowerCase()}` : nombre;
}

export const NOMBRE_SERVICIO: Record<string, string> = {
  POLIGRAFO: 'Polígrafo', 'POLIGRAFO BASIC': 'Polígrafo basic', SOCIOECONOMICO: 'Socioeconómico', 'SOCIOECONOMICO VIRTUAL': 'Socioeconómico virtual', 'SOCIOECONOMICO EMPRESARIAL': 'Socioeconómico empresarial',
  [SERVICIO_FEE]: 'Fee visita (socio cancelado)', INFORNET: 'Infornet', 'VISITA DOMICILIAR': 'Visita domiciliar', 'ENTREVISTA FORENSE': 'Entrevista forense', PDA: 'PDA',
  'ENTREVISTA GERENCIAL': 'Entrevista gerencial', 'ENTREVISTA ESPECIALISTA': 'Entrevista especialista', INSIGHT: 'Insight', MIDOT: 'Midot', 'BACKGROUND CHECK': 'Background check',
};

/**
 * Decide la situación de cada servicio del expediente.
 * `servicios` = los de la fila (ya canónicos, de `serviciosDe`).
 */
export function situacionDePruebas(exp: EntradaSituacion, servicios: readonly string[]): DecisionPrueba[] {
  const sp = txt(exp.statusProceso);
  const ep = txt(exp.estadoPoligrafo), es = txt(exp.estadoSocio);
  const unaPrueba = servicios.length === 1;
  const pre2026 = esPre2026(exp.fechaIngreso);
  const todoCancelado = normEstado(sp) === 'CANCELADO' && !ep && !es;
  return servicios.map(servicio => {
    if (todoCancelado) return { servicio, situacion: 'no_cobra', estadoPrueba: sp, motivo: 'no se cobra: proceso CANCELADO en la Agenda', noReconocido: false };
    if (ES_POLIGRAFO(servicio)) {
      // Fallback a statusProceso solo para una prueba sola o pre-2026; un COMPLETO 2026 sin estadoPoligrafo queda pendiente.
      const estado = ep || ((unaPrueba || pre2026) ? sp : '');
      return decidirPoligrafo(servicio, estado, ep ? 'estadoPoligrafo' : 'statusProceso');
    }
    if (ES_SOCIO(servicio)) {
      const estado = es || sp;   // el estado general es el del socio una vez que empieza (doc de la Agenda)
      return decidirSocio(servicio, estado, es ? 'estadoSocio' : 'statusProceso');
    }
    // Otros servicios: como hoy, por `terminado` del expediente.
    if (exp.cancelado) return { servicio, situacion: 'no_cobra', estadoPrueba: sp, motivo: 'no se cobra: expediente cancelado', noReconocido: false };
    if (exp.terminado) return { servicio, situacion: 'cobra', estadoPrueba: sp, motivo: 'terminado en la Agenda', noReconocido: false };
    return { servicio, situacion: 'pendiente', estadoPrueba: sp, motivo: `pendiente: ${sp || 'sin terminar'}`, noReconocido: false };
  });
}

function decidirPoligrafo(servicio: string, estado: string, fuente: string): DecisionPrueba {
  const e = normEstado(estado);
  const base = { servicio, estadoPrueba: estado, noReconocido: false };
  if (POLI_COBRA.includes(e)) return { ...base, situacion: 'cobra', motivo: `${resultadoLegible(servicio, estado)} (${fuente})` };
  if (NO_COBRA_GENERICO.includes(e)) return { ...base, situacion: 'no_cobra', motivo: `no se cobra: ${e}` };
  if (PENDIENTE_GENERICO.includes(e)) return { ...base, situacion: 'pendiente', motivo: e ? `pendiente: ${e}` : 'pendiente: sin resultado de polígrafo todavía' };
  return { ...base, situacion: 'pendiente', noReconocido: true, motivo: `pendiente · estado no reconocido para el polígrafo: "${estado}"` };
}

function decidirSocio(servicio: string, estado: string, fuente: string): DecisionPrueba {
  const e = normEstado(estado);
  const base = { estadoPrueba: estado, noReconocido: false };
  if (SOCIO_COBRA.includes(e)) return { ...base, servicio, situacion: 'cobra', motivo: `${resultadoLegible(servicio, estado)} (${fuente})` };
  if (SOCIO_FEE.includes(e)) return { ...base, servicio: SERVICIO_FEE, situacion: 'cobra', motivo: `${resultadoLegible(SERVICIO_FEE, estado)}: se cobra el fee con tarifa propia (${fuente})` };
  if (SOCIO_NO_COBRA.includes(e) || NO_COBRA_GENERICO.includes(e)) return { ...base, servicio, situacion: 'no_cobra', motivo: `no se cobra: ${e}` };
  if (SOCIO_PENDIENTE.includes(e) || PENDIENTE_GENERICO.includes(e)) return { ...base, servicio, situacion: 'pendiente', motivo: e ? `pendiente: ${e}` : 'pendiente: el socio todavía no empezó' };
  return { ...base, servicio, situacion: 'pendiente', noReconocido: true, motivo: `pendiente · estado no reconocido para el socio: "${estado}"` };
}

export const ETIQUETA_SITUACION: Record<Situacion, string> = { cobra: 'Por cobrar', pendiente: 'Pendiente de resultado', no_cobra: 'No se cobra' };
export const ICONO_SITUACION: Record<Situacion, string> = { cobra: '🟡', pendiente: '⏳', no_cobra: '⛔' };
