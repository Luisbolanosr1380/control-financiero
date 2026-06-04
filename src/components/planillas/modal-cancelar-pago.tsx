'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { cancelarPagoEmpleadoAction } from '@/app/(app)/planillas/actions';
import type { LineaPlanilla } from '@/lib/db/planillas';

interface Props {
  linea: LineaPlanilla;
  onClose: () => void;
}

/**
 * F-038.4: cancelar pago = empleado NO debe cobrar esta quincena.
 * NO genera deuda (a diferencia de diferir). Casos: licencia sin goce,
 * despido a mitad de quincena, error en la generación de la planilla.
 */
export function ModalCancelarPago({ linea, onClose }: Props) {
  const router = useRouter();
  const [motivo, setMotivo] = useState('');
  const [paso, setPaso] = useState<'motivo' | 'confirmar'>('motivo');
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
      const res = await cancelarPagoEmpleadoAction({ lineaId: linea.id, motivo: motivo.trim() });
      if (res.ok) {
        toast.success(`Pago cancelado · ${linea.empleadoNombre} no cobrará esta quincena`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo cancelar el pago.');
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
          <I.Alert size={15} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Cancelar pago · {linea.empleadoNombre}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {paso === 'motivo' ? (
            <>
              <div style={{
                padding: '10px 14px', marginBottom: 14,
                border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55,
              }}>
                <strong style={{ color: 'var(--ink-2)' }}>Cancelar ≠ Diferir.</strong> Cancelar significa que el
                empleado <strong>NO debe cobrar</strong> esta quincena (licencia sin goce, despido a mitad de quincena,
                error de generación). <strong>NO crea deuda</strong>.
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label className="label">Motivo de la cancelación (requerido)</label>
                <textarea
                  className="input" rows={3}
                  placeholder="Ej. Licencia sin goce desde el 5 de junio; o despido el 10 de junio."
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  disabled={loading}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            </>
          ) : (
            <>
              <div style={{
                padding: '12px 14px', marginBottom: 12,
                border: '1px solid var(--wine)', borderRadius: 'var(--r-2)',
                background: '#F5E2DD', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55,
              }}>
                <strong>¿Estás seguro?</strong> Vas a cancelar el pago de {linea.empleadoNombre} por <span className="num">{Q(linea.netoPagar)}</span>.
                <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                  <li>Esta acción <strong>NO genera deuda</strong>.</li>
                  <li>El empleado se considera como que NO debe cobrar esta quincena.</li>
                  <li>La línea queda como Cancelado en el histórico (no se elimina).</li>
                </ul>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                <strong>Motivo:</strong> {motivo}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cerrar</button>
          {paso === 'motivo' ? (
            <button type="button" className="btn btn-secondary" onClick={() => setPaso('confirmar')} disabled={!valido}>
              Siguiente
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setPaso('motivo')} disabled={loading}>
                Volver
              </button>
              <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading}>
                {loading ? <><I.Refresh size={13} /> Cancelando…</> : <><I.X size={13} /> Sí, cancelar pago</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
