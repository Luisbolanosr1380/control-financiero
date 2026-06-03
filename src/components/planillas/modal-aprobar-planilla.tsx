'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { aprobarPeriodoAction } from '@/app/(app)/planillas/actions';
import type { Periodo } from '@/lib/db/planillas';

interface Props {
  periodo: Periodo;
  onClose: () => void;
}

export function ModalAprobarPlanilla({ periodo, onClose }: Props) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const habilitado = periodo.estado === 'Borrador';

  const onConfirm = async () => {
    if (!habilitado) return;
    setLoading(true);
    try {
      const res = await aprobarPeriodoAction(periodo.id);
      if (res.ok) {
        toast.success(`Planilla ${periodo.nombre} aprobada · ${periodo.cantidadEmpleados} empleados`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo aprobar el período.');
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
          width: 'min(520px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Check size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Aprobar planilla · {periodo.nombre}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {!habilitado && (
            <div style={{
              border: '1px solid var(--wine)', borderRadius: 'var(--r-2)',
              padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: 'var(--wine)',
            }}>
              Este período está en estado <strong>{periodo.estado}</strong>. Solo se puede aprobar desde Borrador.
            </div>
          )}

          <div style={{
            border: '1px solid var(--olive)', borderRadius: 'var(--r-2)',
            background: '#EFF1E0', padding: '12px 14px', marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Resumen del período
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12.5 }}>
              <span style={{ color: 'var(--ink-3)' }}>Período</span>
              <span style={{ textAlign: 'right' }}>{periodo.nombre}</span>
              <span style={{ color: 'var(--ink-3)' }}>Rango</span>
              <span className="num" style={{ textAlign: 'right' }}>{periodo.fechaInicio} → {periodo.fechaFin}</span>
              <span style={{ color: 'var(--ink-3)' }}>Empleados</span>
              <span className="num" style={{ textAlign: 'right' }}>{periodo.cantidadEmpleados}</span>
              <span style={{ fontWeight: 500, borderTop: '1px solid var(--olive)', paddingTop: 4 }}>Monto neto total</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 600, borderTop: '1px solid var(--olive)', paddingTop: 4 }}>
                {Q(periodo.montoTotal)}
              </span>
            </div>
          </div>

          {paso === 1 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              Al aprobar, el período pasará a <strong>Aprobada</strong> y se habilitarán
              los pagos por empleado. <strong>Después no podrás editar las líneas.</strong>
            </div>
          ) : (
            <div style={{
              border: '1px solid var(--wine)', borderRadius: 'var(--r-2)',
              padding: '12px 14px', fontSize: 12.5, color: 'var(--wine)', lineHeight: 1.55,
            }}>
              Confirmar aprobación: una vez aprobada, los montos no se pueden ajustar y se
              registrará tu correo como aprobador.
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          {paso === 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => setPaso(2)} disabled={!habilitado || loading}>
              Continuar
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={!habilitado || loading}>
              {loading ? <><I.Refresh size={13} /> Aprobando…</> : <><I.Check size={13} /> Confirmar aprobación</>}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
