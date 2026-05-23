'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { I } from '@/components/common/icons';

interface Props {
  text: string;
  /** label opcional para a11y, ej. "Más información sobre Mes pico" */
  ariaLabel?: string;
}

/**
 * Ícono (i) que abre un popover con texto explicativo.
 * Usa portal para escapar el `overflow: hidden` de los cards.
 * Cierra con click fuera y Escape. Posicionado bajo el botón.
 */
export function InfoTooltip({ text, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const POP_W = 320;
    setPos({
      top: r.bottom + window.scrollY + 6,
      left: Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - POP_W - 8)),
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      const pop = document.getElementById('info-tooltip-popover');
      if (pop && pop.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        aria-label={ariaLabel ?? 'Más información'}
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: 8, marginLeft: 6, padding: 0,
          border: '1px solid var(--line-2)', background: 'var(--paper-2)',
          color: 'var(--ink-3)', cursor: 'pointer', verticalAlign: 'middle',
          flexShrink: 0,
        }}
      >
        <I.Info size={10} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          id="info-tooltip-popover"
          role="tooltip"
          style={{
            position: 'absolute', top: pos.top, left: pos.left, zIndex: 1100,
            maxWidth: 320, padding: '10px 14px',
            background: 'var(--paper)', border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)', boxShadow: '0 10px 26px rgba(0,0,0,0.16)',
            fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45,
            whiteSpace: 'pre-line',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
