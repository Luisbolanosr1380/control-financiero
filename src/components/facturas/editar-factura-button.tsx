'use client';

/**
 * F-044 — Edición no-contable de facturas.
 *
 * Solo se editan: número de factura, fecha de emisión, observaciones. Campos
 * contables (monto, cliente, IVA, estado) son visibles pero deshabilitados
 * con candado. Para cambiarlos hay que anular + refacturar.
 *
 * Flujo del modal:
 *   1) Edit form: usuario modifica los campos editables.
 *   2) Confirm: muestra resumen "campo: 'antes' → 'después'" antes de pegar.
 *   3) Submit: server action → Airtable update batch (todas las líneas).
 *
 * Auditoría: el server registra Editado_Por / Fecha_Ultima_Edicion /
 * Historial_Ediciones. Si esos campos no existen aún en Airtable (Stark no
 * los creó), result.auditoriaPersistida=false y mostramos warning suave —
 * el cambio funcional ya se aplicó.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { editarFacturaAction } from '@/app/(app)/facturacion/[id]/actions';
import type { Invoice } from '@/lib/types';
import type { EntradaHistorialEdicion } from '@/lib/db/facturas';
import { parsearHistorialEdiciones } from '@/lib/db/facturas';

interface Props {
  factura: Invoice;
  clienteNombre: string;
  subtotal: number;
  iva: number;
  cobrosActivos: number;   // cantidad de cobros activos vinculados — info al usuario
}

export function EditarFacturaButton({ factura, clienteNombre, subtotal, iva, cobrosActivos }: Props) {
  const [open, setOpen] = useState(false);

  // F-044: no editable si la factura está anulada o refacturada.
  const noEditable = factura.estadoBruto === 'anulado' || factura.estadoBruto === 'refacturado';
  if (noEditable) {
    return (
      <button className="btn btn-secondary" disabled title={`Las facturas ${factura.estadoBruto === 'anulado' ? 'anuladas' : 'refacturadas'} no se pueden editar`}>
        <I.Edit size={13} /> Editar
      </button>
    );
  }

  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        <I.Edit size={13} /> Editar
      </button>
      {open && (
        <EditarModal
          factura={factura}
          clienteNombre={clienteNombre}
          subtotal={subtotal}
          iva={iva}
          cobrosActivos={cobrosActivos}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ModalProps {
  factura: Invoice;
  clienteNombre: string;
  subtotal: number;
  iva: number;
  cobrosActivos: number;
  onClose: () => void;
}

type Fase = 'edit' | 'confirm';

function EditarModal({ factura, clienteNombre, subtotal, iva, cobrosActivos, onClose }: ModalProps) {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>('edit');
  const [loading, setLoading] = useState(false);

  // Valores iniciales para comparar deltas.
  const noFacturaInicial = factura.noFactura;
  const fechaEmisionInicial = (factura.fechaEmision ?? '').slice(0, 10);
  // Observaciones no vienen en el Invoice consolidado; arrancamos vacío.
  // El backend NO sobrescribe si el campo no se manda.
  const [noFactura, setNoFactura] = useState(noFacturaInicial);
  const [fechaEmision, setFechaEmision] = useState(fechaEmisionInicial);
  const [observaciones, setObservaciones] = useState('');
  const [observacionesTouched, setObservacionesTouched] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);

  const numeroFirstRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { numeroFirstRef.current?.focus(); }, []);

  // Esc cierra (a menos que esté loading o en fase confirm — ahí cancela vuelve a edit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        if (fase === 'confirm') setFase('edit');
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading, fase]);

  // Lista de cambios para confirm/log.
  const cambios = useMemo(() => {
    const r: Array<{ campo: string; antes: string; despues: string; etiqueta: string }> = [];
    if (noFactura.trim() !== noFacturaInicial) {
      r.push({ campo: 'numeroFactura', etiqueta: 'Número de factura', antes: noFacturaInicial, despues: noFactura.trim() });
    }
    if (fechaEmision !== fechaEmisionInicial) {
      r.push({ campo: 'fechaEmision', etiqueta: 'Fecha de emisión', antes: formatearFecha(fechaEmisionInicial), despues: formatearFecha(fechaEmision) });
    }
    if (observacionesTouched) {
      r.push({ campo: 'observaciones', etiqueta: 'Observaciones', antes: '(actuales)', despues: observaciones.trim() || '(vacío)' });
    }
    return r;
  }, [noFactura, fechaEmision, observaciones, observacionesTouched, noFacturaInicial, fechaEmisionInicial]);

  // Validaciones cliente-side (PARTE D).
  const validaciones = useMemo(() => {
    const errores: string[] = [];
    const warnings: string[] = [];

    if (noFactura.trim().length === 0) errores.push('El número de factura no puede quedar vacío.');

    if (fechaEmision) {
      // Fecha futura
      const hoy = new Date();
      const fechaParsed = new Date(`${fechaEmision}T12:00:00`);
      if (fechaParsed.getTime() > hoy.getTime()) {
        errores.push('La fecha de emisión no puede ser futura.');
      }
      // Cambio de mes — warning solo si la fecha cambió
      if (fechaEmision !== fechaEmisionInicial && fechaEmisionInicial) {
        const [yA, mA] = fechaEmisionInicial.split('-');
        const [yN, mN] = fechaEmision.split('-');
        if (yA !== yN || mA !== mN) {
          warnings.push('Estás cambiando la fecha a otro mes contable. Verificá que sea correcto.');
        }
      }
    }
    return { errores, warnings };
  }, [noFactura, fechaEmision, fechaEmisionInicial]);

  const puedeGuardar = cambios.length > 0 && validaciones.errores.length === 0 && !loading;

  const historial: EntradaHistorialEdicion[] = useMemo(
    () => parsearHistorialEdiciones(factura.historialEdiciones),
    [factura.historialEdiciones],
  );

  if (typeof document === 'undefined') return null;

  const submit = async () => {
    setLoading(true);
    try {
      const payload: Parameters<typeof editarFacturaAction>[1] = {};
      if (noFactura.trim() !== noFacturaInicial)               payload.numeroFactura = noFactura.trim();
      if (fechaEmision !== fechaEmisionInicial)                payload.fechaEmision  = fechaEmision;
      if (observacionesTouched)                                payload.observaciones = observaciones.trim();

      const res = await editarFacturaAction(factura.id, payload);
      if (res.ok) {
        const msgAudit = res.auditoriaPersistida
          ? ''
          : ' (auditoría no persistida — agregá los campos Editado_Por / Fecha_Ultima_Edicion / Historial_Ediciones en Airtable)';
        toast.success(`Factura actualizada · ${res.recordsActualizados}/${res.recordsTotal} líneas${msgAudit}`, {
          duration: res.auditoriaPersistida ? 4000 : 8000,
        });
        onClose();
        router.refresh();
      } else if (res.duplicado) {
        toast.error(res.error ?? 'Número de factura duplicado.', { duration: 8000 });
      } else {
        toast.error(res.error ?? 'No se pudo guardar la edición.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red al editar.');
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
          width: 'min(640px, 94vw)', maxHeight: '92vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Edit size={15} style={{ color: 'var(--ink-2)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {fase === 'edit' ? <>Editar factura <span className="num">{noFacturaInicial}</span> · {clienteNombre}</> : <>Confirmar cambios</>}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          {fase === 'edit' ? (
            <>
              <div style={{
                padding: '10px 14px', marginBottom: 16,
                border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5,
              }}>
                ⚠️ Solo se pueden editar campos NO contables. Para corregir monto, cliente o IVA tenés que <strong>anular esta factura y emitir una nueva</strong>.
              </div>

              {cobrosActivos > 0 && (
                <div style={{ padding: '8px 12px', marginBottom: 14, fontSize: 11.5, color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line-3)', borderRadius: 4 }}>
                  ℹ️ Esta factura tiene <strong>{cobrosActivos} cobro{cobrosActivos === 1 ? '' : 's'} activo{cobrosActivos === 1 ? '' : 's'}</strong>. Los cobros se vinculan por record ID, no por número — las ediciones no los afectan.
                </div>
              )}

              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label" htmlFor="ef-numero">Número de factura</label>
                <input
                  id="ef-numero"
                  ref={numeroFirstRef}
                  type="text"
                  className="input"
                  value={noFactura}
                  onChange={(e) => setNoFactura(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label" htmlFor="ef-fecha">Fecha de emisión</label>
                <input
                  id="ef-fecha"
                  type="date"
                  className="input"
                  value={fechaEmision}
                  onChange={(e) => setFechaEmision(e.target.value)}
                  disabled={loading}
                />
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                  La fecha de vencimiento se recalcula automáticamente desde días de crédito del cliente.
                </div>
              </div>

              <div className="field" style={{ marginBottom: 18 }}>
                <label className="label" htmlFor="ef-obs">Observaciones (opcional)</label>
                <textarea
                  id="ef-obs"
                  className="input"
                  rows={3}
                  placeholder="Notas internas, referencias, etc."
                  value={observaciones}
                  onChange={(e) => { setObservaciones(e.target.value); setObservacionesTouched(true); }}
                  disabled={loading}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                  Sobrescribe el campo Observaciones: en Airtable solo si lo modificás.
                </div>
              </div>

              {/* Campos NO editables — visibles con candado */}
              <div style={{
                padding: 12, marginBottom: 14,
                border: '1px dashed var(--line-2)', borderRadius: 'var(--r-2)',
                background: 'var(--paper-2)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
                  🔒 No editable — anular + refacturar
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <Bloqueado label="Cliente"  valor={clienteNombre} />
                  <Bloqueado label="Estado"   valor={factura.estadoBruto.replace(/_/g, ' ')} />
                  <Bloqueado label="Subtotal" valor={Q(subtotal)} />
                  <Bloqueado label="IVA"      valor={Q(iva)} />
                  <Bloqueado label="Total"    valor={Q(factura.total)} />
                </div>
              </div>

              {/* Warnings/errors validación cliente */}
              {validaciones.errores.length > 0 && (
                <div style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: 'var(--wine)', background: '#F5E2DD', border: '1px solid var(--wine)', borderRadius: 4 }}>
                  {validaciones.errores.map(e => <div key={e}>⛔ {e}</div>)}
                </div>
              )}
              {validaciones.warnings.length > 0 && (
                <div style={{ padding: '8px 12px', marginBottom: 10, fontSize: 12, color: 'var(--ink-2)', background: '#FBF1DC', border: '1px solid var(--warn)', borderRadius: 4 }}>
                  {validaciones.warnings.map(w => <div key={w}>⚠️ {w}</div>)}
                </div>
              )}

              {/* Historial collapsible */}
              <div style={{ marginTop: 6, borderTop: '1px solid var(--line-3)', paddingTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setHistorialOpen(o => !o)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <span style={{ transform: historialOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', display: 'inline-block' }}>▸</span>
                  Historial de ediciones {historial.length > 0 && <span style={{ color: 'var(--ink-4)' }}>({historial.length})</span>}
                </button>
                {historialOpen && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--paper-2)', borderRadius: 4, border: '1px solid var(--line-3)' }}>
                    {historial.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Esta factura no ha sido editada.</div>
                    ) : (
                      historial.map((h, i) => (
                        <div key={i} style={{ fontSize: 11.5, color: 'var(--ink-2)', padding: '4px 0', borderBottom: i < historial.length - 1 ? '1px solid var(--line-3)' : 'none' }}>
                          <div style={{ color: 'var(--ink-4)' }}>{h.fecha} · {h.usuario}</div>
                          <div>{h.cambios}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            // Fase confirm
            <>
              <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 14px' }}>
                Vas a aplicar estos cambios:
              </p>
              <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line-3)', borderRadius: 4, padding: 12, marginBottom: 12 }}>
                {cambios.map(c => (
                  <div key={c.campo} style={{ fontSize: 12.5, color: 'var(--ink)', padding: '4px 0' }}>
                    <strong>{c.etiqueta}:</strong>{' '}
                    <span style={{ color: 'var(--ink-4)' }}>{c.antes}</span>
                    {' → '}
                    <span style={{ color: 'var(--olive)' }}>{c.despues}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Esta acción queda registrada en el historial con tu email y la fecha.
                {factura.lineas.length > 1 && (
                  <> Se actualizan <strong>{factura.lineas.length} líneas</strong> del mismo NO.FACTURA.</>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {fase === 'edit' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setFase('confirm')}
                disabled={!puedeGuardar}
                title={cambios.length === 0 ? 'No hay cambios' : undefined}
              >
                Guardar cambios
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setFase('edit')} disabled={loading}>Volver</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={loading}>
                {loading ? <><I.Refresh size={13} /> Guardando…</> : <>Confirmar cambios</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Bloqueado({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>🔒 {label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{valor}</div>
    </div>
  );
}
