'use client';

/**
 * POR FACTURAR · DETALLE de un cliente: sus expedientes (persona solo para
 * identificar, servicio, categoría, territorio, precio resuelto o su estado),
 * filtros por mes de ingreso y estado de cobro, selección → "Facturar" con el
 * número y la fecha reales de SAT/FEL (los emite el auxiliar, no el sistema), y
 * "Mapear" cuando la empresa de la Agenda no apunta a un cliente de financiero.
 * Confirmaciones en línea / modal propio: sin diálogos del navegador.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { crearDetalleAction, mapearClienteAction, marcarNoFacturaAction, quitarNoFacturaAction } from '@/app/(app)/por-facturar/actions';
import { armarFactura, centroPorServicio, enCola, esMitadDeCompleto, facturable } from '@/lib/facturacion-agenda/mapeo';
import { filtrarExpedientes, mesesDisponibles, type FiltroCobro } from '@/lib/facturacion-agenda/resumen';
import { ETIQUETA_ESTADO_TARIFA, ETIQUETA_WRITEBACK, type ExpedienteLocal, type WritebackEstado } from '@/lib/facturacion-agenda/tipos';
import type { GrupoDetalle } from '@/lib/db/facturacion-agenda';
import { ReintentarWritebackButton } from './reintentar-writeback-button';
import { GenerarTarifas } from '@/components/tarifario/generar-tarifas';
import { ModalClienteForm } from '@/components/clientes/modal-cliente-form';
import { buscarClientes } from '@/lib/clientes/buscar';
import { etiquetaOpcionCliente } from './etiqueta-cliente';
import type { Customer } from '@/lib/types';

interface Props { datos: GrupoDetalle; writeback: boolean; configurada: boolean; montoModo: 'con_iva' | 'sin_iva'; /** abrir "Generar tarifas" de entrada (llega de crear cliente + mapear) */ generarInicial?: boolean }

const WB_BADGE: Record<WritebackEstado, string> = { confirmado: 'badge-olive', omitido: 'badge-mute', pendiente: 'badge-warn', conflicto: 'badge-wine', error: 'badge-wine' };
const WB_TEXTO: Record<WritebackEstado, string> = { confirmado: 'En Agenda', omitido: 'Sin enviar', pendiente: 'Falta confirmar', conflicto: 'Conflicto', error: 'Error' };

