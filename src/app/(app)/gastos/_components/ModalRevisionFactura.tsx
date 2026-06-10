'use client';

/**
 * F-050 PARTE E STUB — Modal de revisión de factura.
 *
 * Esta versión es un esqueleto navegable: lee los datos extraídos,
 * permite anular con motivo, y deja el formulario de aprobación apuntado
 * pero NO completo. La implementación completa (selectores de CC, cuenta
 * contable, banco, preview del asiento en vivo) se cierra en el próximo
 * commit de PARTE E.
 *
 * Decisión: subir el stub habilita inmediatamente:
 *  - La columna "Acción por fila" de PARTE D abre algo coherente.
 *  - El flujo de anular factura ya queda funcional end-to-end.
 *  - El selector de cuenta contable (que depende de field IDs pendientes
 *    de confirmar via MCP en CUENTAS) puede armarse sin bloquear la PARTE D.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { anularFacturaAction } from '@/app/(app)/gastos/_actions/anular-factura';
import type { FacturaIn } from '@/lib/db/facturas-in';

interface Props {
  factura: FacturaIn;
  onClose: () => void;
}

export function ModalRevisionFactura({ factura, onClose }: Props) {
  const router = useRouter();
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  if (typeof document === 'undefined') return null;

  const anular = async () => {
    if (motivo.trim().length < 5) {
      toast.error('El motivo debe tener al menos 5 caracteres.');
      return;
    }
    setLoading(true);
    try {
      const res = await anularFacturaAction({ facturaInId: factura.id, motivo: motivo.trim() });
      if (res.ok) {
        toast.success('Factura anulada.');
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo anular.');
      }
    } finally {
      setLoading(false);
    }
  };

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
          width: 'min(840px, 96vw)', maxHeight: '92vh', overflow: 'auto',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            Revisión de factura · {factura.proveedorNombre || factura.proveedorNit || 'Sin proveedor'}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar">
            <I.X size={14} />
          </button>
        </div>

        {/* Datos extraídos (sección 1) */}
        <div style={{ padding: 18, borderBottom: '1px solid var(--line-3)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Datos extraídos
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 12.5 }}>
            <Campo label="Proveedor" valor={factura.proveedorNombre || '—'} />
            <Campo label="NIT" valor={factura.proveedorNit || '—'} />
            <Campo label="Tipo doc" valor={factura.tipoDoc || '—'} />
            <Campo label="Serie / Número" valor={`${factura.serie || '—'} / ${factura.numero || '—'}`} />
            <Campo label="Fecha emisión" valor={factura.fechaEmision ? formatearFecha(factura.fechaEmision) : '—'} />
            <Campo label="Moneda" valor={factura.moneda} />
            <Campo label="Subtotal" valor={Q(factura.subtotal)} />
            <Campo label="IVA" valor={Q(factura.iva)} />
            <Campo label="Total" valor={Q(factura.total)} strong />
          </div>
          {factura.archivoUrl && (
            <div style={{ marginTop: 12 }}>
              <a href={factura.archivoUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: 12 }}>
                📄 Ver PDF original
              </a>
            </div>
          )}
        </div>

        {/* Formulario de decisiones (sección 3) — STUB */}
        <div style={{ padding: 18, borderBottom: '1px solid var(--line-3)' }}>
          <div style={{
            padding: 12, background: '#FBF1DC', border: '1px solid var(--amber)', borderRadius: 4,
            fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
          }}>
            🚧 <strong>Sección de decisiones (PARTE E)</strong>: selectores de
            Centro de Costo, Cuenta contable de gasto, Tipo Operativo y
            Método de pago + preview del asiento en vivo. En desarrollo —
            la integración con CUENTAS depende de field IDs pendientes de
            confirmar via MCP. Por ahora podés anular la factura desde el
            footer si los datos no son utilizables.
          </div>
        </div>

        {/* Anular inline */}
        {pidiendoMotivo && (
          <div style={{ padding: 16, background: 'var(--paper-2)', borderBottom: '1px solid var(--line-3)' }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>
              Motivo de anulación (mín. 5 chars):
            </div>
            <input
              type="text"
              className="input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. PDF ilegible, factura duplicada, datos OCR no recuperables…"
              disabled={loading}
              autoFocus
            />
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          {!pidiendoMotivo ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: 'var(--wine)' }}
              onClick={() => setPidiendoMotivo(true)}
              disabled={loading}
            >
              Anular…
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              onClick={anular}
              disabled={loading || motivo.trim().length < 5}
            >
              {loading ? 'Anulando…' : 'Confirmar anulación'}
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled title="PARTE E pendiente">
            Aprobar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Campo({ label, valor, strong }: { label: string; valor: string; strong?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: strong ? 14 : 13, fontWeight: strong ? 500 : 400, color: strong ? 'var(--ink)' : 'var(--ink-2)', marginTop: 2 }}>
        {valor || '—'}
      </div>
    </div>
  );
}
