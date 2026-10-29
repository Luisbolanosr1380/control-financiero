'use client';

/**
 * CLIENTE · "Cambiar NIT" (023): modal con el NIT actual (solo lectura), el NIT nuevo y
 * un resumen en vivo de lo que se moverá (tarifas + histórico, empresas de la Agenda,
 * expedientes, detalles) calculado por la RPC en modo simulación. Confirmación antes de
 * aplicar; nunca diálogos del navegador. Si el NIT nuevo ya es de otro cliente pide
 * aceptar explícitamente compartirlo; si choca una llave del tarifario no deja aplicar
 * y muestra qué chocó. Sirve desde la ficha del cliente (por cliente) y desde el
 * tarifario (por NIT: tarifas huérfanas en un NIT sin cliente, el caso CBC).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { cambiarNitClienteAction, previsualizarCambioNitAction } from '@/app/(app)/clientes/actions';
import { nitComparable, nitEsPlaceholder } from '@/lib/clientes/nit';
import { filasMovidas, nitNuevoAceptable, type CambioNitOk, type CambioNitResult, type ObjetivoNit } from '@/lib/clientes/cambiar-nit';

interface Props {
  objetivo: ObjetivoNit;
  /** NIT actual (como está guardado; puede venir vacío si el cliente no tiene). */
  nitActual: string;
  /** Nombre del cliente (o razón social del tarifario) para el título. */
  nombre: string;
  onClose: () => void;
  /** Se llama después de aplicar (el caller refresca o navega al NIT nuevo). */
  onHecho?: (r: CambioNitOk) => void;
}

