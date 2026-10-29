'use client';

/**
 * POR FACTURAR · DETALLE de un cliente: sus expedientes (persona solo para
 * identificar, servicio, categoría, territorio, precio resuelto o su estado),
 * filtros por mes de ingreso y estado de cobro, selección → "Facturar" con el
 * número y la fecha reales de SAT/FEL (los emite el auxiliar, no el sistema), y
 * "Mapear" cuando la empresa de la Agenda no apunta a un cliente de financiero.
 * Confirmaciones en línea / modal propio: sin diálogos del navegador.
 */
import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { emitirFacturaAgendaAction, mapearClienteAction, marcarNoFacturaAction, quitarNoFacturaAction } from '@/app/(app)/por-facturar/actions';
import { armarFactura, centroPorServicio, enCola, facturable } from '@/lib/facturacion-agenda/mapeo';
import { filtrarExpedientes, mesesDisponibles, type FiltroCobro } from '@/lib/facturacion-agenda/resumen';
import { ETIQUETA_ESTADO_TARIFA, ETIQUETA_WRITEBACK, type ExpedienteLocal, type WritebackEstado } from '@/lib/facturacion-agenda/tipos';
import type { GrupoDetalle } from '@/lib/db/facturacion-agenda';
import { ReintentarWritebackButton } from './reintentar-writeback-button';

interface Props { datos: GrupoDetalle; writeback: boolean; configurada: boolean; montoModo: 'con_iva' | 'sin_iva' }

const WB_BADGE: Record<WritebackEstado, string> = { confirmado: 'badge-olive', omitido: 'badge-mute', pendiente: 'badge-warn', conflicto: 'badge-wine', error: 'badge-wine' };
const WB_TEXTO: Record<WritebackEstado, string> = { confirmado: 'En Agenda', omitido: 'Sin enviar', pendiente: 'Falta confirmar', conflicto: 'Conflicto', error: 'Error' };

