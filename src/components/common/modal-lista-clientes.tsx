'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';

export interface FilaCliente {
  custId: string;
  nombre: string;
  col1?: React.ReactNode;
  col2?: React.ReactNode;
}

interface Props {
  abierto: boolean;
  onClose: () => void;
  titulo: string;
  subtitulo?: string;
  filas: FilaCliente[];
  col1Label?: string;
  col2Label?: string;
  col1Align?: 'left' | 'right';
  col2Align?: 'left' | 'right';
}

/**
 * Modal reusable con lista de clientes. Cada fila lleva al detalle del cliente.
 * Usa portal para escapar overflow. Cierra con ESC, click fuera y botón X.
 */
export function ModalListaClientes({
  abierto, onClose, titulo, subtitulo, filas,
  col1Label, col2Label, col1Align = 'right', col2Align = 'right',
}: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [abierto, onClose]);

  if (!abierto || typeof document === 'undefined') return null;

  const hasCol1 = !!col1Label || filas.some(f => f.col1 !== undefined);
  const hasCol2 = !!col2Label || filas.some(f => f.col2 !== undefined);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <I.Users size={15} style={{ color: 'var(--ink-3)' }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{titulo}</div>
            <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} title="Cerrar (Esc)">
              <I.X size={15} />
            </button>
          </div>
          {subtitulo && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{subtitulo}</div>
          )}
        </div>

        <div style={{ overflowY: 'auto' }}>
          {filas.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
              No hay clientes en esta vista.
            </div>
          ) : (
            <table className="table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: hasCol1 && hasCol2 ? '54%' : hasCol1 || hasCol2 ? '64%' : '100%' }}>Cliente</th>
                  {hasCol1 && (
                    <th className={col1Align === 'right' ? 'num' : ''} style={{ width: hasCol2 ? '23%' : '36%', textAlign: col1Align }}>
                      {col1Label ?? ''}
                    </th>
                  )}
                  {hasCol2 && (
                    <th className={col2Align === 'right' ? 'num' : ''} style={{ width: '23%', textAlign: col2Align }}>
                      {col2Label ?? ''}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filas.map(f => (
                  <tr
                    key={f.custId}
                    className="clickable"
                    onClick={() => { onClose(); router.push(`/clientes/${f.custId}`); }}
                  >
                    <td
                      className="cell-strong"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={f.nombre}
                    >
                      {f.nombre}
                    </td>
                    {hasCol1 && (
                      <td className={col1Align === 'right' ? 'num' : ''} style={{ whiteSpace: 'nowrap', textAlign: col1Align }}>
                        {f.col1}
                      </td>
                    )}
                    {hasCol2 && (
                      <td className={col2Align === 'right' ? 'num' : ''} style={{ whiteSpace: 'nowrap', textAlign: col2Align }}>
                        {f.col2}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
