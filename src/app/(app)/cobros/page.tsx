'use client';

import { I } from '@/components/common/icons';
import { Q, formatDateShort } from '@/lib/utils';
import { CUSTOMERS } from '@/lib/mock-data';

const PAYMENTS = [
  { id: 'REC-2026-0188', date: '2026-05-17', custId: 'C-005', amount: 47260, method: 'Transferencia', bank: 'BAC',       ref: 'TRF-93481' },
  { id: 'REC-2026-0187', date: '2026-05-16', custId: 'C-009', amount: 24800, method: 'Cheque',        bank: 'Banrural',  ref: 'CHQ-00184' },
  { id: 'REC-2026-0186', date: '2026-05-15', custId: 'C-004', amount: 29400, method: 'Transferencia', bank: 'Cuscatlán', ref: 'TRF-91207' },
  { id: 'REC-2026-0185', date: '2026-05-14', custId: 'C-008', amount: 18900, method: 'Transferencia', bank: 'BAC',       ref: 'TRF-91103' },
  { id: 'REC-2026-0184', date: '2026-05-13', custId: 'C-006', amount: 12600, method: 'Depósito',      bank: 'Banrural',  ref: 'DEP-44012' },
  { id: 'REC-2026-0183', date: '2026-05-10', custId: 'C-002', amount: 35000, method: 'Transferencia', bank: 'Banrural',  ref: 'TRF-89045' },
];

export default function CobrosPage() {
  const custById = Object.fromEntries(CUSTOMERS.map(c => [c.id, c]));
  const totalMes = PAYMENTS.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cobros y recibos</h1>
          <div className="page-subtitle">
            <span className="num">{PAYMENTS.length}</span> recibos en mayo · <span className="num">{Q(totalMes)}</span> recaudado
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary"><I.Download size={13} /> Exportar</button>
          <button className="btn btn-primary"><I.Plus size={13} /> Registrar cobro</button>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 22 }}>
        <div className="kpi">
          <div className="kpi-label">Cobrado · mayo</div>
          <div className="kpi-value"><span className="currency">Q</span>184,000</div>
          <div className="kpi-delta neg"><I.ArrowDown size={11} /> 18% <span className="vs">vs marzo</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Recibos del mes</div>
          <div className="kpi-value">{PAYMENTS.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Conciliación pendiente</div>
          <div className="kpi-value">3</div>
          <div className="kpi-delta neg"><I.Alert size={11} /> Q41K sin conciliar</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Recibo</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th className="num">Monto</th>
              <th>Método</th>
              <th>Banco</th>
              <th>Referencia</th>
              <th>Conciliado</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {PAYMENTS.map(p => (
              <tr key={p.id} className="clickable">
                <td className="num cell-strong">{p.id}</td>
                <td className="num cell-mute">{formatDateShort(p.date)}</td>
                <td className="cell-strong">{custById[p.custId]?.short ?? '—'}</td>
                <td className="num cell-strong">{Q(p.amount)}</td>
                <td>{p.method}</td>
                <td>{p.bank}</td>
                <td className="num cell-mute">{p.ref}</td>
                <td><span className="badge badge-olive">Sí</span></td>
                <td><button className="modal-close"><I.More size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
