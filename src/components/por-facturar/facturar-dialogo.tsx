'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { armarFactura, centroPorServicio } from '@/lib/facturacion-agenda/mapeo';
import type { ExpedienteLocal, WritebackEstado } from '@/lib/facturacion-agenda/tipos';
import type { CentroCosto } from '@/lib/db/centros';

export interface FacturarInput { noFactura: string; fechaEmision: string; centroPorTipo: Record<string, string> }
export type FacturarResultado = { ok: true; noFactura: string; facturaAppId: string; total: number; expedientes: number; writeback: { estado: WritebackEstado; detalle: string } } | { ok: false; error: string };

interface DialogoProps {
  seleccion: ExpedienteLocal[]; centros: CentroCosto[]; cliente: string; writeback: boolean; configurada: boolean; montoModo: 'con_iva' | 'sin_iva';
  /** Título de contexto (ej. "detalle DET-0001 aprobado por …"). */
  contexto?: string;
  onClose: () => void;
  /** Quién emite: desde un detalle aprobado (019). */
  onConfirmar: (input: FacturarInput) => Promise<FacturarResultado>;
  onHecho: (r: { noFactura: string; facturaAppId: string; total: number; writeback: { estado: WritebackEstado; detalle: string } }) => void;
}

/**
 * Diálogo "Facturar": número y fecha reales de SAT/FEL (los emite el auxiliar, no el sistema),
 * líneas por centro de costo (sugerido por servicio, editable) y total con IVA. Se invoca
 * desde un DETALLE aprobado por el cliente. Sin diálogos del navegador.
 */
