'use client';

/**
 * POR FACTURAR · pestaña "Sin mapear": empresas de la Agenda cuyos expedientes en
 * cola no apuntan a un cliente de financiero. Agregadas por empresa en SQL (017),
 * con búsqueda y paginación, pedidas ON DEMAND (nunca vienen con la lista).
 *
 * MASIVO: checkbox por fila + "toda la página" + "todo el filtro" y una barra de
 * acciones: "No se factura (no aplica)" con UN motivo para todas, o "Mapear todas a
 * un cliente" (mismo NIT: Walmart/… → la matriz). "Mapear →" individual se mantiene.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { empresasSinMapearAction, empresasSinMapearTodasAction, mapearClientesLoteAction, marcarNoFacturaLoteAction } from '@/app/(app)/por-facturar/actions';
import type { ClienteSlim, EmpresaRef, PaginaSinMapear } from '@/lib/db/facturacion-agenda';
import { buscarClientes } from '@/lib/clientes/buscar';
import { etiquetaOpcionCliente } from './etiqueta-cliente';

const POR_PAGINA = 25;
type Accion = 'ninguna' | 'no_factura' | 'mapear';

export function SinMapearLista({ totalEmpresas, totalExpedientes, clientes = [], puede = false }: { totalEmpresas: number; totalExpedientes: number; clientes?: ClienteSlim[]; puede?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [qAplicada, setQAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<PaginaSinMapear | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [sel, setSel] = useState<Map<string, EmpresaRef>>(new Map());
  const [accion, setAccion] = useState<Accion>('ninguna');
  const [motivo, setMotivo] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setQAplicada(q.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let vivo = true; setCargando(true); setError('');
    empresasSinMapearAction(qAplicada, pagina, POR_PAGINA).then(d => { if (vivo) setDatos(d); }).catch(e => { if (vivo) setError(e instanceof Error ? e.message : 'Error'); }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [qAplicada, pagina, version]);

  const total = datos?.totalEmpresas ?? totalEmpresas;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const filas = datos?.filas ?? [];
  const todosPagina = filas.length > 0 && filas.every(f => sel.has(f.empresaIdExterno));
  const toggle = (f: { empresaIdExterno: string; empresaNombreExterno: string }) => setSel(s => { const n = new Map(s); if (n.has(f.empresaIdExterno)) n.delete(f.empresaIdExterno); else n.set(f.empresaIdExterno, { empresaIdExterno: f.empresaIdExterno, empresaNombreExterno: f.empresaNombreExterno }); return n; });
  const togglePagina = () => setSel(s => { const n = new Map(s); if (todosPagina) filas.forEach(f => n.delete(f.empresaIdExterno)); else filas.forEach(f => n.set(f.empresaIdExterno, { empresaIdExterno: f.empresaIdExterno, empresaNombreExterno: f.empresaNombreExterno })); return n; });
  const seleccionarFiltro = async () => {
    setBusy(true);
    try { const todas = await empresasSinMapearTodasAction(qAplicada); setSel(new Map(todas.map(e => [e.empresaIdExterno, e]))); toast.message(`${todas.length} empresa${todas.length === 1 ? '' : 's'} seleccionada${todas.length === 1 ? '' : 's'}${qAplicada ? ` (filtro "${qAplicada}")` : ''}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  const limpiar = () => { setSel(new Map()); setAccion('ninguna'); setMotivo(''); setClienteId(''); setFiltroCliente(''); };
  const terminar = (msg: string) => { toast.success(msg); limpiar(); setVersion(v => v + 1); router.refresh(); };

  // Buscador: sin tildes ni mayúsculas, por nombre / razón social / nombre comercial / marcas / nombre en la Agenda / NIT; sin tope.
  const opcionesCliente = useMemo(() => buscarClientes(clientes, filtroCliente), [clientes, filtroCliente]);
  useEffect(() => { if (filtroCliente.trim() && opcionesCliente.length === 1 && clienteId !== opcionesCliente[0].id) setClienteId(opcionesCliente[0].id); }, [filtroCliente, opcionesCliente, clienteId]);
  const clienteSel = clientes.find(c => c.id === clienteId);

  const confirmarNoFactura = async () => {
    setBusy(true);
    try {
      const r = await marcarNoFacturaLoteAction({ empresas: [...sel.values()], motivo });
      if (r.ok) terminar(`${r.aplicadas} empresa${r.aplicadas === 1 ? '' : 's'} marcada${r.aplicadas === 1 ? '' : 's'} como no se factura · ${r.reclasificados} expediente(s) fuera de la cola`); else toast.error(r.error);
    } finally { setBusy(false); }
  };
  const confirmarMapeo = async () => {
    if (!clienteId) return;
    setBusy(true);
    try {
      const r = await mapearClientesLoteAction({ empresas: [...sel.values()], clienteAppId: clienteId });
      if (r.ok) terminar(`${r.aplicadas} empresa${r.aplicadas === 1 ? '' : 's'} → ${r.clienteNombre} (NIT ${r.nit}) · ${r.reclasificados} expediente(s) re-resueltos`); else toast.error(r.error);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <input className="input" placeholder="Buscar empresa de la Agenda… (ej. WALMART)" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 300 }} aria-label="Buscar empresa sin mapear" />
          <span className="cell-mute">{totalEmpresas} empresa{totalEmpresas === 1 ? '' : 's'} · {totalExpedientes} expediente{totalExpedientes === 1 ? '' : 's'} en cola sin cliente de financiero</span>
          {puede && total > 0 && <button className="btn btn-ghost" onClick={() => void seleccionarFiltro()} disabled={busy || cargando} data-accion="seleccionar-filtro" title="Selecciona todas las empresas del filtro actual, no solo la página">Seleccionar {qAplicada ? `las ${total} de "${qAplicada}"` : `las ${total}`}</button>}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1 || cargando} aria-label="Página anterior"><I.ChevLeft size={13} /></button>
            <span className="num" data-paginacion>{pagina} / {paginas}</span>
            <button className="btn btn-ghost" onClick={() => setPagina(p => Math.min(paginas, p + 1))} disabled={pagina >= paginas || cargando} aria-label="Página siguiente"><I.ArrowRight size={13} /></button>
          </span>
        </div>
      </div>

      {puede && sel.size > 0 && (
        <div className="card" role="region" aria-label="Acciones masivas" data-barra-masiva style={{ marginBottom: 12, borderColor: 'var(--olive)' }}>
          <div className="card-pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <div><strong>{sel.size}</strong> empresa{sel.size === 1 ? '' : 's'} seleccionada{sel.size === 1 ? '' : 's'}</div>
            {accion === 'ninguna' && <>
              <button className="btn btn-secondary" onClick={() => setAccion('no_factura')} disabled={busy} data-accion="no-factura-lote">No se factura (no aplica)</button>
              <button className="btn btn-secondary" onClick={() => setAccion('mapear')} disabled={busy} data-accion="mapear-lote">Mapear todas a un cliente</button>
              <button className="btn btn-ghost" onClick={limpiar} disabled={busy} style={{ marginLeft: 'auto' }}>Limpiar selección</button>
            </>}
            {accion === 'no_factura' && <>
              <input className="input" placeholder="Motivo para todas (opcional): intercompany, reclutamiento — Fase A…" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={200} aria-label="Motivo de no facturar (lote)" style={{ minWidth: 340 }} disabled={busy} />
              <button className="btn btn-ghost" onClick={() => setAccion('ninguna')} disabled={busy}>Volver</button>
              <button className="btn btn-primary" onClick={() => void confirmarNoFactura()} disabled={busy} data-accion="confirmar-no-factura-lote">{busy ? <><I.Refresh size={13} /> Marcando…</> : <><I.Check size={13} /> Marcar {sel.size} como no se factura</>}</button>
            </>}
            {accion === 'mapear' && <>
              <input className="input" placeholder="Buscar cliente por nombre o NIT…" value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)} aria-label="Buscar cliente para mapear (lote)" style={{ minWidth: 240 }} disabled={busy} />
              <select className="input" value={clienteId} onChange={e => setClienteId(e.target.value)} aria-label="Cliente de financiero (lote)" style={{ minWidth: 300 }} disabled={busy}>
                <option value="">Elegí el cliente…</option>
                {opcionesCliente.map(c => <option key={c.id} value={c.id}>{etiquetaOpcionCliente(c, filtroCliente)}</option>)}
              </select>
              <button className="btn btn-ghost" onClick={() => setAccion('ninguna')} disabled={busy}>Volver</button>
              <button className="btn btn-primary" onClick={() => void confirmarMapeo()} disabled={busy || !clienteId} data-accion="confirmar-mapear-lote">{busy ? <><I.Refresh size={13} /> Mapeando…</> : <><I.Check size={13} /> Mapear {sel.size}{clienteSel ? ` a ${clienteSel.name}` : ''}</>}</button>
            </>}
          </div>
        </div>
      )}

      <div className="card">
        <table className="table" data-lista="sin-mapear">
          <thead><tr>
            {puede && <th style={{ width: 28 }}><input type="checkbox" checked={todosPagina} onChange={togglePagina} aria-label="Seleccionar toda la página" disabled={filas.length === 0 || busy} /></th>}
            <th>Empresa en la Agenda</th><th className="num">Expedientes en cola</th><th>Ingreso más antiguo</th><th>Más reciente</th><th style={{ width: 120 }}></th>
          </tr></thead>
          <tbody>
            {error && <tr><td colSpan={6} style={{ color: 'var(--wine)', padding: 20 }}>{error}</td></tr>}
            {!error && cargando && !datos && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>Cargando empresas…</td></tr>}
            {!error && datos && filas.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>{qAplicada ? 'Ninguna empresa con esa búsqueda.' : 'Todas las empresas con expedientes en cola están mapeadas.'}</td></tr>}
            {filas.map(f => {
              const href = `/por-facturar/${encodeURIComponent('e-' + f.empresaIdExterno)}`;
              return (
                <tr key={f.empresaIdExterno} style={{ opacity: cargando ? 0.6 : 1 }} data-empresa={f.empresaIdExterno}>
                  {puede && <td><input type="checkbox" checked={sel.has(f.empresaIdExterno)} onChange={() => toggle(f)} aria-label={`Seleccionar ${f.empresaNombreExterno || f.empresaIdExterno}`} disabled={busy} /></td>}
                  <td><Link href={href} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{f.empresaNombreExterno || '—'}</Link><div className="cell-mute" style={{ fontSize: 11 }}>{f.empresaIdExterno}</div></td>
                  <td className="num cell-strong">{f.expedientes}</td>
                  <td className="num cell-mute" style={{ fontSize: 12 }}>{f.fechaMasAntigua ?? '—'}</td>
                  <td className="num cell-mute" style={{ fontSize: 12 }}>{f.fechaMasReciente ?? '—'}</td>
                  <td><Link href={href} className="btn btn-secondary" style={{ fontSize: 12 }}>Mapear →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
