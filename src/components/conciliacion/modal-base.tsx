'use client';

import { createPortal } from 'react-dom';
import { I } from '@/components/common/icons';

export function ModalBase({ titulo, ancho = 520, onClose, children, pie }: {
  titulo: string; ancho?: number; onClose: () => void; children: React.ReactNode; pie?: React.ReactNode;
}) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width: `min(${ancho}px, 96vw)`, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="card-head">
          <div className="card-title">{titulo}</div>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} title="Cerrar"><I.X size={15} /></button>
        </div>
        <div className="card-pad" style={{ overflowY: 'auto' }}>{children}</div>
        {pie && <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-3)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{pie}</div>}
      </div>
    </div>,
    document.body,
  );
}