export function GrupoDetalleView({ datos, writeback, configurada, montoModo, generarInicial = false }: Props) {
  const router = useRouter();
  const puede = usePuede();
  const puedeFacturar = puede('facturar_agenda');
  const [mes, setMes] = useState('');
  const [cobro, setCobro] = useState<FiltroCobro>('por_facturar');
  const [soloListos, setSoloListos] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [creando, setCreando] = useState(false);
  const [generando, setGenerando] = useState(generarInicial && !!datos.nit);

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

  const generarDetalle = async () => {
    if (!seleccion.length) return;
    setCreando(true);
    try {
      const r = await crearDetalleAction({ idsExternos: seleccion.map(e => e.idExterno) });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`Detalle ${r.detalle.correlativo} generado en borrador · ${r.detalle.expedientes} expediente(s) · ${Q(r.detalle.total)} con IVA`);
      setSel(new Set());
      router.push(`/por-facturar/detalle/${r.detalle.id}`);
    } finally { setCreando(false); }
  };
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
          {datos.nit && sinTarifa > 0 && puedeFacturar && !generando && <button className="btn btn-secondary" onClick={() => setGenerando(true)} data-accion="generar-tarifas"><I.Plus size={13} /> Generar tarifas faltantes</button>}
          {datos.nit && <Link href={`/tarifario/${encodeURIComponent(datos.nit)}`} className="btn btn-ghost"><I.Coins size={13} /> Tarifario del cliente</Link>}
        </div>
      </div>

      {generando && generarInicial && datos.nit && <div className="card" role="status" data-recien-mapeado style={{ borderColor: 'var(--olive)', marginBottom: 10 }}><div className="card-pad" style={{ fontSize: 13 }}><strong>{datos.nombre}</strong> quedó creado y mapeado a <strong>{datos.nombreExterno || 'la empresa de la Agenda'}</strong>. Si todavía no tiene tarifario, generalo acá abajo: las filas nacen en Q0 y al cargar el precio los expedientes se resuelven solos.</div></div>}
      {generando && datos.nit && <GenerarTarifas nit={datos.nit} razonSocial={datos.nombre} modo="tarjeta" />}
      {datos.noFactura && <NoFacturaBanner datos={datos} puede={puedeFacturar} />}
      {datos.arranque && <div className="card" role="status" data-arranque style={{ marginBottom: 14 }}><div className="card-pad" style={{ fontSize: 13 }}>Este cliente se factura por este flujo <strong>desde el {datos.arranque.facturarDesde}</strong>: <strong>{datos.arranque.fuera}</strong> expediente{datos.arranque.fuera === 1 ? '' : 's'} con ingreso anterior quedan <strong>fuera de la cola</strong> (histórico ya cubierto, p. ej. por provisión). Siguen en la lista, atenuados y marcados &quot;antes del arranque&quot;, para conciliar.</div></div>}
      {!datos.nit && !datos.noFactura && puedeFacturar && <MapearCliente datos={datos} />}
      {!datos.nit && !datos.noFactura && !puedeFacturar && <div className="card" role="status" style={{ borderColor: 'var(--wine)', marginBottom: 14 }}><div className="card-pad" style={{ fontSize: 13 }}>Esta empresa de la Agenda todavía no está mapeada a un cliente: un admin o contador tiene que mapearla antes de facturar.</div></div>}

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

      {/* FIX OVERFLOW: la tabla desplaza dentro de la tarjeta (no la página); selección + persona fijas a la izquierda, factura a la derecha. */}
      <div className="card" style={{ marginBottom: sel.size ? 70 : 0 }}>
        <div className="table-scroll" data-tabla-expedientes>
          <table className="table" style={{ '--col-persona-left': puedeFacturar ? '56px' : '0px' } as React.CSSProperties}>
            <thead><tr>
              {puedeFacturar && <th className="col-sel"><input type="checkbox" checked={todosSel} onChange={toggleTodos} aria-label="Seleccionar todos los facturables visibles" disabled={facturablesVisibles.length === 0} /></th>}
              <th className="col-persona">Persona</th><th>Ingreso</th><th>Servicio</th><th>Categoría</th><th>Territorio</th><th className="num">Precio sin IVA</th><th>Cobro en Agenda</th><th className="col-acciones">Factura</th>
            </tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>Ningún expediente con esos filtros.</td></tr>}
              {filas.map(e => <FilaExpediente key={e.idExterno} e={e} puede={puedeFacturar} sel={sel.has(e.idExterno)} onToggle={() => toggle(e.idExterno)} />)}
            </tbody>
          </table>
        </div>
      </div>

      {sel.size > 0 && puedeFacturar && (
        <div role="region" aria-label="Selección para el detalle" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: 'var(--paper)', borderTop: '1px solid var(--line-2)', boxShadow: '0 -8px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '10px 24px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
            <div><strong>{seleccion.length}</strong> expediente{seleccion.length === 1 ? '' : 's'} seleccionado{seleccion.length === 1 ? '' : 's'}</div>
            <div className="num">Subtotal <strong>{Q(preview.subtotal)}</strong> · IVA {Q(preview.iva)} · Total <strong>{Q(preview.total)}</strong></div>
            <button className="btn btn-ghost" onClick={() => setSel(new Set())}>Limpiar</button>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => void generarDetalle()} disabled={seleccion.length === 0 || creando} data-accion="generar-detalle"><I.Receipt size={13} /> {creando ? 'Generando…' : 'Generar detalle'}</button>
          </div>
        </div>
      )}

    </div>
  );
}

/**
 * Servicio REAL de la fila (lo que se cobra) y, debajo, el proceso: una mitad de un
 * COMPLETO dice "COMPLETO · esta fila cobra solo X; la otra mitad es su propia fila"
 * para que se vea que su precio es el de esa mitad y no el de los dos.
 */
function ServicioCell({ e }: { e: ExpedienteLocal }) {
  const servicio = e.tipoCobrado || e.tipoPrueba || '—';
  const proceso = (e.procesoSolicitado ?? '').trim();
  const mitad = esMitadDeCompleto(e);
  const completoEnUno = /COMPLET/i.test(proceso) && e.tipoCobrado.includes(' + ');
  const sinServicio = /COMPLET/i.test(proceso) && !e.tipoCobrado;
  return (
    <>
      <div data-servicio={e.tipoCobrado || ''}>{servicio}</div>
      {mitad && <div className="cell-mute" style={{ fontSize: 11 }} title="La Agenda parte un completo en dos expedientes: uno POLIGRAFO y otro SOCIOECONOMICO. Esta fila cobra solo su servicio; la otra mitad es su propia fila.">COMPLETO · mitad: solo {servicio.toLowerCase()}</div>}
      {completoEnUno && <div className="cell-mute" style={{ fontSize: 11 }} title="Este registro trae los dos servicios en la misma fila: se cobran los dos.">COMPLETO en un registro</div>}
      {sinServicio && <div className="cell-mute" style={{ fontSize: 11, color: 'var(--wine)' }}>COMPLETO sin servicio: dato a revisar en la Agenda</div>}
      {!mitad && !completoEnUno && !sinServicio && proceso && proceso.toUpperCase() !== e.tipoCobrado ? <div className="cell-mute" style={{ fontSize: 11 }}>{proceso}</div> : null}
    </>
  );
}

