'use client';

import { useMemo, useState } from 'react';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import type { Invoice, Customer } from '@/lib/types';

interface Props {
  facturas: Invoice[];   // solo abiertas (vencido / por_cobrar)
  clientes: Customer[];
}

type PresetKey = 'exacto' | 'q1' | 'q10' | 'q100' | 'pct1';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'exacto', label: 'Exacto' },
  { key: 'q1',     label: '±Q1' },
  { key: 'q10',    label: '±Q10' },
  { key: 'q100',   label: '±Q100' },
  { key: 'pct1',   label: '±1%' },
];

function tolFor(preset: PresetKey, monto: number): number {
  switch (preset) {
    case 'exacto': return 0;
    case 'q1':     return 1;
    case 'q10':    return 10;
    case 'q100':   return 100;
    case 'pct1':   return monto * 0.01;
  }
}

interface FacturaMatch {
  invoice: Invoice;
  cliente: string;
  diff: number;
}

interface ClienteMatch {
  custId: string;
  cliente: string;
  facturas: Invoice[];
  suma: number;
  diff: number;
}

// "exacto" (verde) si dif=0; si no "+Q3.50" / "−Q12"
function DiffBadge({ diff }: { diff: number }) {
  if (Math.abs(diff) < 0.005) {
    return <span style={{ color: 'var(--olive)', fontWeight: 600, fontSize: 12 }}>exacto</span>;
  }
  const sign = diff > 0 ? '+' : '−';
  return (
    <span className="num" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
      {sign}{Q(Math.abs(diff))}
    </span>
  );
}

export function IdentificarClient({ facturas, clientes }: Props) {
  const [raw, setRaw] = useState('');
  const [preset, setPreset] = useState<PresetKey>('exacto');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const nombrePorCliente = useMemo(
    () => new Map(clientes.map(c => [c.id, c.name])),
    [clientes],
  );

  const monto = useMemo(() => {
    const n = parseFloat(raw.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [raw]);

  const tol = tolFor(preset, monto);

  const facturaMatches = useMemo<FacturaMatch[]>(() => {
    if (monto <= 0) return [];
    return facturas
      .filter(f => Math.abs(f.total - monto) <= tol)
      .map(f => ({
        invoice: f,
        cliente: nombrePorCliente.get(f.custId) || f.custId || '—',
        diff: f.total - monto,
      }))
      .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  }, [facturas, monto, tol, nombrePorCliente]);

  const clienteMatches = useMemo<ClienteMatch[]>(() => {
    if (monto <= 0) return [];
    const grupos = new Map<string, Invoice[]>();
    for (const f of facturas) {
      if (!grupos.has(f.custId)) grupos.set(f.custId, []);
      grupos.get(f.custId)!.push(f);
    }
    const out: ClienteMatch[] = [];
    for (const [custId, fs] of grupos) {
      const suma = fs.reduce((s, f) => s + f.total, 0);
      if (Math.abs(suma - monto) <= tol) {
        out.push({
          custId,
          cliente: nombrePorCliente.get(custId) || custId || '—',
          facturas: [...fs].sort((a, b) => b.total - a.total),
          suma,
          diff: suma - monto,
        });
      }
    }
    return out.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  }, [facturas, monto, tol, nombrePorCliente]);

  const toggle = (custId: string) => {
    const s = new Set(expanded);
    if (s.has(custId)) s.delete(custId); else s.add(custId);
    setExpanded(s);
  };

  const hasInput = monto > 0;
  const sinMatches = hasInput && facturaMatches.length === 0 && clienteMatches.length === 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Identificar pago</h1>
          <div className="page-subtitle">
            Conciliación inversa · dado el monto de un depósito, sugiere qué factura o cliente pudo haberlo pagado. <strong>Solo lectura.</strong>
          </div>
        </div>
      </div>

      {/* Entrada: monto + tolerancia */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-pad">
          <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500, marginBottom: 8 }}>
            Monto del depósito
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <span className="currency" style={{ fontSize: 30, color: 'var(--ink-3)', fontWeight: 500 }}>Q</span>
            <input
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="num"
              style={{
                fontSize: 30, fontWeight: 500, letterSpacing: '-0.02em',
                border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--ink)', width: '100%', maxWidth: 360, padding: 0,
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)', marginRight: 4 }}>Tolerancia</span>
            {PRESETS.map(p => (
              <button
                key={p.key}
                className={'btn ' + (preset === p.key ? 'btn-primary' : 'btn-secondary')}
                style={{ padding: '5px 12px', fontSize: 12 }}
                onClick={() => setPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
            {hasInput && tol > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-4)' }} className="num">
                rango {Q(monto - tol)} – {Q(monto + tol)}
              </span>
            )}
          </div>
        </div>
      </div>

      {!hasInput && (
        <div className="card"><div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 40, fontSize: 13 }}>
          <I.Search size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>Ingresá un monto para buscar coincidencias.</div>
        </div></div>
      )}

      {sinMatches && (
        <div className="card"><div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 40, fontSize: 13 }}>
          <I.Alert size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>Ningún match dentro de la tolerancia. Probá ampliarla.</div>
        </div></div>
      )}

      {hasInput && facturaMatches.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div className="card-title">Facturas que calzan</div>
            <div className="card-actions">
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }} className="num">{facturaMatches.length}</span>
            </div>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Cliente</th>
                  <th className="num">Total</th>
                  <th className="num">Días vencida</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {facturaMatches.map(m => (
                  <tr key={m.invoice.id}>
                    <td className="num cell-strong">{m.invoice.noFactura}</td>
                    <td className="cell-strong">{m.cliente}</td>
                    <td className="num cell-strong">{Q(m.invoice.total)}</td>
                    <td className="num cell-mute">{m.invoice.dueAgo > 0 ? `${m.invoice.dueAgo} d` : '—'}</td>
                    <td className="num"><DiffBadge diff={m.diff} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasInput && clienteMatches.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Clientes que calzan</div>
            <div className="card-actions">
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }} className="num">{clienteMatches.length}</span>
            </div>
          </div>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Cliente</th>
                  <th className="num">Facturas abiertas</th>
                  <th className="num">Suma</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {clienteMatches.map(m => {
                  const isOpen = expanded.has(m.custId);
                  return (
                    <FragmentRows key={m.custId} m={m} isOpen={isOpen} onToggle={() => toggle(m.custId)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRows({ m, isOpen, onToggle }: { m: ClienteMatch; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td style={{ color: 'var(--ink-4)' }}>{isOpen ? <I.ChevDown size={14} /> : <I.Chevron size={14} />}</td>
        <td className="cell-strong">{m.cliente}</td>
        <td className="num cell-mute">{m.facturas.length}</td>
        <td className="num cell-strong">{Q(m.suma)}</td>
        <td className="num"><DiffBadge diff={m.diff} /></td>
      </tr>
      {isOpen && m.facturas.map(f => (
        <tr key={f.id} style={{ background: 'var(--bg-2)' }}>
          <td></td>
          <td className="num cell-mute" style={{ paddingLeft: 8 }}>{f.noFactura}</td>
          <td colSpan={2} className="cell-mute" style={{ fontSize: 11.5 }}>
            {f.status === 'vencido' ? `vencida ${f.dueAgo} d` : 'por cobrar'}
          </td>
          <td className="num cell-mute">{Q(f.total)}</td>
        </tr>
      ))}
    </>
  );
}
