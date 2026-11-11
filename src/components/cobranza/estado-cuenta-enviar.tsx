'use client';

/**
 * CENTRO DE COBROS · PR 2 (035) · «Enviar estado de cuenta» desde la ficha del cliente: modal propio (sin diálogos del
 * navegador) que carga el estado de cuenta y el correo propuesto (plantilla «estado_cuenta» con el saldo real), deja
 * cambiar destinatario, copia, asunto y cuerpo, y manda. El envío queda en el historial como «Correo enviado».
 */
import { useEffect, useState } from 'react';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { enviarEstadoCuentaAction, prepararEstadoCuentaAction } from '@/app/(app)/cobranza/actions';
import type { DatosEstadoCuenta } from '@/lib/db/cobranza-recordatorios';

const OTRO = '__otro__';

export function EstadoCuentaEnviar({ clienteId, clienteNombre, onClose, onListo }: { clienteId: string; clienteNombre: string; onClose: () => void; onListo: (msg: string) => void }) {
  const [datos, setDatos] = useState<DatosEstadoCuenta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [para, setPara] = useState(''); const [paraOtro, setParaOtro] = useState(''); const [cc, setCc] = useState(''); const [asunto, setAsunto] = useState(''); const [cuerpo, setCuerpo] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    void prepararEstadoCuentaAction(clienteId).then(r => {
      if (!vivo) return;
      if (!r.ok) { setError(r.error); setCargando(false); return; }
      setDatos(r.datos); setPara(r.datos.destinatario?.correo ?? (r.datos.contactos[0]?.correo ?? OTRO)); setCc(r.datos.cc.join(', ')); setAsunto(r.datos.asunto); setCuerpo(r.datos.cuerpo); setCargando(false);
    });
    return () => { vivo = false; };
  }, [clienteId]);

  const destino = para === OTRO ? paraOtro : para;
  const enviar = async () => {
    setError(''); setBusy(true);
    try { const r = await enviarEstadoCuentaAction(clienteId, { para: destino, cc, asunto, cuerpo }); if (r.ok) onListo(r.detalle); else setError(r.error); } finally { setBusy(false); }
  };
  const ec = datos?.ec;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Enviar estado de cuenta" onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12, overflowY: 'auto' }}>
      <div className="card" style={{ maxWidth: 680, width: '100%', marginTop: 12 }} onClick={e => e.stopPropagation()} data-estado-cuenta-enviar>
        <div className="card-head"><div className="card-title">Enviar estado de cuenta · {clienteNombre}</div><div className="card-actions"><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cerrar</button></div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
          {cargando && <div className="cell-mute">Armando el estado de cuenta…</div>}
          {ec && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }} data-ec-resumen>
              <span>Saldo pendiente <strong className="num">{Q(ec.totales.saldo)}</strong> · {ec.totales.n} factura{ec.totales.n === 1 ? '' : 's'}</span>
              <span>Vencido <strong className="num" style={{ color: ec.totales.vencido > 0 ? 'var(--wine)' : undefined }}>{Q(ec.totales.vencido)}</strong></span>
              {ec.paquetes.length > 0 && <span>{ec.paquetes.map(p => `${p.correlativo}: ${p.remanente} restantes`).join(' · ')}</span>}
              <a href={`/imprimir/estado-cuenta/${encodeURIComponent(clienteId)}`} target="_blank" rel="noopener" style={{ marginLeft: 'auto' }} data-accion="ver-pdf">Ver el PDF</a>
            </div>
          )}
          {datos && !datos.correoConfigurado && <div role="status" data-sin-correo>Correo no configurado en este deploy (falta RESEND_API_KEY): descargá el PDF y mandalo a mano.</div>}
          {datos && (
            <>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <label style={{ display: 'grid', gap: 3 }}>Para
                  <select className="input" value={para} onChange={e => setPara(e.target.value)} disabled={busy} aria-label="Destinatario" data-campo="para">
                    {datos.contactos.map(c => <option key={c.id} value={c.correo}>{c.nombre} · {c.correo}{c.preferido ? ' ★' : ''}</option>)}
                    <option value={OTRO}>Otro correo…</option>
                  </select>
                  {para === OTRO && <input className="input" type="email" value={paraOtro} onChange={e => setParaOtro(e.target.value)} placeholder="correo@cliente.com" aria-label="Otro correo" disabled={busy} data-campo="para-otro" />}
                </label>
                <label style={{ display: 'grid', gap: 3 }}>Copia (CC) <input className="input" value={cc} onChange={e => setCc(e.target.value)} aria-label="Copia" disabled={busy} data-campo="cc" /></label>
              </div>
              <label style={{ display: 'grid', gap: 3 }}>Asunto <input className="input" value={asunto} onChange={e => setAsunto(e.target.value)} maxLength={200} disabled={busy} data-campo="asunto" /></label>
              <label style={{ display: 'grid', gap: 3 }}>Cuerpo <span className="cell-mute" style={{ fontSize: 11 }}>({'{{estado_cuenta}}'} se reemplaza por la tabla al enviar)</span><textarea className="input" value={cuerpo} onChange={e => setCuerpo(e.target.value)} rows={9} maxLength={8000} disabled={busy} data-campo="cuerpo" style={{ fontFamily: 'inherit', fontSize: 12.5 }} /></label>
            </>
          )}
          {error && <div style={{ color: 'var(--wine)' }} role="alert" data-error-ec>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void enviar()} disabled={busy || !datos || !datos.correoConfigurado || !destino} data-accion="confirmar-enviar-ec"><I.Send size={13} /> {busy ? 'Enviando…' : 'Enviar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
