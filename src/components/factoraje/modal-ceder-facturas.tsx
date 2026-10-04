'use client';

/**
 * Ceder facturas a un factoraje: lista las facturas con saldo por cobrar
 * que NO están cedidas (el servidor recalcula y la base tiene el candado
 * anti-doble-cesión), permite elegir varias y ajustar el monto a ceder
 * (por defecto el saldo; nunca más que el saldo).
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Q } from '@/lib/utils';
import { ModalBase } from '@/components/conciliacion/modal-base';
import type { Factoraje, FacturaCedible } from '@/lib/db/factoraje';
import { cederFacturasAction, getFacturasCediblesAction } from '@/app/(app)/factoraje/actions';

const fmtFecha = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');

export function ModalCederFacturas({ factoraje, onClose, onListo }: { factoraje: Factoraje; onClose: () => void; onListo: () => void }) {
  const [facturas, setFacturas] = useState<FacturaCedible[] | null>(null);
  const [sel, setSel] = useState<Map<string, number>>(new Map());   // facturaId → monto a ceder
  const [busq, setBusq] = useState('');
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    getFacturasCediblesAction().then(f => { if (vivo) setFacturas(f); }).catch(e => toast.error(e instanceof Error ? e.message : String(e)));
    return () => { vivo = false; };
  }, []);

  const visibles = useMemo(() => {
    const q = busq.trim().toLowerCase();
    return (facturas ?? []).filter(f => !q || f.noFactura.toLowerCase().includes(q) || f.cliente.toLowerCase().includes(q));
  }, [facturas, busq]);
  const total = [...sel.values()].reduce((s, m) => s + m, 0);

  const toggle = (f: FacturaCedible) => setSel(prev => { const n = new Map(prev); if (n.has(f.id)) n.delete(f.id); else n.set(f.id, f.saldo); return n; });

  const ceder = async () => {
    setBusy(true);
    try {
      const r = await cederFacturasAction({
        factorajeId: factoraje.id,
        items: [...sel].map(([facturaId, montoCedido]) => ({ facturaId, montoCedido, nota: nota.trim() || undefined })),
      });
      if (r.ok) { toast.success(r.mensaje); onListo(); } else toast.error(r.error);
    } finally { setBusy(false); }
  };

  return (
    <ModalBase titulo={`Ceder facturas a ${factoraje.financiador}`} ancho={820} onClose={onClose}
      pie={<>
        <span style={{ marginRight: 'auto', fontSize: 12.5 }}>{sel.size} factura(s) · <strong className="num">{Q(total)}</strong></span>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-primary" onClick={ceder} disabled={busy || sel.size === 0}>{busy ? 'Cediendo…' : `Ceder ${sel.size || ''}`}</button>
      </>}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <input className="input" placeholder="Buscar por número o cliente…" value={busq} onChange={e => setBusq(e.target.value)} style={{ flex: 1 }} />
        <input className="input" placeholder="Nota (opcional, ej. no. de contrato)" value={nota} onChange={e => setNota(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginBottom: 8 }}>
        Solo facturas con saldo por cobrar (total − cobros − notas de crédito) y sin cesión activa. Una factura ya cedida no aparece; si alguien la cede al mismo tiempo, la base lo rechaza.
      </div>
      {facturas === null ? <div style={{ padding: 20, color: 'var(--ink-4)' }}>Cargando facturas…</div> : (
        <table className="table">
          <thead><tr><th style={{ width: 30 }}></th><th>Factura</th><th>Cliente</th><th style={{ width: 95 }}>Emisión</th><th className="num" style={{ width: 110 }}>Saldo</th><th className="num" style={{ width: 140 }}>Monto a ceder</th></tr></thead>
          <tbody>
            {visibles.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 22, color: 'var(--ink-4)' }}>No hay facturas disponibles para ceder.</td></tr>}
            {visibles.slice(0, 300).map(f => {
              const marcada = sel.has(f.id);
              return (
                <tr key={f.id} style={{ background: marcada ? 'var(--olive-bg)' : undefined }}>
                  <td><input type="checkbox" checked={marcada} onChange={() => toggle(f)} /></td>
                  <td className="num cell-strong">{f.noFactura}</td>
                  <td style={{ fontSize: 12.5 }}>{f.cliente}</td>
                  <td className="num">{fmtFecha(f.fechaEmision)}</td>
                  <td className="num">{Q(f.saldo)}</td>
                  <td>
                    {marcada && (
                      <input className="input num" style={{ width: 120, padding: '3px 6px', fontSize: 12 }} inputMode="decimal"
                        value={sel.get(f.id)} max={f.saldo}
                        onChange={e => { const v = Math.min(Number(e.target.value.replace(/[^\d.]/g, '')) || 0, f.saldo); setSel(prev => new Map(prev).set(f.id, v)); }} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ModalBase>
  );
}
