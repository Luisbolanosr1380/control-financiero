/**
 * F-051.7 — Empresa empleadora de cada empleado.
 *
 * EMPLEADOS.empresa_empleadora (Airtable fldVw0FZMEYk601RR, singleSelect).
 * Convención del CFO: vacío = Golden Talent (legacy — los empleados
 * registrados antes de F-051.7 no tienen el campo seteado).
 *
 * Importante para el cash-flow (F-051):
 *  - Solo la nómina de Golden Talent se proyecta en planillaProyectada().
 *  - HIT / Poligrafy / BYDSA entran como obligaciones recurrentes
 *    intercompany (F-051.6) — si la planilla los proyectara también,
 *    se cuentan DOBLE en el horizonte.
 *
 * La separación contable del asiento (Dr Gasto Nómina solo Golden /
 * Dr CxC HIT / Dr CxC Poligrafy / Dr CxC BYDSA / Cr Bancos) queda
 * para F-056.
 */

// MULTI-EMPRESA · Paso 3 (propuesta 1 aprobada): el union type fijo se
// vuelve string — las opciones válidas viven en el catálogo
// empresas_relacionadas (db/empresas-relacionadas.ts), que pre-007 cae
// a los labels legacy de abajo. La "principal" ya no es el literal
// 'Golden Talent': es empresaConfig().nombre (= 'Golden Talent' en el
// deploy de Golden sin env vars — fidelidad exacta).
import { empresaConfig } from '../config/empresa';

export type EmpresaEmpleadora = string;

/** Labels históricos del enum — HOY el fallback pre-007 del catálogo. */
export const EMPRESAS_EMPLEADORAS_LEGACY: readonly string[] = [
  'Golden Talent', 'HIT', 'Poligrafy', 'BYDSA',
];
/** @deprecated usar getOpcionesEmpresas() (catálogo) o el fallback legacy. */
export const EMPRESAS_EMPLEADORAS: readonly EmpresaEmpleadora[] = EMPRESAS_EMPLEADORAS_LEGACY;

export const EMPRESA_EMPLEADORA_DEFAULT: EmpresaEmpleadora = empresaConfig().nombre;

/** Field ID Airtable. La lectura actual va por nombre del campo. */
export const EMPRESA_EMPLEADORA_FIELD_ID = 'fldVw0FZMEYk601RR';
/** Nombre del campo en EMPLEADOS. */
export const EMPRESA_EMPLEADORA_FIELD_NAME = 'EMPRESA_EMPLEADORA';

export function normalizarEmpresa(v: unknown): EmpresaEmpleadora {
  const raw = typeof v === 'string'
    ? v
    : (v && typeof v === 'object' && 'name' in (v as object) ? String((v as { name?: unknown }).name ?? '') : '');
  const s = raw.trim();
  // Vacío = la empresa principal (convención legacy). Cualquier otro valor
  // se respeta tal cual: el catálogo gobierna lo que la UI OFRECE, pero la
  // lectura no renombra datos (antes coercionaba lo desconocido a Golden —
  // en Golden es indistinguible porque el enum de DB solo permitía los 5).
  return s === '' ? EMPRESA_EMPLEADORA_DEFAULT : s;
}

/** ¿Es la empresa PRINCIPAL de este deploy? (incluye los legacy sin campo).
 *  En Golden: empresaConfig().nombre = 'Golden Talent' → semántica idéntica. */
export function esGolden(empresa: EmpresaEmpleadora): boolean {
  return empresa === EMPRESA_EMPLEADORA_DEFAULT;
}

/** Visual: color del badge en la UI. La principal no lleva badge; las
 *  conocidas conservan su color histórico; una empresa nueva del catálogo
 *  recibe un color estable derivado de su nombre. */
const BADGE_CONOCIDAS: Record<string, { bg: string; fg: string }> = {
  'HIT':       { bg: 'var(--indigo-bg)',    fg: 'var(--indigo)'  },  // azul
  'Poligrafy': { bg: 'rgba(120, 78, 175, 0.14)', fg: '#5C3DAB'  },   // morado
  'BYDSA':     { bg: 'var(--amber-bg)',     fg: 'var(--amber)'   },  // naranja/ámbar
};
const BADGE_PALETA = [
  { bg: 'var(--olive-bg)', fg: 'var(--olive)' },
  { bg: 'var(--wine-bg)',  fg: 'var(--wine)'  },
  { bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  { bg: 'var(--indigo-bg)', fg: 'var(--indigo)' },
];

export function badgeColorEmpresa(empresa: string): { bg: string; fg: string } {
  if (empresa === EMPRESA_EMPLEADORA_DEFAULT) return { bg: 'transparent', fg: 'var(--ink-3)' };  // sin badge
  if (BADGE_CONOCIDAS[empresa]) return BADGE_CONOCIDAS[empresa];
  let h = 0;
  for (const ch of empresa) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return BADGE_PALETA[h % BADGE_PALETA.length];
}

/** @deprecated usar badgeColorEmpresa() — este Record no cubre empresas del catálogo. */
export const EMPRESA_BADGE_COLOR: Record<string, { bg: string; fg: string }> = {
  'Golden Talent': { bg: 'transparent', fg: 'var(--ink-3)' },
  ...BADGE_CONOCIDAS,
};
