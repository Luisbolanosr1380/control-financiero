'use client';

/**
 * PRECIO ESPECIAL POR PRUEBA (037): el lápiz de la línea, el modal y cómo se ve una línea ajustada.
 *
 * El modal pide el monto con un selector SIN IVA / CON IVA (con IVA → se guarda round(x / 1.12, 2) y se muestra el
 * precio con IVA que resulta, para confirmar que cuadra: 274.40 → 245.00 → 274.40) y el motivo, obligatorio, con
 * sugerencias. «Mostrar el motivo al cliente» decide si sale en el PDF y en el link (los internos no salen).
 * La línea muestra la tarifa tachada, el precio nuevo y el badge «Precio especial» con el motivo en el `title`.
 * Sin diálogos del navegador. Permiso: quien llama decide si muestra el lápiz (facturar_agenda = admin y contador);
 * la acción del servidor vuelve a validar.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { precioConIva } from '@/lib/tarifario/canon';
import { MOTIVOS_PRECIO_ESPECIAL, motivoEsDeCliente, montoSinIvaDe } from '@/lib/facturacion-agenda/tipos';
import { ajustarPrecioPruebaAction } from '@/app/(app)/por-facturar/actions';

export interface PruebaPrecioEspecial {
  componenteId: string; persona: string; servicio: string;
  /** Tarifa sin IVA (monto_calculado). */
  montoTarifa: number;
  /** El precio especial vigente, si lo tiene. */
  actual: { monto: number; motivo: string; cliente: boolean } | null;
  /** La prueba está en un detalle ya enviado: al guardar sube de versión y hay que reenviarlo. */
  enDetalleEnviado?: boolean;
}

/** Lápiz «Precio especial» de la línea. */
export function PrecioEspecialBoton({ onClick, disabled, tiene }: { onClick: () => void; disabled?: boolean; tiene: boolean }) {
  return (
    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 5px', marginLeft: 4, verticalAlign: 'middle' }} onClick={onClick} disabled={disabled}
      aria-label="Precio especial" title={tiene ? 'Cambiar o quitar el precio especial' : 'Precio especial: cobrar esta prueba distinto a la tarifa, con motivo'} data-accion="precio-especial">
      <I.Edit size={12} />
    </button>
  );
}

/** Monto de una línea ajustada: tarifa tachada, precio nuevo y badge con el motivo en el title. */
export function PrecioEspecialMonto({ tarifa, nuevo, motivo, cliente, conBadge = true }: { tarifa: number; nuevo: number; motivo: string; cliente?: boolean; conBadge?: boolean }) {
  return (
    <span data-precio-especial={nuevo} data-precio-tarifa={tarifa} style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <s className="cell-mute" style={{ fontSize: 11 }} title="Tarifa">{Q(tarifa)}</s>
      <span className="cell-strong">{Q(nuevo)}</span>
      {conBadge && <span className="badge badge-warn" style={{ fontSize: 9 }} title={`${motivo || 'Precio especial'}${cliente === undefined ? '' : cliente ? ' · el motivo se le muestra al cliente' : ' · motivo interno'}`} data-badge-precio-especial>Precio especial</span>}
    </span>
  );
}