export function GrupoDetalleView({ datos, writeback, configurada, montoModo }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const puedeFacturar = puede('facturar_agenda');
  const [mes, setMes] = useState('');
  const [cobro, setCobro] = useState<FiltroCobro>('por_facturar');
  const [soloListos, setSoloListos] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState(false);
  const [ultima, setUltima] = useState<{ noFactura: string; facturaAppId: string; total: number; writeback: { estado: WritebackEstado; detalle: string } } | null>(null);

  const exps = datos.expedientes;
  const meses = useMemo(() => mesesDisponibles(exps), [exps]);
  const filas = useMemo(() => filtrarExpedientes(exps, { mes: mes || undefined, cobro, soloListos }), [exps, mes, cobro, soloListos]);
  const listos = exps.filter(facturable);
  const totalListo = Math.round(listos.reduce((s, e) => s + (e.montoCalculado ?? 0), 0) * 100) / 100;
  const sinTarifa = exps.filter(e => enCola(e) && e.estadoTarifa === 'sin_tarifa').length;
  const sinMapear = exps.filter(e => enCola(e) && e.estadoTarifa === 'cliente_sin_mapear').length;
  const facturados = exps.filter(e => e.facturaId).length;
  const seleccion = exps.filter(e => sel.has(e.idExterno) && facturable(e));
  const preview = useMemo(() => armarFactura(seleccion, t => centroPorServicio(t, datos.centros)), [seleccion, datos.centros]);
  const facturablesVisibles = filas.filter(facturable);
  const todosSel = facturablesVisibles.length > 0 && facturablesVisibles.every(e => sel.has(e.idExterno));

  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleTodos = () => setSel(s => { const n = new Set(s); if (todosSel) facturablesVisibles.forEach(e => n.delete(e.idExterno)); else facturablesVisibles.forEach(e => n.add(e.idExterno)); return n; });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href="/por-facturar" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Por facturar</Link></div>
          <h1 className="page-title">{datos.nombre || datos.nombreExterno || 'Cliente'}</h1>
          <div className="page-subtitle">
            {datos.nit ? <><span className="num">NIT {datos.nit}</span>{datos.nombreExterno && datos.nombreExterno !== datos.nombre ? <> · en la Agenda: <strong>{datos.nombreExterno}</strong></> : null}</> : <>Empresa de la Agenda <strong>{datos.nombreExterno || datos.empresaIdExterno}</strong> · {datos.noFactura ? <span style={{ color: 'var(--ink-3)' }}>marcada como <strong>no se factura</strong> por este flujo</span> : <span style={{ color: 'var(--wine)' }}>sin mapear a un cliente de financiero</span>}</>}
            {' '}· precios <strong>sin IVA</strong> del tarifario.
          </div>
        </div>
        <div className="page-actions">
          {datos.nit && <Link href={`/tarifario/${encodeURIComponent(datos.nit)}`} className="btn btn-ghost"><I.Coins size={13} /> Tarifario del cliente</Link>}
        </div>
      </div>

      {datos.noFactura && <NoFacturaBanner datos={datos} puede={puedeFacturar} />}
      {!datos.nit && !datos.noFactura && puedeFacturar && <MapearCliente datos={datos} />}
      {!datos.nit && !datos.noFactura && !puedeFacturar && <div className="card" role="status" style={{ borderColor: 'var(--wine)', marginBottom: 14 }}><div className="card-pad" style={{ fontSize: 13 }}>Esta empresa de la Agenda todavía no está mapeada a un cliente: un admin o contador tiene que mapearla antes de facturar.</div></div>}

      {ultima && (
        <div className="card" role="status" data-resultado="factura" style={{ borderColor: ultima.writeback.estado === 'confirmado' || ultima.writeback.estado === 'omitido' ? 'var(--olive)' : 'var(--wine)', marginBottom: 14 }}>
          <div className="card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 260, lineHeight: 1.45 }}>
              <strong>Factura {ultima.noFactura}</strong> registrada en financiero por {Q(ultima.total)} con IVA. <span className={'badge ' + WB_BADGE[ultima.writeback.estado]} style={{ fontSize: 10, marginLeft: 4 }}>{WB_TEXTO[ultima.writeback.estado]}</span>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{ultima.writeback.detalle}</div>
            </div>
            <Link href={`/facturacion/${ultima.facturaAppId}`} className="btn btn-secondary"><I.Receipt size={13} /> Ver factura</Link>
            {['pendiente', 'conflicto', 'error'].includes(ultima.writeback.estado) && <ReintentarWritebackButton noFactura={ultima.noFactura} />}
            <button className="btn btn-ghost" onClick={() => setUltima(null)} aria-label="Cerrar aviso"><I.X size={13} /></button>
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="listos"><div className="kpi-label">Listos para facturar</div><div className="kpi-value">{listos.length}</div><div className="kpi-delta"><span className="vs">de {exps.filter(enCola).length} en cola</span></div></div>
        <div className="kpi" data-kpi="total"><div className="kpi-label">Total sin IVA</div><div className="kpi-value">{Q(totalListo)}</div><div className="kpi-delta"><span className="vs">con IVA {Q(Math.round(totalListo * 112) / 100)}</span></div></div>
        <div className="kpi" data-kpi="sin-tarifa"><div className="kpi-label">Sin tarifa</div><div className="kpi-value" style={{ color: sinTarifa ? 'var(--burnt, #b5651d)' : undefined }}>{sinTarifa}</div><div className="kpi-delta"><span className="vs">{sinTarifa ? 'cargá la tarifa y se resuelve solo' : 'todas con precio'}</span></div></div>
        <div className="kpi" data-kpi="sin-mapear"><div className="kpi-label">Cliente sin mapear</div><div className="kpi-value" style={{ color: sinMapear ? 'var(--wine)' : undefined }}>{sinMapear}</div><div className="kpi-delta"><span className="vs">{sinMapear ? 'mapeá la empresa' : 'mapeado'}</span></div></div>
        <div className="kpi" data-kpi="facturados"><div className="kpi-label">Facturados desde acá</div><div className="kpi-value">{facturados}</div><div className="kpi-delta"><span className="vs">{exps.filter(e => e.facturaId && e.writebackEstado && !['confirmado', 'omitido'].includes(e.writebackEstado)).length} sin confirmar en Agenda</span></div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <select className="input" value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes de ingreso" title="Mes de ingreso"><option value="">Todos los meses</option>{meses.map(m => <option key={m} value={m}>{m}</option>)}</select>
          <select className="input" value={cobro} onChange={e => setCobro(e.target.value as FiltroCobro)} aria-label="Estado de cobro" title="Estado de cobro"><option value="por_facturar">Por facturar (cobro pendiente en Agenda)</option><option value="facturados">Facturados / resueltos</option><option value="todos">Todos</option></select>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={soloListos} onChange={e => setSoloListos(e.target.checked)} aria-label="Solo con precio resuelto" /> Solo con precio resuelto</label>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{filas.length} expediente{filas.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: sel.size ? 70 : 0 }}>
        <table className="table">
          <thead><tr>
            {puedeFacturar && <th style={{ width: 28 }}><input type="checkbox" checked={todosSel} onChange={toggleTodos} aria-label="Seleccionar todos los facturables visibles" disabled={facturablesVisibles.length === 0} /></th>}
            <th>Persona</th><th>Ingreso</th><th>Servicio</th><th>Categoría</th><th>Territorio</th><th className="num">Precio sin IVA</th><th>Cobro en Agenda</th><th>Factura</th>
          </tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>Ningún expediente con esos filtros.</td></tr>}
            {filas.map(e => <FilaExpediente key={e.idExterno} e={e} puede={puedeFacturar} sel={sel.has(e.idExterno)} onToggle={() => toggle(e.idExterno)} />)}
          </tbody>
        </table>
      </div>

      {sel.size > 0 && puedeFacturar && (
        <div role="region" aria-label="Selección para facturar" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: 'var(--paper)', borderTop: '1px solid var(--line-2)', boxShadow: '0 -8px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '10px 24px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            <div><strong>{seleccion.length}</strong> expediente{seleccion.length === 1 ? '' : 's'} seleccionado{seleccion.length === 1 ? '' : 's'}</div>
            <div className="num">Subtotal <strong>{Q(preview.subtotal)}</strong> · IVA {Q(preview.iva)} · Total <strong>{Q(preview.total)}</strong></div>
            <button className="btn btn-ghost" onClick={() => setSel(new Set())}>Limpiar</button>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setDialogo(true)} disabled={seleccion.length === 0}><I.Receipt size={13} /> Facturar seleccionados</button>
          </div>
        </div>
      )}

      {dialogo && (
        <FacturarDialogo
          seleccion={seleccion} centros={datos.centros} cliente={datos.nombre} writeback={writeback} configurada={configurada} montoModo={montoModo}
          onClose={() => setDialogo(false)}
          onHecho={r => { setUltima(r); setSel(new Set()); setDialogo(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

function FilaExpediente({ e, puede, sel, onToggle }: { e: ExpedienteLocal; puede: boolean; sel: boolean; onToggle: () => void }) {
  const esFacturable = facturable(e);
  const estadoCobro = [e.statusCobroExterno, e.estatusPagoExterno].filter(Boolean).join(' · ') || 'sin estado';
  return (
    <tr data-expediente={e.idExterno} style={{ opacity: !enCola(e) && !e.facturaId ? 0.65 : 1 }}>
      {puede && <td><input type="checkbox" checked={sel} onChange={onToggle} disabled={!esFacturable} aria-label={`Seleccionar ${e.persona || e.idExterno}`} /></td>}
      <td><div className="cell-strong">{e.persona || '—'}</div><div className="cell-mute" style={{ fontSize: 11 }}>{e.puesto || e.idExterno}{e.statusProceso ? ` · ${e.statusProceso}` : ''}</div></td>
      <td className="num" style={{ fontSize: 12 }}>{e.fechaIngreso ?? '—'}</td>
      <td><div>{e.tipoCobrado || e.tipoPrueba || '—'}</div>{e.procesoSolicitado && e.procesoSolicitado.toUpperCase() !== e.tipoCobrado ? <div className="cell-mute" style={{ fontSize: 11 }}>{e.procesoSolicitado}</div> : null}</td>
      <td title={e.categoriaPrueba || 'sin categoría'}>{e.categoriaCanon || <span className="cell-mute">—</span>}</td>
      <td title={e.deptoVisita || 'sin depto. de visita'}>{e.territorioResuelto || <span className="cell-mute">no indicado</span>}</td>
      <td className="num">
        {e.estadoTarifa === 'resuelta' && e.montoCalculado !== null
          ? <span className="cell-strong" title={e.componentes.length > 1 ? e.componentes.map(c => `${c.tipoPrueba} ${Q(c.monto)}`).join(' + ') : e.detalleTarifa || undefined}>{Q(e.montoCalculado)}{e.componentes.some(c => !c.aprobada) && <span className="badge badge-warn" style={{ fontSize: 9, marginLeft: 4 }} title="La tarifa no está aprobada en el tarifario">no aprobada</span>}</span>
          : <span className={'badge ' + (e.estadoTarifa === 'cliente_sin_mapear' ? 'badge-wine' : e.estadoTarifa === 'excluido_psicometrica' || e.estadoTarifa === 'excluido_no_factura' ? 'badge-mute' : 'badge-warn')} style={{ fontSize: 10 }} title={e.detalleTarifa || undefined}>{ETIQUETA_ESTADO_TARIFA[e.estadoTarifa]}</span>}
      </td>
      <td style={{ fontSize: 12 }}>
        <div>{estadoCobro}</div>
        {e.montoExterno !== null && <div className="cell-mute num" style={{ fontSize: 11 }} title="Monto registrado en la Agenda">Agenda: {Q(e.montoExterno)}</div>}
        {(e.cobroMegapaca ?? 0) > 0 && <span className="badge badge-outline" style={{ fontSize: 10 }} title="Cobro aparte de Megapaca: no se mezcla con el monto normal">Megapaca {Q(e.cobroMegapaca)}</span>}
      </td>
      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {e.facturaId && e.noFactura
          ? <>
              <Link href={`/facturacion/${e.facturaAppId ?? ''}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{e.noFactura}</Link>
              {e.writebackEstado && <span className={'badge ' + WB_BADGE[e.writebackEstado]} style={{ fontSize: 10, marginLeft: 6 }} title={e.writebackDetalle || ETIQUETA_WRITEBACK[e.writebackEstado]}>{WB_TEXTO[e.writebackEstado]}</span>}
              {e.writebackEstado && ['pendiente', 'conflicto', 'error'].includes(e.writebackEstado) && <div style={{ marginTop: 4 }}><ReintentarWritebackButton noFactura={e.noFactura} compacto /></div>}
              {e.cobroWritebackEstado && <div className="cell-mute" style={{ fontSize: 10 }} title={e.cobroWritebackDetalle || undefined}>cobro → Agenda: {e.cobroWritebackEstado}</div>}
            </>
          : e.numeroFacturaExterno ? <span className="cell-mute" title="Facturado fuera de la app (número que tiene la Agenda)">{e.numeroFacturaExterno}</span> : <span className="cell-mute">—</span>}
      </td>
    </tr>
  );
}

function NoFacturaBanner({ datos, puede }: { datos: GrupoDetalle; puede: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const quitar = async () => {
    setBusy(true);
    try {
      const r = await quitarNoFacturaAction(datos.empresaIdExterno);
      if (r.ok) { toast.success(`"${datos.nombreExterno}" vuelve a la cola · ${r.reclasificados} expediente(s) re-resueltos`); router.refresh(); } else toast.error(r.error);
    } finally { setBusy(false); }
  };
  return (
    <div className="card" role="status" data-no-factura style={{ borderColor: 'var(--line-2)', marginBottom: 14 }}>
      <div className="card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <div style={{ flex: 1, minWidth: 280, lineHeight: 1.45 }}>
          <strong>No se factura por evaluaciones.</strong> Sus expedientes están fuera de la cola y no se cotizan.
          {datos.noFactura?.motivo ? <> Motivo: <em>{datos.noFactura.motivo}</em>.</> : null}
          {datos.noFactura?.marcadoPor ? <span className="cell-mute"> · marcado por {datos.noFactura.marcadoPor}</span> : null}
          <div className="cell-mute" style={{ fontSize: 12, marginTop: 2 }}>No significa que nunca se facture: el reclutamiento va por la Fase A; esto solo la saca de la cola de evaluaciones.</div>
        </div>
        {puede && <button className="btn btn-secondary" onClick={() => void quitar()} disabled={busy}>{busy ? <><I.Refresh size={13} /> Quitando…</> : 'Quitar la marca (volver a la cola)'}</button>}
      </div>
    </div>
  );
}

function MapearCliente({ datos }: { datos: GrupoDetalle }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState('');
  const [motivo, setMotivo] = useState('');
  const [modoNoFactura, setModoNoFactura] = useState(false);
  const [clienteId, setClienteId] = useState(datos.sugerencias[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const opciones = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    const lista = f ? datos.clientes.filter(c => c.name.toLowerCase().includes(f) || c.nit.replace(/[^0-9A-Za-z]/g, '').includes(f.replace(/[^0-9a-z]/g, ''))) : datos.clientes;
    return lista.slice(0, 60);
  }, [datos.clientes, filtro]);
  const elegido = datos.clientes.find(c => c.id === clienteId);
  const mapear = async () => {
    if (!clienteId) return;
    setBusy(true);
    try {
      const r = await mapearClienteAction({ empresaIdExterno: datos.empresaIdExterno, empresaNombreExterno: datos.nombreExterno, clienteAppId: clienteId });
      if (r.ok) { toast.success(`"${datos.nombreExterno}" → ${r.clienteNombre} (NIT ${r.nit}) · ${r.reclasificados} expediente(s) re-resueltos`); router.push(`/por-facturar/${encodeURIComponent('n-' + r.nit)}`); }
      else toast.error(r.error);
    } finally { setBusy(false); }
  };
  const marcarNoFactura = async () => {
    setBusy(true);
    try {
      const r = await marcarNoFacturaAction({ empresaIdExterno: datos.empresaIdExterno, empresaNombreExterno: datos.nombreExterno, motivo });
      if (r.ok) { toast.success(`"${datos.nombreExterno}" marcada como no se factura · ${r.reclasificados} expediente(s) fuera de la cola`); router.refresh(); } else toast.error(r.error);
    } finally { setBusy(false); }
  };
  return (
    <div className="card" role="region" aria-label="Mapear cliente" style={{ borderColor: 'var(--wine)', marginBottom: 14 }}>
      <div className="card-head"><div className="card-title">Mapear &quot;{datos.nombreExterno || datos.empresaIdExterno}&quot; a un cliente de financiero</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>id en la Agenda: {datos.empresaIdExterno}</span></div></div>
      <div className="card-pad" style={{ fontSize: 13, display: 'grid', gap: 10 }}>
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>Mientras no esté mapeada, sus expedientes quedan en <strong>cliente sin mapear</strong> y no se facturan. El tarifario se busca por el NIT del cliente elegido.</div>
        {datos.sugerencias.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="cell-mute" style={{ fontSize: 12 }}>Sugeridos por nombre:</span>
            {datos.sugerencias.map(s => <button key={s.id} type="button" className={'btn ' + (clienteId === s.id ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setClienteId(s.id)}>{s.name} <span className="cell-mute num" style={{ fontSize: 11 }}>NIT {s.nit || '—'}</span></button>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" placeholder="Buscar cliente por nombre o NIT…" value={filtro} onChange={e => setFiltro(e.target.value)} aria-label="Buscar cliente para mapear" style={{ minWidth: 260 }} />
          <select className="input" value={clienteId} onChange={e => setClienteId(e.target.value)} aria-label="Cliente de financiero" style={{ minWidth: 320 }}>
            <option value="">Elegí el cliente…</option>
            {opciones.map(c => <option key={c.id} value={c.id}>{c.name}{c.nit ? ` · NIT ${c.nit}` : ' · sin NIT'}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => void mapear()} disabled={busy || !clienteId}>{busy ? <><I.Refresh size={13} /> Mapeando…</> : <><I.Check size={13} /> Mapear{elegido ? ` a ${elegido.name}` : ''}</>}</button>
        </div>
        <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="cell-mute" style={{ fontSize: 12 }}>O, si no se factura por este flujo (interna / intercompany / reclutamiento = Fase A):</span>
          {!modoNoFactura
            ? <button type="button" className="btn btn-ghost" onClick={() => setModoNoFactura(true)} disabled={busy} data-accion="no-factura">No se factura (interno / no aplica)</button>
            : <>
                <input className="input" placeholder="Motivo (opcional): intercompany, reclutamiento — Fase A…" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={200} aria-label="Motivo de no facturar" style={{ minWidth: 320 }} disabled={busy} />
                <button type="button" className="btn btn-ghost" onClick={() => setModoNoFactura(false)} disabled={busy}>Volver</button>
                <button type="button" className="btn btn-secondary" onClick={() => void marcarNoFactura()} disabled={busy} data-accion="confirmar-no-factura">{busy ? <><I.Refresh size={13} /> Marcando…</> : <><I.Check size={13} /> Confirmar: no se factura</>}</button>
              </>}
        </div>
      </div>
    </div>
  );
}

interface DialogoProps {
  seleccion: ExpedienteLocal[]; centros: GrupoDetalle['centros']; cliente: string; writeback: boolean; configurada: boolean; montoModo: 'con_iva' | 'sin_iva';
  onClose: () => void; onHecho: (r: { noFactura: string; facturaAppId: string; total: number; writeback: { estado: WritebackEstado; detalle: string } }) => void;
}

function FacturarDialogo({ seleccion, centros, cliente, writeback, configurada, montoModo, onClose, onHecho }: DialogoProps) {
  const [noFactura, setNoFactura] = useState('');
  const [fecha, setFecha] = useState(obtenerFechaHoyGuatemala());
  const [loading, setLoading] = useState(false);
  const tipos = useMemo(() => [...new Set(seleccion.flatMap(e => (e.componentes.length ? e.componentes.map(c => c.tipoPrueba) : [e.tipoCobrado])))], [seleccion]);
  const [centroPorTipo, setCentroPorTipo] = useState<Record<string, string>>(() => Object.fromEntries(tipos.map(t => [t, centroPorServicio(t, centros) ?? ''])));
  const f = useMemo(() => armarFactura(seleccion, t => centroPorTipo[t] || null), [seleccion, centroPorTipo]);
  const nombreCC = (id: string) => centros.find(c => c.id === id)?.nombre ?? '—';
  const valido = noFactura.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && f.sinCentro.length === 0 && seleccion.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, loading]);

  const confirmar = async () => {
    if (!valido) return;
    setLoading(true);
    try {
      const r = await emitirFacturaAgendaAction({ idsExternos: seleccion.map(e => e.idExterno), noFactura: noFactura.trim(), fechaEmision: fecha, centroPorTipo });
      if (!r.ok) { toast.error(r.error); return; }
      if (r.writeback.estado === 'confirmado' || r.writeback.estado === 'omitido') toast.success(`Factura ${r.noFactura} registrada · ${r.expedientes} expediente(s) · ${Q(r.total)} con IVA`);
      else toast.warning(`Factura ${r.noFactura} registrada, pero la Agenda no confirmó: ${r.writeback.detalle}`);
      onHecho({ noFactura: r.noFactura, facturaAppId: r.facturaAppId, total: r.total, writeback: r.writeback });
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error de red'); }
    finally { setLoading(false); }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onClick={() => { if (!loading) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Facturar expedientes" style={{ width: 'min(760px, 96vw)', maxHeight: '92vh', background: 'var(--paper)', borderRadius: 'var(--r-3)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Receipt size={15} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>Facturar {seleccion.length} expediente{seleccion.length === 1 ? '' : 's'} de {cliente}</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={loading} title="Cerrar (Esc)"><I.X size={15} /></button>
        </div>
        <div style={{ padding: '18px 22px', overflowY: 'auto', fontSize: 13 }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.45 }}>La factura la emite el auxiliar en <strong>SAT/FEL</strong>; acá se registra con su número y fecha reales, entra al ER y a cobros como cualquier factura, y {writeback && configurada ? <>se marca <strong>FACTURADO</strong> en la Agenda con el monto {montoModo === 'con_iva' ? 'con IVA' : 'sin IVA'} por expediente.</> : <><strong>no</strong> se escribe a la Agenda ({configurada ? 'FACTURAR_WRITEBACK apagado' : 'este deploy no tiene llave'}).</>}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="pf-nf">Número de factura (SAT/FEL) *</label>
              <input id="pf-nf" className="input" value={noFactura} onChange={e => setNoFactura(e.target.value)} placeholder="Ej. A-12345" maxLength={60} disabled={loading} autoFocus />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label" htmlFor="pf-fecha">Fecha de la factura *</label>
              <input id="pf-fecha" type="date" className="input num" value={fecha} max={obtenerFechaHoyGuatemala()} onChange={e => setFecha(e.target.value)} disabled={loading} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head"><div className="card-title">Líneas por centro de costo</div><div className="card-actions"><span className="cell-mute" style={{ fontSize: 11 }}>el ingreso cae en la línea de su servicio</span></div></div>
            <table className="table">
              <thead><tr><th>Servicio</th><th>Centro de costo</th><th className="num">Subtotal</th></tr></thead>
              <tbody>
                {tipos.map(t => {
                  const sub = f.detalle.filter(d => d.tipoPrueba === t).reduce((s, d) => s + d.monto, 0);
                  return (
                    <tr key={t}>
                      <td>{t} <span className="cell-mute" style={{ fontSize: 11 }}>({f.detalle.filter(d => d.tipoPrueba === t).length})</span></td>
                      <td><select className="input" value={centroPorTipo[t] ?? ''} onChange={e => setCentroPorTipo(m => ({ ...m, [t]: e.target.value }))} aria-label={`Centro de costo para ${t}`} disabled={loading} style={{ minWidth: 220 }}><option value="">Elegí el centro…</option>{centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></td>
                      <td className="num">{Q(Math.round(sub * 100) / 100)}</td>
                    </tr>
                  );
                })}
                {f.lineas.map(l => <tr key={l.centroCostoId} style={{ background: 'var(--bg-2)' }}><td className="cell-mute" style={{ fontSize: 12 }}>línea</td><td>{nombreCC(l.centroCostoId)}</td><td className="num">{Q(l.subtotal)} <span className="cell-mute">+ IVA {Q(l.iva)} = {Q(l.total)}</span></td></tr>)}
                <tr style={{ background: 'var(--bg-2)' }}><td colSpan={2} className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>Subtotal · IVA (12 %) · <strong>Total</strong></td><td className="num" data-total={f.total}>{Q(f.subtotal)} · {Q(f.iva)} · <strong>{Q(f.total)}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Expedientes</div></div>
            <table className="table">
              <thead><tr><th>Persona</th><th>Servicio</th><th>Categoría · territorio</th><th className="num">Sin IVA</th></tr></thead>
              <tbody>
                {seleccion.map(e => <tr key={e.idExterno}><td>{e.persona || e.idExterno}</td><td>{e.tipoCobrado}{e.componentes.length > 1 ? <span className="cell-mute" style={{ fontSize: 11 }}> ({e.componentes.map(c => `${c.tipoPrueba} ${Q(c.monto)}`).join(' + ')})</span> : null}</td><td className="cell-mute" style={{ fontSize: 12 }}>{e.categoriaCanon} · {e.territorioResuelto || 'no indicado'}</td><td className="num">{Q(e.montoCalculado ?? 0)}</td></tr>)}
              </tbody>
            </table>
          </div>
          {f.sinCentro.length > 0 && <div role="status" style={{ marginTop: 10, fontSize: 12, color: 'var(--wine)' }}>Elegí el centro de costo para: {f.sinCentro.join(', ')}.</div>}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={loading || !valido}>{loading ? <><I.Refresh size={13} /> Facturando…</> : <><I.Check size={13} /> Confirmar factura {noFactura.trim() ? noFactura.trim() : ''}</>}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
