'use client';

/**
 * PAQUETES PREPAGADOS (034) · lista global /paquetes: todos los paquetes con cliente, líneas, % usado, remanente, valor del
 * remanente (remanente × precio unitario) y vencimiento. Filtros (activos, por agotarse, agotados, vencidos, todos) en la
 * URL. KPI «Pasivo por anticipos»: el valor del remanente de todos los paquetes activos (la contabilidad del ingreso
 * diferido queda fuera: lo decide el CFO aparte).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Q } from '@/lib/utils';
import { NOMBRE_SERVICIO } from '@/lib/facturacion-agenda/situacion';
import { BADGE_ESTADO, ETIQUETA_ESTADO, ETIQUETA_FILTRO, FILTROS_PAQUETES, esFiltroPaquetes, estadoEfectivo, etiquetaLinea, pasaFiltro, porcentajeUsado, totalRemanente, valorRemanente, type FiltroPaquetes, type Paquete } from '@/lib/paquetes/paquete';
import { BarraUso } from './paquetes-section';

const nombreServicio = (s: string) => NOMBRE_SERVICIO[s] ?? (s === 'PSICOMETRICAS' ? 'Psicométricas' : s);
const fecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

export function PaquetesLista({ paquetes, hoy, disponible }: { paquetes: Paquete[]; hoy: string; disponible: boolean }) {
  const sp = useSearchParams();
  const inicial = sp.get('f');
  const [filtro, setFiltro] = useState<FiltroPaquetes>(esFiltroPaquetes(inicial) ? inicial : 'activos');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search); if (filtro === 'activos') p.delete('f'); else p.set('f', filtro);
    const qs = p.toString(); const nuevo = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (nuevo !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', nuevo);
  }, [filtro]);
  const activos = useMemo(() => paquetes.filter(p => pasaFiltro(p, 'activos', hoy)), [paquetes, hoy]);
  const pasivo = useMemo(() => Math.round(activos.reduce((a, p) => a + valorRemanente(p), 0) * 100) / 100, [activos]);
  const conteo = (f: FiltroPaquetes) => paquetes.filter(p => pasaFiltro(p, f, hoy)).length;
  const n = q.trim().toLowerCase();
  const filas = useMemo(() => paquetes.filter(p => pasaFiltro(p, filtro, hoy) && (!n || `${p.correlativo} ${p.nombre} ${p.cliente ?? ''} ${p.nit} ${p.noFactura ?? ''}`.toLowerCase().includes(n))), [paquetes, filtro, hoy, n]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Paquetes prepagados</h1>
          <div className="page-subtitle">El cliente paga N pruebas por adelantado; cada prueba terminada descuenta una y no se vuelve a facturar. Se crean desde el tarifario del cliente.</div>
        </div>
      </div>
      {!disponible && <div className="card" style={{ marginBottom: 14 }}><div className="card-pad" style={{ color: 'var(--wine)', fontSize: 12.5 }}>Esta base no tiene la migración 034: sin paquetes.</div></div>}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="pasivo"><div className="kpi-label">Pasivo por anticipos</div><div className="kpi-value">{Q(pasivo)}</div><div className="kpi-delta"><span className="vs">remanente × precio unitario de los activos, sin IVA</span></div></div>
        <div className="kpi" data-kpi="activos"><div className="kpi-label">Activos</div><div className="kpi-value">{conteo('activos')}</div><div className="kpi-delta"><span className="vs">{activos.reduce((a, p) => a + totalRemanente(p), 0)} pruebas restantes</span></div></div>
        <div className="kpi" data-kpi="por-agotarse"><div className="kpi-label">Por agotarse</div><div className="kpi-value" style={{ color: conteo('por_agotarse') ? 'var(--burnt, #b5651d)' : undefined }}>{conteo('por_agotarse')}</div><div className="kpi-delta"><span className="vs">ofrecer la renovación</span></div></div>
        <div className="kpi" data-kpi="vencidos"><div className="kpi-label">Vencidos</div><div className="kpi-value" style={{ color: conteo('vencidos') ? 'var(--wine)' : undefined }}>{conteo('vencidos')}</div><div className="kpi-delta"><span className="vs">extender o cerrar</span></div></div>
      </div>
      <div className="card">
        <div className="card-pad" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--line-3)' }}>
          {FILTROS_PAQUETES.map(f => <button key={f} type="button" className={'btn ' + (filtro === f ? 'btn-primary' : 'btn-secondary')} style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setFiltro(f)} data-filtro={f} aria-pressed={filtro === f}>{ETIQUETA_FILTRO[f]} <span style={{ opacity: 0.7 }}>({conteo(f)})</span></button>)}
          <input className="input" style={{ marginLeft: 'auto', maxWidth: 260 }} placeholder="Buscar cliente, paquete o factura" value={q} onChange={e => setQ(e.target.value)} data-campo="buscar" />
        </div>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table" data-lista-paquetes={filas.length}>
            <thead><tr><th>Paquete</th><th>Cliente</th><th>Líneas</th><th>Usado</th><th className="num">Remanente</th><th className="num">Valor</th><th>Vence</th><th>Estado</th></tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>{paquetes.length ? 'Ningún paquete con ese filtro.' : 'Todavía no hay paquetes: se crean desde Tarifario → cliente → Paquetes.'}</td></tr>}
              {filas.map(p => { const e = estadoEfectivo(p, hoy); return (
                <tr key={p.id} data-paquete={p.correlativo} data-estado={e}>
                  <td><Link href={`/tarifario/paquetes/${p.id}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{p.correlativo}</Link><div className="cell-mute" style={{ fontSize: 11 }}>{p.nombre}{p.noFactura ? ` · ${p.noFactura}` : ' · pendiente de facturar'}</div></td>
                  <td><Link href={`/tarifario/${encodeURIComponent(p.nit)}`} style={{ color: 'var(--ink)', textDecoration: 'none' }}>{p.cliente || p.nit}</Link><div className="cell-mute num" style={{ fontSize: 11 }}>{p.nit}</div></td>
                  <td style={{ fontSize: 12 }}>{p.lineas.map(l => <div key={l.id}>{etiquetaLinea(l, nombreServicio)}: <span className="num">{l.remanente}</span> de {l.cantidad}</div>)}</td>
                  <td><BarraUso p={p} /><div className="cell-mute num" style={{ fontSize: 11 }}>{porcentajeUsado(p)} %</div></td>
                  <td className="num cell-strong">{totalRemanente(p)}</td>
                  <td className="num">{Q(valorRemanente(p))}</td>
                  <td className="num" style={{ fontSize: 12 }}>{fecha(p.venceEn)}</td>
                  <td><span className={'badge ' + BADGE_ESTADO[e]} data-badge-estado={e}>{ETIQUETA_ESTADO[e]}</span></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
