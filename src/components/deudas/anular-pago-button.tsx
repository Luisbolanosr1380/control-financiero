'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { anularPagoDeudaAction } from '@/app/(app)/deudas/[id]/actions';
import type { PagoDeuda } from '@/lib/db/pagos-deudas';

interface Props {
  pago: PagoDeuda;
  saldoActualDeuda: number;
  estadoActualDeuda: string;
}

const formatFechaShort = (s: string): string =>
  !s ? '—' : formatearFecha(s, 'dd/MM/yyyy');

export function AnularPagoButton({ pago, saldoActualDeuda, estadoActualDeuda }: Props) {
  const [open, setOpen] = useState(false);

  if (pago.estadoPago === 'Anulado') {
    return (
      <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
        Anulado {formatFechaShort(pago.fechaAnulacion ?? '')}
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
        title="Anular este pago"
      >
        <I.X size={11} /> Anular
      </button>
      {open && (
        <AnularModal pago={pago} saldoActualDeuda={saldoActualDeuda} estadoActualDeuda={estadoActualDeuda} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

interface ModalProps {
  pago: PagoDeuda;
  saldoActualDeuda: number;
  estadoActualDeuda: string;
  onClose: () => void;
}

function AnularModal({ pago, saldoActualDeuda, estadoActualDeuda, onClose }: ModalProps) {
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

  const saldoDespues = saldoActualDeuda + pago.capital;
  const estadoDespues = saldoDespues > 0.01 && /liquidada/i.test(estadoActualDeuda) ? 'Vigente' : estadoActualDeuda;
  const eraLiquidada = /liquidada/i.test(estadoActualDeuda);

  const onConfirm = async () => {
    if (!motivo.trim()) return;
    setLoading(true);
    try {
      const res = await anularPagoDeudaAction(pago.id, motivo.trim());
      if (res.ok) {
        toast.success(`Pago anulado · saldo Q${res.saldoNuevo.toFixed(2)} · ${res.estadoDeuda}`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo anular el pago');
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
          width: 'min(540px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Alert size={15} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Anular pago · <span className="num">{Q(pago.montoTotal)}</span>
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Vas a anular este pago del <span className="num">{formatFechaShort(pago.fecha)}</span>:
          </p>

          <div style={{
            border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
            padding: '10px 12px', background: 'var(--paper-2)', marginBottom: 14,
            fontSize: 12, color: 'var(--ink-3)',
          }}>
            <div>Capital: <span className="num">{Q(pago.capital)}</span></div>
            {pago.interes  > 0 && <div>Interés: <span className="num">{Q(pago.interes)}</span></div>}
            {pago.mora     > 0 && <div>Mora: <span className="num">{Q(pago.mora)}</span></div>}
            {pago.comision > 0 && <div>Comisión: <span className="num">{Q(pago.comision)}</span></div>}
            <div style={{ borderTop: '1px solid var(--line-3)', marginTop: 6, paddingTop: 6 }}>
              {pago.metodo} {pago.cuentaBancoName && `· ${pago.cuentaBancoName}`} {pago.referencia && `· ${pago.referencia}`}
            </div>
          </div>

          <div style={{
            padding: '10px 14px', marginBottom: 14,
            border: '1px solid var(--wine)', borderRadius: 'var(--r-2)',
            background: '#F5E2DD', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>⚠️ Esto va a:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Revertir el saldo de la deuda: <span className="num">Q{saldoActualDeuda.toFixed(2)}</span> → <span className="num">Q{saldoDespues.toFixed(2)}</span></li>
              {eraLiquidada && saldoDespues > 0.01 && (
                <li>La deuda vuelve a <strong>{estadoDespues}</strong></li>
              )}
              <li>El monto se pondrá a 0 en Airtable; el motivo y el monto original quedan en el record como histórico</li>
            </ul>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="motivo-anular-pago">Motivo de anulación (requerido)</label>
            <textarea
              id="motivo-anular-pago"
              className="input"
              rows={3}
              placeholder="Ej. Cheque devuelto; pago rechazado por banco"
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
