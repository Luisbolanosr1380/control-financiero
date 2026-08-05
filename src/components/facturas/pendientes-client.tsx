'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import { AGING_BUCKETS, AGING_LABEL, type PendientesCobro, type FacturaPendiente } from '@/lib/db/facturas-pendientes';
import type { AgingBucket } from '@/lib/types';

interface Props {
  data: PendientesCobro;
}

type SortKey = 'diasVencidos' | 'saldo' | 'cliente' | 'fechaEmision' | 'fechaVencimiento';
type EstatusFiltro = 'todas' | 'vencidas' | 'por_vencer';

const BUCKET_COLOR: Record<AgingBucket, string> = {
  corriente: 'var(--olive)',
  '1-30':    'var(--amber)',
  '31-60':   'var(--amber)',
  '61-90':   'var(--wine)',
  '90+':     'var(--wine)',
};

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function PendientesCobroClient({ data }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [centro, setCentro] = useState('');
  const [estatus, setEstatus] = useState<EstatusFiltro>('todas');
  const [bucket, setBucket] = useState<AgingBucket | ''>('');
  const [mes, setMes] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('diasVencidos');
  const [sortAsc, setSortAsc] = useState(false);

  const centrosDisponibles = useMemo(
    () => [...new Set(data.filas.flatMap(f => f.centros))].sort(),
    [data.filas],
  );
  const mesesDisponibles = useMemo(
    () => [...new Set(data.filas.map(f => f.mesEmision).filter(Boolean))].sort().reverse(),
    [data.filas],
  );

  const filas = useMemo(() => {
    let rows = data.filas;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(f => f.cliente.toLowerCase().includes(q) || f.noFactura.toLowerCase().includes(q));
    }
    if (centro)  rows = rows.filter(f => f.centros.includes(centro));
    if (bucket)  rows = rows.filter(f => f.bucket === bucket);
    if (estatus === 'vencidas')   rows = rows.filter(f => f.vencida);
    if (estatus === 'por_vencer') rows = rows.filter(f => !f.vencida);
    if (mes)     rows = rows.filter(f => f.mesEmision === mes);

    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'saldo':            return (a.saldo - b.saldo) * dir;
        case 'cliente':          return a.cliente.localeCompare(b.cliente) * dir;
        case 'fechaEmision':     return a.fechaEmision.localeCompare(b.fechaEmision) * dir;
        case 'fechaVencimiento': return a.fechaVencimiento.localeCompare(b.fechaVencimiento) * dir;
        default:                 return (a.diasVencidos - b.diasVencidos) * dir;
      }
    });
  }, [data.filas, search, centro, bucket, estatus, mes, sortKey, sortAsc]);

  const saldoFiltrado = filas.reduce((s, f) => s + f.saldo, 0);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'cliente'); }
  };
  const flecha = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '');

  const exportarCsv = () => {
    const encabezado = [
      'No. Factura', 'Cliente', 'Fecha emisión', 'Mes', 'Total', 'Saldo por cobrar',
      'Días crédito', 'Fecha vencimiento', 'Días vencidos', 'Estatus', 'Tramo', 'Centro de costo',
    ];
    const lineas = filas.map(f => [
      f.noFactura, f.cliente, f.fechaEmision, f.mesEmision, f.total.toFixed(2), f.saldo.toFixed(2),
      f.diasCredito, f.fechaVencimiento, f.diasVencidos, f.vencida ? 'VENCIDA' : 'POR VENCER',
      AGING_LABEL[f.bucket], f.centros.join(' + '),
    ].map(csvEscape).join(','));
    // BOM para que Excel abra el UTF-8 con acentos bien.
    const blob = new Blob(['﻿' + [encabezado.join(','), ...lineas].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pendientes-cobro-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const thSort = (key: SortKey, label: string, num = false) => (
    <th
      className={num ? 'num' : undefined}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => onSort(key)}
      title="Ordenar"
    >
      {label}{flecha(key)}
    </th>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pendientes de cobro</h1>
          <div className="page-subtitle" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
            <span className="num" style={{ fontWeight: 500 }}>{Q(data.totales.saldoTotalQ)}</span> por cobrar
            {' · '}
            <span className="num">{data.totales.numFacturas}</span> facturas de todos los meses
          </div>
          <div className="page-subtitle" style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
            Vencido: <span className="num" style={{ color: 'var(--wine)' }}>{Q(data.totales.saldoVencidoQ)}</span> ({data.totales.numVencidas})
            {' · '}
            Por vencer: <span className="num" style={{ color: 'var(--olive)' }}>{Q(data.totales.saldoPorVencerQ)}</span> ({data.totales.numPorVencer})
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
          <Link href="/facturacion" className="btn btn-secondary"><I.Receipt size={13} /> Facturación</Link>
          <button className="btn btn-primary" onClick={exportarCsv}><I.Download size={13} /> Exportar CSV</button>
        </div>
      </div>

      {/* Aging: el corazón de la vista — clic en un tramo lo filtra. */}
      <div className="kpi-grid" style={{ gridTemplateColumns: `repeat(${AGING_BUCKETS.length}, 1fr)`, marginBottom: 14 }}>
        {data.aging.map(t => {
          const activo = bucket === t.bucket;
          return (
            <button
              key={t.bucket}
              className="kpi"
              onClick={() => setBucket(activo ? '' : t.bucket)}
              style={{
                textAlign: 'left', cursor: 'pointer', background: activo ? 'var(--bg-2)' : 'transparent',
                border: 'none', borderRight: '1px solid var(--line-3)', fontFamily: 'inherit',
              }}
              title={activo ? 'Quitar filtro' : `Ver solo ${t.etiqueta}`}
            >
              <div className="kpi-label" style={{ color: BUCKET_COLOR[t.bucket] }}>{t.etiqueta}</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>{Q(t.montoQ)}</div>
              <div className="kpi-delta"><span className="num">{t.cantidad}</span>&nbsp;facturas</div>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input placeholder="Cliente o No. factura…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ width: 'auto' }} value={centro} onChange={e => setCentro(e.target.value)}>
          <option value="">Todas las líneas</option>
          {centrosDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={estatus} onChange={e => setEstatus(e.target.value as EstatusFiltro)}>
          <option value="todas">Vencidas y por vencer</option>
          <option value="vencidas">Solo vencidas</option>
          <option value="por_vencer">Solo por vencer</option>
        </select>
        <select className="input num" style={{ width: 'auto' }} value={mes} onChange={e => setMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {mesesDisponibles.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {filas.length} facturas · <span className="num" style={{ fontWeight: 500 }}>{Q(saldoFiltrado)}</span>
        </div>
      </div>

      <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>No. Factura</th>
              {thSort('cliente', 'Cliente')}
              {thSort('fechaEmision', 'Emisión', true)}
              {thSort('saldo', 'Saldo', true)}
              <th className="num">Créd.</th>
              {thSort('fechaVencimiento', 'Vence', true)}
              {thSort('diasVencidos', 'Días venc.', true)}
              <th>Estatus</th>
              <th>Línea</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={10} style={{ height: 140, textAlign: 'center', color: 'var(--ink-4)' }}>
                <div style={{ padding: 36, fontSize: 13 }}>Sin facturas pendientes con estos filtros.</div>
              </td></tr>
            ) : filas.map(f => (
              <tr key={f.id} className="clickable" onClick={() => router.push(`/facturacion/${f.id}`)}>
                <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>
                  {f.noFactura}{f.esParcial && <span className="badge badge-mute" style={{ marginLeft: 6 }}>parcial</span>}
                </td>
                <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.cliente}>
                  {f.cliente}
                </td>
                <td className="num cell-mute" style={{ whiteSpace: 'nowrap' }} title={`Mes ${f.mesEmision}`}>{formatDate(f.fechaEmision)}</td>
                <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }} title={`Total ${Q(f.total)}`}>{Q(f.saldo)}</td>
                <td className="num cell-mute">{f.diasCredito}d</td>
                <td className="num cell-mute" style={{ whiteSpace: 'nowrap' }}>{f.fechaVencimiento ? formatDate(f.fechaVencimiento) : '—'}</td>
                <td className="num" style={{ color: f.diasVencidos > 0 ? 'var(--wine)' : 'var(--ink-3)', fontWeight: f.diasVencidos > 60 ? 600 : 400 }}>
                  {f.diasVencidos > 0 ? f.diasVencidos : '—'}
                </td>
                <td>
                  <span className={'badge ' + (f.vencida ? 'badge-wine' : 'badge-olive')}>
                    {f.vencida ? AGING_LABEL[f.bucket] : 'Por vencer'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{f.centros.join(' + ') || '—'}</td>
                <td onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {f.adjuntoUrl && (
                      <a href={f.adjuntoUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" title="Ver PDF" style={{ padding: 4 }}>
                        <I.Receipt size={13} />
                      </a>
                    )}
                    <Link href={`/facturacion/${f.id}`} className="btn btn-ghost" title="Registrar cobro (en el detalle)" style={{ padding: 4 }}>
                      <I.Coins size={13} />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.porCentro.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-3)' }}>
          Por línea de negocio:{' '}
          {data.porCentro.map((c, i) => (
            <span key={c.centro}>
              {i > 0 && ' · '}
              {c.centro} <span className="num" style={{ fontWeight: 500 }}>{Q(c.saldoQ)}</span> ({c.cantidad})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
