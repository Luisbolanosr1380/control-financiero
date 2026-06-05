'use client';

/**
 * F-045 — Sección "Notas de Crédito" en el detalle de factura.
 *
 * Renderiza cada NC como card. Permite anular (cualquier usuario) y aprobar
 * (solo admin, si la NC está en Pendiente Aprobación). NCs anuladas quedan
 * atenuadas con el motivo visible.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { aprobarNotaCreditoAction, anularNotaCreditoAction } from '@/app/(app)/facturacion/[id]/actions';
import { HelpButton } from '@/components/ayuda/help-button';
import type { NotaCredito, EstadoNotaCredito } from '@/lib/db/notas-credito';

const ESTADO_BADGE: Record<EstadoNotaCredito, { cls: string; text: string }> = {
  'Borrador':               { cls: 'badge-mute',    text: 'Borrador' },
  'Pendiente Aprobación':   { cls: 'badge-warn',    text: 'Pendiente Aprobación' },
  'Aprobada':               { cls: 'badge-outline', text: 'Aprobada' },
  'Activa':                 { cls: 'badge-olive',   text: 'Activa' },
  'Anulada':                { cls: 'badge-wine',    text: 'Anulada' },
};

interface Props {
  notasCredito: NotaCredito[];
  esAdmin: boolean;
}

export function NotasCreditoSection({ notasCredito, esAdmin }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [anulandoId, setAnulandoId] = useState<string | null>(null);
  const [motivoAnul, setMotivoAnul] = useState('');

  const aprobar = async (nc: NotaCredito) => {
    setBusyId(nc.id);
    try {
      const res = await aprobarNotaCreditoAction(nc.id);
      if (res.ok) {
        toast.success(`NC ${nc.numeroNC} aprobada · saldo recalculado`);
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo aprobar.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const confirmarAnular = async (nc: NotaCredito) => {
    if (!motivoAnul.trim()) {
      toast.error('Ingresá un motivo de anulación.');
      return;
    }
    setBusyId(nc.id);
    try {
      const res = await anularNotaCreditoAction(nc.id, motivoAnul.trim());
      if (res.ok) {
        toast.success(`NC ${nc.numeroNC} anulada · saldo de factura recalculado`);
        setAnulandoId(null);
        setMotivoAnul('');
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo anular.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const activas = notasCredito.filter(n => n.estado === 'Activa');
  const montoActivas = activas.reduce((s, n) => s + n.monto, 0);

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">Notas de Crédito</div>
        <div className="card-actions">
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {notasCredito.length} total · {activas.length} activa{activas.length === 1 ? '' : 's'} por <span className="num">{Q(montoActivas)}</span>
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
        {notasCredito.map(nc => {
          const anulada = nc.estado === 'Anulada';
          const badge = ESTADO_BADGE[nc.estado];
          const enAnulacion = anulandoId === nc.id;
          return (
            <div key={nc.id} style={{
              border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
              padding: '12px 14px',
              background: anulada ? '#F2EDE9' : nc.estado === 'Pendiente Aprobación' ? '#FBF1DC' : 'var(--paper-2)',
              opacity: anulada ? 0.7 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                <span className="num" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{nc.numeroNC}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>· {formatearFecha(nc.fechaEmision)}</span>
                <span className={'badge ' + badge.cls} style={{ fontSize: 10, padding: '1px 6px' }}>{badge.text}</span>
                <span className="num" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600, color: anulada ? 'var(--ink-4)' : 'var(--wine)' }}>
                  − {Q(nc.monto)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>
                <strong>Motivo:</strong> {nc.motivo} · <em>{nc.descripcion}</em>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                Emitida por {nc.emitidaPor || '—'}
                {nc.aprobadaPor && <> · Aprobada por {nc.aprobadaPor} ({formatearFecha(nc.fechaAprobacion ?? '')})</>}
                {anulada && nc.motivoAnulacion && (
                  <> · <strong>Anulada</strong> {nc.fechaAnulacion ? `(${formatearFecha(nc.fechaAnulacion)})` : ''} por {nc.anuladaPor || '—'}: {nc.motivoAnulacion}</>
                )}
              </div>

              {/* Acciones */}
              {!anulada && (
                <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                  {nc.adjuntoUrl && (
                    <a href={nc.adjuntoUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>
                      <I.Paperclip size={11} /> Ver PDF
                    </a>
                  )}
                  {esAdmin && nc.estado === 'Pendiente Aprobación' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => aprobar(nc)}
                        disabled={busyId === nc.id}
                      >
                        {busyId === nc.id ? 'Aprobando…' : 'Aprobar'}
                      </button>
                      <HelpButton tag="aprobar-nc" />
                    </span>
                  )}
                  {(nc.estado === 'Activa' || nc.estado === 'Aprobada') && !enAnulacion && (
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '3px 8px', color: 'var(--wine)' }}
                        onClick={() => { setAnulandoId(nc.id); setMotivoAnul(''); }}
                      >
                        <I.X size={11} /> Anular NC
                      </button>
                      <HelpButton tag="anular-nc" />
                    </span>
                  )}
                </div>
              )}

              {enAnulacion && (
                <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--wine)', borderRadius: 4, background: '#F5E2DD' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', marginBottom: 6 }}>
                    Motivo de anulación (requerido):
                  </div>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ej. error de emisión, monto incorrecto…"
                    value={motivoAnul}
                    onChange={(e) => setMotivoAnul(e.target.value)}
                    disabled={busyId === nc.id}
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setAnulandoId(null); setMotivoAnul(''); }} disabled={busyId === nc.id}>
                      Cancelar
                    </button>
                    <button type="button" className="btn btn-danger" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => confirmarAnular(nc)} disabled={busyId === nc.id || !motivoAnul.trim()}>
                      {busyId === nc.id ? 'Anulando…' : 'Confirmar anulación'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
