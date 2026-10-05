'use client';

/**
 * TESORERÍA — flujo de caja proyectado (escritorio). El motor es puro, así
 * que horizonte, granularidad y el toggle de partes relacionadas se
 * recalculan acá sin volver al servidor. Read-only.
 */

import { Fragment, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { proyectar, type EventoCaja, type FuenteCaja, type Granularidad, type Marca, type Periodo } from '@/lib/tesoreria/motor';
import type { Supuestos } from '@/lib/tesoreria/fuentes';

interface Props { hoy: string; eventos: EventoCaja[]; supuestos: Supuestos }
type Horizonte = '13s' | '6m';

const CANTIDAD: Record<Horizonte, Record<Granularidad, number>> = { '13s': { semana: 13, mes: 3 }, '6m': { semana: 26, mes: 6 } };
const FUENTE_LABEL: Record<FuenteCaja, string> = { cobro: 'Cobros de facturas', recurrente: 'Obligaciones recurrentes', deuda: 'Deudas', planilla: 'Planilla', cxp: 'Cuentas por pagar', factoraje: 'Factoraje' };
const MARCA_LABEL: Record<Marca, string> = {
  estimado: 'estimado', dias_credito_default: 'días crédito por defecto', terminos_incompletos: 'solo capital (términos incompletos)',
  intercompany: 'intercompany', sin_fecha: 'sin fecha de pago', parte_relacionada: 'parte relacionada', vencimiento_estimado: 'vencimiento estimado',
};
const MARCA_CLS: Partial<Record<Marca, string>> = { terminos_incompletos: 'badge-warn', dias_credito_default: 'badge-warn', sin_fecha: 'badge-warn', vencimiento_estimado: 'badge-warn', parte_relacionada: 'badge-outline', intercompany: 'badge-outline' };
const fmtFecha = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
const ROJO = 'var(--wine)';

export function TesoreriaClient({ hoy, eventos, supuestos: sup }: Props) {
  const [horizonte, setHorizonte] = useState<Horizonte>('13s');
  const [gran, setGran] = useState<Granularidad>('semana');
  const [incluirPR, setIncluirPR] = useState(true);
  const [incluirSinFecha, setIncluirSinFecha] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const base = useMemo(() => ({
    hoy, granularidad: gran, cantidad: CANTIDAD[horizonte][gran], saldoInicial: sup.saldoInicial.total,
    eventos: incluirPR ? eventos : eventos.filter(e => !e.marcas.includes('parte_relacionada')),
  }), [hoy, gran, horizonte, incluirPR, eventos, sup.saldoInicial.total]);
  const p = useMemo(() => proyectar({ ...base, incluirSinFecha }), [base, incluirSinFecha]);
  // Peor caso: los pasivos sin fecha exigibles hoy (para el aviso cuando están excluidos).
  const peor = useMemo(() => (incluirSinFecha ? p : proyectar({ ...base, incluirSinFecha: true })), [base, incluirSinFecha, p]);
  const { sinFecha: listaSinFecha, totalSinFecha } = useMemo(() => (incluirSinFecha ? proyectar({ ...base, incluirSinFecha: false }) : p), [base, incluirSinFecha, p]);

  const datosGrafico = p.periodos.map(x => ({ etiqueta: x.clave === 'atrasado' ? 'Atrasado' : x.etiqueta, saldo: x.saldoFin, ingresos: x.ingresos, egresos: x.egresos, negativo: x.negativo }));
  const negativos = p.periodos.filter(x => x.negativo).length;

  const exportar = () => {
    const L: string[] = [];
    const fila = (...c: Array<string | number>) => L.push(c.map(csvEscape).join(','));
    fila('Flujo de caja proyectado', `al ${hoy}`, horizonte === '13s' ? '13 semanas' : '6 meses', `por ${gran}`, incluirPR ? 'incluye partes relacionadas' : 'sin partes relacionadas', incluirSinFecha ? 'pasivos sin fecha como exigibles hoy' : 'pasivos sin fecha aparte');
    fila('Saldo inicial', sup.saldoInicial.total);
    L.push('');
    fila('Período', 'Desde', 'Hasta', 'Saldo inicio', 'Ingresos', 'Egresos', 'Neto', 'Saldo fin', 'Negativo');
    for (const x of p.periodos) fila(x.etiqueta, x.inicio, x.fin, x.saldoInicio, x.ingresos, x.egresos, x.neto, x.saldoFin, x.negativo ? 'SÍ' : '');
    fila('TOTAL', '', '', sup.saldoInicial.total, p.totalIngresos, p.totalEgresos, (p.totalIngresos - p.totalEgresos).toFixed(2), p.saldoFinal, '');
    L.push('');
    fila('Período', 'Fecha', 'Tipo', 'Fuente', 'Descripción', 'Monto', 'Supuestos');
    for (const x of p.periodos) for (const e of x.eventos) fila(x.etiqueta, e.fecha, e.tipo, FUENTE_LABEL[e.fuente], e.descripcion, e.tipo === 'egreso' ? -e.monto : e.monto, e.marcas.map(m => MARCA_LABEL[m]).join(' · '));
    L.push('');
    fila('Cobranza vencida (NO incluida en el saldo)');
    for (const e of p.cobranzaVencida) fila('', e.fecha, 'ingreso', FUENTE_LABEL[e.fuente], e.descripcion, e.monto, e.marcas.map(m => MARCA_LABEL[m]).join(' · '));
    if (!incluirSinFecha && p.sinFecha.length) {
      L.push('');
      fila('Pasivos sin fecha de pago (NO incluidos en el saldo)');
      for (const e of p.sinFecha) fila('', '', 'egreso', FUENTE_LABEL[e.fuente], e.descripcion, -e.monto, e.marcas.map(m => MARCA_LABEL[m]).join(' · '));
    }
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flujo-caja_${hoy}_${horizonte}_${gran}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sel = (activo: boolean) => ({ fontSize: 12, padding: '4px 10px', ...(activo ? {} : { opacity: 0.7 }) });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Flujo de caja proyectado</h1>
          <div className="page-subtitle">Cuánto efectivo habrá en cada período según lo que está por cobrar y por pagar hoy. Solo lectura: no registra nada.</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className={'btn ' + (horizonte === '13s' ? 'btn-primary' : 'btn-ghost')} style={sel(horizonte === '13s')} onClick={() => setHorizonte('13s')}>13 semanas</button>
            <button className={'btn ' + (horizonte === '6m' ? 'btn-primary' : 'btn-ghost')} style={sel(horizonte === '6m')} onClick={() => setHorizonte('6m')}>6 meses</button>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className={'btn ' + (gran === 'semana' ? 'btn-secondary' : 'btn-ghost')} style={sel(gran === 'semana')} onClick={() => setGran('semana')}>Por semana</button>
            <button className={'btn ' + (gran === 'mes' ? 'btn-secondary' : 'btn-ghost')} style={sel(gran === 'mes')} onClick={() => setGran('mes')}>Por mes</button>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={incluirPR} onChange={e => setIncluirPR(e.target.checked)} /> Incluir partes relacionadas
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={incluirSinFecha} onChange={e => setIncluirSinFecha(e.target.checked)} /> Pasivos sin fecha como exigibles hoy
          </label>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={exportar}><I.Download size={12} /> Exportar CSV</button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Saldo inicial</div><div className="kpi-value" style={{ fontSize: 20 }}>{Q(sup.saldoInicial.total)}</div><div className="kpi-delta"><span className="vs">{sup.saldoInicial.bancos.length} cuenta(s) GTQ</span></div></div>
        <div className="kpi"><div className="kpi-label">Ingresos proyectados</div><div className="kpi-value" style={{ fontSize: 20 }}>{Q(p.totalIngresos)}</div></div>
        <div className="kpi"><div className="kpi-label">Egresos proyectados</div><div className="kpi-value" style={{ fontSize: 20 }}>{Q(p.totalEgresos)}</div></div>
        <div className="kpi"><div className="kpi-label">Saldo final</div><div className="kpi-value" style={{ fontSize: 20, color: p.saldoFinal < 0 ? ROJO : undefined }}>{Q(p.saldoFinal)}</div></div>
        <div className="kpi"><div className="kpi-label">Punto más bajo</div><div className="kpi-value" style={{ fontSize: 20, color: (p.minimo?.saldo ?? 0) < 0 ? ROJO : undefined }}>{p.minimo ? Q(p.minimo.saldo) : '—'}</div><div className="kpi-delta"><span className="vs">{p.minimo?.etiqueta ?? ''}</span></div></div>
      </div>

      {p.primerNegativo && (
        <div className="card" style={{ borderColor: ROJO, marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13, color: ROJO }}>
            <strong>Caja negativa a partir de {p.primerNegativo.etiqueta}</strong> ({Q(p.primerNegativo.saldo)}). {negativos} período(s) en rojo en este horizonte.
          </div>
        </div>
      )}

      {totalSinFecha > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13 }}>
            <strong>{Q(totalSinFecha)} en pasivos sin fecha de pago</strong> ({listaSinFecha.length} documento(s)).{' '}
            {incluirSinFecha
              ? <>Están incluidos como exigibles hoy, en el período &quot;Atrasado&quot;.</>
              : <>No están en el saldo porque no hay fecha para ubicarlos. Si se pagaran hoy, el punto más bajo sería <strong style={{ color: (peor.minimo?.saldo ?? 0) < 0 ? ROJO : undefined }}>{peor.minimo ? Q(peor.minimo.saldo) : '—'}</strong>. Cargar su vencimiento en Deudas los ubica en el período correcto.</>}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title">Saldo al cierre de cada período</div></div>
        <div style={{ height: 260, padding: '8px 12px' }}>
          <ResponsiveContainer>
            <BarChart data={datosGrafico} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} interval={0} angle={gran === 'semana' && p.periodos.length > 14 ? -35 : 0} textAnchor={gran === 'semana' && p.periodos.length > 14 ? 'end' : 'middle'} height={gran === 'semana' && p.periodos.length > 14 ? 50 : 30} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `Q${Math.round(Number(v) / 1000)}K`} width={60}
                domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
              <Tooltip formatter={(v) => Q(Number(v))} labelStyle={{ fontWeight: 500 }} />
              <ReferenceLine y={0} stroke="var(--ink)" strokeWidth={1.5} />
              <Bar dataKey="saldo" name="Saldo fin">
                {datosGrafico.map((d, i) => <Cell key={i} fill={d.negativo ? '#a23b3b' : '#6b7a3a'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title">Detalle por período</div><div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Clic en un período para ver de dónde sale cada monto</div></div>
        <table className="table">
          <thead><tr><th>Período</th><th className="num">Saldo inicio</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Neto</th><th className="num">Saldo fin</th></tr></thead>
          <tbody>
            {p.periodos.map(x => (
              <Fragment key={x.clave}>
                <tr className="clickable" onClick={() => setAbierto(abierto === x.clave ? null : x.clave)} style={{ cursor: 'pointer', background: x.negativo ? 'var(--wine-bg, #f7e9e9)' : undefined }}>
                  <td><span style={{ display: 'inline-block', width: 14 }}>{abierto === x.clave ? '▾' : '▸'}</span>{x.etiqueta}{x.clave !== 'atrasado' && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}> · {fmtFecha(x.inicio)}–{fmtFecha(x.fin)}</span>}</td>
                  <td className="num">{Q(x.saldoInicio)}</td>
                  <td className="num">{Q(x.ingresos)}</td>
                  <td className="num">{Q(x.egresos)}</td>
                  <td className="num" style={{ color: x.neto < 0 ? ROJO : undefined }}>{Q(x.neto)}</td>
                  <td className="num cell-strong" style={{ color: x.negativo ? ROJO : undefined }}>{Q(x.saldoFin)}</td>
                </tr>
                {abierto === x.clave && <tr><td colSpan={6} style={{ padding: 0 }}><DetallePeriodo periodo={x} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr><td className="cell-strong">Total horizonte</td><td className="num">{Q(sup.saldoInicial.total)}</td><td className="num cell-strong">{Q(p.totalIngresos)}</td><td className="num cell-strong">{Q(p.totalEgresos)}</td><td className="num cell-strong">{Q(p.totalIngresos - p.totalEgresos)}</td><td className="num cell-strong" style={{ color: p.saldoFinal < 0 ? ROJO : undefined }}>{Q(p.saldoFinal)}</td></tr></tfoot>
        </table>
        {(p.fueraDeHorizonte.ingresos > 0 || p.fueraDeHorizonte.egresos > 0) && (
          <div style={{ padding: '8px 16px', fontSize: 11.5, color: 'var(--ink-4)', borderTop: '1px solid var(--line-3)' }}>
            Después del horizonte: {Q(p.fueraDeHorizonte.ingresos)} por cobrar y {Q(p.fueraDeHorizonte.egresos)} por pagar (no incluidos).
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <Supuestos sup={sup} incluirPR={incluirPR} />
        <div className="card">
          <div className="card-head"><div className="card-title">Cobranza vencida · {Q(p.totalCobranzaVencida)}</div></div>
          <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--ink-3)' }}>
            Facturas cuya fecha esperada de cobro ya pasó. <strong>No se suman al saldo</strong>: no asumimos que entren hoy. Si alguna se cobra, la proyección mejora en ese monto.
          </div>
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="table">
              <thead><tr><th>Esperada</th><th>Factura</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                {p.cobranzaVencida.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-4)' }}>Sin cobranza vencida.</td></tr>}
                {[...p.cobranzaVencida].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((e, i) => (
                  <tr key={i}>
                    <td className="num" style={{ color: ROJO }}>{fmtFecha(e.fecha)}</td>
                    <td style={{ fontSize: 12.5 }}>{e.ref?.id ? <a href={`/facturacion/${e.ref.id}`}>{e.descripcion}</a> : e.descripcion}<Marcas marcas={e.marcas} /></td>
                    <td className="num">{Q(e.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {listaSinFecha.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><div className="card-title">Pasivos sin fecha de pago · {Q(totalSinFecha)}</div><div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{incluirSinFecha ? 'incluidos como exigibles hoy' : 'fuera del saldo'} · mayores primero</div></div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="table">
              <tbody>
                {listaSinFecha.slice(0, 200).map((e, i) => (
                  <tr key={i}>
                    <td style={{ width: 150, fontSize: 11.5, color: 'var(--ink-3)' }}>{FUENTE_LABEL[e.fuente]}</td>
                    <td style={{ fontSize: 12.5 }}>{e.ref?.tipo === 'deuda' ? <a href={`/deudas/${e.ref.id}`}>{e.descripcion}</a> : e.descripcion}<Marcas marcas={e.marcas} /></td>
                    <td className="num" style={{ width: 130 }}>{Q(e.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listaSinFecha.length > 200 && <div style={{ padding: '8px 16px', fontSize: 11.5, color: 'var(--ink-4)' }}>… y {listaSinFecha.length - 200} más (todos en el CSV).</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Marcas({ marcas }: { marcas: Marca[] }) {
  const visibles = marcas.filter(m => m !== 'estimado');
  if (!visibles.length) return null;
  return <span style={{ marginLeft: 6 }}>{visibles.map(m => <span key={m} className={'badge ' + (MARCA_CLS[m] ?? 'badge-mute')} style={{ fontSize: 10, marginRight: 4 }}>{MARCA_LABEL[m]}</span>)}</span>;
}

function DetallePeriodo({ periodo: x }: { periodo: Periodo }) {
  const fuentes = Object.entries(x.porFuente) as Array<[FuenteCaja, { ingresos: number; egresos: number }]>;
  const [fuente, setFuente] = useState<FuenteCaja | null>(null);
  const evs = x.eventos.filter(e => !fuente || e.fuente === fuente).sort((a, b) => a.fecha.localeCompare(b.fecha) || b.monto - a.monto);
  return (
    <div style={{ background: 'var(--bg-2, #fafaf7)', padding: '10px 16px 14px 30px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className={'btn ' + (!fuente ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 11.5 }} onClick={() => setFuente(null)}>Todas</button>
        {fuentes.map(([f, t]) => (
          <button key={f} className={'btn ' + (fuente === f ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 11.5 }} onClick={() => setFuente(f)}>
            {FUENTE_LABEL[f]}: {t.ingresos > 0 && <span style={{ color: 'var(--olive)' }}>+{Q(t.ingresos)}</span>}{t.ingresos > 0 && t.egresos > 0 && ' / '}{t.egresos > 0 && <span style={{ color: ROJO }}>−{Q(t.egresos)}</span>}
          </button>
        ))}
      </div>
      {evs.length === 0 ? <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>Sin movimientos en este período.</div> : (
        <table className="table" style={{ background: 'transparent' }}>
          <tbody>
            {evs.map((e, i) => (
              <tr key={i}>
                <td className="num" style={{ width: 95 }}>{fmtFecha(e.fecha)}</td>
                <td style={{ width: 150, fontSize: 11.5, color: 'var(--ink-3)' }}>{FUENTE_LABEL[e.fuente]}</td>
                <td style={{ fontSize: 12.5 }}>{e.descripcion}<Marcas marcas={e.marcas} /></td>
                <td className="num" style={{ width: 130, color: e.tipo === 'egreso' ? ROJO : 'var(--olive)' }}>{e.tipo === 'egreso' ? '−' : '+'}{Q(e.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Supuestos({ sup, incluirPR }: { sup: Supuestos; incluirPR: boolean }) {
  const s = sup;
  const items: Array<[string, React.ReactNode]> = [
    ['Saldo inicial', s.saldoInicial.fuente === 'sin_bancos'
      ? 'No hay cuentas bancarias GTQ activas: se parte de Q0.'
      : <>Saldo registrado de {s.saldoInicial.bancos.length} cuenta(s) GTQ {s.saldoInicial.fuente === 'movimientos' ? 'más los movimientos bancarios cargados' : '(sin movimientos cargados: es el saldo de apertura)'}.{s.saldoInicial.excluidosUSD.length > 0 && <> Cuentas en otra moneda excluidas: {s.saldoInicial.excluidosUSD.join(', ')}.</>}
        <div style={{ marginTop: 4 }}>{s.saldoInicial.bancos.map(b => <div key={b.nombre} style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{b.nombre}: {Q(b.saldo)}{b.movimientos ? ` (${b.movimientos} mov., último ${fmtFecha(b.ultimaFechaMovimiento ?? '')})` : ''}</div>)}</div></>],
    ['Cobros', <>{s.cobros.facturas} factura(s) abiertas por {Q(s.cobros.monto)}, esperadas en emisión + días de crédito del cliente.{s.cobros.conDiasDefault > 0 && <> <strong>{s.cobros.conDiasDefault}</strong> sin días de crédito cargados ({Q(s.cobros.montoDiasDefault)}): se asumen {s.cobros.diasDefault} días.</>}</>],
    ['Facturas cedidas', s.cedidas.facturas > 0 ? <>{s.cedidas.facturas} factura(s) por {Q(s.cedidas.monto)} están cedidas a factoraje: <strong>no cuentan como ingreso propio</strong> (las cobra el financiador).</> : 'No hay facturas cedidas.'],
    ['Deudas', <>{s.deudas.conTerminos} con cuotas calculadas desde sus términos. <strong>{s.deudas.terminosIncompletos}</strong> sin plazo/primera cuota ({Q(s.deudas.montoTerminosIncompletos)}): se proyecta <strong>solo el capital</strong> en su vencimiento, sin inventar interés{s.deudas.sinFecha > 0 && <>; {s.deudas.sinFecha} no tienen fecha de pago (ver &quot;Pasivos sin fecha&quot;)</>}. {s.deudas.partesRelacionadas > 0 && <>{s.deudas.partesRelacionadas} son con socios/empleados/relacionados ({Q(s.deudas.montoPartesRelacionadas)}) — {incluirPR ? 'incluidas' : <strong>excluidas en esta vista</strong>}.</>}</>],
    ['Factoraje', s.factoraje.total === 0 ? 'Sin factorajes con saldo.' : <>{s.factoraje.total} factoraje(s) con saldo. {s.factoraje.capitalExcluidoPorCesiones > 0 && <>{s.factoraje.capitalExcluidoPorCesiones} sin recurso con facturas cedidas: el capital lo cancela el cliente al financiador, no sale de nuestra caja ({Q(s.factoraje.montoCapitalExcluido)}). </>}{s.factoraje.sinComisionInteres > 0 && <>{s.factoraje.sinComisionInteres} sin comisión ni interés cargados: solo capital.</>}</>],
    ['Recurrentes', <>{s.recurrentes.activas} obligación(es) activas proyectadas por frecuencia y día de pago.{s.recurrentes.intercompany > 0 && <> {s.recurrentes.intercompany} se pagan por cuenta de otra empresa del grupo (marcadas intercompany): salen del banco de {s.recurrentes.empresaPrincipal}.</>}</>],
    ['Planilla', s.planilla.fuente === 'sin_datos' ? 'Sin planilla pendiente ni empleados activos.' : <>{s.planilla.lineasPendientes > 0 && <>{s.planilla.lineasPendientes} línea(s) generadas pendientes de pago (neto + IGSS patronal). </>}{s.planilla.quincenaEstimada > 0 && <>Quincenas aún no generadas: estimadas en {Q(s.planilla.quincenaEstimada)} con {s.planilla.empleados} empleado(s) activos (15 y fin de mes).</>}</>],
    ['Cuentas por pagar', <>{s.cxp.gastos} gasto(s) no pagados por {Q(s.cxp.monto)} en su fecha de vencimiento.{s.cxp.sinVencimiento > 0 && <> {s.cxp.sinVencimiento} sin vencimiento: fecha del gasto + 30 días.</>}</>],
    ['Vencidos', 'Pagos vencidos se cuentan en "Atrasado" (exigibles ya). Cobros vencidos se muestran aparte y no suman.'],
  ];
  return (
    <div className="card">
      <div className="card-head"><div className="card-title">Supuestos de esta proyección</div></div>
      <div style={{ padding: '4px 16px 12px' }}>
        {items.map(([t, d]) => (
          <div key={t} style={{ padding: '7px 0', borderBottom: '1px solid var(--line-3)', fontSize: 12.5 }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t}</div>
            <div>{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
