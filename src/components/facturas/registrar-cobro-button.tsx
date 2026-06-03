'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { registrarCobroAction } from '@/app/(app)/facturacion/[id]/actions';
import type { Banco } from '@/lib/db/bancos';
import type { MetodoCobro, MonedaCobro, ComponenteCobro } from '@/lib/db/cobros';
import type { InvoiceStatus } from '@/lib/types';

interface Props {
  noFactura: string;
  total: number;
  saldoPendiente: number;   // F-035: pasado desde el server (puede ser < total si hubo cobros parciales)
  status: InvoiceStatus;
  estadoBruto?: string;     // F-035: si es 'COBRADO PARCIAL' habilita seguir cobrando
  bancos: Banco[];
}

const METODOS: { value: MetodoCobro; label: string; esRetencion: boolean }[] = [
  { value: 'Transferencia', label: 'Transferencia',  esRetencion: false },
  { value: 'Cheque',        label: 'Cheque',         esRetencion: false },
  { value: 'Efectivo',      label: 'Efectivo',       esRetencion: false },
  { value: 'Tarjeta',       label: 'Tarjeta',        esRetencion: false },
  { value: 'Retención IVA', label: 'Retención IVA',  esRetencion: true  },
  { value: 'Retención ISR', label: 'Retención ISR',  esRetencion: true  },
];

const esRetencion = (m: MetodoCobro) => m === 'Retención IVA' || m === 'Retención ISR';
const round2 = (n: number) => Math.round(n * 100) / 100;
const MAX_COMPONENTES = 5;

interface ComponenteUI extends ComponenteCobro {
  uid: string;          // key estable para React
  montoStr: string;     // input controlado como string
}

function nuevoComponente(): ComponenteUI {
  return {
    uid: `c-${Math.random().toString(36).slice(2, 9)}`,
    monto: 0,
    montoStr: '',
    metodo: 'Transferencia',
    bancoId: undefined,
    referencia: '',
  };
}

