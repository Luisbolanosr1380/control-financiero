'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { registrarPagoEmpleadoAction } from '@/app/(app)/planillas/actions';
import type { LineaPlanilla } from '@/lib/db/planillas';

interface BancoOption {
  id: string;
  nombre: string;
}

interface Props {
  linea: LineaPlanilla;
  bancos: BancoOption[];
  onClose: () => void;
}

export function ModalPagarEmpleado({ linea, bancos, onClose }: Props) {
  const router = useRouter();
  const hoy = obtenerFechaHoyGuatemala();
  const [fechaPago, setFechaPago]   = useState(hoy);
  const [bancoId, setBancoId]       = useState(bancos[0]?.id ?? '');
  const [referencia, setReferencia] = useState('');
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const valido = !!fechaPago && !!bancoId;

  const onConfirm = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const res = await registrarPagoEmpleadoAction({
        lineaId: linea.id,
        fechaPago,
        bancoId,
        referencia: referencia.trim() || undefined,
      });
      if (res.ok) {
        toast.success(`Pago registrado · ${linea.empleadoNombre} · Q${linea.netoPagar.toFixed(2)}`);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo registrar el pago.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  };

  if (typeof document === 'undefined') return null;

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
          width: 'min(520px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Bank size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            Registrar pago · {linea.empleadoNombre}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <div style={{
            border: '1px solid var(--olive)', borderRadius: 'var(--r-2)',
            background: '#EFF1E0', padding: '10px 14px', marginBottom: 14,
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12.5,
          }}>
            <span style={{ color: 'var(--ink-3)' }}>Neto a pagar</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{Q(linea.netoPagar)}</span>
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Fecha de pago</label>
            <input
              type="date" className="input num"
              value={fechaPago}
              onChange={(e) => setFechaPago(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label">Banco</label>
            <select className="input" value={bancoId} onChange={(e) => setBancoId(e.target.value)} disabled={loading}>
              {bancos.length === 0 && <option value="">— No hay bancos configurados —</option>}
              {bancos.map(b => (
                <option key={b.id} value={b.id}>{b.nombre}</option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Referencia (opcional)</label>
            <input
              type="text" className="input"
              placeholder="No. de transferencia, cheque, etc."
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading || !valido}>
            {loading ? <><I.Refresh size={13} /> Registrando…</> : <><I.Check size={13} /> Registrar pago</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
