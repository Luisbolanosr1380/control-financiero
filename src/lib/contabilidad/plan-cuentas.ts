/**
 * F-CUENTAS-CREATOR: lógica PURA del plan de cuentas jerárquico.
 * Sin imports — la usan tanto el servidor (crearCuentaContable) como
 * el cliente (creador guiado), así las validaciones son idénticas.
 *
 * Primer dígito = naturaleza. 'Acreedora'/'Deudora' matchean el parseo
 * de los motores ER/BS (startsWith('acre')) y su fallback por código.
 */

export const NATURALEZAS_PLAN: Record<string, { nombre: string; esAcreedora: boolean }> = {
  '1': { nombre: 'Activo',      esAcreedora: false },
  '2': { nombre: 'Pasivo',      esAcreedora: true },
  '3': { nombre: 'Patrimonio',  esAcreedora: true },
  '4': { nombre: 'Ingresos',    esAcreedora: true },
  '5': { nombre: 'Egresos',     esAcreedora: false },
  '6': { nombre: 'Gastos',      esAcreedora: false },
};

export function naturalezaDeCodigo(codigo: string): { nombre: string; esAcreedora: boolean } | null {
  return NATURALEZAS_PLAN[codigo.trim().split('-')[0]] ?? null;
}

/**
 * Siguiente código libre bajo un padre: los hijos se numeran
 * consecutivos → max(segmento de los hijos) + 1; sin hijos → "-1".
 */
export function sugerirSiguienteCodigo(parentPath: string, codigosExistentes: string[]): string {
  const prefijo = `${parentPath}-`;
  const nivelHijo = parentPath.split('-').length + 1;
  let max = 0;
  for (const c of codigosExistentes) {
    if (!c.startsWith(prefijo)) continue;
    const segs = c.split('-');
    if (segs.length !== nivelHijo) continue;
    const n = Number(segs[nivelHijo - 1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${parentPath}-${max + 1}`;
}
