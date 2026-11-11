'use client';

/**
 * PRODUCCIÓN POR MES (025): tabla mes × (terminado, facturado, cobrado, backlog, fuera de la
 * cola, no se cobra); clic en un mes → detalle por línea de negocio y por cliente; selector de
 * rango (navega con ?desde&hasta); "Exportar CSV" arma el archivo en el navegador con los
 * mismos datos. Montos SIN IVA del tarifario. Sin diálogos del navegador.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { csvProduccion, ETIQUETA_LINEA, etiquetaMes, mesesEntre, sumarMeses, totalProduccion, type FilaProduccion, type ProduccionMensual } from '@/lib/facturacion-agenda/produccion';

interface Props { datos: ProduccionMensual | null; desde: string; hasta: string; disponible: boolean }

const pct = (parte: number, total: number): string => { if (total <= 0) return '—'; const p = Math.round((parte / total) * 100); return p === 0 && parte > 0 ? '<1 %' : `${p} %`; };

export function ProduccionMensualView({ datos, desde, hasta, disponible }: Props) {
  const router = useRouter();
  const [mesSel, setMesSel] = useState<string | null>(null);
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  // Todos los meses del rango, también los que no tienen producción (fila en cero).
  const filas = useMemo<FilaProduccion[]>(() => {
    const por = new Map((datos?.meses ?? []).map(m => [m.mes, m]));
    return mesesEntre(desde, hasta).map(m => por.get(m) ?? { ...totalProduccion([]), mes: m });
  }, [datos, desde, hasta]);
  const total = useMemo(() => totalProduccion(filas), [filas]);
  const aplicar = () => router.push(`/por-facturar/produccion?desde=${d}&hasta=${h < d ? d : h}`);
  const mover = (n: number) => router.push(`/por-facturar/produccion?desde=${sumarMeses(desde, n)}&hasta=${sumarMeses(hasta, n)}`);
  const exportar = () => {
    if (!datos) return;
    const blob = new Blob([csvProduccion(datos)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `produccion-${desde}_${hasta}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const detLineas = (datos?.por_servicio ?? []).filter(x => x.mes === mesSel);
  const detClientes = (datos?.por_cliente ?? []).filter(x => x.mes === mesSel);
  const fuentes = datos?.por_fuente ?? [];
  const totalFuentes = fuentes.reduce((s, f) => s + f.n, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><Link href="/por-facturar" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Por facturar</Link></div>
          <h1 className="page-title">Producción por mes de terminación</h1>
          <div className="page-subtitle">Cada prueba cuenta en el mes en que <strong>tuvo resultado</strong> (no en el de ingreso), y se compara con lo <strong>facturado</strong> y lo <strong>cobrado</strong> de ese mismo lote. Montos <strong>sin IVA</strong> del tarifario. Lo que no tiene fecha confiable se cuenta aparte, nunca se inventa.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={exportar} disabled={!datos} data-accion="exportar-csv"><I.Download size={13} /> Exportar CSV</button>
        </div>
      </div>

      {!disponible && <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }} role="status"><div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>016_facturacion_agenda</strong> en esta base.</div></div>}
      {disponible && !datos && <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }} role="status" data-falta-025><div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>025_fecha_resultado_prueba</strong> en esta base: el reporte se calcula en SQL con la fecha de resultado de cada prueba.</div></div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <button className="btn btn-ghost" onClick={() => mover(-1)} aria-label="Un mes atrás" title="Un mes atrás"><I.ChevLeft size={13} /></button>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Desde <input className="input" type="month" value={d} onChange={e => setD(e.target.value)} aria-label="Mes desde" /></label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Hasta <input className="input" type="month" value={h} onChange={e => setH(e.target.value)} aria-label="Mes hasta" /></label>
          <button className="btn btn-secondary" onClick={aplicar} disabled={!/^\d{4}-\d{2}$/.test(d) || !/^\d{4}-\d{2}$/.test(h)} data-accion="aplicar-rango">Aplicar</button>
          <button className="btn btn-ghost" onClick={() => mover(1)} aria-label="Un mes adelante" title="Un mes adelante"><I.Chevron size={13} /></button>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{etiquetaMes(desde)} – {etiquetaMes(hasta)}{datos ? ` · al ${datos.hoy}` : ''}</span>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="terminado"><div className="kpi-label">Terminado (producción)</div><div className="kpi-value">{Q(total.terminado_q)}</div><div className="kpi-delta"><span className="vs">{total.terminado_n} prueba{total.terminado_n === 1 ? '' : 's'}{total.sin_tarifa_n ? ` · ${total.sin_tarifa_n} sin tarifa (no suman)` : ''}</span></div></div>
        <div className="kpi" data-kpi="facturado"><div className="kpi-label">Facturado</div><div className="kpi-value">{Q(total.facturado_q)}</div><div className="kpi-delta"><span className="vs">{total.facturado_n} prueba{total.facturado_n === 1 ? '' : 's'} · {pct(total.facturado_n, total.terminado_n)} de lo terminado</span></div></div>
        <div className="kpi" data-kpi="cobrado"><div className="kpi-label">Cobrado</div><div className="kpi-value">{Q(total.cobrado_q)}</div><div className="kpi-delta"><span className="vs">{total.cobrado_n} prueba{total.cobrado_n === 1 ? '' : 's'} · {pct(total.cobrado_n, total.facturado_n)} de lo facturado</span></div></div>
        <div className="kpi" data-kpi="cubiertas" title="Pruebas cubiertas por un paquete prepagado: producidas, valoradas a su precio unitario; no son backlog de facturación"><div className="kpi-label">Cubiertas por anticipo</div><div className="kpi-value">{total.cubierta_n}</div><div className="kpi-delta"><span className="vs">{Q(total.cubierta_q)} sin IVA</span></div></div>
        <div className="kpi" data-kpi="backlog" title="Terminado y todavía sin factura, en cola (cobro pendiente en la Agenda, dentro del arranque del cliente)"><div className="kpi-label">Backlog de facturación</div><div className="kpi-value" style={{ color: total.backlog_n ? 'var(--burnt, #b5651d)' : undefined }}>{Q(total.backlog_q)}</div><div className="kpi-delta"><span className="vs">{total.backlog_n} prueba{total.backlog_n === 1 ? '' : 's'}{total.backlog_dias_max ? ` · la más vieja ${total.backlog_dias_max} días` : ''}</span></div></div>
        <div className="kpi" data-kpi="fuera-cola" title="Terminado sin factura nuestra pero ya resuelto del lado de la Agenda: pagado por provisión, facturado fuera de la app o anterior al arranque del cliente"><div className="kpi-label">Resuelto fuera de la app</div><div className="kpi-value" style={{ color: 'var(--ink-3)' }}>{Q(total.fuera_cola_q)}</div><div className="kpi-delta"><span className="vs">{total.fuera_cola_n} prueba{total.fuera_cola_n === 1 ? '' : 's'} · {total.no_cobra_n} no se cobran</span></div></div>
        <div className="kpi" data-kpi="sin-fecha" title="Pruebas cobrables sin fecha de resultado confiable: no entran en ningún mes. Bajan cuando la Agenda mande sus fechas de resultado."><div className="kpi-label">Sin fecha (no entran)</div><div className="kpi-value" style={{ color: datos?.sin_fecha.n ? 'var(--wine)' : undefined }}>{datos?.sin_fecha.n ?? 0}</div><div className="kpi-delta"><span className="vs">{datos ? `${Q(datos.sin_fecha.q)} · ${datos.sin_fecha.sin_factura_n} sin factura` : '—'}</span></div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="table-scroll">
          <table className="table" data-tabla="produccion">
            <thead><tr><th>Mes de terminación</th><th className="num">Terminado</th><th className="num">Q sin IVA</th><th className="num">Sin tarifa</th><th className="num">Facturado</th><th className="num">Q facturado</th><th className="num">Cobrado</th><th className="num">Q cobrado</th><th className="num" title="034: cubiertas por un paquete prepagado (producidas a su precio unitario; no son backlog)">Cubiertas</th><th className="num">Backlog</th><th className="num">Q backlog</th><th className="num" title="Antigüedad promedio / máxima del backlog, en días desde el resultado">Días</th><th className="num" title="Sin factura nuestra pero resuelto en la Agenda (pagado / facturado fuera / antes del arranque)">Fuera de cola</th><th className="num">No se cobra</th></tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.mes} className="clickable" style={{ cursor: 'pointer', background: mesSel === f.mes ? 'var(--paper-2, rgba(0,0,0,0.03))' : undefined }} onClick={() => setMesSel(mesSel === f.mes ? null : f.mes)} data-mes={f.mes} aria-selected={mesSel === f.mes}>
                  <td className="cell-strong">{etiquetaMes(f.mes)} <span className="cell-mute" style={{ fontSize: 11 }}>{mesSel === f.mes ? '▾' : '▸'}</span></td>
                  <td className="num">{f.terminado_n || '—'}</td>
                  <td className="num cell-strong">{f.terminado_q ? Q(f.terminado_q) : '—'}</td>
                  <td className="num" style={{ color: f.sin_tarifa_n ? 'var(--burnt, #b5651d)' : undefined }}>{f.sin_tarifa_n || '—'}</td>
                  <td className="num">{f.facturado_n || '—'}</td>
                  <td className="num">{f.facturado_q ? Q(f.facturado_q) : '—'}</td>
                  <td className="num">{f.cobrado_n || '—'}</td>
                  <td className="num">{f.cobrado_q ? Q(f.cobrado_q) : '—'}</td>
                  <td className="num cell-mute" data-cubiertas={f.cubierta_n}>{f.cubierta_n ? `${f.cubierta_n} · ${Q(f.cubierta_q)}` : '—'}</td>
                  <td className="num" style={{ color: f.backlog_n ? 'var(--burnt, #b5651d)' : undefined }}>{f.backlog_n || '—'}</td>
                  <td className="num">{f.backlog_q ? Q(f.backlog_q) : '—'}</td>
                  <td className="num cell-mute" style={{ fontSize: 12 }}>{f.backlog_n ? `${f.backlog_dias_prom ?? '—'} / ${f.backlog_dias_max ?? '—'}` : '—'}</td>
                  <td className="num cell-mute">{f.fuera_cola_n ? `${f.fuera_cola_n} · ${Q(f.fuera_cola_q)}` : '—'}</td>
                  <td className="num cell-mute">{f.no_cobra_n || '—'}</td>
                </tr>
              ))}
              <tr data-mes="total" style={{ fontWeight: 600, borderTop: '2px solid var(--line-2)' }}>
                <td>Total del rango</td>
                <td className="num">{total.terminado_n}</td><td className="num">{Q(total.terminado_q)}</td><td className="num">{total.sin_tarifa_n || '—'}</td>
                <td className="num">{total.facturado_n}</td><td className="num">{Q(total.facturado_q)}</td>
                <td className="num">{total.cobrado_n}</td><td className="num">{Q(total.cobrado_q)}</td><td className="num cell-mute">{total.cubierta_n ? `${total.cubierta_n} · ${Q(total.cubierta_q)}` : '—'}</td>
                <td className="num">{total.backlog_n}</td><td className="num">{Q(total.backlog_q)}</td><td className="num cell-mute">{total.backlog_dias_max ? `máx ${total.backlog_dias_max}` : '—'}</td>
                <td className="num cell-mute">{total.fuera_cola_n ? `${total.fuera_cola_n} · ${Q(total.fuera_cola_q)}` : '—'}</td><td className="num cell-mute">{total.no_cobra_n || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {mesSel && (
        <div className="card" style={{ marginBottom: 12 }} data-detalle-mes={mesSel}>
          <div className="card-head"><div className="card-title">{etiquetaMes(mesSel)} · por línea de negocio y por cliente</div><div className="card-actions"><button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setMesSel(null)}>Cerrar</button></div></div>
          <div className="table-scroll">
            <table className="table" data-tabla="por-servicio">
              <thead><tr><th>Línea</th><th className="num">Terminado</th><th className="num">Q sin IVA</th><th className="num">Sin tarifa</th><th className="num">Facturado</th><th className="num">Q facturado</th><th className="num">Cobrado</th><th className="num">Q cobrado</th><th className="num" title="034: cubiertas por un paquete prepagado (producidas a su precio unitario; no son backlog)">Cubiertas</th><th className="num">Backlog</th><th className="num">Q backlog</th><th className="num">No se cobra</th></tr></thead>
              <tbody>
                {detLineas.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', padding: 18, color: 'var(--ink-4)' }}>Sin pruebas con resultado en este mes.</td></tr>}
                {detLineas.map(x => <tr key={x.linea} data-linea={x.linea}><td className="cell-strong">{ETIQUETA_LINEA[x.linea] ?? x.linea}</td><td className="num">{x.terminado_n}</td><td className="num">{Q(x.terminado_q)}</td><td className="num">{x.sin_tarifa_n || '—'}</td><td className="num">{x.facturado_n || '—'}</td><td className="num">{x.facturado_q ? Q(x.facturado_q) : '—'}</td><td className="num">{x.cobrado_n || '—'}</td><td className="num">{x.cobrado_q ? Q(x.cobrado_q) : '—'}</td><td className="num cell-mute" data-cubiertas={x.cubierta_n}>{x.cubierta_n ? `${x.cubierta_n} · ${Q(x.cubierta_q)}` : '—'}</td><td className="num">{x.backlog_n || '—'}</td><td className="num">{x.backlog_q ? Q(x.backlog_q) : '—'}</td><td className="num cell-mute">{x.no_cobra_n || '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="table" data-tabla="por-cliente">
              <thead><tr><th>Cliente</th><th className="num">Terminado</th><th className="num">Q sin IVA</th><th className="num">Sin tarifa</th><th className="num">Facturado</th><th className="num">Q facturado</th><th className="num">Cobrado</th><th className="num">Q cobrado</th><th className="num" title="034: cubiertas por un paquete prepagado (producidas a su precio unitario; no son backlog)">Cubiertas</th><th className="num">Backlog</th><th className="num">Q backlog</th><th className="num">Días</th><th className="num">No se cobra</th></tr></thead>
              <tbody>
                {detClientes.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', padding: 18, color: 'var(--ink-4)' }}>Sin clientes con resultado en este mes.</td></tr>}
                {detClientes.map(x => (
                  <tr key={`${x.nit_resuelto ?? ''}|${x.empresa}`} data-cliente={x.nit_resuelto ?? x.empresa}>
                    <td>{x.nit_resuelto ? <Link href={`/por-facturar/${encodeURIComponent(`n-${x.nit_resuelto}`)}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }}>{x.empresa}</Link> : <span className="cell-strong">{x.empresa}</span>}<div className="cell-mute" style={{ fontSize: 11 }}>{x.nit_resuelto ? <span className="num">NIT {x.nit_resuelto}</span> : 'sin mapear'}</div></td>
                    <td className="num">{x.terminado_n}</td><td className="num">{Q(x.terminado_q)}</td><td className="num">{x.sin_tarifa_n || '—'}</td>
                    <td className="num">{x.facturado_n || '—'}</td><td className="num">{x.facturado_q ? Q(x.facturado_q) : '—'}</td>
                    <td className="num">{x.cobrado_n || '—'}</td><td className="num">{x.cobrado_q ? Q(x.cobrado_q) : '—'}</td><td className="num cell-mute" data-cubiertas={x.cubierta_n}>{x.cubierta_n ? `${x.cubierta_n} · ${Q(x.cubierta_q)}` : '—'}</td>
                    <td className="num" style={{ color: x.backlog_n ? 'var(--burnt, #b5651d)' : undefined }}>{x.backlog_n || '—'}</td><td className="num">{x.backlog_q ? Q(x.backlog_q) : '—'}</td>
                    <td className="num cell-mute" style={{ fontSize: 12 }}>{x.backlog_n ? `${x.backlog_dias_prom ?? '—'} / ${x.backlog_dias_max ?? '—'}` : '—'}</td>
                    <td className="num cell-mute">{x.no_cobra_n || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {datos && (
        <div className="card">
          <div className="card-pad" style={{ fontSize: 12.5, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }} data-fuentes>
            <span className="cell-mute">Completitud del dato (todas las pruebas con resultado):</span>
            {fuentes.map(f => <span key={f.fuente} className="badge badge-mute" style={{ fontSize: 11 }} title={{ agenda: 'fecha real que mandó la Agenda', detectado: 'primera vez que este sistema vio el cambio (aviso o sync)', fecha_entrega: 'fecha de entrega del expediente (histórico confiable)', sin_dato: 'sin fecha confiable: no entran en ningún mes', sin_fuente: 'pendientes de evaluar' }[f.fuente] ?? f.fuente}>{f.fuente.replace('_', ' ')}: <strong>{f.n}</strong>{totalFuentes ? ` (${pct(f.n, totalFuentes)})` : ''}</span>)}
            {datos.inconsistencias > 0 && <span className="badge badge-wine" style={{ fontSize: 11 }} title="Pruebas con fecha de resultado anterior al ingreso">⚠ {datos.inconsistencias} inconsistencia{datos.inconsistencias === 1 ? '' : 's'}</span>}
            <span className="cell-mute" style={{ marginLeft: 'auto' }}>Cuando la Agenda mande <code>fechaResultadoPoligrafo</code> / <code>fechaResultadoSocio</code>, esas fechas reemplazan a las detectadas y el &quot;sin dato&quot; baja solo.</span>
          </div>
        </div>
      )}
    </div>
  );
}
