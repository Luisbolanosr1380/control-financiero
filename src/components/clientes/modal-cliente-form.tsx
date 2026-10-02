'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearClienteAction, getDatosAltaClienteAction, type DatosAltaCliente } from '@/app/(app)/clientes/actions';
import { detectarIntercompany, CUENTA_CXC_DEFAULT, CUENTA_CXC_INTERCOMPANY } from '@/lib/clientes/intercompany';
import type { Customer } from '@/lib/types';

interface Props {
  onClose: () => void;
  /** F-CLIENTE-INLINE: si está, al crear se entrega el cliente al caller
   *  (para dejarlo seleccionado donde se invocó, ej. emitir factura). */
  onCreado?: (cliente: Customer) => void;
  /** Pre-carga del nombre (ej. lo que el usuario venía buscando). */
  nombreInicial?: string;
}

export function ModalClienteForm({ onClose, onCreado, nombreInicial }: Props) {
  const router = useRouter();
  const [nombreEmpresa, setNombreEmpresa]   = useState(nombreInicial ?? '');
  const [razonSocial, setRazonSocial]       = useState('');
  const [nit, setNit]                       = useState('');
  // F-CXC-SELECTOR: la cuenta sale de un selector (código · nombre) con
  // default Nacionales; si el nombre matchea una empresa hermana del
  // catálogo se SUGIERE Partes Relacionadas (el usuario puede cambiarla).
  const [cuentaCxc, setCuentaCxc]           = useState(CUENTA_CXC_DEFAULT);
  const [cxcTocada, setCxcTocada]           = useState(false);
  const [datosAlta, setDatosAlta]           = useState<DatosAltaCliente>({
    cuentasCxc: [{ codigo: CUENTA_CXC_DEFAULT, nombre: 'CxC Clientes Nacionales' }],
    hermanas: [],
  });
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
    let vivo = true;
    getDatosAltaClienteAction().then(d => { if (vivo) setDatosAlta(d); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  // Sugerencia intercompany: solo mientras el usuario no haya tocado el
  // selector a mano (es sugerencia, no imposición).
  const hermanaDetectada = detectarIntercompany(nombreEmpresa, datosAlta.hermanas)
    ?? detectarIntercompany(razonSocial, datosAlta.hermanas);
  useEffect(() => {
    if (cxcTocada) return;
    const tiene333 = datosAlta.cuentasCxc.some(c => c.codigo === CUENTA_CXC_INTERCOMPANY);
    if (hermanaDetectada && tiene333) setCuentaCxc(CUENTA_CXC_INTERCOMPANY);
    else setCuentaCxc(CUENTA_CXC_DEFAULT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hermanaDetectada, cxcTocada, datosAlta.cuentasCxc.length]);

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
        // Mismo shape que recordToCustomer para que el caller lo use de una.
        onCreado?.({
          id: res.clienteId,
          name: nombreEmpresa.trim(),
          short: nombreEmpresa.trim(),
          nit: nit.trim(),
          contact: '',
          email: emailCobros.trim(),
          phone: '',
          credit: diasCredito.trim() === '' ? 30 : (parseInt(diasCredito, 10) || 0),
          totalBalance: 0,
          vencido: 0,
          avgPayDays: 0,
          onTimeRate: 0,
          contextoComercial: contexto.trim() || undefined,
        });
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
