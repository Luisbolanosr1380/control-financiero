'use client';

/**
 * F-045 — Modal para emitir una nota de crédito desde el detalle de factura.
 *
 * Reglas:
 *  - Solo se muestra si la factura no está ANULADA/REFACTURADA y tiene saldo > 0.
 *  - El monto NO puede exceder el saldo pendiente actual.
 *  - Monto > Q5,000 va a "Pendiente Aprobación" y NO reduce el saldo hasta que
 *    un admin la apruebe. El aviso lo deja claro antes de emitir.
 *  - 2 fases: edit → confirm (sólo para NCs grandes).
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { emitirNotaCreditoAction } from '@/app/(app)/facturacion/[id]/actions';
import type { MotivoNC } from '@/lib/db/notas-credito';
import { MOTIVOS_NC, UMBRAL_APROBACION_NC } from '@/lib/db/notas-credito';
import { MontoInput } from '@/components/ui/monto-input';
import type { InvoiceEstadoBruto } from '@/lib/types';

interface Props {
  facturaId: string;
  facturaNumero: string;
  clienteNombre: string;
  total: number;
  saldoPendiente: number;
  estadoBruto: InvoiceEstadoBruto;
}

export function EmitirNCButton({ facturaId, facturaNumero, clienteNombre, total, saldoPendiente, estadoBruto }: Props) {
  const [open, setOpen] = useState(false);

  const inaplicable =
    estadoBruto === 'anulado' || estadoBruto === 'refacturado' || saldoPendiente <= 0.01;
  if (inaplicable) return null;

  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        <I.Plus size={13} /> Nota de crédito
      </button>
      {open && (
        <Modal
          facturaId={facturaId}
          facturaNumero={facturaNumero}
          clienteNombre={clienteNombre}
          total={total}
          saldoPendiente={saldoPendiente}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ModalProps {
  facturaId: string;
  facturaNumero: string;
  clienteNombre: string;
  total: number;
  saldoPendiente: number;
  onClose: () => void;
}

type Fase = 'edit' | 'confirm';

function Modal({ facturaId, facturaNumero, clienteNombre, total, saldoPendiente, onClose }: ModalProps) {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>('edit');
  const [loading, setLoading] = useState(false);

  const [fechaEmision, setFechaEmision] = useState(obtenerFechaHoyGuatemala());
  const [montoStr, setMontoStr] = useState('');
  const [motivo, setMotivo] = useState<MotivoNC>('Descuento posterior');
  const [descripcion, setDescripcion] = useState('');

  const monto = useMemo(() => {
    const n = Number(montoStr.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [montoStr]);

  const requiereAprobacion = monto > UMBRAL_APROBACION_NC;
  const saldoDespues = Math.max(0, saldoPendiente - (requiereAprobacion ? 0 : monto));

  const errores = useMemo(() => {
    const e: string[] = [];
    if (!fechaEmision) e.push('Fecha de emisión requerida.');
    if (!(monto > 0)) e.push('Monto debe ser mayor a 0.');
    if (monto > saldoPendiente + 0.01) e.push(`Monto excede el saldo pendiente (${Q(saldoPendiente)}).`);
    if (monto > total + 0.01) e.push('La NC no puede exceder el TOTAL original.');
    if (!descripcion.trim()) e.push('Descripción requerida.');
    return e;
  }, [fechaEmision, monto, saldoPendiente, total, descripcion]);

  const puedeContinuar = errores.length === 0 && !loading;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        if (fase === 'confirm') setFase('edit');
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading, fase]);

  if (typeof document === 'undefined') return null;

  const submit = async () => {
    setLoading(true);
    try {
      const res = await emitirNotaCreditoAction({
        facturaId,
        fechaEmision,
        monto,
        motivo,
        descripcion: descripcion.trim(),
      });
      if (res.ok) {
        const accion = res.estadoInicial === 'Activa'
          ? `${res.numeroNC} activa · saldo reducido a ${Q(saldoDespues)}`
          : `${res.numeroNC} en Pendiente Aprobación — un admin debe activarla`;
        toast.success(`NC emitida · ${accion}`, { duration: 6000 });
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo emitir la NC.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red.');
    } finally {
      setLoading(false);
    }
  };

  const irAConfirm = () => {
    if (requiereAprobacion) setFase('confirm');
    else submit();   // ≤ Q5K se emite directo sin segunda confirmación
  };

  return createPortal(
    <div
      onClick={() => { if (!loading) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Plus size={15} style={{ color: 'var(--ink-2)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {fase === 'edit'
              ? <>Emitir Nota de Crédito · factura <span className="num">{facturaNumero}</span></>
              : <>Confirmar emisión</>}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          {fase === 'edit' ? (
            <>
              <div style={{
                padding: '10px 14px', marginBottom: 16,
                border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5,
              }}>
                <strong>{clienteNombre}</strong> · Total <span className="num">{Q(total)}</span> · Saldo actual <span className="num" style={{ color: 'var(--wine)' }}>{Q(saldoPendiente)}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="field">
                  <label className="label" htmlFor="nc-fecha">Fecha de emisión</label>
                  <input id="nc-fecha" type="date" className="input" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} disabled={loading} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="nc-monto">Monto (Q)</label>
                  <MontoInput
                    id="nc-monto"
                    value={montoStr === '' ? null : (Number.isFinite(Number(montoStr)) ? Number(montoStr) : null)}
                    onChange={(v) => setMontoStr(v == null ? '' : String(v))}
                    placeholder="0.00"
                    prefix="Q"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label" htmlFor="nc-motivo">Motivo</label>
                <select id="nc-motivo" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoNC)} disabled={loading}>
                  {MOTIVOS_NC.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label" htmlFor="nc-desc">Descripción</label>
                <textarea
                  id="nc-desc"
                  className="input"
                  rows={3}
                  placeholder="Detalle libre del motivo (acordado vía email, error específico, etc.)"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  disabled={loading}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              {/* Aviso aprobación */}
              {monto > 0 && (
                <div style={{
                  padding: '10px 14px', marginBottom: 12,
                  fontSize: 12, lineHeight: 1.5,
                  background: requiereAprobacion ? '#FBF1DC' : '#E8EDDE',
                  border: requiereAprobacion ? '1px solid var(--warn)' : '1px solid var(--olive)',
                  borderRadius: 4,
                  color: 'var(--ink-2)',
                }}>
                  {requiereAprobacion ? (
                    <>⚠️ Esta NC requiere <strong>aprobación de admin</strong> antes de activarse (monto &gt; {Q(UMBRAL_APROBACION_NC)}). Quedará en <strong>Pendiente Aprobación</strong>.</>
                  ) : (
                    <>✓ Esta NC se <strong>activa automáticamente</strong> al emitir (monto ≤ {Q(UMBRAL_APROBACION_NC)}).</>
                  )}
                </div>
              )}

              {/* Preview impacto */}
              {monto > 0 && errores.length === 0 && (
                <div style={{
                  padding: 12,
                  background: 'var(--paper-2)', border: '1px solid var(--line-3)', borderRadius: 4,
                  fontSize: 12, lineHeight: 1.7,
                }}>
                  <div>Saldo actual: <span className="num">{Q(saldoPendiente)}</span></div>
                  <div>Monto NC: <span className="num" style={{ color: 'var(--wine)' }}>− {Q(monto)}</span></div>
                  <div style={{ borderTop: '1px solid var(--line-3)', marginTop: 6, paddingTop: 6 }}>
                    Saldo después: <strong className="num" style={{ color: requiereAprobacion ? 'var(--ink-4)' : 'var(--olive)' }}>
                      {requiereAprobacion ? `${Q(saldoPendiente)} (sin cambio hasta aprobar)` : Q(saldoDespues)}
                    </strong>
                  </div>
                </div>
              )}

              {errores.length > 0 && (
                <div style={{ padding: '8px 12px', marginTop: 10, fontSize: 12, color: 'var(--wine)', background: '#F5E2DD', border: '1px solid var(--wine)', borderRadius: 4 }}>
                  {errores.map(e => <div key={e}>⛔ {e}</div>)}
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 14px' }}>
                Vas a emitir una NC por <strong className="num">{Q(monto)}</strong> contra la factura <strong className="num">{facturaNumero}</strong>.
              </p>
              <div style={{ padding: 12, marginBottom: 12, background: '#FBF1DC', border: '1px solid var(--warn)', borderRadius: 4, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                ⚠️ Como el monto supera {Q(UMBRAL_APROBACION_NC)}, la NC <strong>NO reduce el saldo</strong> hasta que un administrador la apruebe desde <code>/notas-credito</code>.
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Motivo: <strong>{motivo}</strong><br />
                Descripción: <em>{descripcion.trim()}</em>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {fase === 'edit' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={irAConfirm}
                disabled={!puedeContinuar}
              >
                {requiereAprobacion ? 'Continuar' : (loading ? <><I.Refresh size={13} /> Emitiendo…</> : 'Emitir NC')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setFase('edit')} disabled={loading}>Volver</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={loading}>
                {loading ? <><I.Refresh size={13} /> Emitiendo…</> : 'Confirmar emisión'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
