'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { I } from '@/components/common/icons';
import type { DescuentoQuincena } from '@/lib/calculos/planilla-calc';

interface Props {
  onClose: () => void;
  onSubmit: (descuento: DescuentoQuincena) => void;
}

const TIPOS: DescuentoQuincena['tipo'][] = ['Préstamo', 'Anticipo', 'Daño', 'Otro'];

export function ModalAgregarDescuento({ onClose, onSubmit }: Props) {
  const [tipo, setTipo]               = useState<DescuentoQuincena['tipo']>('Préstamo');
  const [monto, setMonto]             = useState('');
  const [descripcion, setDescripcion] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const montoNum = Math.round((parseFloat(monto.replace(/[^\d.]/g, '')) || 0) * 100) / 100;
  const valido = montoNum > 0;

  const onConfirm = () => {
    if (!valido) return;
    onSubmit({
      tipo,
      monto: montoNum,
      descripcion: descripcion.trim() || undefined,
    });
    onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(480px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Slider size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Agregar descuento</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Tipo</label>
            <select
              className="input"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as DescuentoQuincena['tipo'])}
            >
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Monto (Q)</label>
            <input
              type="text" inputMode="decimal" className="input num"
              placeholder="0.00"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Descripción (opcional)</label>
            <input
              type="text" className="input"
              placeholder="Ej. Cuota mensual préstamo de caja."
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={!valido}>
            <I.Plus size={13} /> Agregar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