export function PrecioEspecialDialogo({ prueba, onClose, onHecho }: { prueba: PruebaPrecioEspecial; onClose: () => void; onHecho: (r: { reenviar: boolean; quitado: boolean }) => void }) {
  const [base, setBase] = useState<'sin_iva' | 'con_iva'>('con_iva');
  const [texto, setTexto] = useState(prueba.actual ? String(precioConIva(prueba.actual.monto).toFixed(2)) : '');
  const [motivo, setMotivo] = useState(prueba.actual?.motivo ?? '');
  const [cliente, setCliente] = useState(prueba.actual ? prueba.actual.cliente : false);
  const [clienteTocado, setClienteTocado] = useState(!!prueba.actual);
  const [busy, setBusy] = useState(false);
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const numero = Number(texto.replace(/[Qq\s,]/g, ''));
  const montoOk = texto.trim() !== '' && Number.isFinite(numero) && numero > 0;
  const sinIva = montoOk ? montoSinIvaDe(numero, base) : 0;
  const conIva = montoOk ? precioConIva(sinIva) : 0;
  // con IVA: el precio que resulta puede no ser exactamente el escrito (el sin IVA se guarda a 2 decimales)
  const cuadra = base === 'sin_iva' || Math.abs(conIva - Math.round(numero * 100) / 100) < 0.005;
  const motivoOk = motivo.trim().length >= 3;
  const igualTarifa = montoOk && Math.abs(sinIva - prueba.montoTarifa) < 0.005;
  const elegirMotivo = (m: string) => { setMotivo(m); if (!clienteTocado) setCliente(motivoEsDeCliente(m)); };
  const cambiarBase = (b: 'sin_iva' | 'con_iva') => { if (b === base) return; if (montoOk) setTexto((b === 'con_iva' ? precioConIva(sinIva) : sinIva).toFixed(2)); setBase(b); };

  const guardar = async (quitar: boolean) => {
    setBusy(true);
    try {
      const r = await ajustarPrecioPruebaAction(prueba.componenteId, quitar ? { monto: null } : { monto: numero, base, motivo: motivo.trim(), motivoCliente: cliente });
      if (!r.ok) { toast.error(r.error); return; }
      const sufijo = r.reenviar ? ` · el detalle ${r.detalle?.correlativo ?? ''} cambió después de enviado (versión ${r.detalle?.version ?? ''}): reenvialo al cliente` : r.detalle ? ` · ${r.detalle.correlativo}: total ${Q(r.detalle.total)} con IVA` : '';
      if (r.sinCambio) toast.message('Sin cambios: la prueba ya tenía ese precio y ese motivo.');
      else if (quitar) toast.success(`Precio especial quitado: ${prueba.persona} vuelve a la tarifa (${Q(prueba.montoTarifa)} sin IVA)${sufijo}`);
      else toast.success(`Precio especial guardado: ${Q(r.montoNuevo ?? sinIva)} sin IVA · ${Q(precioConIva(r.montoNuevo ?? sinIva))} con IVA${sufijo}`);
      onHecho({ reenviar: r.reenviar, quitado: quitar });
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error de red'); }
    finally { setBusy(false); }
  };

  if (!montado) return null;
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Precio especial" onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div className="card" style={{ maxWidth: 560, width: '100%', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()} data-dialogo-precio-especial={prueba.componenteId}>
        <div className="card-head"><div className="card-title">Precio especial</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>solo esta prueba · el sync no lo pisa</span></div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 12, fontSize: 13 }}>
          <div>
            <strong>{prueba.persona}</strong> · {prueba.servicio}
            <div className="cell-mute" style={{ fontSize: 12 }} data-tarifa={prueba.montoTarifa}>Tarifa: {Q(prueba.montoTarifa)} sin IVA · {Q(precioConIva(prueba.montoTarifa))} con IVA{prueba.actual ? <> · hoy con precio especial de <strong>{Q(prueba.actual.monto)}</strong> sin IVA</> : null}</div>
          </div>
          {prueba.enDetalleEnviado && <div role="status" style={{ color: 'var(--wine)', fontSize: 12.5 }} data-aviso-reenviar>El detalle <strong>ya se envió</strong> al cliente: al guardar se recalcula el total, sube la versión y el link que tiene deja de servir. Hay que <strong>reenviarlo</strong>.</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: 4, flex: 1, minWidth: 160 }}>Monto a cobrar (Q)
              <input className="input num" inputMode="decimal" value={texto} onChange={e => setTexto(e.target.value)} placeholder="274.40" aria-label="Monto a cobrar" autoFocus disabled={busy} data-campo="monto" />
            </label>
            <div role="radiogroup" aria-label="El monto es" style={{ display: 'inline-flex', gap: 4 }} data-selector-iva={base}>
              <button type="button" role="radio" aria-checked={base === 'con_iva'} className={'btn ' + (base === 'con_iva' ? 'btn-secondary' : 'btn-ghost')} onClick={() => cambiarBase('con_iva')} disabled={busy} data-base="con_iva">Con IVA</button>
              <button type="button" role="radio" aria-checked={base === 'sin_iva'} className={'btn ' + (base === 'sin_iva' ? 'btn-secondary' : 'btn-ghost')} onClick={() => cambiarBase('sin_iva')} disabled={busy} data-base="sin_iva">Sin IVA</button>
            </div>
          </div>
          <div className="card" style={{ background: 'var(--bg-2)' }} data-resultado-precio data-sin-iva={montoOk ? sinIva : ''} data-con-iva={montoOk ? conIva : ''}>
            <div className="card-pad num" style={{ fontSize: 12.5 }}>
              {montoOk
                ? <>Se guarda <strong>{Q(sinIva)}</strong> sin IVA → en el detalle y la factura la línea sale en <strong>{Q(conIva)}</strong> con IVA.
                    {!cuadra && <div style={{ color: 'var(--wine)', marginTop: 2 }} data-no-cuadra>No cuadra al centavo con {Q(numero)}: el precio con IVA que resulta es {Q(conIva)}.</div>}
                    {igualTarifa && <div className="cell-mute" style={{ marginTop: 2 }}>Es igual a la tarifa: no hace falta un precio especial.</div>}</>
                : <span className="cell-mute">Escribí el monto para ver cómo queda sin IVA y con IVA.</span>}
            </div>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>Motivo (obligatorio)
            <input className="input" value={motivo} onChange={e => elegirMotivo(e.target.value)} maxLength={300} placeholder="Por qué se cobra distinto a la tarifa" aria-label="Motivo" disabled={busy} data-campo="motivo" />
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-sugerencias-motivo>
            {MOTIVOS_PRECIO_ESPECIAL.map(m => <button key={m.texto} type="button" className={'btn ' + (motivo === m.texto ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => elegirMotivo(m.texto)} disabled={busy} data-sugerencia={m.texto}>{m.texto}</button>)}
          </div>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={cliente} onChange={e => { setCliente(e.target.checked); setClienteTocado(true); }} disabled={busy} data-campo="motivo-cliente" style={{ marginTop: 3 }} />
            <span>Mostrar el motivo al cliente<span className="cell-mute" style={{ display: 'block', fontSize: 11.5 }}>Sale en Observaciones del PDF y en el link. Sin marcar, el motivo es interno: el cliente ve el precio, no el porqué.</span></span>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {prueba.actual && <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => void guardar(true)} disabled={busy} data-accion="quitar-precio-especial" title={`Vuelve a la tarifa: ${Q(prueba.montoTarifa)} sin IVA`}>Quitar precio especial</button>}
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar(false)} disabled={busy || !montoOk || !motivoOk || igualTarifa} data-accion="guardar-precio-especial"><I.Check size={13} /> {busy ? 'Guardando…' : 'Guardar precio especial'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