export function RegistrarCobroButton({ noFactura, total, saldoPendiente, status, estadoBruto, bancos }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // F-035: además de EMITIDA/PENDIENTE, COBRADO PARCIAL permite seguir cobrando.
  const cobrable =
    estadoBruto === 'COBRADO PARCIAL' ||
    status === 'vencido' || status === 'por_cobrar' || status === 'pendiente' || status === 'emitida';
  if (!cobrable) {
    const label = status === 'cobrado' ? 'Cobrada' : status === 'anulado' ? 'Anulada' : status;
    return (
      <button className="btn btn-primary" disabled title="La factura ya está totalmente cobrada o no es cobrable">
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
          saldoPendiente={saldoPendiente}
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
  saldoPendiente: number;
  bancos: Banco[];
  onClose: () => void;
  onSuccess: () => void;
}

function CobroModal({ noFactura, total, saldoPendiente, bancos, onClose, onSuccess }: ModalProps) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha]         = useState(hoy);
  const [moneda, setMoneda]       = useState<MonedaCobro>('GTQ');
  const [tipoCambio, setTipoCambio] = useState<string>('1');
  const [componentes, setComponentes] = useState<ComponenteUI[]>(() => {
    const c = nuevoComponente();
    c.bancoId = bancos[0]?.id;
    return [c];
  });
  const [confirmando, setConfirmando] = useState(false);
  const [loading, setLoading]         = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const sinBancos = bancos.length === 0;
  const requiereBanco = componentes.some(c => !esRetencion(c.metodo));

  const sumaCobro = useMemo(
    () => round2(componentes.reduce((s, c) => s + (Number.isFinite(c.monto) ? c.monto : 0), 0)),
    [componentes],
  );
  const saldoDespues = round2(saldoPendiente - sumaCobro);
  const excede       = sumaCobro - saldoPendiente > 0.01;
  const liquidaTodo  = !excede && saldoDespues <= 0.01;

  const erroresComponentes: string[] = [];
  componentes.forEach((c, i) => {
    if (!(c.monto > 0)) erroresComponentes.push(`Componente #${i + 1}: monto debe ser mayor a 0`);
    if (!esRetencion(c.metodo) && !c.bancoId) erroresComponentes.push(`Componente #${i + 1}: elegí un banco`);
  });

  const valido = sumaCobro > 0 && !excede && erroresComponentes.length === 0 && (!requiereBanco || !sinBancos);

  const actualizar = (uid: string, patch: Partial<ComponenteUI>) => {
    setComponentes(prev => prev.map(c => c.uid === uid ? { ...c, ...patch } : c));
  };

  const agregarComponente = () => {
    if (componentes.length >= MAX_COMPONENTES) return;
    const c = nuevoComponente();
    c.bancoId = bancos[0]?.id;
    setComponentes(prev => [...prev, c]);
  };

  const eliminarComponente = (uid: string) => {
    if (componentes.length === 1) return;
    setComponentes(prev => prev.filter(c => c.uid !== uid));
  };

  const handleMontoChange = (uid: string, raw: string) => {
    const limpio = raw.replace(/[^\d.]/g, '');
    const n = parseFloat(limpio);
    actualizar(uid, { montoStr: raw, monto: Number.isFinite(n) ? round2(n) : 0 });
  };

  const handleMetodoChange = (uid: string, m: MetodoCobro) => {
    const cambioARetencion = esRetencion(m);
    actualizar(uid, {
      metodo: m,
      bancoId: cambioARetencion ? undefined : (componentes.find(c => c.uid === uid)?.bancoId ?? bancos[0]?.id),
    });
  };

  const onConfirm = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const tc = parseFloat(tipoCambio.replace(/[^\d.]/g, ''));
      const componentesPayload: ComponenteCobro[] = componentes.map(c => ({
        monto: round2(c.monto),
        metodo: c.metodo,
        bancoId: esRetencion(c.metodo) ? undefined : c.bancoId,
        referencia: c.referencia?.trim() || undefined,
      }));
      const res = await registrarCobroAction({
        noFactura,
        fecha,
        componentes: componentesPayload,
        moneda,
        tipoCambio: Number.isFinite(tc) && tc > 0 ? tc : 1,
      });
      if (res.ok) {
        const cuandoEstado = res.estadoNuevo === 'COBRADO' ? 'liquida la factura' : `quedan Q${res.saldoNuevo.toFixed(2)} pendientes`;
        toast.success(`Cobro registrado · Q${res.totalCobrado.toFixed(2)} (${cuandoEstado})`);
        onSuccess();
      } else if (res.cobrosCreados > 0) {
        toast.warning(res.error ?? `Cobro parcial: ${res.cobrosCreados} cobro(s) creado(s). Revisá Airtable.`);
        onSuccess();
      } else {
        toast.error(res.error ?? 'No se pudo registrar el cobro');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red al registrar el cobro');
    } finally {
      setLoading(false);
      setConfirmando(false);
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
          width: 'min(720px, 96vw)', maxHeight: '92vh',
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
          {/* Header info: total + saldo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ padding: '10px 14px', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', background: 'var(--paper-2)' }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total factura</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink-2)' }}>{Q(total)}</div>
            </div>
            <div style={{ padding: '10px 14px', border: '1px solid var(--olive)', borderRadius: 'var(--r-2)', background: '#EFF1E0' }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Saldo pendiente</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--olive)' }}>{Q(saldoPendiente)}</div>
            </div>
          </div>

          {sinBancos && requiereBanco && (
            <div style={{
              padding: '10px 14px', marginBottom: 14,
              border: '1px solid var(--amber)', borderRadius: 'var(--r-2)',
              background: '#FBF3E0', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
            }}>
              <strong>No hay bancos activos.</strong> Marcá al menos uno en Airtable o usá solo componentes de retención.
            </div>
          )}

          {/* Fila: fecha + moneda + TC */}
          <div style={{ display: 'grid', gridTemplateColumns: moneda === 'USD' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Fecha del cobro</label>
              <input type="date" className="input num" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={loading} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Moneda</label>
              <select className="input" value={moneda} onChange={(e) => setMoneda(e.target.value as MonedaCobro)} disabled={loading}>
                <option value="GTQ">GTQ (Quetzales)</option>
                <option value="USD">USD (Dólares)</option>
              </select>
            </div>
            {moneda === 'USD' && (
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Tipo de cambio</label>
                <input type="text" inputMode="decimal" className="input num" value={tipoCambio} onChange={(e) => setTipoCambio(e.target.value)} disabled={loading} />
              </div>
            )}
          </div>

          {/* Componentes */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Componentes del cobro
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginLeft: 'auto', fontSize: 11 }}
                onClick={agregarComponente}
                disabled={loading || componentes.length >= MAX_COMPONENTES}
                title={componentes.length >= MAX_COMPONENTES ? `Máximo ${MAX_COMPONENTES}` : 'Agregar componente'}
              >
                <I.Plus size={12} /> Agregar componente
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {componentes.map((c, idx) => {
                const ret = esRetencion(c.metodo);
                return (
                  <div key={c.uid} style={{
                    border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                    padding: '10px 12px', background: ret ? '#FBF7E6' : 'var(--paper)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Componente #{idx + 1}
                      </span>
                      {ret && <span className="badge badge-warn" style={{ fontSize: 10.5 }}>Retención</span>}
                      {componentes.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}
                          onClick={() => eliminarComponente(c.uid)}
                          disabled={loading}
                          title="Quitar este componente"
                        >
                          <I.X size={11} /> Quitar
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label className="label">Método</label>
                        <select
                          className="input"
                          value={c.metodo}
                          onChange={(e) => handleMetodoChange(c.uid, e.target.value as MetodoCobro)}
                          disabled={loading}
                        >
                          {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label className="label">Monto</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input num"
                          value={c.montoStr}
                          placeholder="0.00"
                          onChange={(e) => handleMontoChange(c.uid, e.target.value)}
                          disabled={loading}
                        />
                      </div>
                      {!ret ? (
                        <>
                          <div className="field" style={{ margin: 0 }}>
                            <label className="label">Banco / cuenta</label>
                            <select
                              className="input"
                              value={c.bancoId ?? ''}
                              onChange={(e) => actualizar(c.uid, { bancoId: e.target.value })}
                              disabled={loading || sinBancos}
                            >
                              {sinBancos && <option value="">(sin bancos activos)</option>}
                              {bancos.map(b => (
                                <option key={b.id} value={b.id}>
                                  {b.nombreCuenta || b.banco} {b.numeroCuenta ? `· ${b.numeroCuenta}` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label className="label">Referencia bancaria</label>
                            <input
                              type="text"
                              className="input"
                              placeholder="Ej. TRF-91207"
                              value={c.referencia ?? ''}
                              onChange={(e) => actualizar(c.uid, { referencia: e.target.value })}
                              disabled={loading}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                          <label className="label">Número de constancia</label>
                          <input
                            type="text"
                            className="input"
                            placeholder="Ej. CR-2026-001"
                            value={c.referencia ?? ''}
                            onChange={(e) => actualizar(c.uid, { referencia: e.target.value })}
                            disabled={loading}
                          />
                          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                            La constancia PDF se sube manualmente en Airtable en el campo Constancia_Retencion del registro creado.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Resumen calculado */}
          <div style={{
            padding: '12px 14px',
            border: `1px solid ${excede ? 'var(--wine)' : liquidaTodo ? 'var(--olive)' : 'var(--line-2)'}`,
            borderRadius: 'var(--r-2)',
            background: excede ? '#F5E2DD' : liquidaTodo ? '#EFF1E0' : 'var(--paper-2)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12.5 }}>
              <span style={{ color: 'var(--ink-3)' }}>Total cobro:</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{Q(sumaCobro)}</span>
              <span style={{ color: 'var(--ink-3)' }}>Saldo después:</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 500, color: excede ? 'var(--wine)' : liquidaTodo ? 'var(--olive)' : 'var(--ink-2)' }}>
                {Q(Math.max(0, saldoDespues))}
              </span>
            </div>
            <div style={{ fontSize: 12, marginTop: 8, color: excede ? 'var(--wine)' : liquidaTodo ? 'var(--olive)' : 'var(--ink-3)', fontWeight: 500 }}>
              {excede        ? `Excede el saldo por Q${(sumaCobro - saldoPendiente).toFixed(2)}`
               : liquidaTodo ? 'Liquida completamente la factura ✓'
                             : `Quedará saldo pendiente Q${saldoDespues.toFixed(2)} (factura → COBRADO PARCIAL)`}
            </div>
            {erroresComponentes.length > 0 && (
              <ul style={{ margin: '8px 0 0 18px', padding: 0, color: 'var(--wine)', fontSize: 11.5 }}>
                {erroresComponentes.map(e => <li key={e}>{e}</li>)}
              </ul>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          {!confirmando ? (
            <button type="button" className="btn btn-primary" onClick={() => { if (valido) setConfirmando(true); }} disabled={!valido || loading}>
              <I.Check size={13} /> Revisar y confirmar
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmando(false)} disabled={loading}>
                Volver
              </button>
              <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={loading}>
                {loading ? <><I.Refresh size={13} /> Registrando…</> : <><I.Check size={13} /> Confirmar {liquidaTodo ? 'cobro total' : 'cobro parcial'}</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
