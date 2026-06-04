'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import type { Acreedor } from '@/lib/db/deudas';
import type { PagoEnriquecido } from '@/lib/db/pagos-deudas';

interface Props {
  pagos: PagoEnriquecido[];
  acreedores: Acreedor[];
}

const METODOS = ['Transferencia', 'Cheque', 'Efectivo', 'Tarjeta', 'Domiciliado', 'Compensación'];

const formatFecha = (s: string): string =>
  !s || s === 'SIN-FECHA' ? '—' : formatearFecha(s, 'dd/MM/yyyy');

export function PagosDeudasClient({ pagos, acreedores }: Props) {
  const router = useRouter();

  const [metodo, setMetodo] = useState('');
  const [banco, setBanco] = useState('');
  const [acreedorId, setAcreedorId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [search, setSearch] = useState('');
  // F-036: toggle anulados.
  const [mostrarAnulados, setMostrarAnulados] = useState(false);

  const bancos = useMemo(() => [...new Set(pagos.map(p => p.cuentaBancoName).filter(Boolean))].sort(), [pagos]);
  const numAnulados = useMemo(() => pagos.filter(p => p.estadoPago === 'Anulado').length, [pagos]);

  const filtrados = useMemo(() => {
    let r = pagos;
    if (!mostrarAnulados) r = r.filter(p => p.estadoPago === 'Activo');
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
  }, [pagos, metodo, banco, acreedorId, desde, hasta, search, mostrarAnulados]);

  const sumaTotal   = filtrados.reduce((s, p) => s + p.montoTotal, 0);
  const sumaCapital = filtrados.reduce((s, p) => s + p.capital, 0);

  const limpiar = () => {
    setMetodo(''); setBanco(''); setAcreedorId(''); setDesde(''); setHasta(''); setSearch('');
  };

  const sinPagos = pagos.length === 0;
  const filtrosActivos = !!(metodo || banco || acreedorId || desde || hasta || search.trim());

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pagos a acreedores</h1>
          {sinPagos
            ? <div className="page-subtitle">Sin pagos registrados todavía</div>
            : <>
                <div className="page-subtitle" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
                  <span style={{ fontWeight: 500 }}>{filtrosActivos ? 'Filtrado' : 'Total'}:</span>{' '}
                  <span className="num" style={{ fontWeight: 500 }}>{filtrados.length}</span> pagos
                  {' · '}
                  <span className="num" style={{ fontWeight: 500 }}>{Q(sumaTotal)}</span>
                  {sumaCapital !== sumaTotal && <> · <span className="num" style={{ color: 'var(--ink-3)' }}>Capital {Q(sumaCapital)}</span></>}
                </div>
                <div className="page-subtitle" style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
                  Mostrando <span className="num">{filtrados.length}</span> de <span className="num">{pagos.length}</span> pagos recientes
                </div>
              </>
          }
        </div>
      </div>

      {sinPagos && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-pad" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
            <I.Coins size={36} style={{ opacity: 0.5, marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 4 }}>
              Aún no se registró ningún pago
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Andá a <a href="/deudas" style={{ color: 'var(--olive)', textDecoration: 'underline' }}>/deudas</a>,
              {' '}abrí una deuda y tocá <strong>&quot;Registrar pago&quot;</strong>. Acá aparecerán todos los pagos cronológicamente.
            </div>
          </div>
        </div>
      )}

      {!sinPagos && (<>

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
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)', cursor: numAnulados === 0 ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={mostrarAnulados}
              onChange={(e) => setMostrarAnulados(e.target.checked)}
              disabled={numAnulados === 0}
            />
            <span>Mostrar anulados {numAnulados > 0 && <span className="num" style={{ color: 'var(--ink-4)' }}>({numAnulados})</span>}</span>
          </label>
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
            ) : filtrados.map(p => {
              const anulado = p.estadoPago === 'Anulado';
              return (
              <tr key={p.id} className="clickable" onClick={() => router.push(`/deudas/${p.deudaId}`)} style={{ opacity: anulado ? 0.55 : 1 }} title={anulado ? `Anulado: ${p.motivoAnulacion ?? ''}` : undefined}>
                <td className="num cell-strong" style={{ whiteSpace: 'nowrap', textDecoration: anulado ? 'line-through' : 'none' }}>{formatFecha(p.fecha)}</td>
                <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.acreedorNombre}>
                  <span
                    onClick={(e) => { e.stopPropagation(); router.push(`/acreedores/${p.acreedorId}`); }}
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                  >
                    {p.acreedorNombre || '—'}
                  </span>
                </td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.deudaNombre}>{p.deudaNombre || '—'}</td>
                <td className="num cell-strong" style={{ textDecoration: anulado ? 'line-through' : 'none' }}>{Q(p.montoTotal)}</td>
                <td className="num">{Q(p.capital)}</td>
                <td>
                  <span className="badge badge-outline" style={{ fontSize: 10.5 }}>{p.metodo}</span>
                  {anulado && <span className="badge badge-wine" style={{ fontSize: 9.5, padding: '1px 6px', marginLeft: 4 }}>Anulado</span>}
                </td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.referencia}>{p.referencia || '—'}</td>
                <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.cuentaBancoName}>{p.cuentaBancoName || '—'}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};
