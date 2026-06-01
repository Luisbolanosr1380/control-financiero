'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import type { Acreedor } from '@/lib/db/deudas';
import type { PagoEnriquecido } from '@/lib/db/pagos-deudas';

interface Props {
  pagos: PagoEnriquecido[];
  acreedores: Acreedor[];
}

const METODOS = ['Transferencia', 'Cheque', 'Efectivo', 'Tarjeta', 'Domiciliado', 'Compensación'];

function formatFecha(s: string): string {
  if (!s || s === 'SIN-FECHA') return '—';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

export function PagosDeudasClient({ pagos, acreedores }: Props) {
  const router = useRouter();

  const [metodo, setMetodo] = useState('');
  const [banco, setBanco] = useState('');
  const [acreedorId, setAcreedorId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [search, setSearch] = useState('');

  const bancos = useMemo(() => [...new Set(pagos.map(p => p.cuentaBancoName).filter(Boolean))].sort(), [pagos]);

  const filtrados = useMemo(() => {
    let r = pagos;
    if (metodo)     r = r.filter(p => p.metodo === metodo);
    if (banco)      r = r.filter(p => p.cuentaBancoName === banco);
    if (acreedorId) r = r.filter(p => p.acreedorId === acreedorId);
    if (desde)      r = r.filter(p => p.fecha >= desde);
    if (hasta)      r = r.filter(p => p.fecha <= hasta);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(p =>
        p.acreedorNombre.toLowerCase().includes(q) ||
        p.deudaNombre.toLowerCase().includes(q) ||
        p.referencia.toLowerCase().includes(q),
      );
    }
    return r;
  }, [pagos, metodo, banco, acreedorId, desde, hasta, search]);

  const sumaTotal   = filtrados.reduce((s, p) => s + p.montoTotal, 0);
  const sumaCapital = filtrados.reduce((s, p) => s + p.capital, 0);

  const limpiar = () => {
    setMetodo(''); setBanco(''); setAcreedorId(''); setDesde(''); setHasta(''); setSearch('');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pagos a acreedores</h1>
          <div className="page-subtitle">
            Mostrando <span className="num">{filtrados.length}</span> de <span className="num">{pagos.length}</span> pagos recientes
            {' · '}
            <span className="num">Total filtrado: {Q(sumaTotal)}</span>
            {sumaCapital !== sumaTotal && <> · <span className="num">Capital: {Q(sumaCapital)}</span></>}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card" style={{ padding: 0, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} style={selectStyle}>
            <option value="">Método (todos)</option>
            {METODOS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={banco} onChange={(e) => setBanco(e.target.value)} style={selectStyle}>
            <option value="">Banco (todos)</option>
            {bancos.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={acreedorId} onChange={(e) => setAcreedorId(e.target.value)} style={selectStyle}>
            <option value="">Acreedor (todos)</option>
            {acreedores.map(a => <option key={a.id} value={a.id}>{a.nombre || a.nombreLegal}</option>)}
          </select>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={selectStyle} title="Desde" />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={selectStyle} title="Hasta" />
          <div className="toolbar-search" style={{ marginLeft: 'auto' }}>
            <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
            <input placeholder="Acreedor, deuda, referencia..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={limpiar} style={{ fontSize: 11 }}>Limpiar</button>
        </div>
      </div>

      {/* Tabla */}
      <div className="table-wrap" style={{ borderRadius: 'var(--r-3, 10px)' }}>
        <table className="table" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th className="num" style={{ width: 100 }}>Fecha</th>
              <th>Acreedor</th>
              <th>Deuda</th>
              <th className="num" style={{ width: 110 }}>Total</th>
              <th className="num" style={{ width: 110 }}>Capital</th>
              <th style={{ width: 120 }}>Método</th>
              <th style={{ width: 140 }}>Referencia</th>
              <th style={{ width: 200 }}>Banco</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={8} style={{ height: 160, textAlign: 'center', color: 'var(--ink-4)' }}>
                <I.Coins size={26} style={{ opacity: 0.4, marginBottom: 6 }} />
                <div style={{ fontSize: 13 }}>No hay pagos que coincidan con el filtro</div>
              </td></tr>
            ) : filtrados.map(p => (
              <tr key={p.id} className="clickable" onClick={() => router.push(`/deudas/${p.deudaId}`)}>
                <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{formatFecha(p.fecha)}</td>
                <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.acreedorNombre}>
                  <span
                    onClick={(e) => { e.stopPropagation(); router.push(`/acreedores/${p.acreedorId}`); }}
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                  >
                    {p.acreedorNombre || '—'}
                  </span>
                </td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.deudaNombre}>{p.deudaNombre || '—'}</td>
                <td className="num cell-strong">{Q(p.montoTotal)}</td>
                <td className="num">{Q(p.capital)}</td>
                <td><span className="badge badge-outline" style={{ fontSize: 10.5 }}>{p.metodo}</span></td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.referencia}>{p.referencia || '—'}</td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.cuentaBancoName}>{p.cuentaBancoName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};
