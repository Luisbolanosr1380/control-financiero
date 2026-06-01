'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { registrarPagoDeudaAction } from '@/app/(app)/deudas/[id]/actions';
import type { MetodoPagoDeuda } from '@/lib/db/pagos-deudas';

interface Props {
  deudaId: string;
  deudaNombre: string;
  acreedorNombre: string;
  saldoPendiente: number;
  estaLiquidada: boolean;
  cuentasBanco: string[];     // opciones del singleSelect Cuenta_Banco
}

const METODOS: MetodoPagoDeuda[] = ['Transferencia', 'Cheque', 'Efectivo', 'Tarjeta', 'Domiciliado', 'Compensación'];

export function RegistrarPagoButton({ deudaId, deudaNombre, acreedorNombre, saldoPendiente, estaLiquidada, cuentasBanco }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn btn-primary"
        onClick={() => setOpen(true)}
        disabled={estaLiquidada || saldoPendiente <= 0}
        title={estaLiquidada ? 'La deuda ya está liquidada' : 'Registrar un pago'}
      >
        <I.Plus size={13} /> Registrar pago
      </button>
      {open && (
        <RegistrarPagoModal
          deudaId={deudaId}
          deudaNombre={deudaNombre}
          acreedorNombre={acreedorNombre}
          saldoPendiente={saldoPendiente}
          cuentasBanco={cuentasBanco}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ModalProps extends Omit<Props, 'estaLiquidada'> {
  onClose: () => void;
}

function RegistrarPagoModal({ deudaId, deudaNombre, acreedorNombre, saldoPendiente, cuentasBanco, onClose }: ModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(today);
  const [montoTotal, setMontoTotal] = useState('');
  const [desglosar, setDesglosar] = useState(false);
  const [capital, setCapital] = useState('');
  const [interes, setInteres] = useState('');
  const [mora, setMora] = useState('');
  const [comision, setComision] = useState('');
  const [metodo, setMetodo] = useState<MetodoPagoDeuda>('Transferencia');
  const [referencia, setReferencia] = useState('');
  const [cuentaBanco, setCuentaBanco] = useState(cuentasBanco[0] ?? '');
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  // Solo permite cerrar con Esc; portal a body para evitar problemas de stacking.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !enviando) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enviando]);

  const total      = parseNum(montoTotal);
  const cap        = parseNum(capital);
  const intNum     = parseNum(interes);
  const moraNum    = parseNum(mora);
  const comNum     = parseNum(comision);
  const sumaDesglose = cap + intNum + moraNum + comNum;
  const restante   = total - sumaDesglose;
  const requiereRef = metodo === 'Transferencia' || metodo === 'Cheque';

  // Reglas de validación
  const errores: string[] = [];
  if (!fecha)                    errores.push('Fecha requerida.');
  if (total <= 0)                errores.push('Monto total debe ser mayor a 0.');
  const capitalEfectivo = desglosar ? cap : total;
  if (capitalEfectivo > saldoPendiente + 0.01) errores.push(`No podés pagar más de ${Q(saldoPendiente)} (saldo).`);
  if (desglosar && Math.abs(restante) > 0.01)  errores.push(`El desglose debe sumar exactamente ${Q(total)}.`);
  if (!metodo)                   errores.push('Método requerido.');
  if (requiereRef && !referencia.trim()) errores.push(`Referencia requerida para ${metodo}.`);
  if (!cuentaBanco)              errores.push('Cuenta bancaria requerida.');

  const puedeEnviar = errores.length === 0 && !enviando;

  const enviar = async () => {
    if (!puedeEnviar) return;
    setEnviando(true);
    try {
      const res = await registrarPagoDeudaAction({
        deudaId,
        fecha,
        montoTotal: total,
        desglose: desglosar
          ? { capital: cap, interes: intNum, mora: moraNum, comision: comNum }
          : undefined,
        metodo,
        referencia: referencia.trim() || undefined,
        cuentaBancoName: cuentaBanco,
        moneda: 'GTQ',
        tipoCambio: 1,
        notas: notas.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.mensaje);
        onClose();
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  };

  if (!mounted) return null;
  const body = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !enviando) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(14, 42, 36, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        padding: 20,
      }}
    >
      <div className="card" style={{
        width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--paper-2)', padding: 0,
      }}>
        <div className="card-head" style={{ borderBottom: '1px solid var(--line-3)' }}>
          <div>
            <div className="card-title">Registrar pago</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
              {acreedorNombre} · {deudaNombre || '—'} · Saldo actual: <strong className="num">{Q(saldoPendiente)}</strong>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} disabled={enviando}><I.X size={14} /></button>
        </div>

        <div style={{ padding: 18, display: 'grid', gap: 12 }}>
          <Field label="Fecha del pago">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={inputStyle} />
          </Field>

          <Field label={`Monto total del pago (${desglosar ? 'capital + interés + mora + comisión' : 'se asume 100% capital'})`}>
            <input
              type="number" step="0.01" min="0.01"
              placeholder="0.00"
              value={montoTotal}
              onChange={(e) => setMontoTotal(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={desglosar} onChange={(e) => setDesglosar(e.target.checked)} />
            Desglosar pago en capital / interés / mora / comisión
          </label>

          {desglosar && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 12, background: 'var(--paper)', borderRadius: 6, border: '1px solid var(--line-3)' }}>
              <Field label="Capital (reduce saldo)">
                <input type="number" step="0.01" min="0" value={capital} onChange={(e) => setCapital(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Interés">
                <input type="number" step="0.01" min="0" value={interes} onChange={(e) => setInteres(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Mora">
                <input type="number" step="0.01" min="0" value={mora} onChange={(e) => setMora(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Comisión">
                <input type="number" step="0.01" min="0" value={comision} onChange={(e) => setComision(e.target.value)} style={inputStyle} />
              </Field>
              <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: Math.abs(restante) < 0.01 ? 'var(--olive)' : 'var(--wine)', textAlign: 'right' }}>
                Suma del desglose: <strong className="num">{Q(sumaDesglose)}</strong> {Math.abs(restante) < 0.01 ? '✓ cuadra' : `· ${restante > 0 ? `falta ${Q(restante)}` : `sobra ${Q(-restante)}`}`}
              </div>
            </div>
          )}

          <Field label="Método">
            <select value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoPagoDeuda)} style={inputStyle}>
              {METODOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>

          <Field label={`Referencia ${requiereRef ? '(requerida)' : '(opcional)'}`}>
            <input type="text" placeholder="Nº transferencia, cheque, etc." value={referencia} onChange={(e) => setReferencia(e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Cuenta bancaria (de donde sale)">
            {cuentasBanco.length > 0 ? (
              <select value={cuentaBanco} onChange={(e) => setCuentaBanco(e.target.value)} style={inputStyle}>
                {cuentasBanco.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input type="text" placeholder="Nombre exacto de la opción en Airtable" value={cuentaBanco} onChange={(e) => setCuentaBanco(e.target.value)} style={inputStyle} />
            )}
            {cuentasBanco.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                No hay opciones de Cuenta_Banco registradas todavía. Tipeá el nombre que exista en Airtable.
              </div>
            )}
          </Field>

          <Field label="Notas (opcional)">
            <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
          </Field>

          <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
            💡 Subir el comprobante (PDF / foto del soporte) se hace después en la pantalla de detalle del pago. Esta versión registra solo los datos del pago.
          </div>

          {errores.length > 0 && (
            <div style={{ padding: '8px 10px', background: 'rgba(138, 42, 42, 0.06)', border: '1px solid var(--wine)', borderRadius: 4, fontSize: 11.5, color: 'var(--wine)' }}>
              {errores.map((e, i) => <div key={i}>· {e}</div>)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--line-3)' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
          {!confirmando ? (
            <button className="btn btn-primary" onClick={() => setConfirmando(true)} disabled={!puedeEnviar}>
              Registrar pago
            </button>
          ) : (
            <button className="btn btn-primary" onClick={enviar} disabled={enviando} style={{ background: 'var(--olive)' }}>
              {enviando ? 'Registrando...' : `Confirmar: pagar ${Q(total)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper)',
  fontFamily: 'inherit', color: 'var(--ink)', outline: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}

function parseNum(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
