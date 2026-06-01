/**
 * Matriz de permisos por rol (F-030).
 *
 * Reglas:
 * - admin: todo, sin límites.
 * - gerencia: chat con límite mensual, análisis manual solo lunes/fin de mes.
 * - operativo: lectura + CRUD operativo, SIN AI (ni chat ni análisis).
 *
 * `aurosLimiteMensual` es número o Infinity (admin). Cuando se compara contra
 * el consumo actual hay que tratarlo como cap duro.
 */

import type { Role } from './allowlist';

export interface PermisosRol {
  aurosChat: boolean;
  aurosLimiteMensual: number;              // número finito o Infinity
  analisisManual: boolean;
  analisisManualVentanaTiempo: boolean;    // true = solo lunes + últimos 2 días del mes
  gestionUsuarios: boolean;
  crearEditar: boolean;
  verAnaliticaAvanzada: boolean;
}

export const PERMISSIONS: Record<Role, PermisosRol> = {
  admin: {
    aurosChat: true,
    aurosLimiteMensual: Infinity,
    analisisManual: true,
    analisisManualVentanaTiempo: false,
    gestionUsuarios: true,
    crearEditar: true,
    verAnaliticaAvanzada: true,
  },
  gerencia: {
    aurosChat: true,
    aurosLimiteMensual: 100,
    analisisManual: true,
    analisisManualVentanaTiempo: true,
    gestionUsuarios: false,
    crearEditar: true,
    verAnaliticaAvanzada: true,
  },
  operativo: {
    aurosChat: false,
    aurosLimiteMensual: 0,
    analisisManual: false,
    analisisManualVentanaTiempo: false,
    gestionUsuarios: false,
    crearEditar: true,
    verAnaliticaAvanzada: false,
  },
};

type PermisoBooleano = {
  [K in keyof PermisosRol]: PermisosRol[K] extends boolean ? K : never;
}[keyof PermisosRol];

/** Helper: el rol tiene activo el permiso booleano. */
export function tienePermiso(rol: Role, permiso: PermisoBooleano): boolean {
  return PERMISSIONS[rol][permiso] === true;
}

/** Helper: límite mensual de consultas a Auros del rol. */
export function getLimiteAuros(rol: Role): number {
  return PERMISSIONS[rol].aurosLimiteMensual;
}

/**
 * Ventana de tiempo para análisis manual (F-030 parte F).
 * Habilitada solo si es LUNES o uno de los últimos 2 días del mes.
 */
export function estaEnVentanaAnalisisManual(hoy: Date = new Date()): boolean {
  const esLunes = hoy.getDay() === 1; // 0=domingo, 1=lunes
  const ultimoDiaDelMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const diaDelMes = hoy.getDate();
  const esUltimosDosDias = diaDelMes >= (ultimoDiaDelMes - 1);
  return esLunes || esUltimosDosDias;
}

/** Calcula la próxima fecha (YYYY-MM-DD) en que se abre la ventana. */
export function proximaVentanaAnalisisManual(hoy: Date = new Date()): string {
  // Probamos cada día siguiente hasta encontrar uno que esté en ventana
  const probe = new Date(hoy);
  probe.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 35; i++) {
    probe.setDate(probe.getDate() + 1);
    if (estaEnVentanaAnalisisManual(probe)) {
      const y = probe.getFullYear();
      const m = String(probe.getMonth() + 1).padStart(2, '0');
      const d = String(probe.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return '';
}

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Texto legible para humanos: "lunes 8 de junio". */
export function fechaLegible(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const fecha = new Date(y, m - 1, d);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${dias[fecha.getDay()]} ${d} de ${MESES_ES[m - 1]}`;
}

/** Mes referencia para queries: "YYYY-MM". */
export function mesReferencia(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
