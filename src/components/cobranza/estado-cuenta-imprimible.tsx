/**
 * CENTRO DE COBROS · PR 2 (035) · «Estado de cuenta» imprimible (server component): mismo molde del detalle (logo,
 * emisor con NIT y dirección, tipografía serif, tabla compacta que no se parte entre hojas). Facturas abiertas con su
 * antigüedad y saldo real, totales, tramos, cedidas a factoraje aparte, paquetes prepagados con remanente y datos para pagar.
 */
import { Q } from '@/lib/utils';
import { ETIQUETA_TRAMO, fechaLarga, type EstadoCuenta } from '@/lib/cobranza/recordatorios';
import { ImprimirBoton } from '@/components/por-facturar/imprimir-boton';

const f = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

export function EstadoCuentaImprimible({ ec, emisor, volverA }: { ec: EstadoCuenta; emisor: { nombre: string; nit: string; direccion: string; logoUrl?: string | null }; volverA: string }) {
  const tramos = ec.aging.filter(a => a.n > 0);
  return (
    <main style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', maxWidth: 820, margin: '0 auto', padding: '32px 28px', background: '#fff' }} data-estado-cuenta={ec.totales.n} data-saldo={ec.totales.saldo.toFixed(2)}>
      <style>{`
        @media print { .no-print { display: none !important; } body { margin: 0; } main { padding: 0 !important; max-width: none !important; } @page { size: letter portrait; margin: 14mm 12mm; } .doc-tabla thead { display: table-header-group; } .doc-tabla tr { break-inside: avoid; page-break-inside: avoid; } }
        .doc-tabla { width: 100%; border-collapse: collapse; font-size: 11px; line-height: 1.3; }
        .doc-tabla th { text-align: left; font-weight: 600; border-bottom: 1.5px solid #111; padding: 5px 6px; font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; }
        .doc-tabla td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
        .doc-tabla td.num, .doc-tabla th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .doc-tabla tfoot td { border-bottom: 0; border-top: 1.5px solid #111; font-weight: 600; }
        .doc-mute { color: #666; font-size: 9.5px; } .doc-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; } .doc-kpis div { border: 1px solid #ddd; padding: 8px 10px; font-size: 11px; } .doc-kpis b { display: block; font-size: 16px; margin-top: 2px; }
        .doc-bloque { border: 1px solid #111; padding: 10px 12px; margin-top: 16px; font-size: 11.5px; white-space: pre-line; }
      `}</style>
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 16 }}>
        <a href={volverA} style={{ fontSize: 13, color: '#444', alignSelf: 'center' }}>← Volver a la ficha de cobranza</a>
        <ImprimirBoton />
      </div>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 24, borderBottom: '2px solid #111', paddingBottom: 12, marginBottom: 14 }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {emisor.logoUrl && <img src={emisor.logoUrl} alt={emisor.nombre} style={{ height: 46, width: 'auto', display: 'block', marginBottom: 8 }} data-logo />}
          <div style={{ fontSize: 17, fontWeight: 600 }}>{emisor.nombre}</div>
          {emisor.nit && <div className="doc-mute">NIT {emisor.nit}</div>}
          {emisor.direccion && <div className="doc-mute">{emisor.direccion}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Estado de cuenta</div>
          <div className="doc-mute">Al {fechaLarga(ec.hoy)}</div>
          <div className="doc-mute" style={{ marginTop: 4 }}>Saldos a la fecha: total de cada factura menos cobros y notas de crédito aplicados.</div>
        </div>
      </header>
      <section style={{ marginBottom: 6, fontSize: 12 }} data-cliente>
        <div><strong>Cliente:</strong> {ec.cliente.nombre}</div>
        <div><strong>NIT:</strong> {ec.cliente.nit || '—'}{ec.cliente.diasCredito ? <span className="doc-mute"> · {ec.cliente.diasCredito} días de crédito</span> : null}</div>
      </section>
      <div className="doc-kpis">
        <div>Saldo pendiente<b className="num" data-kpi="saldo">{Q(ec.totales.saldo)}</b><span className="doc-mute">{ec.totales.n} factura{ec.totales.n === 1 ? '' : 's'}</span></div>
        <div>Vencido<b style={{ color: ec.totales.vencido > 0 ? '#8a2a2a' : '#111' }}>{Q(ec.totales.vencido)}</b><span className="doc-mute">{ec.totales.nVencidas} vencida{ec.totales.nVencidas === 1 ? '' : 's'}</span></div>
        <div>Por vencer<b>{Q(ec.totales.porVencer)}</b><span className="doc-mute">{tramos.length ? tramos.map(t => `${t.etiqueta} ${Q(t.monto)}`).join(' · ') : 'sin antigüedad'}</span></div>
      </div>
      <table className="doc-tabla" data-tabla-ec>
        <thead><tr><th>Factura</th><th className="num">Emisión</th><th className="num">Vence</th><th className="num">Días</th><th className="num">Total</th><th className="num">Cobrado</th><th className="num">Notas de crédito</th><th className="num">Saldo</th><th>Antigüedad</th></tr></thead>
        <tbody>
          {ec.facturas.length === 0 && <tr><td colSpan={9} className="doc-mute" style={{ padding: 14, textAlign: 'center' }}>Sin facturas pendientes de pago.</td></tr>}
          {ec.facturas.map(x => (
            <tr key={x.noFactura} data-factura={x.noFactura} data-tramo={x.tramo}>
              <td>{x.noFactura}</td><td className="num">{f(x.fechaEmision)}</td><td className="num">{f(x.fechaVencimiento)}</td>
              <td className="num" style={{ color: x.diasVencida > 0 ? '#8a2a2a' : '#444' }}>{x.diasVencida > 0 ? `${x.diasVencida} vencida` : x.diasVencida === 0 ? 'vence hoy' : `en ${-x.diasVencida}`}</td>
              <td className="num">{Q(x.total)}</td><td className="num">{x.cobrado ? Q(x.cobrado) : '—'}</td><td className="num">{x.ncs ? Q(x.ncs) : '—'}</td><td className="num"><strong>{Q(x.saldo)}</strong></td><td>{ETIQUETA_TRAMO[x.tramo]}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={7} className="num">Saldo pendiente</td><td className="num">{Q(ec.totales.saldo)}</td><td></td></tr></tfoot>
      </table>
      {ec.cedidas.length > 0 && <p className="doc-mute" style={{ marginTop: 8 }} data-cedidas={ec.cedidas.length}>Facturas cedidas a factoraje (las cobra el financiador, no suman al saldo): {ec.cedidas.map(x => `${x.noFactura} (${Q(x.saldo)})`).join(', ')}.</p>}
      {ec.paquetes.length > 0 && (
        <section style={{ marginTop: 16, fontSize: 11.5 }} data-paquetes={ec.paquetes.length}>
          <div style={{ fontWeight: 600, borderBottom: '1px solid #111', paddingBottom: 3, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>Paquetes prepagados</div>
          {ec.paquetes.map(p => <div key={p.correlativo}>{p.correlativo} · {p.nombre}: <strong>{p.usadas} usadas de {p.cantidad} · {p.remanente} restantes</strong>{p.venceEn ? ` · vence ${f(p.venceEn)}` : ''} <span className="doc-mute">· las pruebas cubiertas por el paquete no generan factura</span></div>)}
        </section>
      )}
      {ec.datosPago && <div className="doc-bloque" data-datos-pago>{ec.datosPago}</div>}
      <p className="doc-mute" style={{ marginTop: 18 }}>Documento informativo generado el {fechaLarga(ec.hoy)}; no sustituye a las facturas. Si ya realizó algún pago que no aparece, le agradecemos indicarnos la fecha y el banco para aplicarlo.</p>
    </main>
  );
}
