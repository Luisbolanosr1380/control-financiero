import Link from 'next/link';
import { getSesion } from '@/lib/auth/guard';
import { puede } from '@/lib/auth/roles';
import { cargarMesEnCurso } from '@/lib/resumen/mes-en-curso';
import { getFacturasPendientesCobro } from '@/lib/db/facturas-pendientes';
import { saldoInicial } from '@/lib/tesoreria/fuentes';
import { lineaCalendario, tituloDia } from '@/lib/resumen/textos';
import s from '@/components/movil/movil.module.css';

export const dynamic = 'force-dynamic';

const Q = (n: number) => `Q${Math.round(n).toLocaleString('en-US')}`;

/**
 * Resumen · Hoy: 4 tarjetas de un vistazo. Todo sale de fuentes existentes:
 *  · facturado / cobrado del mes → el mismo cálculo que usa Auros (con
 *    mes anterior y ritmo al mismo día; nunca un cero pelado);
 *  · por cobrar → facturas-pendientes (propio: excluye cedidas a factoraje);
 *  · caja hoy → saldo de bancos de /tesoreria.
 */
export default async function ResumenHoyPage() {
  const { rol } = await getSesion();
  const [mes, pend] = await Promise.all([cargarMesEnCurso(), getFacturasPendientesCobro()]);
  const caja = await saldoInicial(mes.v.hoy);
  const verFlujo = puede(rol, 'flujo');
  const t = pend.totales;

  return (
    <div className={s.resumen}>
      <div className={s.resumenDia}>{tituloDia(mes.v)}</div>
      <div className={s.tarjetas}>
        <section className={s.tarjeta} aria-label="Facturado del mes">
          <div className={s.tarjetaEtiqueta}>Facturado del mes</div>
          <div className={s.tarjetaValor}>{Q(mes.facturado.mesActualAHoyQ)}</div>
          <div className={s.tarjetaNota}>{lineaCalendario(mes.v, mes.facturado)}</div>
        </section>
        <section className={s.tarjeta} aria-label="Cobrado del mes">
          <div className={s.tarjetaEtiqueta}>Cobrado del mes</div>
          <div className={s.tarjetaValor}>{Q(mes.cobrado.mesActualAHoyQ)}</div>
          <div className={s.tarjetaNota}>{lineaCalendario(mes.v, mes.cobrado)}</div>
        </section>
        <Link href="/m/resumen/cobrar" className={s.tarjeta} aria-label="Por cobrar">
          <div className={s.tarjetaEtiqueta}>Por cobrar</div>
          <div className={s.tarjetaValor}>{Q(t.saldoTotalQ)}</div>
          <div className={s.tarjetaNota}>
            {t.saldoVencidoQ > 0 ? <span className={s.rojo}>{Q(t.saldoVencidoQ)} vencido</span> : 'Nada vencido'} · {t.numFacturas} factura{t.numFacturas === 1 ? '' : 's'}
            {t.numCedidas > 0 && <><br />Sin las {t.numCedidas} cedidas a factoraje ({Q(t.saldoCedidoQ)})</>}
          </div>
        </Link>
        {verFlujo ? (
          <Link href="/m/resumen/flujo" className={s.tarjeta} aria-label="Caja hoy">
            <div className={s.tarjetaEtiqueta}>Caja hoy</div>
            <div className={`${s.tarjetaValor} ${caja.total < 0 ? s.rojo : ''}`}>{Q(caja.total)}</div>
            <div className={s.tarjetaNota}>{notaCaja(caja)}</div>
          </Link>
        ) : (
          <section className={s.tarjeta} aria-label="Caja hoy">
            <div className={s.tarjetaEtiqueta}>Caja hoy</div>
            <div className={`${s.tarjetaValor} ${caja.total < 0 ? s.rojo : ''}`}>{Q(caja.total)}</div>
            <div className={s.tarjetaNota}>{notaCaja(caja)}</div>
          </section>
        )}
      </div>
      <p className={s.ayuda}>Solo consulta. Para operar o editar, usá la computadora.</p>
    </div>
  );
}

function notaCaja(caja: Awaited<ReturnType<typeof saldoInicial>>): string {
  if (caja.fuente === 'sin_bancos') return 'No hay cuentas bancarias cargadas';
  const n = caja.bancos.length;
  return `${n} cuenta${n === 1 ? '' : 's'} en quetzales${caja.fuente === 'movimientos' ? ' · con movimientos cargados' : ' · saldo registrado'}`;
}