function FilaExpediente({ e, puede, sel, onToggle }: { e: ExpedienteLocal; puede: boolean; sel: boolean; onToggle: () => void }) {
  const esFacturable = facturable(e);
  const estadoCobro = [e.statusCobroExterno, e.estatusPagoExterno].filter(Boolean).join(' · ') || 'sin estado';
  return (
    <tr data-expediente={e.idExterno} style={{ opacity: !enCola(e) && !e.facturaId ? 0.65 : 1 }}>
      {puede && <td className="col-sel"><input type="checkbox" checked={sel} onChange={onToggle} disabled={!esFacturable} aria-label={`Seleccionar ${e.persona || e.idExterno}`} /></td>}
      <td className="col-persona">
        <span className="cell-strong cell-ellipsis" title={e.persona || e.idExterno}>{e.persona || '—'}</span>
        <span className="cell-mute cell-ellipsis" style={{ fontSize: 11 }} title={`${e.puesto || e.idExterno}${e.statusProceso ? ` · ${e.statusProceso}` : ''}${e.solicitante ? ` · solicita ${e.solicitante}` : ''}`}>{e.puesto || e.idExterno}{e.statusProceso ? ` · ${e.statusProceso}` : ''}</span>
      </td>
      <td className="num" style={{ fontSize: 12 }}>{e.fechaIngreso ?? '—'}</td>
      <td className="col-servicio"><ServicioCell e={e} /></td>
      <td title={e.categoriaPrueba || 'sin categoría'}>{e.categoriaCanon || <span className="cell-mute">—</span>}</td>
      <td title={e.deptoVisita || 'sin depto. de visita'}>{e.territorioResuelto || <span className="cell-mute">no indicado</span>}</td>
      <td className="num">
        {e.estadoTarifa === 'resuelta' && e.montoCalculado !== null
          ? <span className="cell-strong" title={e.componentes.length > 1 ? e.componentes.map(c => `${c.tipoPrueba} ${Q(c.monto)}`).join(' + ') : e.detalleTarifa || undefined}>{Q(e.montoCalculado)}{e.componentes.some(c => !c.aprobada) && <span className="badge badge-warn" style={{ fontSize: 9, marginLeft: 4 }} title="La tarifa no está aprobada en el tarifario">no aprobada</span>}</span>
          : <span className={'badge ' + (e.estadoTarifa === 'cliente_sin_mapear' ? 'badge-wine' : e.estadoTarifa === 'excluido_psicometrica' || e.estadoTarifa === 'excluido_no_factura' ? 'badge-mute' : 'badge-warn')} style={{ fontSize: 10 }} title={e.detalleTarifa || undefined}>{ETIQUETA_ESTADO_TARIFA[e.estadoTarifa]}</span>}
      </td>
      <td style={{ fontSize: 12 }}>
        <div>{estadoCobro}</div>
        {e.arranqueExcluido && <span className="badge badge-mute" data-antes-arranque style={{ fontSize: 10 }} title="Ingreso anterior al arranque de la facturación de este cliente: fuera de la cola, sigue en la data para conciliar">antes del arranque</span>}
        {e.montoExterno !== null && <div className="cell-mute num" style={{ fontSize: 11 }} title="Monto registrado en la Agenda">Agenda: {Q(e.montoExterno)}</div>}
        {(e.cobroMegapaca ?? 0) > 0 && <span className="badge badge-outline" style={{ fontSize: 10 }} title="Cobro aparte de Megapaca: no se mezcla con el monto normal">Megapaca {Q(e.cobroMegapaca)}</span>}
      </td>
      <td className="col-acciones" style={{ fontSize: 12 }}>
        {e.facturaId && e.noFactura
          ? <>
              <Link href={`/facturacion/${e.facturaAppId ?? ''}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{e.noFactura}</Link>
              {e.writebackEstado && <span className={'badge ' + WB_BADGE[e.writebackEstado]} style={{ fontSize: 10, marginLeft: 6 }} title={e.writebackDetalle || ETIQUETA_WRITEBACK[e.writebackEstado]}>{WB_TEXTO[e.writebackEstado]}</span>}
              {e.writebackEstado && ['pendiente', 'conflicto', 'error'].includes(e.writebackEstado) && <div style={{ marginTop: 4 }}><ReintentarWritebackButton noFactura={e.noFactura} compacto /></div>}
              {e.cobroWritebackEstado && <div className="cell-mute" style={{ fontSize: 10 }} title={e.cobroWritebackDetalle || undefined}>cobro → Agenda: {e.cobroWritebackEstado}</div>}
            </>
          : e.detalleId ? <Link href={`/por-facturar/detalle/${e.detalleId}`} className="badge badge-warn" style={{ fontSize: 10, textDecoration: 'none' }} title="Reservado en un detalle de facturación (pre-liquidación)">En detalle →</Link>
          : e.numeroFacturaExterno ? <span className="cell-mute cell-ellipsis" title={`Facturado fuera de la app (número que tiene la Agenda): ${e.numeroFacturaExterno}`}>{e.numeroFacturaExterno}</span> : <span className="cell-mute">—</span>}
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
  const puede = usePuede();
  const [filtro, setFiltro] = useState('');
  const [motivo, setMotivo] = useState('');
  const [modoNoFactura, setModoNoFactura] = useState(false);
  const [clienteId, setClienteId] = useState(datos.sugerencias[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [crear, setCrear] = useState(false);
  // Buscador: sin tildes ni mayúsculas, por nombre / razón social / nombre comercial / marcas (020) / nombre en la Agenda / NIT; sin tope de 60.
  const opciones = useMemo(() => buscarClientes(datos.clientes, filtro), [datos.clientes, filtro]);
  useEffect(() => { if (filtro.trim() && opciones.length === 1 && clienteId !== opciones[0].id) setClienteId(opciones[0].id); }, [filtro, opciones, clienteId]);
  const elegido = datos.clientes.find(c => c.id === clienteId);
  const mapearA = async (id: string, creado?: Customer) => {
    setBusy(true);
    try {
      const r = await mapearClienteAction({ empresaIdExterno: datos.empresaIdExterno, empresaNombreExterno: datos.nombreExterno, clienteAppId: id });
      if (r.ok) {
        toast.success(`${creado ? `Cliente "${creado.name}" creado y mapeado` : `"${datos.nombreExterno}" → ${r.clienteNombre} (NIT ${r.nit})`} · ${r.reclasificados} expediente(s) re-resueltos`);
        // Recién creado: ir al cliente con "Generar tarifas" abierto (nace sin tarifario).
        router.push(`/por-facturar/${encodeURIComponent('n-' + r.nit)}${creado ? '?generar=1' : ''}`);
      } else toast.error(creado ? `El cliente "${creado.name}" se creó, pero no se pudo mapear: ${r.error}` : r.error);
    } finally { setBusy(false); }
  };
  const mapear = () => { if (clienteId) void mapearA(clienteId); };
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
          <input className="input" placeholder="Buscar por nombre, razón social, marca, nombre en la Agenda o NIT…" value={filtro} onChange={e => setFiltro(e.target.value)} aria-label="Buscar cliente para mapear" style={{ minWidth: 300 }} />
          <select className="input" value={clienteId} onChange={e => setClienteId(e.target.value)} aria-label="Cliente de financiero" style={{ minWidth: 320 }}>
            <option value="">{filtro.trim() ? `${opciones.length} coincidencia${opciones.length === 1 ? '' : 's'}…` : 'Elegí el cliente…'}</option>
            {opciones.map(c => <option key={c.id} value={c.id}>{etiquetaOpcionCliente(c, filtro)}</option>)}
          </select>
          <button className="btn btn-primary" onClick={mapear} disabled={busy || !clienteId}>{busy ? <><I.Refresh size={13} /> Mapeando…</> : <><I.Check size={13} /> Mapear{elegido ? ` a ${elegido.name}` : ''}</>}</button>
          {puede('emitir_factura') && <button type="button" className="btn btn-ghost" onClick={() => setCrear(true)} disabled={busy} data-accion="crear-cliente-inline" title="El cliente no existe en financiero: crearlo acá y dejarlo mapeado en un paso"><I.Plus size={13} /> Crear cliente nuevo</button>}
        </div>
        {filtro.trim() && opciones.length === 0 && <div className="cell-mute" style={{ fontSize: 12 }}>Ningún cliente coincide con &quot;{filtro.trim()}&quot;. Probá otro nombre o NIT, o creá el cliente nuevo.</div>}
        {crear && (
          <ModalClienteForm
            onClose={() => setCrear(false)}
            nombreInicial={datos.nombreExterno}
            exigirNit
            subtitulo={`para mapear "${datos.nombreExterno || datos.empresaIdExterno}"`}
            onCreado={c => { void mapearA(c.id, c); }}
          />
        )}
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
