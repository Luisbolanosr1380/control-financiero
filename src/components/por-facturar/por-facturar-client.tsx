'use client';

/**
 * POR FACTURAR · AGENDA — maestro: KPIs globales, estado del sync ("Traer ahora")
 * y dos pestañas: "Facturables" (una fila por cliente con expedientes en cola
 * resueltos o sin tarifa) y "Sin mapear" (empresas de la Agenda agregadas en SQL,
 * paginadas y pedidas on demand). Las psicométricas solo se cuentan. Nunca se
 * carga el espejo completo. Click → detalle del cliente. Sin diálogos del navegador.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { usePuede } from '@/components/auth/permisos';
import { Q } from '@/lib/utils';
import { formatearFechaConHora } from '@/lib/utils/fechas';
import { sincronizarAgendaAction } from '@/app/(app)/por-facturar/actions';
import { filtrarGrupos, type GrupoCliente, type KpisPorFacturar } from '@/lib/facturacion-agenda/resumen';
import type { SyncEstado } from '@/lib/facturacion-agenda/tipos';
import { SinMapearLista } from './sin-mapear-lista';

interface Props { disponible: boolean; configurada: boolean; writeback: boolean; grupos: GrupoCliente[]; kpis: KpisPorFacturar; sync: SyncEstado | null; total: number; sinMapear: { expedientes: number; empresas: number }; agregadoEnSql: boolean }
type Pestana = 'facturables' | 'sin_mapear';

export function PorFacturarClient({ disponible, configurada, writeback, grupos, kpis, sync, total, sinMapear, agregadoEnSql }: Props) {
  const [pestana, setPestana] = useState<Pestana>('facturables');
  const router = useRouter();
  const puede = usePuede();
  const puedeFacturar = puede('facturar_agenda');
  const [q, setQ] = useState('');
  const [soloAccion, setSoloAccion] = useState(false);
  const [busy, setBusy] = useState(false);
  const filas = useMemo(() => filtrarGrupos(grupos, q, soloAccion), [grupos, q, soloAccion]);
  const irASinMapear = () => setPestana('sin_mapear');

  const traer = async () => {
    setBusy(true);
    try {
      const r = await sincronizarAgendaAction();
      if (r.omitido) toast.message(r.omitido);
      else if (r.ok) toast.success(`Agenda: ${r.leidos} expediente(s) en ${r.paginas} página(s)${r.reclasificados ? ` · ${r.reclasificados} re-resueltos` : ''}`);
      else toast.error(r.error ?? 'No se pudo traer de la Agenda');
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Por facturar · Agenda</h1>
          <div className="page-subtitle">Expedientes de evaluación <strong>terminados</strong> con cobro pendiente en la Agenda de Golden, con su precio del tarifario (<strong>sin IVA</strong>). Psicométricas quedan fuera (trato aparte).</div>
        </div>
        <div className="page-actions">
          {puedeFacturar && disponible && (
            <button className="btn btn-secondary" onClick={() => void traer()} disabled={busy || !configurada} title={configurada ? 'GET /expedientes?cambiadosDesde=… de la Agenda' : 'Este deploy no tiene llave de la Agenda'}>
              <I.Refresh size={13} /> {busy ? 'Trayendo…' : 'Traer ahora'}
            </button>
          )}
        </div>
      </div>

      {!disponible && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }} role="status">
          <div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>016_facturacion_agenda</strong> en esta base.</div>
        </div>
      )}
      {disponible && !configurada && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }} role="status">
          <div className="card-pad" style={{ fontSize: 13 }}>Este deploy no tiene <strong>FACTURACION_API_KEY_AGENDA</strong>: no se trae nada de la Agenda ni se le escribe. Lo que se vea acá viene de pruebas o de un webhook.</div>
        </div>
      )}
      {disponible && configurada && !writeback && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }} role="status">
          <div className="card-pad" style={{ fontSize: 13 }}><strong>FACTURAR_WRITEBACK apagado</strong>: facturar deja todo en financiero pero no escribe el cobro de vuelta a la Agenda (corrida en seco).</div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="listos"><div className="kpi-label">Listos para facturar</div><div className="kpi-value">{kpis.listos}</div><div className="kpi-delta"><span className="vs">{kpis.clientes} cliente{kpis.clientes === 1 ? '' : 's'} · {total} expedientes en total</span></div></div>
        <div className="kpi" data-kpi="total"><div className="kpi-label">Total sin IVA</div><div className="kpi-value">{Q(kpis.totalSinIva)}</div><div className="kpi-delta"><span className="vs">con IVA {Q(kpis.totalConIva)}</span></div></div>
        <div className="kpi" data-kpi="sin-tarifa"><div className="kpi-label">Sin tarifa</div><div className="kpi-value" style={{ color: kpis.sinTarifa ? 'var(--burnt, #b5651d)' : undefined }}>{kpis.sinTarifa}</div><div className="kpi-delta"><span className="vs">falta cargarla en el tarifario</span></div></div>
        <div className="kpi" data-kpi="sin-mapear" role="button" tabIndex={0} onClick={irASinMapear} onKeyDown={e => { if (e.key === 'Enter') irASinMapear(); }} style={{ cursor: 'pointer' }} title="Ver las empresas sin mapear"><div className="kpi-label">Cliente sin mapear</div><div className="kpi-value" style={{ color: kpis.sinMapear ? 'var(--wine)' : undefined }}>{kpis.sinMapear}</div><div className="kpi-delta"><span className="vs">{sinMapear.empresas} empresa{sinMapear.empresas === 1 ? '' : 's'} de la Agenda · mapear →</span></div></div>
        <div className="kpi" data-kpi="facturados"><div className="kpi-label">Facturados desde acá</div><div className="kpi-value">{kpis.facturados}</div><div className="kpi-delta"><span className="vs" style={{ color: kpis.writebackPendiente ? 'var(--wine)' : undefined }}>{kpis.writebackPendiente ? `${kpis.writebackPendiente} sin confirmar en Agenda` : 'todos confirmados en Agenda'}</span></div></div>
        <div className="kpi" data-kpi="excluidos"><div className="kpi-label">Psicométricas (excluidas)</div><div className="kpi-value" style={{ color: 'var(--ink-3)' }}>{kpis.excluidos}</div><div className="kpi-delta"><span className="vs">no se facturan individual</span></div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <div><span className="cell-mute">Última corrida:</span> <span data-sync="ultima">{sync?.ultimaCorrida ? formatearFechaConHora(sync.ultimaCorrida) : 'nunca'}</span></div>
          <div><span className="cell-mute">Resultado:</span> {sync?.ultimoResultado || '—'}</div>
          <div><span className="cell-mute">Sincronizado hasta:</span> <span className="num">{sync?.ultimoActualizadoEn ? formatearFechaConHora(sync.ultimoActualizadoEn) : '—'}</span></div>
          <div className="cell-mute">{sync?.corridas ?? 0} corrida{(sync?.corridas ?? 0) === 1 ? '' : 's'} · cron cada 15 min + webhook</div>
          {disponible && !agregadoEnSql && <div className="cell-mute" role="status" title="Sin la 017 los conteos se hacen con consultas livianas; con ella, en SQL">· falta la migración 017 (agregados en SQL)</div>}
        </div>
      </div>

      <div role="tablist" aria-label="Pestañas" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button role="tab" aria-selected={pestana === 'facturables'} className={'btn ' + (pestana === 'facturables' ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPestana('facturables')}>Facturables <span className="cell-mute">({grupos.length} cliente{grupos.length === 1 ? '' : 's'})</span></button>
        <button role="tab" aria-selected={pestana === 'sin_mapear'} className={'btn ' + (pestana === 'sin_mapear' ? 'btn-secondary' : 'btn-ghost')} onClick={irASinMapear} data-tab="sin-mapear">Sin mapear <span className="cell-mute">({sinMapear.empresas} empresa{sinMapear.empresas === 1 ? '' : 's'} · {sinMapear.expedientes} exp.)</span></button>
      </div>

      {pestana === 'sin_mapear' ? <SinMapearLista totalEmpresas={sinMapear.empresas} totalExpedientes={sinMapear.expedientes} /> : <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <input className="input" placeholder="Buscar cliente por nombre o NIT…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 300 }} aria-label="Buscar cliente" />
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={soloAccion} onChange={e => setSoloAccion(e.target.checked)} aria-label="Solo con tarifas faltantes" />
            Solo con tarifas faltantes <span className="cell-mute">({grupos.filter(g => g.sinTarifa).length})</span>
          </label>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{filas.length} cliente{filas.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead><tr><th>Cliente</th><th className="num">Listos</th><th className="num">Total sin IVA</th><th className="num">Con IVA</th><th className="num">Sin tarifa</th><th className="num">Sin mapear</th><th className="num">Facturados</th><th>Desde</th><th style={{ width: 160 }}>Estado</th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-4)' }}>{grupos.length === 0 ? (sinMapear.expedientes ? 'Ningún cliente con precio resuelto todavía: mapeá las empresas en la pestaña "Sin mapear".' : configurada ? 'Todavía no hay expedientes: corré "Traer ahora" o esperá el cron.' : 'Sin expedientes en esta base.') : 'Ningún cliente con esa búsqueda.'}</td></tr>}
            {filas.map(g => {
              const href = `/por-facturar/${encodeURIComponent(g.clave)}`;
              return (
                <tr key={g.clave} className="clickable" style={{ cursor: 'pointer' }} onClick={() => router.push(href)} data-grupo={g.clave}>
                  <td>
                    <Link href={href} onClick={ev => ev.stopPropagation()} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{g.nombre}</Link>
                    <div className="cell-mute" style={{ fontSize: 11 }}>{g.nit ? <span className="num">NIT {g.nit}{g.nombreExterno && g.nombreExterno !== g.nombre ? ` · en la Agenda: ${g.nombreExterno}` : ''}</span> : <span>Empresa de la Agenda sin mapear</span>}</div>
                  </td>
                  <td className="num cell-strong">{g.listos || '—'}</td>
                  <td className="num">{g.totalSinIva ? Q(g.totalSinIva) : '—'}</td>
                  <td className="num cell-mute">{g.totalConIva ? Q(g.totalConIva) : '—'}</td>
                  <td className="num" style={{ color: g.sinTarifa ? 'var(--burnt, #b5651d)' : undefined }}>{g.sinTarifa || '—'}</td>
                  <td className="num" style={{ color: g.sinMapear ? 'var(--wine)' : undefined }}>{g.sinMapear || '—'}</td>
                  <td className="num">{g.facturados || '—'}{g.writebackPendiente ? <span className="badge badge-wine" style={{ fontSize: 10, marginLeft: 6 }} title="Factura creada, falta confirmar en Agenda">{g.writebackPendiente} sin confirmar</span> : null}</td>
                  <td className="num cell-mute" style={{ fontSize: 12 }}>{g.fechaIngresoMasAntigua ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {g.sinMapear > 0 && <span className="badge badge-wine" style={{ fontSize: 10 }}>Sin mapear</span>}
                    {g.sinTarifa > 0 && <span className="badge badge-warn" style={{ fontSize: 10, marginLeft: g.sinMapear ? 4 : 0 }}>Sin tarifa</span>}
                    {!g.sinMapear && !g.sinTarifa && g.listos > 0 && <span className="badge badge-olive" style={{ fontSize: 10 }}>Listo</span>}
                    {!g.sinMapear && !g.sinTarifa && !g.listos && <span className="badge badge-mute" style={{ fontSize: 10 }}>Al día</span>}
                    {g.conMegapaca > 0 && <span className="badge badge-outline" style={{ fontSize: 10, marginLeft: 4 }} title="Expedientes con cobro Megapaca aparte">Megapaca</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}
