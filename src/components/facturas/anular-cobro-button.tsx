'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { anularCobroAction } from '@/app/(app)/facturacion/[id]/actions';
import type { GrupoCobro } from '@/lib/db/cobros';

interface Props {
  grupo: GrupoCobro;
  saldoActual: number;
  totalFactura: number;
}

const formatFechaShort = (s: string): string =>
  !s ? '—' : formatearFecha(s, 'dd/MM/yyyy');

export function AnularCobroButton({ grupo, saldoActual, totalFactura }: Props) {
  const [open, setOpen] = useState(false);

  if (grupo.estadoCobro === 'Anulado') {
    return (
      <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
        Anulado {formatFechaShort(grupo.fechaAnulacion ?? '')}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen(true)}
        style={{ padding: '2px 8px', fontSize: 11, color: 'var(--wine)' }}
        title="Anular este cobro"
      >
        <I.X size={11} /> Anular
      </button>
      {open && (
        <AnularModal
          grupo={grupo}
          saldoActual={saldoActual}
          totalFactura={totalFactura}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ModalProps {
  grupo: GrupoCobro;
  saldoActual: number;
  totalFactura: number;
  onClose: () => void;
}

function AnularModal({ grupo, saldoActual, totalFactura, onClose }: ModalProps) {
  const router = useRouter();
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  // Saldo después de anular = saldo actual + monto del cobro (cap a totalFactura).
  const saldoDespues = Math.min(totalFactura, saldoActual + grupo.totalCobrado);
  const estadoDespues: 'EMITIDA' | 'COBRADO PARCIAL' | 'COBRADO' =
    saldoDespues <= 0.01 ? 'COBRADO'
    : saldoDespues >= totalFactura - 0.01 ? 'EMITIDA'
    : 'COBRADO PARCIAL';

  const onConfirm = async () => {
    if (!motivo.trim()) return;
    setLoading(true);
    try {
      const res = await anularCobroAction(grupo.grupoId, motivo.trim());
      if (res.ok) {
        toast.success(`Cobro anulado · saldo Q${res.saldoNuevo.toFixed(2)} · ${res.estadoNuevo}`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo anular el cobro');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red al anular');
    } finally {
      setLoading(false);
    }
  };

  if (typeof document === 'undefined') return null;

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
          <I.Alert size={15} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Anular cobro · <span className="num">{Q(grupo.totalCobrado)}</span>
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Vas a anular este cobro de <span className="num">{formatFechaShort(grupo.fecha)}</span>:
          </p>

          {/* Resumen de componentes */}
          <div style={{
            border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
            padding: '10px 12px', background: 'var(--paper-2)', marginBottom: 14,
          }}>
            {grupo.componentes.map((c, i) => (
              <div key={i} style={{ display: 'flex', fontSize: 12, color: 'var(--ink-3)', gap: 6, padding: '2px 0' }}>
                <span>{c.metodo}</span>
                {c.bancoNombre && <span style={{ color: 'var(--ink-4)' }}>· {c.bancoNombre}</span>}
                {c.referencia && <span style={{ color: 'var(--ink-4)' }}>· {c.referencia}</span>}
                <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>{Q(c.monto)}</span>
              </div>
            ))}
          </div>

          <div style={{
            padding: '10px 14px', marginBottom: 14,
            border: '1px solid var(--wine)', borderRadius: 'var(--r-2)',
            background: '#F5E2DD', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>⚠️ Esto va a:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Revertir el saldo: <span className="num">Q{saldoActual.toFixed(2)}</span> → <span className="num">Q{saldoDespues.toFixed(2)}</span></li>
              <li>Cambiar el estado de la factura a <strong>{estadoDespues}</strong></li>
              <li>El cobro queda en histórico marcado como <strong>Anulado</strong> (no se elimina)</li>
              {grupo.tieneRetencion && (
                <li style={{ color: 'var(--wine)' }}>Las retenciones (IVA Q{grupo.totalRetencionIVA.toFixed(2)} · ISR Q{grupo.totalRetencionISR.toFixed(2)}) se excluyen del crédito fiscal acumulado</li>
              )}
            </ul>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="motivo-anular-cobro">Motivo de anulación (requerido)</label>
            <textarea
              id="motivo-anular-cobro"
              className="input"
              rows={3}
              placeholder="Ej. Cliente reportó error en transferencia; recibo cancelado"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={loading}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading || !motivo.trim()}>
            {loading ? <><I.Refresh size={13} /> Anulando…</> : <><I.X size={13} /> Confirmar anulación</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
