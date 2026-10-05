'use client';

/**
 * Flujo de caja proyectado para el teléfono. Mismo motor y mismos defaults
 * que /tesoreria (partes relacionadas incluidas, pasivos sin fecha aparte),
 * así las cifras coinciden. Pantalla chica: barras del saldo al cierre de
 * cada período, línea de cero, negativos en rojo, etiquetas espaciadas y
 * el detalle en una lista tocable en vez de tooltips finos.
 */
import { useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { proyectar, type EventoCaja, type Granularidad } from '@/lib/tesoreria/motor';
import s from './movil.module.css';

interface Props { hoy: string; eventos: EventoCaja[]; saldoInicial: number; cedidas: { facturas: number; monto: number } }

const CANTIDAD: Record<'13s' | '6m', { gran: Granularidad; n: number }> = { '13s': { gran: 'semana', n: 13 }, '6m': { gran: 'mes', n: 6 } };
const Q = (n: number) => `${n < 0 ? '−' : ''}Q${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const QK = (n: number) => {
  const a = Math.abs(n);
  const t = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M` : a >= 1000 ? `${Math.round(a / 1000)}K` : String(Math.round(a));
  return `${n < 0 ? '−' : ''}Q${t}`;
};
const ROJO = '#a23b3b';
const VERDE = '#5A6A2E';

export function FlujoMovil({ hoy, eventos, saldoInicial, cedidas }: Props) {
  const [horizonte, setHorizonte] = useState<'13s' | '6m'>('13s');
  const p = useMemo(() => proyectar({
    hoy, granularidad: CANTIDAD[horizonte].gran, cantidad: CANTIDAD[horizonte].n, saldoInicial, eventos, incluirSinFecha: false,
  }), [hoy, horizonte, saldoInicial, eventos]);

  const datos = p.periodos.map(x => ({
    clave: x.clave,
    eje: x.clave === 'atrasado' ? 'Atr.' : horizonte === '13s' ? x.etiqueta.split(' – ')[0] : x.etiqueta.split(' ')[0],
    saldo: x.saldoFin,
    negativo: x.negativo,
  }));

  return (
    <div className={s.resumen}>
      <div className={s.segmentosChicos} role="tablist" aria-label="Horizonte">
        {(['13s', '6m'] as const).map(h => (
          <button key={h} type="button" role="tab" aria-selected={horizonte === h}
            className={`${s.segmentoChico} ${horizonte === h ? s.segmentoChicoActivo : ''}`} onClick={() => setHorizonte(h)}>
            {h === '13s' ? '13 semanas' : '6 meses'}
          </button>
        ))}
      </div>

      {p.primerNegativo ? (
        <div className={s.alertaRoja} role="status">
          <strong>Caja negativa desde {p.primerNegativo.clave === 'atrasado' ? 'ya (pagos atrasados)' : p.primerNegativo.etiqueta}</strong>
          <span> · punto más bajo {Q(p.minimo?.saldo ?? 0)}</span>
        </div>
      ) : (
        <div className={s.alertaOk} role="status">Sin períodos en rojo en este horizonte · punto más bajo {Q(p.minimo?.saldo ?? saldoInicial)}</div>
      )}

      <div className={s.tarjetasDos}>
        <div className={s.tarjeta}><div className={s.tarjetaEtiqueta}>Caja hoy</div><div className={s.tarjetaValorChico}>{Q(saldoInicial)}</div></div>
        <div className={s.tarjeta}><div className={s.tarjetaEtiqueta}>Al final</div><div className={`${s.tarjetaValorChico} ${p.saldoFinal < 0 ? s.rojo : ''}`}>{Q(p.saldoFinal)}</div></div>
      </div>

      <div className={s.grafico} aria-label="Saldo al cierre de cada período">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={datos} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="eje" tick={{ fontSize: 11 }} interval={horizonte === '13s' ? 2 : 0} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => QK(Number(v))} width={52} tickLine={false} axisLine={false} tickCount={4}
              domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
            {/* El eje siempre incluye el cero: si todo es negativo, la línea queda arriba y las barras cuelgan de ella. */}
            <ReferenceLine y={0} stroke="var(--ink)" strokeWidth={1.5} />
            <Bar dataKey="saldo" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {datos.map(d => <Cell key={d.clave} fill={d.negativo ? ROJO : VERDE} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className={s.leyenda}><span className={s.puntoVerde} /> saldo positivo <span className={s.puntoRojo} /> negativo · la línea es el cero</div>
      </div>

      <ul className={s.listaPeriodos} aria-label="Saldo por período">
        {p.periodos.map(x => (
          <li key={x.clave} className={x.negativo ? s.periodoNegativo : ''}>
            <span>{x.clave === 'atrasado' ? 'Atrasado (vencido)' : x.etiqueta}</span>
            <span className={s.num}>
              {x.neto !== 0 && <small className={x.neto < 0 ? s.rojo : s.verde}>{x.neto > 0 ? '+' : ''}{QK(x.neto)} </small>}
              <strong className={x.negativo ? s.rojo : ''}>{Q(x.saldoFin)}</strong>
            </span>
          </li>
        ))}
      </ul>

      <p className={s.ayuda}>
        Mismos supuestos que el flujo de la computadora: cobros vencidos y pasivos sin fecha van aparte
        {p.totalSinFecha > 0 && <> (pasivos sin fecha: {Q(p.totalSinFecha)})</>}
        {cedidas.facturas > 0 && <>; las {cedidas.facturas} facturas cedidas a factoraje ({Q(cedidas.monto)}) no cuentan como cobro propio</>}.
        El detalle completo está en Flujo de caja proyectado, en la computadora.
      </p>
    </div>
  );
}
