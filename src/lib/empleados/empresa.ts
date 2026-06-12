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

export type EmpresaEmpleadora = 'Golden Talent' | 'HIT' | 'Poligrafy' | 'BYDSA';

export const EMPRESAS_EMPLEADORAS: readonly EmpresaEmpleadora[] = [
  'Golden Talent', 'HIT', 'Poligrafy', 'BYDSA',
];

export const EMPRESA_EMPLEADORA_DEFAULT: EmpresaEmpleadora = 'Golden Talent';

/** Field ID Airtable. La lectura actual va por nombre del campo. */
export const EMPRESA_EMPLEADORA_FIELD_ID = 'fldVw0FZMEYk601RR';
/** Nombre del campo en EMPLEADOS. */
export const EMPRESA_EMPLEADORA_FIELD_NAME = 'EMPRESA_EMPLEADORA';

export function normalizarEmpresa(v: unknown): EmpresaEmpleadora {
  const raw = typeof v === 'string'
    ? v
    : (v && typeof v === 'object' && 'name' in (v as object) ? String((v as { name?: unknown }).name ?? '') : '');
  const s = raw.trim();
  if (s === '') return EMPRESA_EMPLEADORA_DEFAULT;
  return (EMPRESAS_EMPLEADORAS as readonly string[]).includes(s)
    ? (s as EmpresaEmpleadora)
    : EMPRESA_EMPLEADORA_DEFAULT;
}

/** Solo los empleados de Golden Talent (incluye los legacy sin campo). */
export function esGolden(empresa: EmpresaEmpleadora): boolean {
  return empresa === 'Golden Talent';
}

/** Visual: color del badge en la UI. */
export const EMPRESA_BADGE_COLOR: Record<EmpresaEmpleadora, { bg: string; fg: string }> = {
  'Golden Talent': { bg: 'transparent',         fg: 'var(--ink-3)'   },  // sin badge
  'HIT':           { bg: 'var(--indigo-bg)',    fg: 'var(--indigo)'  },  // azul
  'Poligrafy':     { bg: 'rgba(120, 78, 175, 0.14)', fg: '#5C3DAB'  },   // morado
  'BYDSA':         { bg: 'var(--amber-bg)',     fg: 'var(--amber)'   },  // naranja/ámbar
};
