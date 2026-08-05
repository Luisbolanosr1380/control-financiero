'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearClienteAction } from '@/app/(app)/clientes/actions';

interface Props {
  onClose: () => void;
}

export function ModalClienteForm({ onClose }: Props) {
  const router = useRouter();
  const [nombreEmpresa, setNombreEmpresa]   = useState('');
  const [razonSocial, setRazonSocial]       = useState('');
  const [nit, setNit]                       = useState('');
  const [cuentaCxc, setCuentaCxc]           = useState('1-1-3-1');
  const [emailCobros, setEmailCobros]       = useState('');
  const [correoCobro, setCorreoCobro]       = useState('');
  const [whatsappCobros, setWhatsapp]       = useState('');
  const [diasCredito, setDiasCredito]       = useState('30');
  const [periodicidad, setPeriodicidad]     = useState('');
  const [fechaFacturacion, setFechaFact]    = useState('');
  const [instrucciones, setInstrucciones]   = useState('');
  const [contexto, setContexto]             = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const valido = nombreEmpresa.trim().length > 0;

  const onConfirm = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const res = await crearClienteAction({
        nombreEmpresa: nombreEmpresa.trim(),
        razonSocial: razonSocial.trim() || undefined,
        nit: nit.trim() || undefined,
        cuentaCxc: cuentaCxc.trim() || undefined,
        emailCobros: emailCobros.trim() || undefined,
        correoCobro: correoCobro.trim() || undefined,
        whatsappCobros: whatsappCobros.trim() || undefined,
        diasCredito: diasCredito.trim() === '' ? undefined : parseInt(diasCredito, 10) || 0,
        periodicidadFactura: periodicidad.trim() || undefined,
        fechaFacturacion: fechaFacturacion.trim() === '' ? undefined : parseInt(fechaFacturacion, 10),
        instruccionesCobro: instrucciones.trim() || undefined,
        contextoComercial: contexto.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.mensaje);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error);
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
          width: 'min(640px, 96vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Users size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Nuevo cliente</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">Nombre de la empresa *</label>
              <input type="text" className="input" value={nombreEmpresa} onChange={(e) => setNombreEmpresa(e.target.value)} disabled={loading} autoFocus />
            </div>
            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">Razón social (la que va en la factura)</label>
              <input type="text" className="input" placeholder="Si se deja vacío, usa el nombre de la empresa" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">NIT (o CF)</label>
              <input type="text" className="input num" placeholder="1234567-8 o CF" value={nit} onChange={(e) => setNit(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Cuenta CxC</label>
              <input type="text" className="input num" value={cuentaCxc} onChange={(e) => setCuentaCxc(e.target.value)} disabled={loading} />
            </div>

            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>
              Cobranza
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Email cobros</label>
              <input type="email" className="input" value={emailCobros} onChange={(e) => setEmailCobros(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Correo cobro (secundario)</label>
              <input type="email" className="input" value={correoCobro} onChange={(e) => setCorreoCobro(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">WhatsApp cobros</label>
              <input type="text" className="input num" value={whatsappCobros} onChange={(e) => setWhatsapp(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Días de crédito</label>
              <input type="text" inputMode="numeric" className="input num" value={diasCredito} onChange={(e) => setDiasCredito(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Periodicidad de factura</label>
              <input type="text" className="input" placeholder='ej. "25 de cada mes"' value={periodicidad} onChange={(e) => setPeriodicidad(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Día de facturación (1-31)</label>
              <input type="text" inputMode="numeric" className="input num" value={fechaFacturacion} onChange={(e) => setFechaFact(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">Instrucciones de cobro</label>
              <textarea className="input" rows={2} value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">Contexto comercial (opcional)</label>
              <textarea className="input" rows={2} value={contexto} onChange={(e) => setContexto(e.target.value)} disabled={loading} />
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading || !valido}>
            {loading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Check size={13} /> Crear cliente</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
