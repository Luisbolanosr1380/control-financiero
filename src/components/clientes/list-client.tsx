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
  episodico:  { cls: 'badge-mute',    text: 'Episódico' },
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

type Tab = 'todos' | 'riesgo' | 'sanos' | 'episodicos';

export function ClientesListClient({ clientes }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('todos');
  const [search, setSearch] = useState('');

  const enRiesgoSet = new Set<ClienteClasificacion>(['perdido', 'en_riesgo', 'en_declive']);
  const esRiesgoReal = (c: typeof clientes[number]) => enRiesgoSet.has(c.clasificacion) && c.naturalezaDominante !== 'proyecto';
  const esEpisodico  = (c: typeof clientes[number]) => c.naturalezaDominante === 'proyecto';

  const counts = {
    todos: clientes.length,
    riesgo: clientes.filter(esRiesgoReal).length,
    sanos: clientes.filter(c => c.clasificacion === 'sano').length,
    episodicos: clientes.filter(esEpisodico).length,
  };

  let rows = clientes;
  if (tab === 'riesgo')     rows = rows.filter(esRiesgoReal);
  if (tab === 'sanos')      rows = rows.filter(c => c.clasificacion === 'sano');
  if (tab === 'episodicos') rows = rows.filter(esEpisodico);
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
        {(['todos', 'riesgo', 'sanos', 'episodicos'] as const).map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t === 'todos' ? 'Todos' : t === 'riesgo' ? 'En riesgo' : t === 'sanos' ? 'Sanos' : 'Episódicos'}
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
        <table className="table" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: '36%' }}>Cliente</th>
              <th style={{ width: '12%' }}>Clasificación</th>
              <th className="num" style={{ width: '14%' }}>Promedio/mes</th>
              <th className="num" style={{ width: '12%' }}>Última factura</th>
              <th className="num" style={{ width: '12%' }}>Sin facturar</th>
              <th style={{ width: '14%' }}>Tendencia</th>
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
                  <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nombre}>{c.nombre}</td>
                  <td><span className={'badge ' + badge.cls}>{badge.text}</span></td>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{Q(c.montoPromedio)}</td>
                  <td className="num cell-mute" style={{ whiteSpace: 'nowrap' }}>{formatDate(c.ultimaFactura)}</td>
                  <td className="num" style={{ color: c.mesesSinFacturar > 2 ? 'var(--wine)' : 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                    {c.mesesSinFacturar.toFixed(1)} m
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}><TendenciaCell t={c.tendencia} /></td>
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
