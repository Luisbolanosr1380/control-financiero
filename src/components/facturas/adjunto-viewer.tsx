'use client';

import { useEffect, useState } from 'react';
import { I } from '@/components/common/icons';

interface Props {
  url: string;
  nombre?: string;
}

export function AdjuntoViewer({ url, nombre }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <I.Paperclip size={16} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{nombre ?? 'Factura.pdf'}</span>
        <button type="button" className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>
          <I.Eye size={13} /> Ver PDF
        </button>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(20, 18, 16, 0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 3vw',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '94vw', height: '94vh', background: 'var(--paper)', borderRadius: 'var(--r-3)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
              <I.Paperclip size={14} style={{ color: 'var(--ink-3)' }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{nombre ?? 'Factura.pdf'}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ fontSize: 12 }}>
                  <I.ArrowRight size={13} /> Abrir en pestaña
                </a>
                <a href={url} download={nombre ?? 'factura.pdf'} className="btn btn-secondary" style={{ fontSize: 12 }}>
                  <I.Download size={13} /> Descargar
                </a>
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} title="Cerrar (Esc)">
                  <I.X size={15} />
                </button>
              </div>
            </div>
            <iframe
              src={url}
              title={nombre ?? 'PDF de la factura'}
              style={{ flex: 1, width: '100%', border: 'none', background: 'var(--bg-2)' }}
            />
          </div>
        </div>
      )}
    </>
  );
}
