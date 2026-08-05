'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import { registrarGestionAction, getGestionesClienteAction } from '@/app/(app)/facturacion/pendientes/actions';
import { CANALES_GESTION, type CanalGestion, type GestionCobro } from '@/lib/db/gestiones-cobro';

interface FacturaDelCliente {
  id: string;
  noFactura: string;
  saldo: number;
  diasVencidos: number;
}

interface Props {
  custId: string;
  cliente: string;
  facturas: FacturaDelCliente[];   // pendientes de ESTE cliente (para referenciar)
  onClose: () => void;
}

export function GestionCobroModal({ custId, cliente, facturas, onClose }: Props) {
  const router = useRouter();
  const [historial, setHistorial] = useState<GestionCobro[] | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  const [canal, setCanal]           = useState<CanalGestion>('Llamada');
  const [contacto, setContacto]     = useState('');
  const [comentario, setComentario] = useState('');
  const [promesa, setPromesa]       = useState('');
  const [seguimiento, setSeguimiento] = useState('');
  const [facturasSel, setFacturasSel] = useState<Record<string, { checked: boolean; fecha: string }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let vivo = true;
    getGestionesClienteAction(custId).then(g => { if (vivo) setHistorial(g); });
    return () => { vivo = false; };
  }, [custId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const onConfirm = async () => {
    if (!comentario.trim()) return;
    setLoading(true);
    try {
      const refs = Object.entries(facturasSel)
        .filter(([, v]) => v.checked)
        .map(([facturaId, v]) => ({ facturaId, fechaPromesa: v.fecha || undefined }));
      const res = await registrarGestionAction({
        custId,
        canal,
        contactoCliente: contacto.trim() || undefined,
        comentario: comentario.trim(),
        fechaPagoPromesa: promesa || undefined,
        proximoSeguimiento: seguimiento || undefined,
        facturas: refs.length ? refs : undefined,
      });
      if (res.ok) {
        toast.success(res.mensaje);
        setMostrarForm(false);
        setComentario(''); setContacto(''); setPromesa(''); setSeguimiento(''); setFacturasSel({});
        setHistorial(await getGestionesClienteAction(custId));
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

  const hoy = new Date().toISOString().slice(0, 10);

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
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Gestión de cobro · {cliente}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={onClose} disabled={loading}>
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '16px 22px', overflowY: 'auto' }}>
          {!mostrarForm && (
            <button className="btn btn-primary" style={{ marginBottom: 14 }} onClick={() => setMostrarForm(true)}>
              <I.Plus size={13} /> Registrar gestión
            </button>
          )}

          {mostrarForm && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">Canal</label>
                  <select className="input" value={canal} onChange={e => setCanal(e.target.value as CanalGestion)} disabled={loading}>
                    {CANALES_GESTION.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">Con quién se habló</label>
                  <input className="input" placeholder="ej. Licda. Pérez, contabilidad" value={contacto} onChange={e => setContacto(e.target.value)} disabled={loading} />
                </div>
                <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                  <label className="label">Comentario * (qué dijo el cliente)</label>
                  <textarea className="input" rows={3} value={comentario} onChange={e => setComentario(e.target.value)} disabled={loading} autoFocus />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">Fecha de pago prometida</label>
                  <input type="date" className="input num" value={promesa} onChange={e => setPromesa(e.target.value)} disabled={loading} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">Próximo seguimiento</label>
                  <input type="date" className="input num" value={seguimiento} onChange={e => setSeguimiento(e.target.value)} disabled={loading} />
                </div>

                {facturas.length > 0 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Facturas referenciadas (opcional — fecha propia si difiere)
                    </div>
                    <div style={{ display: 'grid', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                      {facturas.map(f => {
                        const sel = facturasSel[f.id] ?? { checked: false, fecha: '' };
                        return (
                          <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={sel.checked}
                              onChange={e => setFacturasSel({ ...facturasSel, [f.id]: { ...sel, checked: e.target.checked } })}
                              disabled={loading}
                            />
                            <span className="num" style={{ minWidth: 110 }}>{f.noFactura}</span>
                            <span className="num" style={{ color: 'var(--ink-3)', minWidth: 90 }}>{Q(f.saldo)}</span>
                            <span style={{ color: f.diasVencidos > 0 ? 'var(--wine)' : 'var(--ink-4)', fontSize: 11.5, minWidth: 70 }}>
                              {f.diasVencidos > 0 ? `${f.diasVencidos}d venc.` : 'por vencer'}
                            </span>
                            {sel.checked && (
                              <input
                                type="date"
                                className="input num"
                                style={{ padding: '2px 6px', fontSize: 12, width: 140 }}
                                value={sel.fecha}
                                min={hoy}
                                placeholder="fecha propia"
                                onChange={e => setFacturasSel({ ...facturasSel, [f.id]: { ...sel, fecha: e.target.value } })}
                                disabled={loading}
                                title="Fecha prometida para ESTA factura (vacío = usa la general)"
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setMostrarForm(false)} disabled={loading}>Cancelar</button>
                  <button className="btn btn-primary" onClick={onConfirm} disabled={loading || !comentario.trim()}>
                    {loading ? <><I.Refresh size={13} /> Guardando…</> : <><I.Check size={13} /> Guardar gestión</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            Histórico {historial ? `· ${historial.length}` : ''}
          </div>
          {historial === null ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>Cargando…</div>
          ) : historial.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>
              Sin gestiones registradas — este cliente nunca se ha contactado desde el sistema.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {historial.map(g => (
                <div key={g.id} style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4, fontSize: 11.5 }}>
                    <span className="num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{formatDate(g.fechaGestion)}</span>
                    <span className="badge badge-mute">{g.canal}</span>
                    {g.contactoCliente && <span style={{ color: 'var(--ink-3)' }}>con {g.contactoCliente}</span>}
                    <span style={{ color: 'var(--ink-4)', marginLeft: 'auto' }}>{g.usuario}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap', marginBottom: 6 }}>{g.comentario}</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5 }}>
                    {g.fechaPagoPromesa && (
                      <span style={{ color: g.fechaPagoPromesa < hoy ? 'var(--wine)' : 'var(--olive)' }}>
                        Prometió pagar: <span className="num" style={{ fontWeight: 600 }}>{formatDate(g.fechaPagoPromesa)}</span>
                        {g.fechaPagoPromesa < hoy && ' (venció)'}
                      </span>
                    )}
                    {g.proximoSeguimiento && (
                      <span style={{ color: 'var(--ink-3)' }}>Seguimiento: <span className="num">{formatDate(g.proximoSeguimiento)}</span></span>
                    )}
                    {g.facturas.length > 0 && (
                      <span style={{ color: 'var(--ink-3)' }}>
                        Facturas: {g.facturas.map(f => f.fechaPromesa ? `${f.noFactura} (${formatDate(f.fechaPromesa)})` : f.noFactura).join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
