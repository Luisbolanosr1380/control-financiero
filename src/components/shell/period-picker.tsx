'use client';

/**
 * F-BF-002a — Selector global de mes del header.
 *
 * Reemplaza el `<div className="period-picker">` decorativo que solo
 * mostraba "Mayo 2026" hardcodeado y no hacía nada al clickearlo.
 * Ahora actualiza `?mes=YYYY-MM` preservando los demás searchParams.
 * Cada vista server-side lee el param y filtra su fetch.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { I } from '@/components/common/icons';
import {
  etiquetaMes,
  mesesDisponibles,
  parseMesParam,
} from '@/lib/utils/mes-activo';

export function PeriodPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Mes activo: lo que diga el searchParam, o el actual si no hay.
  const mesActivo = parseMesParam(searchParams.get('mes') ?? undefined);
  const opciones = mesesDisponibles(12);

  // Cerrar al click fuera.
  useEffect(() => {
    if (!abierto) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [abierto]);

  const elegir = (mes: string) => {
    setAbierto(false);
    const next = new URLSearchParams(searchParams.toString());
    next.set('mes', mes);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setAbierto(o => !o)}
        className="period-picker"
        aria-haspopup="listbox"
        aria-expanded={abierto}
      >
        <I.Calendar size={13} /> {etiquetaMes(mesActivo)} <I.ChevDown size={12} />
      </button>

      {abierto && (
        <div
          role="listbox"
          aria-label="Seleccionar mes"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            minWidth: 180,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--paper-2)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            boxShadow: '0 12px 28px -8px rgba(14, 42, 36, 0.18)',
            padding: 4,
          }}
        >
          {opciones.map(mes => {
            const activo = mes === mesActivo;
            return (
              <button
                key={mes}
                type="button"
                role="option"
                aria-selected={activo}
                onClick={() => elegir(mes)}
                style={{
                  all: 'unset',
                  display: 'block',
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '7px 10px',
                  fontSize: 13,
                  cursor: 'pointer',
                  borderRadius: 4,
                  color: activo ? 'var(--paper)' : 'var(--ink-2)',
                  background: activo ? 'var(--ink)' : 'transparent',
                  fontWeight: activo ? 500 : 400,
                }}
                onMouseEnter={(e) => { if (!activo) e.currentTarget.style.background = 'var(--paper-tint)'; }}
                onMouseLeave={(e) => { if (!activo) e.currentTarget.style.background = 'transparent'; }}
              >
                {etiquetaMes(mes)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
