'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { diferirPagoEmpleadoAction } from '@/app/(app)/planillas/actions';
import type { LineaPlanilla } from '@/lib/db/planillas';

interface Props {
  linea: LineaPlanilla;
  onClose: () => void;
}

export function ModalDiferirPago({ linea, onClose }: Props) {
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

  const valido = motivo.trim().length > 0;

  const onConfirm = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const res = await diferirPagoEmpleadoAction({ lineaId: linea.id, motivo: motivo.trim() });
      if (res.ok) {
        toast.success(`Pago diferido · Deuda salarial Q${linea.netoPagar.toFixed(2)} creada`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo diferir el pago.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red');
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
          <I.Clock size={15} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Diferir pago · {linea.empleadoNombre}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 14px', lineHeight: 1.55 }}>
            Diferir convierte la quincena no pagada en una <strong>deuda salarial</strong> contra
            el acreedor del empleado (módulo de Deudas). El empleado podrá cobrarla más adelante
            sin perder trazabilidad contable.
          </p>

          <div className="field" style={{ marginBottom: 14 }}>
            <label className="label">Motivo</label>
            <textarea
              className="input" rows={3}
              placeholder="Ej. Flujo de caja apretado; se libera en próxima quincena."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={loading}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{
            border: '1px solid var(--wine)', borderRadius: 'var(--r-2)',
            background: 'rgba(123, 28, 45, 0.05)', padding: '10px 14px',
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12.5,
          }}>
            <span style={{ color: 'var(--ink-3)' }}>Se creará una deuda por</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--wine)' }}>{Q(linea.netoPagar)}</span>
            <span style={{ color: 'var(--ink-4)', fontSize: 11, gridColumn: '1 / -1', marginTop: 4 }}>
              Contra el acreedor del empleado en /deudas (se crea si no existe).
            </span>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading || !valido}>
            {loading ? <><I.Refresh size={13} /> Difiriendo…</> : <><I.Check size={13} /> Diferir pago</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
