/**
 * F-043 — Fuente ÚNICA de verdad para los badges del sidebar.
 *
 * Reemplaza los queries dispersos (cada quien por su lado) y los valores
 * hardcoded que estaban quemados en el sidebar. Si un badge nuevo se agrega
 * al sidebar, se agrega acá — no en el componente.
 *
 * Garantías:
 *  - Cada count usa LA MISMA función que la pantalla destino. Lo que muestre
 *    el badge "X vencidas" tiene que coincidir con lo que cuente esa pantalla.
 *  - Si una fuente falla, ese count cae a 0 (silencioso) — NUNCA a un número
 *    falso. La info financiera errónea es peor que no tener info.
 *  - Sidebar trata 0 como "no mostrar badge" (más limpio).
 */

import { getFacturasLiviano, predicadoFiltro } from './facturas';
import { getKPIsPagosPendientes } from './planillas';
import { getKPIsDeudas } from './deudas';

export interface SidebarBadges {
  /** Facturas en cobranza activa con Estatus_Cobranza = VENCIDA. Matchea /facturacion tab "Vencidas". */
  facturasVencidas: number;
  /** Líneas de planilla en estado Pendiente, períodos Aprobada/En pago. Matchea /planillas/pendientes. */
  pagosPendientes: number;
  /** Subset de pagosPendientes con >= 15 días desde aprobación (F-038.4.bis). */
  pagosPendientesAlertasRojas: number;
  /** Deudas vigentes con vencida=true o diasEnMora>0. Matchea /deudas tab "Vencidas". */
  deudasVencidas: number;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function getSidebarBadges(): Promise<SidebarBadges> {
  const [livianasResult, kpResult, kdResult] = await Promise.all([
    safe(() => getFacturasLiviano()),
    safe(() => getKPIsPagosPendientes()),
    safe(() => getKPIsDeudas()),
  ]);

  const facturasVencidas = livianasResult
    ? livianasResult.filter(predicadoFiltro('vencidas')).length
    : 0;

  return {
    facturasVencidas,
    pagosPendientes:             kpResult?.totalEmpleadosPendientes ?? 0,
    pagosPendientesAlertasRojas: kpResult?.alertasRojas ?? 0,
    deudasVencidas:              kdResult?.vencidas.cantidad ?? 0,
  };
}
