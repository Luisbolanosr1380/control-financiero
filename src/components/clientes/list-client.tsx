'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import type { AnalisisCliente, ClienteClasificacion, Tendencia } from '@/lib/db/clientes-analisis';

const BADGE: Record<ClienteClasificacion, { cls: string; text: string }> = {
  perdido:    { cls: 'badge-wine',    text: 'Perdido' },
  en_riesgo:  { cls: 'badge-warn',    text: 'En riesgo' },
  en_declive: { cls: 'badge-outline', text: 'En declive' },
  sano:       { cls: 'badge-olive',   text: 'Sano' },
  nuevo:      { cls: 'badge-mute',    text: 'Nuevo' },
};

function TendenciaCell({ t }: { t: Tendencia }) {
  const ico = t === 'creciente' ? <I.ArrowUp size={11} style={{ color: 'var(--olive)' }} />
            : t === 'decreciente' ? <I.ArrowDown size={11} style={{ color: 'var(--wine)' }} />
            : <span style={{ display: 'inline-block', width: 9, height: 2, background: 'var(--ink-4)', borderRadius: 1 }} />;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
      {ico}{t}
    </span>
  );
}

interface Props {
  clientes: AnalisisCliente[];
}

type Tab = 'todos' | 'riesgo' | 'sanos';

export function ClientesListClient({ clientes }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('todos');
  const [search, setSearch] = useState('');

  const enRiesgoSet = new Set<ClienteClasificacion>(['perdido', 'en_riesgo', 'en_declive']);

  const counts = {
    todos: clientes.length,
    riesgo: clientes.filter(c => enRiesgoSet.has(c.clasificacion)).length,
    sanos: clientes.filter(c => c.clasificacion === 'sano').length,
  };

  let rows = clientes;
  if (tab === 'riesgo') rows = rows.filter(c => enRiesgoSet.has(c.clasificacion));
  if (tab === 'sanos')  rows = rows.filter(c => c.clasificacion === 'sano');
  if (search.trim()) {
    const q = search.toLowerCase();
    rows = rows.filter(c => c.nombre.toLowerCase().includes(q));
  }
  // Ordenar por impacto descendente: monto promedio
  rows = [...rows].sort((a, b) => b.montoPromedio - a.montoPromedio);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <div className="page-subtitle">
            <span className="num">{clientes.length}</span> clientes con actividad (12 meses) · análisis de retención
          </div>
        </div>
      </div>

      <div className="tabs">
        {(['todos', 'riesgo', 'sanos'] as const).map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t === 'todos' ? 'Todos' : t === 'riesgo' ? 'En riesgo' : 'Sanos'}
            <span className="tab-count num">{counts[t]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input placeholder="Buscar cliente…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span>{rows.length} resultados</span>
        </div>
      </div>

      <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Clasificación</th>
              <th className="num">Promedio/mes</th>
              <th className="num">Última factura</th>
              <th className="num">Sin facturar</th>
              <th>Tendencia</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ height: 160, textAlign: 'center', color: 'var(--ink-4)' }}>
                <div style={{ padding: 40, fontSize: 13 }}>Sin clientes en esta vista.</div>
              </td></tr>
            ) : rows.map(c => {
              const badge = BADGE[c.clasificacion];
              return (
                <tr key={c.custId} className="clickable" onClick={() => router.push(`/clientes/${c.custId}`)}>
                  <td className="cell-strong">{c.nombre}</td>
                  <td><span className={'badge ' + badge.cls}>{badge.text}</span></td>
                  <td className="num cell-strong">{Q(c.montoPromedio)}</td>
                  <td className="num cell-mute">{formatDate(c.ultimaFactura)}</td>
                  <td className="num" style={{ color: c.mesesSinFacturar > 2 ? 'var(--wine)' : 'var(--ink-2)' }}>
                    {c.mesesSinFacturar.toFixed(1)} m
                  </td>
                  <td><TendenciaCell t={c.tendencia} /></td>
                  <td><button className="modal-close"><I.More size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
