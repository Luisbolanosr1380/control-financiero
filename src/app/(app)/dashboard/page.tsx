import { currentUser } from '@clerk/nextjs/server';
import { getFacturas } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getDashboardKPIs, getLineStats, getAging, getTopDeudores } from '@/lib/db/kpis';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getKPIsDeudas } from '@/lib/db/deudas';
import { getKPIsPagosPendientes } from '@/lib/db/planillas';
import { getKPIsNotasCredito } from '@/lib/db/notas-credito';
import { getEvolucion12m, construirAlertasVivas } from '@/lib/db/dashboard-live';
import { empresaConfig } from '@/lib/config/empresa';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

// Saludo real por hora/fecha de Guatemala (UTC-6 fija) — antes era un
// texto quemado del prototipo ("Martes 19 de mayo, 2026").
function saludoGuatemala(dueno: string) {
  const gt = new Date(Date.now() - 6 * 3600_000);
  const h = gt.getUTCHours();
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const dia = gt.getUTCDate();
  const ultimoDia = new Date(gt.getUTCFullYear(), gt.getUTCMonth() + 1, 0).getDate();
  const fecha = `${dias[gt.getUTCDay()]} ${dia} de ${meses[gt.getUTCMonth()]}, ${gt.getUTCFullYear()} · Día ${dia} del mes · ${ultimoDia - dia} día${ultimoDia - dia === 1 ? '' : 's'} para el cierre`;
  return { saludo, nombre: dueno, fecha };
}

export const revalidate = 60;

export default async function DashboardPage() {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);
  const esOperativo = rol === 'operativo';
  const esAdmin = rol === 'admin';

  const [facturas, clientes] = await Promise.all([getFacturas(), getClientes()]);

  const [kpis, lineStats, aging, topDeudores, analisis, deudasKpis, pendientesKpis, ncsKpis, evolucion] = await Promise.all([
    getDashboardKPIs(facturas),
    getLineStats(facturas),
    getAging(facturas),
    getTopDeudores(5, facturas, clientes),
    getAnalisisClientes(),
    getKPIsDeudas(),
    getKPIsPagosPendientes(),   // F-038.4
    getKPIsNotasCredito(),      // F-045
    getEvolucion12m(facturas),  // FIX-DASHBOARD-ANALITICA-HIT: antes mock MONTHLY
  ]);

  // F-045: alerta NCs pendientes solo a admin (es el único que las aprueba).
  const alertaNCsPendientes = esAdmin && ncsKpis.pendientesAprobacion > 0
    ? { cantidad: ncsKpis.pendientesAprobacion, monto: ncsKpis.montoPendientesAprobacion }
    : null;

  // Banner de alerta de pasivos en mora (F-027): se muestra si el monto
  // vencido supera Q100K o el promedio de mora supera 90 días.
  const ALERTA_PASIVOS_THRESHOLD_Q = 100_000;
  const ALERTA_PASIVOS_THRESHOLD_DIAS = 90;
  const alertaDeudasVencidas = deudasKpis.vencidas.cantidad > 0 &&
    (deudasKpis.vencidas.montoTotal > ALERTA_PASIVOS_THRESHOLD_Q
      || deudasKpis.vencidas.diasPromedioMora > ALERTA_PASIVOS_THRESHOLD_DIAS)
    ? {
        montoTotal: deudasKpis.vencidas.montoTotal,
        cantidad: deudasKpis.vencidas.cantidad,
        diasPromedio: deudasKpis.vencidas.diasPromedioMora,
      }
    : null;

  // "En riesgo" = fuga real → solo clientes con naturaleza recurrente o mixta.
  // Los proyecto-dominantes (TalentTrack, Administrativo) NO son fuga por inactividad.
  const clientesRiesgo = analisis
    .filter(a =>
      (a.clasificacion === 'perdido' || a.clasificacion === 'en_riesgo' || a.clasificacion === 'en_declive')
      && a.naturalezaDominante !== 'proyecto',
    )
    .sort((a, b) => b.montoPromedio - a.montoPromedio)
    .slice(0, 8);

  // FIX-DASHBOARD-ANALITICA-HIT: alertas EN VIVO desde la base del deploy
  // (antes: AI_INSIGHTS mock con clientes/líneas de Golden).
  const alertas = construirAlertasVivas({ kpis, lineStats, aging, topDeudores, clientesRiesgo });

  return (
    <DashboardClient
      kpis={kpis}
      lineStats={lineStats}
      aging={aging}
      topDeudores={topDeudores}
      clientesRiesgo={clientesRiesgo}
      alertaDeudasVencidas={alertaDeudasVencidas}
      pendientesKpis={pendientesKpis}
      esOperativo={esOperativo}
      alertaNCsPendientes={alertaNCsPendientes}
      evolucion={evolucion}
      alertas={alertas}
      saludo={saludoGuatemala(empresaConfig().dueno)}
    />
  );
}
