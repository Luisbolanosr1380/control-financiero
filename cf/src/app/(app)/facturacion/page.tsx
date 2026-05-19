'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDateShort } from '@/lib/utils';
import { INVOICES, CUSTOMERS, LINES } from '@/lib/mock-data';

export default function FacturacionPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'todas' | 'vencidas' | 'por_cobrar' | 'cobradas' | 'anuladas'>('todas');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const custById = Object.fromEntries(CUSTOMERS.map(c => [c.id, c]));

  const counts = {
    todas:      INVOICES.length,
    vencidas:   INVOICES.filter(i => i.status === 'vencido').length,
    por_cobrar: INVOICES.filter(i => i.status === 'por_cobrar').length,
    cobradas:   INVOICES.filter(i => i.status === 'cobrado').length,
    anuladas:   0,
  };

  let rows = INVOICES;
  if (tab === 'vencidas')   rows = rows.filter(i => i.status === 'vencido');
  if (tab === 'por_cobrar') rows = rows.filter(i => i.status === 'por_cobrar');
  if (tab === 'cobradas')   rows = rows.filter(i => i.status === 'cobrado');
  if (tab === 'anuladas')   rows = [];

  if (search) {
    rows = rows.filter(i =>
      i.id.toLowerCase().includes(search.toLowerCase()) ||
      custById[i.custId].name.toLowerCase().includes(search.toLowerCase())
    );
  }

  const totalSaldo = rows.reduce((s, i) => s + i.balance, 0);

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Facturación</h1>
          <div className="page-subtitle">
            <span className="num">{counts.todas}</span> facturas · <span className="num">Q2,760,696</span> facturado · <span className="num" style={{ color: 'var(--wine)' }}>Q1,614,094</span> por cobrar
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar</button>
          <button className="btn btn-secondary"><I.Mail size={13} /> Recordatorios masivos</button>
          <button className="btn btn-primary">
            <I.Plus size={13} /> Nueva factura <span className="kbd">⌘N</span>
          </button>
        </div>
      </div>

      <div className="alert-banner">
        <div className="alert-icon">!</div>
        <div className="alert-text">
          <strong>Q1.11M en cartera +90 días</strong> · 317 facturas concentradas en 12 clientes. La gestión de cobro proactiva podría recuperar <span className="num">~Q420K</span> en los próximos 30 días.
        </div>
        <button className="btn btn-danger" onClick={() => router.push('/ai')}>Plan de recuperación</button>
      </div>

      <div className="tabs">
        <button className={'tab' + (tab === 'todas' ? ' active' : '')} onClick={() => setTab('todas')}>
          Todas <span className="tab-count num">{counts.todas}</span>
        </button>
        <button className={'tab' + (tab === 'vencidas' ? ' active' : '')} onClick={() => setTab('vencidas')}>
          Vencidas <span className="tab-count num">{counts.vencidas}</span>
        </button>
        <button className={'tab' + (tab === 'por_cobrar' ? ' active' : '')} onClick={() => setTab('por_cobrar')}>
          Por cobrar <span className="tab-count num">{counts.por_cobrar}</span>
        </button>
        <button className={'tab' + (tab === 'cobradas' ? ' active' : '')} onClick={() => setTab('cobradas')}>
          Cobradas <span className="tab-count num">{counts.cobradas}</span>
        </button>
        <button className={'tab' + (tab === 'anuladas' ? ' active' : '')} onClick={() => setTab('anuladas')}>
          Anuladas <span className="tab-count num">{counts.anuladas}</span>
        </button>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input placeholder="Factura, cliente, NIT…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="filter-chip"><I.Filter size={11} /> Centro de costo</button>
        <button className="filter-chip active">Estado: {tab}</button>
        <button className="filter-chip">Cliente</button>
        <button className="filter-chip">Aging</button>
        <button className="filter-chip"><I.Calendar size={11} /> Emisión: últimos 90d</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span>{rows.length} resultados</span>
          <span style={{ color: 'var(--line-2)' }}>·</span>
          <span className="num">Total: {Q(totalSaldo)}</span>
        </div>
      </div>

      <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
              </th>
              <th>Factura</th>
              <th>Cliente</th>
              <th>Centro</th>
              <th>Emisión</th>
              <th>Vencimiento</th>
              <th className="num">Total</th>
              <th className="num">Saldo</th>
              <th>Aging</th>
              <th>Estado</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} style={{ height: 200, textAlign: 'center', color: 'var(--ink-4)' }}>
                <div style={{ padding: 40 }}>
                  <I.Receipt size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>No hay facturas en esta vista</div>
                </div>
              </td></tr>
            ) : rows.map(inv => {
              const cust = custById[inv.custId];
              const line = LINES[inv.line];
              const today = new Date(2026, 4, 19);
              const emisionDate = new Date(today); emisionDate.setDate(emisionDate.getDate() - inv.emisionAgo);
              const dueDate = new Date(today); dueDate.setDate(dueDate.getDate() - inv.dueAgo);

              const agingDays = inv.dueAgo;
              let agingBadge: { cls: string; text: string };
              if (inv.status === 'cobrado') agingBadge = { cls: 'badge-olive', text: 'Pagada' };
              else if (agingDays > 90) agingBadge = { cls: 'badge-wine', text: '+90 d' };
              else if (agingDays > 60) agingBadge = { cls: 'badge-wine', text: `${agingDays} d` };
              else if (agingDays > 30) agingBadge = { cls: 'badge-warn', text: `${agingDays} d` };
              else if (agingDays > 0)  agingBadge = { cls: 'badge-warn', text: `${agingDays} d` };
              else                     agingBadge = { cls: 'badge-mute', text: `${Math.abs(agingDays)} d` };

              const statusBadgeMap: Record<string, { cls: string; text: string }> = {
                vencido:    { cls: 'badge-wine',    text: 'Vencida' },
                por_cobrar: { cls: 'badge-outline', text: 'Por cobrar' },
                cobrado:    { cls: 'badge-olive',   text: 'Cobrada' },
              };
              const statusBadge = statusBadgeMap[inv.status] ?? { cls: 'badge-mute', text: inv.status };

              return (
                <tr key={inv.id} className="clickable" onClick={() => router.push(`/facturacion/${inv.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={() => {
                      const s = new Set(selected);
                      if (s.has(inv.id)) s.delete(inv.id); else s.add(inv.id);
                      setSelected(s);
                    }} />
                  </td>
                  <td className="num cell-strong">{inv.id}</td>
                  <td className="cell-strong">{cust.short}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span className={'dot ' + line.dot}></span>{line.name}
                    </span>
                  </td>
                  <td className="num cell-mute">{formatDateShort(emisionDate)}</td>
                  <td className="num">{formatDateShort(dueDate)}</td>
                  <td className="num cell-strong">{Q(inv.total)}</td>
                  <td className="num cell-strong">{Q(inv.balance)}</td>
                  <td><span className={'badge ' + agingBadge.cls}>{agingBadge.text}</span></td>
                  <td><span className={'badge ' + statusBadge.cls}>{statusBadge.text}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="modal-close"><I.More size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="pagination">
          <span>Mostrando <span className="num">1–{rows.length}</span> de <span className="num">{counts.todas}</span></span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="page-btn"><I.ChevLeft size={12} /></button>
            <button className="page-btn active">1</button>
            <button className="page-btn">2</button>
            <button className="page-btn">3</button>
            <span style={{ color: 'var(--ink-4)', padding: '0 4px' }}>…</span>
            <button className="page-btn">26</button>
            <button className="page-btn"><I.Chevron size={12} /></button>
          </div>
          {selected.size > 0 && (
            <div style={{ marginLeft: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: 'var(--ink)' }}><span className="num">{selected.size}</span> seleccionadas</span>
              <button className="btn btn-secondary" style={{ padding: '4px 8px' }}>Enviar recordatorio</button>
              <button className="btn btn-secondary" style={{ padding: '4px 8px' }}>Marcar gestión</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
