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
 *   NEXT_PUBLIC_EMPRESA_NOMBRE — nombre corto para UI y Auros ("Golden
 *     Talent"). PUBLIC para que los componentes cliente también lo vean;
 *     EMPRESA_NOMBRE (server-only) funciona como alias/override.
 *   EMPRESA_NOMBRE_LEGAL   — razón social para documentos legales (boletas)
 *   EMPRESA_NIT
 *   EMPRESA_DIRECCION
 *   EMPRESA_LOGO_URL       — logo para encabezados (null = marca textual)
 *   EMPRESA_MONEDA         — 'GTQ' | 'USD'
 *   EMPRESA_ES_GRUPO       — '1'/'true' si tiene empresas hermanas
 *                            (habilita semántica intercompany en UI/flujo)
 *   EMPRESA_DESCRIPCION    — una frase para el prompt de Auros
 *   EMPRESA_DUENO          — cómo llama Auros al dueño/CFO
 *   NEXT_PUBLIC_SISTEMA_NOMBRE / NEXT_PUBLIC_EMPRESA_MONEDA — ídem,
 *     públicas. El resto (NIT, dirección, descripción…) es server-only y
 *     llega a la UI por props desde server components.
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

// ── FIX server/client boundary ("process is not defined") ──
// En el browser NO existe `process`: el bundler solo inlinea accesos
// LITERALES a process.env.X — la referencia desnuda `const e =
// process.env` llegaba al bundle del cliente (vía el import de
// empleados/empresa.ts en componentes 'use client') y reventaba.
//
// Patrón seguro bajo cualquier bundler:
//  · ENV: process.env real solo si `typeof process` existe (server);
//    en el cliente queda {} — typeof sobre un global ausente no tira.
//  · Identidad PÚBLICA del deploy: variables NEXT_PUBLIC_* accedidas
//    con literales (el bundler las inlinea como constantes en el
//    cliente), dentro del guard por si algún runtime no las inlinea.
// En el cliente, lo no-público resuelve a los DEFAULTS de Golden; la
// identidad visible (nombre/sistema/moneda) viaja por NEXT_PUBLIC_ o
// por props desde server components (patrón del sidebar).
const ENV: NodeJS.ProcessEnv =
  typeof process !== 'undefined' && process.env ? process.env : ({} as NodeJS.ProcessEnv);

// Literales COMPLETOS (el bundler los inlinea como constantes en el
// cliente — por eso NO pueden ir detrás de un typeof-guard, que en el
// browser elegiría la rama undefined aunque el valor esté inlineado).
// El try/catch cubre el caso teórico de un bundler que no inlinea.
function publicos(): { nombre?: string; sistema?: string; moneda?: string } {
  try {
    return {
      nombre:  process.env.NEXT_PUBLIC_EMPRESA_NOMBRE,
      sistema: process.env.NEXT_PUBLIC_SISTEMA_NOMBRE,
      moneda:  process.env.NEXT_PUBLIC_EMPRESA_MONEDA,
    };
  } catch {
    return {};
  }
}
const PUB = publicos();

/** Config de la empresa de ESTE deploy. Server: env completas; cliente:
 *  NEXT_PUBLIC_* + defaults (lo sensible nunca llega al browser). */
export function empresaConfig(): EmpresaConfig {
  const e = ENV;
  const nombrePublico = PUB.nombre?.trim() || undefined;
  const nombre = nombrePublico || e.EMPRESA_NOMBRE?.trim() || DEFAULTS_GOLDEN.nombre;
  const sistema = PUB.sistema?.trim() || DEFAULTS_GOLDEN.nombreSistema;
  const monedaRaw = PUB.moneda?.trim() || e.EMPRESA_MONEDA;
  const moneda = monedaRaw === 'USD' ? 'USD' : DEFAULTS_GOLDEN.moneda;
  const esCustom = nombre !== DEFAULTS_GOLDEN.nombre;
  return {
    slug:          (e.EMPRESA_SLUG?.trim() || DEFAULTS_GOLDEN.slug).toLowerCase(),
    nombre,
    nombreLegal:   e.EMPRESA_NOMBRE_LEGAL?.trim()   || DEFAULTS_GOLDEN.nombreLegal,
    nit:           e.EMPRESA_NIT?.trim()            || DEFAULTS_GOLDEN.nit,
    direccion:     e.EMPRESA_DIRECCION?.trim()      || DEFAULTS_GOLDEN.direccion,
    logoUrl:       e.EMPRESA_LOGO_URL?.trim()       || DEFAULTS_GOLDEN.logoUrl,
    moneda,
    monedaSimbolo: moneda === 'USD' ? '$' : 'Q',
    esGrupo:       bool(e.EMPRESA_ES_GRUPO, DEFAULTS_GOLDEN.esGrupo),
    descripcion:   e.EMPRESA_DESCRIPCION?.trim()    || DEFAULTS_GOLDEN.descripcion,
    dueno:         e.EMPRESA_DUENO?.trim()          || DEFAULTS_GOLDEN.dueno,
    nombreSistema: sistema,
    // titulo/subtitulo: históricos EXACTOS salvo que el deploy defina su nombre.
    titulo:    esCustom ? `${sistema} · ${nombre}` : DEFAULTS_GOLDEN.titulo,
    subtitulo: esCustom ? nombre : DEFAULTS_GOLDEN.subtitulo,
  };
}
