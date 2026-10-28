'use client';

/**
 * POR FACTURAR · pestaña "Sin mapear": empresas de la Agenda cuyos expedientes en
 * cola no apuntan a un cliente de financiero. Agregadas por empresa en SQL (017),
 * con búsqueda y paginación, pedidas ON DEMAND (nunca vienen con la lista). Cada
 * fila lleva al detalle `e-<empresa.id>`, donde está el panel "Mapear".
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { I } from '@/components/common/icons';
import { empresasSinMapearAction } from '@/app/(app)/por-facturar/actions';
import type { PaginaSinMapear } from '@/lib/db/facturacion-agenda';

const POR_PAGINA = 25;

export function SinMapearLista({ totalEmpresas, totalExpedientes }: { totalEmpresas: number; totalExpedientes: number }) {
  const [q, setQ] = useState('');
  const [qAplicada, setQAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<PaginaSinMapear | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { const t = setTimeout(() => { setQAplicada(q.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let vivo = true; setCargando(true); setError('');
    empresasSinMapearAction(qAplicada, pagina, POR_PAGINA).then(d => { if (vivo) setDatos(d); }).catch(e => { if (vivo) setError(e instanceof Error ? e.message : 'Error'); }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [qAplicada, pagina]);

  const total = datos?.totalEmpresas ?? totalEmpresas;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <input className="input" placeholder="Buscar empresa de la Agenda…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 300 }} aria-label="Buscar empresa sin mapear" />
          <span className="cell-mute">{totalEmpresas} empresa{totalEmpresas === 1 ? '' : 's'} · {totalExpedientes} expediente{totalExpedientes === 1 ? '' : 's'} en cola sin cliente de financiero</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1 || cargando} aria-label="Página anterior"><I.ChevLeft size={13} /></button>
            <span className="num" data-paginacion>{pagina} / {paginas}</span>
            <button className="btn btn-ghost" onClick={() => setPagina(p => Math.min(paginas, p + 1))} disabled={pagina >= paginas || cargando} aria-label="Página siguiente"><I.ArrowRight size={13} /></button>
          </span>
        </div>
      </div>
      <div className="card">
        <table className="table" data-lista="sin-mapear">
          <thead><tr><th>Empresa en la Agenda</th><th className="num">Expedientes en cola</th><th>Ingreso más antiguo</th><th>Más reciente</th><th style={{ width: 120 }}></th></tr></thead>
          <tbody>
            {error && <tr><td colSpan={5} style={{ color: 'var(--wine)', padding: 20 }}>{error}</td></tr>}
            {!error && cargando && !datos && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>Cargando empresas…</td></tr>}
            {!error && datos && datos.filas.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>{qAplicada ? 'Ninguna empresa con esa búsqueda.' : 'Todas las empresas con expedientes en cola están mapeadas.'}</td></tr>}
            {datos?.filas.map(f => {
              const href = `/por-facturar/${encodeURIComponent('e-' + f.empresaIdExterno)}`;
              return (
                <tr key={f.empresaIdExterno} style={{ opacity: cargando ? 0.6 : 1 }} data-empresa={f.empresaIdExterno}>
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
