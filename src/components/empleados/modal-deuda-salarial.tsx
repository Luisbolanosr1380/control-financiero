'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearDeudaSalarialAction } from '@/app/(app)/empleados/actions';

interface Props {
  empleadoId: string;
  empleadoNombre: string;
  salarioSugerido?: number;   // 50% del mensual (quincena)
  onClose: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ModalDeudaSalarial({ empleadoId, empleadoNombre, salarioSugerido, onClose }: Props) {
  const router = useRouter();
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState(salarioSugerido ? salarioSugerido.toFixed(2) : '');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const montoNum = round2(parseFloat(monto.replace(/[^\d.]/g, '')) || 0);
  const valido = montoNum > 0 && !!fecha;

  const onConfirm = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const res = await crearDeudaSalarialAction(empleadoId, montoNum, fecha, notas.trim() || undefined);
      if (res.ok) {
        toast.success(`Deuda salarial creada · Q${montoNum.toFixed(2)}${res.acreedorCreado ? ' (acreedor del empleado creado)' : ''}`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo crear la deuda salarial');
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
          <I.Debt size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Registrar deuda salarial · {empleadoNombre}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 14px', lineHeight: 1.55 }}>
            Cuando una quincena no se paga, se difiere como deuda contra un acreedor del propio empleado
            (categoría "Empleados" en /deudas). Si el empleado no tenía acreedor vinculado todavía, se le crea uno.
          </p>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Fecha de la quincena diferida</label>
            <input type="date" className="input num" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={loading} />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Monto neto que se difirió (Q)</label>
            <input
              type="text"
              inputMode="decimal"
              className="input num"
              placeholder="0.00"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              disabled={loading}
            />
            {salarioSugerido && salarioSugerido > 0 && (
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                Sugerido (50% del mensual): Q{salarioSugerido.toFixed(2)}
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Notas / motivo (opcional)</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Ej. Flujo de caja temporalmente apretado; programado para liberarse en julio."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              disabled={loading}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading || !valido}>
            {loading ? <><I.Refresh size={13} /> Creando…</> : <><I.Check size={13} /> Crear deuda</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
