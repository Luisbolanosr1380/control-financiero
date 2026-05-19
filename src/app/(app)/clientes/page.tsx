'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { CUSTOMERS } from '@/lib/mock-data';

export default function ClientesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const rows = CUSTOMERS.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <div className="page-subtitle">
            <span className="num">{CUSTOMERS.length}</span> clientes · <span className="num">Q1,614,094</span> por cobrar consolidado
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar cartera</button>
          <button className="btn btn-primary"><I.Plus size={13} /> Nuevo cliente</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
          <input placeholder="Buscar cliente, NIT, contacto…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="filter-chip"><I.Filter size={11} /> Estado de cuenta</button>
        <button className="filter-chip">Línea</button>
        <button className="filter-chip">Antigüedad</button>
      </div>

      <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Contacto</th>
              <th>Crédito</th>
              <th className="num">Saldo total</th>
              <th className="num">Vencido</th>
              <th className="num">Días prom. pago</th>
              <th>Puntualidad</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const pct = Math.round(c.onTimeRate * 100);
              return (
                <tr key={c.id} className="clickable" onClick={() => router.push(`/clientes/${c.id}`)}>
                  <td className="cell-strong">{c.short}</td>
                  <td className="cell-mute">{c.contact}</td>
                  <td className="num">{c.credit} días</td>
                  <td className="num cell-strong">{Q(c.totalBalance)}</td>
                  <td className="num" style={{ color: c.vencido > 0 ? 'var(--wine)' : 'var(--ink-3)' }}>{Q(c.vencido)}</td>
                  <td className="num">{c.avgPayDays} d</td>
                  <td>
                    <span className={'badge ' + (pct >= 70 ? 'badge-olive' : pct >= 50 ? 'badge-warn' : 'badge-wine')}>
                      {pct}%
                    </span>
                  </td>
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
