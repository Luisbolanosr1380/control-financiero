'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { anularFacturaAction } from '@/app/(app)/facturacion/[id]/actions';
import type { InvoiceStatus } from '@/lib/types';
import type { MotivoAnulacion } from '@/lib/db/facturas';

const MOTIVOS: MotivoAnulacion[] = ['Error en datos', 'Cancelación del cliente', 'Refacturación'];

interface Props {
  noFactura: string;
  status: InvoiceStatus;
}

const ESTADO_LABEL: Partial<Record<InvoiceStatus, string>> = {
  cobrado:       'Cobrada',
  contabilizado: 'Contabilizada',
  pendiente:     'Pendiente',
  por_cobrar:    'Por cobrar',
  vencido:       'Vencida',
  emitida:       'Emitida',
};

export function AnularFacturaButton({ noFactura, status }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [motivoTipo, setMotivoTipo] = useState<MotivoAnulacion | ''>('');
  const [loading, setLoading] = useState(false);

  if (status === 'anulado') {
    return (
      <button className="btn btn-secondary" disabled title="Esta factura ya está anulada">
        <I.X size={13} /> Anulada
      </button>
    );
  }

  // Advertencia reforzada si está en un estado que puede afectar contabilidad
  const advertenciaReforzada = status === 'cobrado' || status === 'contabilizado';

  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        <I.X size={13} /> Anular factura
      </button>
      {open && (
        <ConfirmModal
          noFactura={noFactura}
          status={status}
          advertenciaReforzada={advertenciaReforzada}
          motivo={motivo}
          setMotivo={setMotivo}
          motivoTipo={motivoTipo}
          setMotivoTipo={setMotivoTipo}
          loading={loading}
          onClose={() => { if (!loading) { setOpen(false); setMotivo(''); setMotivoTipo(''); } }}
          onConfirm={async () => {
            setLoading(true);
            try {
              const res = await anularFacturaAction(noFactura, motivo || undefined, motivoTipo || undefined);
              const accion = motivoTipo === 'Refacturación' ? 'refacturada' : 'anulada';
              if (res.ok) {
                toast.success(`Factura ${noFactura} ${accion} · ${res.recordsActualizados} línea(s)`);
                setOpen(false);
                setMotivo('');
                setMotivoTipo('');
                router.refresh();
              } else if (res.bloqueadoPorCobros) {
                // F-036: bloqueo por cobros activos. Toast persistente con instrucción.
                toast.error(res.error ?? 'No se puede anular: hay cobros activos.', { duration: 8000 });
                setOpen(false);
              } else if (res.recordsActualizados > 0) {
                toast.warning(res.error ?? `Anulación parcial: ${res.recordsActualizados}/${res.recordsTotal}. Revisá Airtable.`);
                router.refresh();
              } else {
                toast.error(res.error ?? 'No se pudo anular la factura');
              }
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Error de red al anular');
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
    </>
  );
}

interface ConfirmProps {
  noFactura: string;
  status: InvoiceStatus;
  advertenciaReforzada: boolean;
  motivo: string;
  setMotivo: (v: string) => void;
  motivoTipo: MotivoAnulacion | '';
  setMotivoTipo: (v: MotivoAnulacion | '') => void;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ConfirmModal({ noFactura, status, advertenciaReforzada, motivo, setMotivo, motivoTipo, setMotivoTipo, loading, onClose, onConfirm }: ConfirmProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  if (typeof document === 'undefined') return null;

  const estadoLabel = ESTADO_LABEL[status] ?? status;

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
          width: 'min(540px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Alert size={15} style={{ color: 'var(--wine)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {motivoTipo === 'Refacturación' ? 'Refacturar' : 'Anular'} factura <span className="num">{noFactura}</span>
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px' }}>
          {advertenciaReforzada && (
            <div style={{
              padding: '10px 14px', marginBottom: 14,
              border: '1px solid var(--wine)', borderRadius: 'var(--r-2)',
              background: '#F5E2DD', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
            }}>
              <strong>⚠️ Esta factura está marcada como {estadoLabel.toLowerCase()}.</strong> Anularla puede afectar tu contabilidad. Verificá antes de continuar.
            </div>
          )}

          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 14px' }}>
            La factura pasará a <strong>{motivoTipo === 'Refacturación' ? 'REFACTURADO' : 'ANULADO'}</strong> en Airtable. Se actualizan <strong>todas las líneas</strong> que comparten este NO.FACTURA. La factura quedará fuera de KPIs y listados activos. <span style={{ color: 'var(--ink-4)' }}>No se puede des-anular desde la app (se hace manual en Airtable si hace falta).</span>
          </p>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label" htmlFor="motivo-tipo-anular">Motivo de anulación (opcional)</label>
            <select
              id="motivo-tipo-anular"
              className="input"
              value={motivoTipo}
              onChange={(e) => setMotivoTipo(e.target.value as MotivoAnulacion | '')}
              disabled={loading}
              style={{ fontFamily: 'inherit' }}
            >
              <option value="">— Sin motivo predefinido (queda como Anulada) —</option>
              {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {motivoTipo === 'Refacturación' && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
                Esta factura quedará marcada como <strong>REFACTURADA</strong>. Tendrás que emitir la nueva factura por separado (todavía no la genera el sistema).
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="motivo-anular">Detalle adicional (opcional)</label>
            <textarea
              id="motivo-anular"
              className="input"
              rows={3}
              placeholder="Ej. duplicada, monto incorrecto, cambio de cliente…"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={loading}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
              Se guarda en el campo Observaciones con la fecha y el motivo seleccionado.
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading
              ? <><I.Refresh size={13} /> {motivoTipo === 'Refacturación' ? 'Refacturando' : 'Anulando'}…</>
              : <><I.X size={13} /> Confirmar {motivoTipo === 'Refacturación' ? 'refacturación' : 'anulación'}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
