'use client';

/**
 * FACTORAJE — pantalla (escritorio). Izquierda: factorajes por financiador.
 * Derecha: el factoraje elegido con sus facturas cedidas y acciones.
 * Los botones siguen al rol (usePuede); el servidor revalida cada acción.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { usePuede } from '@/components/auth/permisos';
import { DeudaFormModal } from '@/components/deudas/deuda-form-modal';
import type { Acreedor } from '@/lib/db/deudas';
import type { Cesion, EstadoCesion, Factoraje } from '@/lib/db/factoraje';
import type { AsientoFactorajePreview } from '@/lib/factoraje/asiento-config';
import { cambiarEstadoCesionAction, contabilizarFactorajeAction, previewAsientoFactorajeAction } from '@/app/(app)/factoraje/actions';
import { ModalCederFacturas } from './modal-ceder-facturas';

interface Props {
  disponible: boolean;
  factorajes: Factoraje[];
  seleccionadoId: string | null;
  acreedores: Acreedor[];
  centros: Array<{ id: string; nombre: string }>;
  asientoHabilitado: boolean;
}

const ESTADO_CLS: Record<EstadoCesion, string> = { Cedida: 'badge-warn', Liberada: 'badge-mute', Recomprada: 'badge-outline', Pagada: 'badge-olive' };
const fmtFecha = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—');
const pct = (x: number) => (x ? `${(x * 100).toFixed(2)}%` : '—');

export function FactorajeClient({ disponible, factorajes, seleccionadoId, acreedores, centros, asientoHabilitado }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const puedeGestionar = puede('factoraje');
  const puedeCeder = puede('ceder_factura');

  const [sel, setSel] = useState<string | null>(seleccionadoId ?? factorajes[0]?.id ?? null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [modal, setModal] = useState<'nuevo' | 'ceder' | null>(null);
  const [preview, setPreview] = useState<AsientoFactorajePreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filtroFin, setFiltroFin] = useState('');

  const fact = factorajes.find(f => f.id === sel) ?? null;
  const financiadores = useMemo(() => [...new Set(factorajes.map(f => f.financiador))].sort(), [factorajes]);
  const lista = factorajes.filter(f => !filtroFin || f.financiador === filtroFin);
  const totales = useMemo(() => ({
    activos: factorajes.filter(f => f.numCedidas > 0).length,
    cedido: factorajes.reduce((s, f) => s + f.totalCedidoActivo, 0),
    adelantado: factorajes.reduce((s, f) => s + f.montoOriginal, 0),
    saldo: factorajes.reduce((s, f) => s + f.saldoPendiente, 0),
  }), [factorajes]);

  const correr = async (key: string, fn: () => Promise<{ ok: true; mensaje: string } | { ok: false; error: string }>) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) { toast.success(r.mensaje); router.refresh(); } else toast.error(r.error);
    } finally { setBusy(null); }
  };

  const cambiar = (c: Cesion, estado: Exclude<EstadoCesion, 'Cedida'>) => {
    const txt = { Liberada: 'Liberar (vuelve a estar disponible para ceder)', Recomprada: 'Marcar como recomprada al financiador', Pagada: 'Marcar como pagada (el cliente pagó al financiador)' }[estado];
    const nota = window.prompt(`${txt} — factura ${c.noFactura} (${Q(c.montoCedido)}).\nNota (opcional):`);
    if (nota === null) return;
    correr(c.id, () => cambiarEstadoCesionAction({ cesionId: c.id, estado, nota }));
  };

  const verAsiento = async () => {
    if (!fact) return;
    const r = await previewAsientoFactorajeAction(fact.id);
    if (r.ok) setPreview(r.preview); else toast.error(r.error);
  };

  const cesionesVisibles = fact ? fact.cesiones.filter(c => verHistorial || c.estado === 'Cedida') : [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Factoraje</h1>
          <div className="page-subtitle">Facturas cedidas a financiadores: con quién, cuánto, a qué plazo y con qué términos. Una factura cedida no puede cederse dos veces.</div>
        </div>
        <div className="page-actions">
          {puedeGestionar && disponible && (
            <button className="btn btn-primary" onClick={() => setModal('nuevo')}><I.Plus size={13} /> Nuevo factoraje</button>
          )}
        </div>
      </div>

      {!disponible && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>010_factoraje_facturas</strong> en esta base.</div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Factorajes</div><div className="kpi-value" style={{ fontSize: 20 }}>{factorajes.length}</div><div className="kpi-delta"><span className="vs">{totales.activos} con facturas cedidas</span></div></div>
        <div className="kpi"><div className="kpi-label">Cartera cedida (activa)</div><div className="kpi-value" style={{ fontSize: 20 }}>{Q(totales.cedido)}</div><div className="kpi-delta"><span className="vs">no suma al por cobrar propio</span></div></div>
        <div className="kpi"><div className="kpi-label">Monto financiado</div><div className="kpi-value" style={{ fontSize: 20 }}>{Q(totales.adelantado)}</div></div>
        <div className="kpi"><div className="kpi-label">Saldo con financiadores</div><div className="kpi-value" style={{ fontSize: 20 }}>{Q(totales.saldo)}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Lista */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Factorajes</div>
            <div className="card-actions">
              <select className="input" style={{ fontSize: 12, padding: '3px 6px' }} value={filtroFin} onChange={e => setFiltroFin(e.target.value)}>
                <option value="">Todos los financiadores</option>
                {financiadores.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          {lista.length === 0 ? (
            <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 28, fontSize: 12.5 }}>
              Sin factorajes{filtroFin ? ' de ese financiador' : ''}. {puedeGestionar ? 'Creá uno con "Nuevo factoraje".' : ''}
            </div>
          ) : lista.map(f => (
            <div key={f.id} className="clickable" onClick={() => { setSel(f.id); setPreview(null); setVerHistorial(false); }}
              style={{ padding: '10px 16px', borderTop: '1px solid var(--line-3)', background: f.id === sel ? 'var(--olive-bg)' : undefined, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{f.financiador}</div>
                <span className={'badge ' + (f.estadoDeuda === 'Vencida' ? 'badge-wine' : 'badge-outline')} style={{ fontSize: 10 }}>{f.estadoDeuda || '—'}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{f.nombre || 'Sin nombre'} · {f.conRecurso ? 'con recurso' : 'sin recurso'} · vence {fmtFecha(f.fechaVencimiento)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginTop: 3 }}>
                <span className="num">Financiado {Q(f.montoOriginal)}</span>
                <span className="num" style={{ color: f.numCedidas ? 'var(--ink)' : 'var(--ink-4)' }}>{f.numCedidas} factura(s) · {Q(f.totalCedidoActivo)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Detalle */}
        <div className="card">
          {!fact ? (
            <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 40 }}>Elegí un factoraje.</div>
          ) : (
            <>
              <div className="card-head">
                <div className="card-title">{fact.financiador} · {fact.nombre || 'Factoraje'}</div>
                <div className="card-actions" style={{ display: 'flex', gap: 6 }}>
                  <a className="btn btn-ghost" style={{ fontSize: 12 }} href={`/deudas/${fact.id}`}>Ver deuda</a>
                  {puedeGestionar && <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={verAsiento}>Ver asiento propuesto</button>}
                  {puedeCeder && <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => setModal('ceder')}><I.Plus size={12} /> Ceder facturas</button>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', borderBottom: '1px solid var(--line-3)' }}>
                {[
                  ['Financiado', Q(fact.montoOriginal)], ['Saldo', Q(fact.saldoPendiente)], ['Reserva', pct(fact.reservaPct)],
                  ['Comisión', pct(fact.comisionPct)], ['Interés anual', pct(fact.interesPct)], ['Vence', `${fmtFecha(fact.fechaVencimiento)}${fact.plazoDias ? ` · ${fact.plazoDias} d` : ''}`],
                ].map(([l, v]) => (
                  <div key={l} style={{ padding: '10px 14px', borderRight: '1px solid var(--line-3)' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                    <div className="num" style={{ fontSize: 14, fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
                <span>{fact.numCedidas} factura(s) cedida(s) · {Q(fact.totalCedidoActivo)} · {fact.conRecurso ? 'Con recurso: si el cliente no paga, respondemos nosotros.' : 'Sin recurso: el riesgo de no pago lo asume el financiador.'}</span>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={verHistorial} onChange={e => setVerHistorial(e.target.checked)} /> ver historial</label>
              </div>
              <table className="table">
                <thead><tr><th>Factura</th><th>Cliente</th><th style={{ width: 95 }}>Cedida el</th><th className="num" style={{ width: 120 }}>Monto cedido</th><th style={{ width: 100 }}>Estado</th><th style={{ width: 230 }}></th></tr></thead>
                <tbody>
                  {cesionesVisibles.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>Sin facturas cedidas{verHistorial ? '' : ' activas'}.</td></tr>}
                  {cesionesVisibles.map(c => (
                    <tr key={c.id} style={{ opacity: c.estado === 'Cedida' ? 1 : 0.65 }}>
                      <td><a href={`/facturacion/${c.facturaAppId}`} className="num cell-strong">{c.noFactura}</a>{c.nota && <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{c.nota}</div>}</td>
                      <td style={{ fontSize: 12.5 }}>{c.cliente}</td>
                      <td className="num">{fmtFecha(c.fechaCesion)}</td>
                      <td className="num cell-strong">{Q(c.montoCedido)}<div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>de {Q(c.totalFactura)}</div></td>
                      <td><span className={'badge ' + ESTADO_CLS[c.estado]}>{c.estado}</span>{c.estadoPor && c.estado !== 'Cedida' && <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>{fmtFecha((c.estadoEn ?? '').slice(0, 10))}</div>}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {c.estado === 'Cedida' && (puedeGestionar ? (
                          <>
                            <button className="btn btn-ghost" style={{ fontSize: 11.5 }} disabled={busy === c.id} onClick={() => cambiar(c, 'Pagada')}>Pagada</button>
                            <button className="btn btn-ghost" style={{ fontSize: 11.5 }} disabled={busy === c.id} onClick={() => cambiar(c, 'Recomprada')}>Recomprar</button>
                            <button className="btn btn-ghost" style={{ fontSize: 11.5, color: 'var(--wine)' }} disabled={busy === c.id} onClick={() => cambiar(c, 'Liberada')}>Liberar</button>
                          </>
                        ) : <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>🔒 Contador/Admin</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {preview && (
                <div style={{ borderTop: '1px solid var(--line-3)', padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Asiento propuesto del adelanto · {preview.tipo === 'con_recurso' ? 'con recurso' : 'sin recurso'}</div>
                    <span className={'badge ' + (asientoHabilitado ? 'badge-olive' : 'badge-warn')}>{asientoHabilitado ? 'Generación habilitada' : 'Apagado — pendiente de validación del contador'}</span>
                  </div>
                  <table className="table">
                    <thead><tr><th style={{ width: 90 }}>Cuenta</th><th>Descripción</th><th className="num" style={{ width: 120 }}>Debe</th><th className="num" style={{ width: 120 }}>Haber</th></tr></thead>
                    <tbody>
                      {preview.partidas.map((p, i) => <tr key={i}><td className="num">{p.cuentaCodigo}</td><td style={{ fontSize: 12.5 }}>{p.descripcion}</td><td className="num">{p.debe ? Q(p.debe) : ''}</td><td className="num">{p.haber ? Q(p.haber) : ''}</td></tr>)}
                      <tr><td></td><td style={{ fontWeight: 600 }}>Total {preview.balanceado ? '✓ balanceado' : '✗ NO balanceado'}</td><td className="num" style={{ fontWeight: 600 }}>{Q(preview.totalDebe)}</td><td className="num" style={{ fontWeight: 600 }}>{Q(preview.totalHaber)}</td></tr>
                    </tbody>
                  </table>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>{preview.nota}</div>
                  {puedeGestionar && (
                    <button className="btn btn-secondary" style={{ marginTop: 8, fontSize: 12 }} disabled={busy === 'asiento'} onClick={() => correr('asiento', () => contabilizarFactorajeAction(fact.id))}>
                      Contabilizar adelanto
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {modal === 'nuevo' && (
        <DeudaFormModal
          acreedores={acreedores} centros={centros} modo="crear" tipoInicial="Factoraje"
          onClose={() => setModal(null)}
          onCreado={(id) => { setModal(null); router.push(`/factoraje?f=${encodeURIComponent(id)}`); router.refresh(); }}
        />
      )}
      {modal === 'ceder' && fact && (
        <ModalCederFacturas factoraje={fact} onClose={() => setModal(null)} onListo={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}
