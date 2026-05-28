'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { registrarCobroAction } from '@/app/(app)/facturacion/[id]/actions';
import type { Banco } from '@/lib/db/bancos';
import type { MetodoCobro, MonedaCobro } from '@/lib/db/cobros';
import type { InvoiceStatus } from '@/lib/types';

interface Props {
  noFactura: string;
  total: number;
  status: InvoiceStatus;
  bancos: Banco[];
}

const METODOS: MetodoCobro[] = ['Transferencia', 'Cheque', 'Efectivo', 'Tarjeta'];

export function RegistrarCobroButton({ noFactura, total, status, bancos }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Habilitado solo si EMITIDA/PENDIENTE → vencido/por_cobrar (= EMITIDA con días) o pendiente
  const cobrable = status === 'vencido' || status === 'por_cobrar' || status === 'pendiente' || status === 'emitida';
  if (!cobrable) {
    const label = status === 'cobrado' ? 'Cobrada' : status === 'anulado' ? 'Anulada' : status;
    return (
      <button className="btn btn-primary" disabled title="Solo facturas en EMITIDA o PENDIENTE pueden cobrarse">
        <I.Coins size={13} /> {label}
      </button>
    );
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <I.Coins size={13} /> Registrar cobro
      </button>
      {open && (
        <CobroModal
          noFactura={noFactura}
          total={total}
          bancos={bancos}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

interface ModalProps {
  noFactura: string;
  total: number;
  bancos: Banco[];
  onClose: () => void;
  onSuccess: () => void;
}

function CobroModal({ noFactura, total, bancos, onClose, onSuccess }: ModalProps) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha]         = useState(hoy);
  const [bancoId, setBancoId]     = useState(bancos[0]?.id ?? '');
  const [metodo, setMetodo]       = useState<MetodoCobro>('Transferencia');
  const [moneda, setMoneda]       = useState<MonedaCobro>('GTQ');
  const [tipoCambio, setTipoCambio] = useState<string>('1');
  const [referencia, setReferencia] = useState('');
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  if (typeof document === 'undefined') return null;

  const sinBancos = bancos.length === 0;

  const onConfirm = async () => {
    if (sinBancos) return;
    setLoading(true);
    try {
      const tc = parseFloat(tipoCambio.replace(/[^\d.]/g, ''));
      const res = await registrarCobroAction({
        noFactura,
        fecha,
        bancoId,
        metodo,
        moneda,
        tipoCambio: Number.isFinite(tc) && tc > 0 ? tc : 1,
        referencia: referencia.trim() || undefined,
      });
      if (res.ok) {
        toast.success(`Cobro registrado · ${Q(res.totalCobrado)} en ${res.cobrosCreados} línea(s)`);
        onSuccess();
      } else if (res.cobrosCreados > 0) {
        toast.warning(res.error ?? `Cobro parcial: ${res.cobrosCreados}/${res.recordsActualizados}. Revisá Airtable.`);
        onSuccess();
      } else {
        toast.error(res.error ?? 'No se pudo registrar el cobro');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red al registrar el cobro');
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
          width: 'min(560px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Coins size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Registrar cobro · factura <span className="num">{noFactura}</span>
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          {/* Monto fijo (info, no editable) */}
          <div style={{ padding: '12px 14px', marginBottom: 16, border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', background: 'var(--paper-2)' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
              Cobro completo
            </div>
            <div className="num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>{Q(total)}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4 }}>
              No se permiten cobros parciales por ahora.
            </div>
          </div>

          {sinBancos && (
            <div style={{
              padding: '10px 14px', marginBottom: 14,
              border: '1px solid var(--amber)', borderRadius: 'var(--r-2)',
              background: '#FBF3E0', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
            }}>
              <strong>No hay bancos marcados como ACTIVO.</strong> Marcá al menos uno en la tabla BANCOS de Airtable para registrar cobros.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Fecha del cobro</label>
              <input type="date" className="input num" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={loading || sinBancos} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Banco / cuenta</label>
              <select className="input" value={bancoId} onChange={(e) => setBancoId(e.target.value)} disabled={loading || sinBancos}>
                {bancos.length === 0 && <option value="">(sin bancos activos)</option>}
                {bancos.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.nombreCuenta || b.banco} {b.numeroCuenta ? `· ${b.numeroCuenta}` : ''} ({b.moneda})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Método</label>
              <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoCobro)} disabled={loading || sinBancos}>
                {METODOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Moneda</label>
              <select className="input" value={moneda} onChange={(e) => setMoneda(e.target.value as MonedaCobro)} disabled={loading || sinBancos}>
                <option value="GTQ">GTQ (Quetzales)</option>
                <option value="USD">USD (Dólares)</option>
              </select>
            </div>
            {moneda === 'USD' && (
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Tipo de cambio</label>
                <input type="text" inputMode="decimal" className="input num" value={tipoCambio} onChange={(e) => setTipoCambio(e.target.value)} disabled={loading || sinBancos} />
              </div>
            )}
            <div className="field" style={{ margin: 0, gridColumn: moneda === 'USD' ? 'auto' : '1 / -1' }}>
              <label className="label">Referencia (opcional)</label>
              <input type="text" className="input" placeholder="Ej. TRF-91207" value={referencia} onChange={(e) => setReferencia(e.target.value)} disabled={loading || sinBancos} />
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading || sinBancos || !bancoId}>
            {loading ? <><I.Refresh size={13} /> Registrando…</> : <><I.Check size={13} /> Confirmar cobro</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