export function CambiarNitModal({ objetivo, nitActual, nombre, onClose, onHecho }: Props) {
  const [nitNuevo, setNitNuevo] = useState('');
  const [forzar, setForzar] = useState(false);
  const [preview, setPreview] = useState<CambioNitResult | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);

  const comparable = nitComparable(nitNuevo);
  const igual = comparable !== '' && comparable === nitComparable(nitActual);
  const aceptable = nitNuevoAceptable(nitNuevo) && !igual;
  const hint = nitNuevo.trim() === '' ? null
    : igual ? 'Es el mismo NIT que tiene hoy.'
    : nitEsPlaceholder(comparable) ? 'Vacío, 0 o CF no identifican a un cliente: no sirven como NIT.'
    : !aceptable ? 'No parece un NIT de Guatemala (dígitos + verificador, ej. 1234567-8).'
    : null;

  // Resumen en vivo (simulación en la base), con debounce.
  useEffect(() => {
    if (!aceptable) { setPreview(null); return; }
    let vivo = true;
    setCalculando(true);
    const t = setTimeout(async () => {
      try {
        const r = await previsualizarCambioNitAction(objetivo, nitNuevo.trim(), forzar);
        if (vivo) setPreview(r);
      } finally { if (vivo) setCalculando(false); }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nitNuevo, forzar, aceptable, objetivo.clienteId, objetivo.nitViejo]);

  const listo = !!preview && preview.ok && !calculando && !busy;

  const aplicar = async () => {
    setBusy(true); setErrorAplicar(null);
    try {
      const r = await cambiarNitClienteAction(objetivo, nitNuevo.trim(), forzar);
      if (r.ok) { toast.success(r.mensaje); onHecho?.(r); onClose(); }
      else { setErrorAplicar(r.error); setPreview(r); }
    } finally { setBusy(false); }
  };

  const compartido = preview && !preview.ok && preview.codigo === 'nit_compartido';
  const choque = preview && !preview.ok && preview.codigo === 'tarifa_choque';
  const otroError = preview && !preview.ok && !compartido && !choque;
  const movidas = preview ? (preview.ok ? preview.movidas : preview.movera) : undefined;
  const filas = movidas ? filasMovidas(movidas) : [];
  const destino = preview ? (preview.ok ? preview.destino : preview.destino) : null;
  const compartidoCon = preview?.ok ? preview.compartidoCon : (compartido ? preview?.compartidoCon : null);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Cambiar NIT" data-cambiar-nit className="card" style={{ width: 'min(560px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="card-head">
          <div>
            <div className="card-title">Cambiar NIT</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{nombre}</div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={busy} title="Cerrar"><I.X size={15} /></button>
        </div>
        <div className="card-pad" style={{ overflowY: 'auto', display: 'grid', gap: 14, fontSize: 13 }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            El NIT es la llave que cruza al cliente con su tarifario, el mapeo de la Agenda, los expedientes y los detalles de facturación. Acá se cambia <strong>en todo de una sola vez</strong>; los montos y lo demás quedan igual.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="cn-actual">NIT actual</label>
              <input id="cn-actual" className="input num" value={nitActual || '(sin NIT)'} readOnly disabled />
            </div>
            <div className="field">
              <label className="label" htmlFor="cn-nuevo">NIT nuevo</label>
              <input id="cn-nuevo" className="input num" value={nitNuevo} onChange={e => { setNitNuevo(e.target.value); setErrorAplicar(null); setForzar(false); }} placeholder="ej. 1234567-8" autoFocus disabled={busy} autoComplete="off" />
              {hint && <div style={{ fontSize: 11.5, color: 'var(--wine)', marginTop: 4 }} data-hint>{hint}</div>}
            </div>
          </div>

          {aceptable && (
            <div data-resumen data-estado={calculando ? 'calculando' : preview ? (preview.ok ? 'ok' : preview.codigo) : 'vacio'} className="card" style={{ background: 'var(--paper-2)', borderColor: choque ? 'var(--wine)' : compartido ? 'var(--burnt, #b5651d)' : undefined }}>
              <div className="card-pad" style={{ display: 'grid', gap: 8 }}>
                {calculando && <div className="cell-mute" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><I.Refresh size={13} /> Calculando qué se movería…</div>}
                {!calculando && preview && (
                  <>
                    {(preview.ok || compartido || choque) && (
                      <>
                        <div className="cell-strong">{preview.ok ? 'Se moverán' : 'Se moverían'} de <span className="num">{nitComparable(nitActual) || '(sin NIT)'}</span> a <span className="num">{comparable}</span>:</div>
                        {filas.length ? (
                          <table className="table" style={{ fontSize: 12.5 }}>
                            <tbody>{filas.map(f => <tr key={f.tabla}><td>{f.tabla}</td><td className="num cell-strong" style={{ textAlign: 'right' }}>{f.n}</td></tr>)}</tbody>
                          </table>
                        ) : <div className="cell-mute">Solo el cliente: no hay tarifas, mapeos ni expedientes en el NIT actual.</div>}
                        {destino && !compartidoCon && <div style={{ fontSize: 12.5 }}>El NIT <span className="num">{comparable}</span> es de <strong>{destino}</strong>: las tarifas y expedientes pasan a ese cliente.</div>}
                      </>
                    )}
                    {compartido && (
                      <div data-compartido style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
                        <div style={{ color: 'var(--burnt, #b5651d)', display: 'flex', gap: 6, alignItems: 'flex-start' }}><I.Alert size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>{preview.error}</span></div>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                          <input type="checkbox" checked={forzar} onChange={e => setForzar(e.target.checked)} data-accion="forzar-compartido" />
                          <span>Entiendo que el NIT quedará compartido con <strong>{preview.compartidoCon}</strong> y quiero cambiarlo igual.</span>
                        </label>
                      </div>
                    )}
                    {preview.ok && compartidoCon && <div data-compartido-aceptado style={{ color: 'var(--burnt, #b5651d)', fontSize: 12.5 }}>El NIT quedará compartido con <strong>{compartidoCon}</strong> (aceptado).</div>}
                    {choque && (
                      <div data-choque style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
                        <div style={{ color: 'var(--wine)', display: 'flex', gap: 6, alignItems: 'flex-start' }}><I.Alert size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span><strong>No se aplica:</strong> {preview.error}</span></div>
                        <table className="table" style={{ fontSize: 12 }}>
                          <thead><tr><th>Tipo de prueba</th><th>Categoría</th><th>Territorio</th><th className="num">Q en {nitComparable(nitActual)}</th><th className="num">Q en {comparable}</th></tr></thead>
                          <tbody>{(preview.choques ?? []).map((c, i) => (
                            <tr key={i}><td>{c.tipoPrueba}</td><td>{c.categoria === 'UNICA' ? '—' : c.categoria}</td><td>{c.territorio === 'UNICA' ? '—' : c.territorio}</td><td className="num">{c.montoViejo.toFixed(2)}</td><td className="num">{c.montoNuevo.toFixed(2)}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                    {otroError && <div style={{ color: 'var(--wine)', fontSize: 12.5 }} data-error>{preview.error}</div>}
                  </>
                )}
              </div>
            </div>
          )}
          {errorAplicar && <div role="alert" style={{ color: 'var(--wine)', fontSize: 12.5 }}>{errorAplicar}</div>}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-3)', display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          <span className="cell-mute" style={{ fontSize: 11.5, marginRight: 'auto' }}>Después del cambio, la cola de la Agenda del cliente se re-resuelve sola.</span>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void aplicar()} disabled={!listo} data-accion="confirmar-cambiar-nit">
            {busy ? <><I.Refresh size={13} /> Cambiando…</> : <><I.Check size={13} /> Cambiar NIT{preview?.ok && comparable ? ` a ${comparable}` : ''}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
