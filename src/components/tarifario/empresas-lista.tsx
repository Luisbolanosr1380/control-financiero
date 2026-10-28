'use client';

/**
 * TARIFARIO · MAESTRO: una fila por empresa (NIT) con sus conteos, el
 * semáforo (rojo = tiene Q0, amarillo = pendientes, verde = todo aprobado),
 * las tarifas ESTANCADAS (sin subir precio más allá del umbral) y desde
 * cuándo no se le revisa precio en general. Primero las que requieren
 * acción, luego alfabético. Click → detalle.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { filtrarEmpresas, type EmpresaTarifario, type Semaforo } from '@/lib/tarifario/resumen';
import { UMBRAL_ESTANCADA_MESES_DEFAULT, fechaDesdeTexto } from '@/lib/tarifario/antiguedad';

const SEM: Record<Semaforo, { cls: string; text: string; color: string }> = {
  rojo:     { cls: 'badge-wine',  text: 'Sin tarifa',  color: 'var(--wine)' },
  amarillo: { cls: 'badge-warn',  text: 'Pendientes',  color: 'var(--burnt, #b5651d)' },
  verde:    { cls: 'badge-olive', text: 'Al día',      color: 'var(--olive)' },
};

export function EmpresasLista({ empresas, umbralMeses = UMBRAL_ESTANCADA_MESES_DEFAULT }: { empresas: EmpresaTarifario[]; umbralMeses?: number }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [soloEstancadas, setSoloEstancadas] = useState(false);
  const filas = useMemo(() => filtrarEmpresas(empresas, q, soloEstancadas), [empresas, q, soloEstancadas]);
  const conEstancadas = empresas.filter(e => e.estancadas > 0).length;
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <input className="input" placeholder="Buscar empresa por razón social o NIT…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 300 }} aria-label="Buscar empresa" />
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={soloEstancadas} onChange={e => setSoloEstancadas(e.target.checked)} aria-label="Solo con tarifas estancadas" />
            Solo con tarifas estancadas <span className="cell-mute">({conEstancadas})</span>
          </label>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{filas.length} empresa{filas.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th style={{ width: 28 }}></th><th>Empresa</th><th className="num">Tarifas activas</th><th className="num">Pendientes</th><th className="num">Sin tarifa (Q0)</th><th className="num" title={`Sin subir precio hace más de ${umbralMeses} meses`}>Estancadas</th><th>Precio desde</th><th style={{ width: 120 }}>Estado</th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>{empresas.length === 0 ? 'El tarifario está vacío. Cargá la primera tarifa en "Ver todas".' : soloEstancadas && !q ? 'Ninguna empresa con tarifas estancadas.' : 'Ninguna empresa con esa búsqueda.'}</td></tr>}
            {filas.map(e => {
              const s = SEM[e.semaforo];
              const href = `/tarifario/${encodeURIComponent(e.nit)}`;
              return (
                <tr key={e.nit} className="clickable" style={{ cursor: 'pointer' }} onClick={() => router.push(href)}>
                  <td><span aria-label={s.text} title={s.text} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: s.color }} /></td>
                  <td><Link href={href} onClick={ev => ev.stopPropagation()} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{e.razonSocial || '—'}</Link><div className="num cell-mute" style={{ fontSize: 11 }}>NIT {e.nit}</div></td>
                  <td className="num">{e.activas}</td>
                  <td className="num" style={{ color: e.pendientes ? 'var(--burnt, #b5651d)' : undefined }}>{e.pendientes || '—'}</td>
                  <td className="num" style={{ color: e.sinTarifa ? 'var(--wine)' : undefined }}>{e.sinTarifa || '—'}</td>
                  <td className="num" style={{ color: e.estancadas ? 'var(--wine)' : undefined }}>{e.estancadas || '—'}</td>
                  <td className="cell-mute" style={{ fontSize: 12, whiteSpace: 'nowrap' }} title="Desde cuándo no se le revisa precio: la tarifa menos reciente del cliente">{fechaDesdeTexto(e.precioDesde)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={'badge ' + s.cls} style={{ fontSize: 10 }}>{s.text}</span>
                    {e.estancadas > 0 && <span className="badge badge-wine" style={{ fontSize: 10, marginLeft: 4 }} title={`${e.estancadas} tarifa${e.estancadas === 1 ? '' : 's'} sin subir hace más de ${umbralMeses} meses`}>{e.estancadas} estancada{e.estancadas === 1 ? '' : 's'}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