export function FacturarDialogo({ seleccion, centros, cliente, writeback, configurada, montoModo, contexto, onClose, onConfirmar, onHecho }: DialogoProps) {
  const [noFactura, setNoFactura] = useState('');
  const [fecha, setFecha] = useState(obtenerFechaHoyGuatemala());
  const [loading, setLoading] = useState(false);
  const tipos = useMemo(() => [...new Set(seleccion.flatMap(e => (e.componentes.length ? e.componentes.map(c => c.tipoPrueba) : [e.tipoCobrado])))], [seleccion]);
  const [centroPorTipo, setCentroPorTipo] = useState<Record<string, string>>(() => Object.fromEntries(tipos.map(t => [t, centroPorServicio(t, centros) ?? ''])));
  const f = useMemo(() => armarFactura(seleccion, t => centroPorTipo[t] || null), [seleccion, centroPorTipo]);
  const nombreCC = (id: string) => centros.find(c => c.id === id)?.nombre ?? '—';
  const valido = noFactura.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && f.sinCentro.length === 0 && seleccion.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const confirmar = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const r = await onConfirmar({ noFactura: noFactura.trim(), fechaEmision: fecha, centroPorTipo });
      if (!r.ok) { toast.error(r.error); return; }
      if (r.writeback.estado === 'confirmado' || r.writeback.estado === 'omitido') toast.success(`Factura ${r.noFactura} registrada · ${r.expedientes} expediente(s) · ${Q(r.total)} con IVA`);
      else toast.warning(`Factura ${r.noFactura} registrada, pero la Agenda no confirmó: ${r.writeback.detalle}`);
      onHecho({ noFactura: r.noFactura, facturaAppId: r.facturaAppId, total: r.total, writeback: r.writeback });
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error de red'); }
    finally { setLoading(false); }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onClick={() => { if (!loading) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Facturar expedientes" style={{ width: 'min(760px, 96vw)', maxHeight: '92vh', background: 'var(--paper)', borderRadius: 'var(--r-3)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Receipt size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Facturar {seleccion.length} expediente{seleccion.length === 1 ? '' : 's'} de {cliente}{contexto ? <span className="cell-mute" style={{ fontSize: 12, marginLeft: 8 }}>{contexto}</span> : null}</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)"><I.X size={15} /></button>
        </div>
        <div style={{ padding: '18px 22px', overflowY: 'auto', fontSize: 13 }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.45 }}>La factura la emite el auxiliar en <strong>SAT/FEL</strong>; acá se registra con su número y fecha reales, entra al ER y a cobros como cualquier factura, y {writeback && configurada ? <>se marca <strong>FACTURADO</strong> en la Agenda con el monto {montoModo === 'con_iva' ? 'con IVA' : 'sin IVA'} por expediente.</> : <><strong>no</strong> se escribe a la Agenda ({configurada ? 'FACTURAR_WRITEBACK apagado' : 'este deploy no tiene llave'}).</>}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="pf-nf">Número de factura (SAT/FEL) *</label>
              <input id="pf-nf" className="input" value={noFactura} onChange={e => setNoFactura(e.target.value)} placeholder="Ej. A-12345" maxLength={60} disabled={loading} autoFocus />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="pf-fecha">Fecha de la factura *</label>
              <input id="pf-fecha" type="date" className="input num" value={fecha} max={obtenerFechaHoyGuatemala()} onChange={e => setFecha(e.target.value)} disabled={loading} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head"><div className="card-title">Líneas por centro de costo</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>el ingreso cae en la línea de su servicio</span></div></div>
            <table className="table">
              <thead><tr><th>Servicio</th><th>Centro de costo</th><th className="num">Subtotal</th></tr></thead>
              <tbody>
                {tipos.map(t => {
                  const sub = f.detalle.filter(d => d.tipoPrueba === t).reduce((s, d) => s + d.monto, 0);
                  return (
                    <tr key={t}>
                      <td>{t} <span className="cell-mute" style={{ fontSize: 11 }}>({f.detalle.filter(d => d.tipoPrueba === t).length})</span></td>
                      <td><select className="input" value={centroPorTipo[t] ?? ''} onChange={e => setCentroPorTipo(m => ({ ...m, [t]: e.target.value }))} aria-label={`Centro de costo para ${t}`} disabled={loading} style={{ minWidth: 220 }}><option value="">Elegí el centro…</option>{centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></td>
                      <td className="num">{Q(Math.round(sub * 100) / 100)}</td>
                    </tr>
                  );
                })}
                {f.lineas.map(l => <tr key={l.centroCostoId} style={{ background: 'var(--bg-2)' }}><td className="cell-mute" style={{ fontSize: 12 }}>línea</td><td>{nombreCC(l.centroCostoId)}</td><td className="num">{Q(l.subtotal)} <span className="cell-mute">+ IVA {Q(l.iva)} = {Q(l.total)}</span></td></tr>)}
                <tr style={{ background: 'var(--bg-2)' }}><td colSpan={2} className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>Subtotal · IVA (12 %) · <strong>Total</strong></td><td className="num" data-total={f.total}>{Q(f.subtotal)} · {Q(f.iva)} · <strong>{Q(f.total)}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Expedientes</div></div>
            <table className="table">
              <thead><tr><th>Persona</th><th>Servicio</th><th>Categoría · territorio</th><th className="num">Sin IVA</th></tr></thead>
              <tbody>
                {seleccion.map(e => <tr key={e.idExterno}><td>{e.persona || e.idExterno}</td><td>{e.tipoCobrado}{e.componentes.length > 1 ? <span className="cell-mute" style={{ fontSize: 11 }}> ({e.componentes.map(c => `${c.tipoPrueba} ${Q(c.monto)}`).join(' + ')})</span> : null}</td><td className="cell-mute" style={{ fontSize: 12 }}>{e.categoriaCanon} · {e.territorioResuelto || 'no indicado'}</td><td className="num">{Q(e.montoCalculado ?? 0)}</td></tr>)}
              </tbody>
            </table>
          </div>
          {f.sinCentro.length > 0 && <div role="status" style={{ marginTop: 10, fontSize: 12, color: 'var(--wine)' }}>Elegí el centro de costo para: {f.sinCentro.join(', ')}.</div>}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={loading || !valido}>{loading ? <><I.Refresh size={13} /> Facturando…</> : <><I.Check size={13} /> Confirmar factura {noFactura.trim() ? noFactura.trim() : ''}</>}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
