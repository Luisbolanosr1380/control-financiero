'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q, formatDateShort } from '@/lib/utils';
import { LINES } from '@/lib/mock-data';
import type { Invoice, Customer } from '@/lib/types';

interface Props {
  facturas: Invoice[];
  clientes: Customer[];
}

export function FacturasListClient({ facturas, clientes }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'todas' | 'vencidas' | 'por_cobrar' | 'cobradas' | 'anuladas' | 'pendientes'>('todas');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const custById = Object.fromEntries(clientes.map(c => [c.id, c]));

  const counts = {
    todas:      facturas.length,
    vencidas:   facturas.filter(i => i.status === 'vencido').length,
    por_cobrar: facturas.filter(i => i.status === 'por_cobrar').length,
    cobradas:   facturas.filter(i => i.status === 'cobrado').length,
    anuladas:   facturas.filter(i => i.status === 'anulado').length,
    pendientes: facturas.filter(i => i.status === 'pendiente').length,
  };

  let rows = facturas;
  if (tab === 'vencidas')   rows = rows.filter(i => i.status === 'vencido');
  if (tab === 'por_cobrar') rows = rows.filter(i => i.status === 'por_cobrar');
  if (tab === 'cobradas')   rows = rows.filter(i => i.status === 'cobrado');
  if (tab === 'anuladas')   rows = rows.filter(i => i.status === 'anulado');
  if (tab === 'pendientes') rows = rows.filter(i => i.status === 'pendiente');

  if (search) {
    rows = rows.filter(i =>
      i.noFactura.toLowerCase().includes(search.toLowerCase()) ||
      (custById[i.custId]?.name ?? '').toLowerCase().includes(search.toLowerCase())
    );
  }

  const totalSaldo = rows.reduce((s, i) => s + i.balance, 0);
  const activas = facturas.filter(i => i.status !== 'anulado');
  const totalFacturadoActivo = activas.reduce((s, i) => s + i.total, 0);
  const totalPorCobrar = activas.reduce((s, i) => s + i.balance, 0);

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
            <span className="num">{counts.todas}</span> facturas · <span className="num">{Q(totalFacturadoActivo)}</span> facturado · <span className="num" style={{ color: 'var(--wine)' }}>{Q(totalPorCobrar)}</span> por cobrar
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar</button>
          <button className="btn btn-secondary"><I.Mail size={13} /> Recordatorios masivos</button>
          <button className="btn btn-primary" onClick={() => router.push('/facturacion/nueva')}>
            <I.Plus size={13} /> Nueva factura <span className="kbd">⌘N</span>
          </button>
        </div>
      </div>

      <div className="tabs">
        {(['todas', 'vencidas', 'por_cobrar', 'cobradas', 'anuladas', 'pendientes'] as const).map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t === 'todas' ? 'Todas' : t === 'vencidas' ? 'Vencidas' : t === 'por_cobrar' ? 'Por cobrar' : t === 'cobradas' ? 'Cobradas' : t === 'anuladas' ? 'Anuladas' : 'Pendientes'}
            <span className="tab-count num">{counts[t]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input placeholder="Factura, cliente, NIT…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span>{rows.length} resultados</span>
          <span style={{ margin: '0 8px', color: 'var(--line-2)' }}>·</span>
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
              <th className="num">Total</th>
              <th className="num">Saldo</th>
              <th>Aging</th>
              <th>Estado</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} style={{ height: 200, textAlign: 'center', color: 'var(--ink-4)' }}>
                <div style={{ padding: 40 }}>
                  <I.Receipt size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>No hay facturas en esta vista</div>
                </div>
              </td></tr>
            ) : rows.map(inv => {
              const cust = custById[inv.custId];
              const line = LINES[inv.line];
              const agingDays = inv.dueAgo;
              let agingBadge: { cls: string; text: string };
              if (inv.status === 'cobrado')       agingBadge = { cls: 'badge-olive', text: 'Pagada' };
              else if (agingDays > 90)            agingBadge = { cls: 'badge-wine', text: '+90 d' };
              else if (agingDays > 60)            agingBadge = { cls: 'badge-wine', text: `${agingDays} d` };
              else if (agingDays > 30)            agingBadge = { cls: 'badge-warn', text: `${agingDays} d` };
              else if (agingDays > 0)             agingBadge = { cls: 'badge-warn', text: `${agingDays} d` };
              else                                agingBadge = { cls: 'badge-mute', text: `${Math.abs(agingDays)} d` };

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
                  <td className="num cell-strong">{inv.noFactura}</td>
                  <td className="cell-strong">{cust?.short ?? inv.custId ?? '—'}</td>
                  <td>
                    {inv.isMixed ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        {inv.lineas.map((l, idx) => (
                          <span key={idx} className={'dot ' + LINES[l.line].dot} title={LINES[l.line].name}></span>
                        ))}
                        <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                          {inv.lineas.length} líneas
                        </span>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span className={'dot ' + line.dot}></span>{line.name}
                      </span>
                    )}
                  </td>
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
      </div>
    </div>
  );
}
