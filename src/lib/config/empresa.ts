/**
 * MULTI-EMPRESA · Bloque 1-A — Config central por empresa.
 *
 * TODO lo específico de la empresa se lee de acá (nunca hardcodeado en
 * componentes, prompts ni documentos). Cada deploy define su identidad
 * por env vars; sin env vars los defaults son EXACTAMENTE los valores
 * históricos de Golden — así el deploy de Golden queda idéntico sin
 * configurar nada (refactor, no cambio).
 *
 * Env vars por deploy (todas opcionales, default = Golden):
 *   EMPRESA_NOMBRE         — nombre corto para UI y Auros ("Golden Talent")
 *   EMPRESA_NOMBRE_LEGAL   — razón social para documentos legales (boletas)
 *   EMPRESA_NIT
 *   EMPRESA_DIRECCION
 *   EMPRESA_LOGO_URL       — logo para encabezados (null = marca textual)
 *   EMPRESA_MONEDA         — 'GTQ' | 'USD'
 *   EMPRESA_ES_GRUPO       — '1'/'true' si tiene empresas hermanas
 *                            (habilita semántica intercompany en UI/flujo)
 *   EMPRESA_DESCRIPCION    — una frase para el prompt de Auros
 *   EMPRESA_DUENO          — cómo llama Auros al dueño/CFO
 *   NEXT_PUBLIC_EMPRESA_NOMBRE / NEXT_PUBLIC_SISTEMA_NOMBRE — variantes
 *     públicas para componentes client (el sidebar); si no están, los
 *     server components pasan los valores por props.
 */

export interface EmpresaConfig {
  /** Identificador del deploy para permisos (Clerk metadata.empresas[].slug). */
  slug: string;
  nombre: string;          // corto — UI, Auros, selector
  nombreLegal: string;     // razón social — boletas y documentos
  nit: string;
  direccion: string;
  logoUrl: string | null;
  moneda: 'GTQ' | 'USD';
  monedaSimbolo: string;   // 'Q' | '$'
  esGrupo: boolean;
  descripcion: string;     // para el prompt de Auros
  dueno: string;           // cómo se refiere Auros al dueño
  nombreSistema: string;   // marca del producto ("Control Financiero")
  /** <title> del browser. Sin EMPRESA_NOMBRE queda el histórico EXACTO
   *  de Golden (fidelidad pixel); con él, `Sistema · Empresa`. */
  titulo: string;
  /** Subtítulo del sidebar bajo la marca. Histórico: "Sistema operativo";
   *  con EMPRESA_NOMBRE definido, el nombre de la empresa. */
  subtitulo: string;
}

const DEFAULTS_GOLDEN: EmpresaConfig = {
  slug: 'golden',
  nombre: 'Golden Talent',
  nombreLegal: 'Golden Talent Guatemala, S.A.',
  nit: '8439027-3',
  direccion: 'Ciudad de Guatemala, Guatemala C.A.',
  logoUrl: null,
  moneda: 'GTQ',
  monedaSimbolo: 'Q',
  esGrupo: true,
  descripcion: 'empresa de servicios profesionales en Guatemala: Polígrafo, Socioeconómicos, TalentTrackAI, Administrativo',
  dueno: 'Stark',
  nombreSistema: 'Control Financiero',
  titulo: 'Control Financiero · Sistema operativo de contabilidad',
  subtitulo: 'Sistema operativo',
};

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true';
}

/** Config de la empresa de ESTE deploy. Server-side (lee process.env). */
export function empresaConfig(): EmpresaConfig {
  const e = process.env;
  const moneda = e.EMPRESA_MONEDA === 'USD' ? 'USD' : DEFAULTS_GOLDEN.moneda;
  return {
    slug:          (e.EMPRESA_SLUG?.trim() || DEFAULTS_GOLDEN.slug).toLowerCase(),
    nombre:        e.EMPRESA_NOMBRE?.trim()         || DEFAULTS_GOLDEN.nombre,
    nombreLegal:   e.EMPRESA_NOMBRE_LEGAL?.trim()   || DEFAULTS_GOLDEN.nombreLegal,
    nit:           e.EMPRESA_NIT?.trim()            || DEFAULTS_GOLDEN.nit,
    direccion:     e.EMPRESA_DIRECCION?.trim()      || DEFAULTS_GOLDEN.direccion,
    logoUrl:       e.EMPRESA_LOGO_URL?.trim()       || DEFAULTS_GOLDEN.logoUrl,
    moneda,
    monedaSimbolo: moneda === 'USD' ? '$' : 'Q',
    esGrupo:       bool(e.EMPRESA_ES_GRUPO, DEFAULTS_GOLDEN.esGrupo),
    descripcion:   e.EMPRESA_DESCRIPCION?.trim()    || DEFAULTS_GOLDEN.descripcion,
    dueno:         e.EMPRESA_DUENO?.trim()          || DEFAULTS_GOLDEN.dueno,
    nombreSistema: e.NEXT_PUBLIC_SISTEMA_NOMBRE?.trim() || DEFAULTS_GOLDEN.nombreSistema,
    ...derivados(e),
  };
}

/** titulo/subtitulo: históricos exactos salvo que el deploy defina su nombre. */
function derivados(e: NodeJS.ProcessEnv): Pick<EmpresaConfig, 'titulo' | 'subtitulo'> {
  const nombre = e.EMPRESA_NOMBRE?.trim();
  const sistema = e.NEXT_PUBLIC_SISTEMA_NOMBRE?.trim() || DEFAULTS_GOLDEN.nombreSistema;
  if (!nombre) return { titulo: DEFAULTS_GOLDEN.titulo, subtitulo: DEFAULTS_GOLDEN.subtitulo };
  return { titulo: `${sistema} · ${nombre}`, subtitulo: nombre };
}
