/**
 * MÓVIL — qué ve cada rol en la app del teléfono. PURO (sin IO): lo usan
 * el layout de /m, la redirección de / y el validador.
 *
 * Único punto para ajustar el mapa:
 *  · gerentes / dueños / socios (admin, lectura) → arrancan en Auros.
 *  · operadores (contador, auxiliar)            → arrancan en captura.
 * Cada sección además exige su permiso real: Auros = PERMISSIONS.aurosChat
 * (auxiliar no tiene), captura = poder registrar al menos un documento.
 */
import { puede, type Accion, type Rol } from '../auth/roles';
import { PERMISSIONS } from '../auth/permissions';

export type SeccionMovil = 'auros' | 'captura';
export type TipoCaptura = 'gasto' | 'factura' | 'cobro';

export const HOME_POR_ROL: Record<Rol, SeccionMovil> = {
  admin: 'auros',
  lectura: 'auros',
  contador: 'captura',
  auxiliar: 'captura',
};

export const ACCION_CAPTURA: Record<TipoCaptura, Accion> = {
  gasto: 'registrar_gasto',
  factura: 'emitir_factura',
  cobro: 'registrar_cobro',
};

export function tiposCaptura(rol: Rol | null | undefined): TipoCaptura[] {
  if (!rol) return [];
  return (Object.keys(ACCION_CAPTURA) as TipoCaptura[]).filter(t => puede(rol, ACCION_CAPTURA[t]));
}

export function seccionesMovil(rol: Rol | null | undefined): SeccionMovil[] {
  if (!rol) return [];
  const out: SeccionMovil[] = [];
  if (PERMISSIONS[rol].aurosChat) out.push('auros');
  if (tiposCaptura(rol).length > 0) out.push('captura');
  return out;
}

/** Home del rol; si el rol no tiene esa sección, la primera que sí tenga. */
export function homeMovil(rol: Rol | null | undefined): SeccionMovil | null {
  const secciones = seccionesMovil(rol);
  if (!rol || secciones.length === 0) return null;
  return secciones.includes(HOME_POR_ROL[rol]) ? HOME_POR_ROL[rol] : secciones[0];
}

/** User-agent de teléfono (para mandar / → /m). Tablets quedan en escritorio. */
export function esTelefono(userAgent: string | null | undefined): boolean {
  const ua = userAgent ?? '';
  return /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari(?!.*iPad)/i.test(ua) && !/iPad|Tablet/i.test(ua);
}

/** Preguntas tocables al abrir Auros. Redactadas para no caer en el "cero de
 *  inicio de mes": comparan contra el mes pasado o miran stock (caja, cartera). */
export const SUGERENCIAS_MOVIL = [
  '¿Cómo va mi flujo de caja?',
  '¿Quién facturó más este mes? (vs el mes pasado)',
  '¿Cuánto me deben y quién?',
  '¿Estoy ganando este mes?',
  '¿Qué pagos vienen esta semana?',
  'Contame del cliente…',
] as const;
