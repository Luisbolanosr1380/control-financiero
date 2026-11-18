import { Q } from '@/lib/utils';
import { NOMBRE_SERVICIO, resultadoLegible } from '@/lib/facturacion-agenda/situacion';
import { esCompartido, etiquetaLinea, subtotalesPorNit, textoUsadas, totalCantidad, totalRemanente, totalUsadas, type PaqueteDetalle } from '@/lib/paquetes/paquete';
import { ImprimirBoton } from '@/components/por-facturar/imprimir-boton';

/**
 * «ESTADO DEL PAQUETE» imprimible (server component, fuera del shell): encabezado del emisor con logo y del cliente, el
 * paquete (nombre, factura del anticipo, vigencia), «Usadas 63 de 100 · Restan 37», por línea la tabla de pruebas
 * descontadas (persona, solicitante, fecha de resultado, resultado) y el remanente. Mismo formato que el detalle de
 * facturación: letra compacta, filas que no se parten entre hojas, encabezado repetido. Estilos propios + @media print.
 * 036: columna «Empresa / NIT» en cada prueba y, si el paquete lo usan varias empresas, el subtotal de usadas por NIT.
 */
const nombreServicio = (s: string) => NOMBRE_SERVICIO[s] ?? (s === 'PSICOMETRICAS' ? 'Psicométricas' : s);
const fecha = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

export function PaqueteImprimible({ datos, emisor, hoy }: { datos: PaqueteDetalle; emisor: { nombre: string; nit: string; direccion: string; logoUrl?: string | null }; hoy: string }) {
  const p = datos.paquete;
  const vigentes = datos.consumos.filter(c => !c.revertidoEn);
  const subtotales = subtotalesPorNit(datos);
  const compartido = esCompartido(p) || subtotales.length > 1;
  return (
    <main style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', maxWidth: 820, margin: '0 auto', padding: '32px 28px', background: '#fff' }} data-imprimible="paquete" data-paquete={p.correlativo}>
      <style>{`
        @media print {
          .no-print { display: none !important; } body { margin: 0; } main { padding: 0 !important; max-width: none !important; } @page { size: letter portrait; margin: 14mm 12mm; }
          .doc-tabla thead { display: table-header-group; } .doc-tabla tr { break-inside: avoid; page-break-inside: avoid; } .doc-linea { break-inside: avoid; }
        }
        .doc-tabla { width: 100%; border-collapse: collapse; font-size: 10px; line-height: 1.25; table-layout: fixed; }
        .doc-tabla td, .doc-tabla th { overflow-wrap: anywhere; }
        .doc-tabla th { text-align: left; font-weight: 600; border-bottom: 1.5px solid #111; padding: 4px 4px; font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; }
        .doc-tabla td { padding: 4px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
        .doc-tabla td.num, .doc-tabla th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .doc-mute { color: #666; font-size: 9.5px; }
      `}</style>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}><ImprimirBoton /></div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, borderBottom: '2px solid #111', paddingBottom: 12, marginBottom: 14 }}>
        <div>
          {emisor.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={emisor.logoUrl} alt={emisor.nombre} style={{ height: 46, width: 'auto', display: 'block', marginBottom: 8 }} data-logo />}
          <div style={{ fontSize: 15, fontWeight: 700 }}>{emisor.nombre}</div>
          <div className="doc-mute">NIT {emisor.nit}{emisor.direccion ? ` · ${emisor.direccion}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Estado del paquete</div>
          <div style={{ fontSize: 13 }}>{p.correlativo} · {p.nombre}</div>
          <div className="doc-mute">al {fecha(hoy)}</div>
        </div>
      </header>
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 11.5, marginBottom: 14 }}>
        <div>
          <div className="doc-mute">Cliente</div>
          <div style={{ fontWeight: 700 }}>{p.cliente || '—'}</div>
          <div>NIT {p.nit}{compartido ? ' · titular del paquete' : ''}</div>
          {esCompartido(p) && <div className="doc-mute" style={{ marginTop: 4 }} data-tambien-lo-usan>También lo usa{p.nitsAdicionales.length === 1 ? '' : 'n'}: {p.nitsAdicionales.map(a => `${a.razonSocial || a.nombre || 'NIT'} (NIT ${a.nit})`).join(' · ')}</div>}
        </div>
        <div>
          <div className="doc-mute">Paquete</div>
          <div>Factura del anticipo: <strong>{p.noFactura || 'pendiente de facturar'}</strong></div>
          <div>Vigencia: desde el {fecha(p.fechaInicio)}{p.venceEn ? ` hasta el ${fecha(p.venceEn)}` : ' · sin vencimiento'}</div>
        </div>
      </section>
      <div style={{ fontSize: 15, fontWeight: 700, margin: '6px 0 14px', padding: '8px 10px', border: '1.5px solid #111', display: 'inline-block' }} data-usadas-texto>{textoUsadas(p)}</div>
      {compartido && (
        <section className="doc-linea" style={{ marginBottom: 16 }} data-subtotal-nit={subtotales.map(t => `${t.nit}:${t.usadas}`).join(',')}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Usadas por empresa</div>
          <table className="doc-tabla">
            <colgroup><col style={{ width: '56%' }} /><col style={{ width: '24%' }} /><col style={{ width: '20%' }} /></colgroup>
            <thead><tr><th>Empresa</th><th>NIT</th><th className="num">Usadas</th></tr></thead>
            <tbody>
              {subtotales.map(t => <tr key={t.nit}><td>{t.empresa}{t.titular ? <span className="doc-mute"> · titular</span> : !t.vigente ? <span className="doc-mute"> · ya no usa el paquete</span> : null}</td><td>{t.nit || '—'}</td><td className="num">{t.usadas}</td></tr>)}
              <tr><td colSpan={2}><strong>Total</strong></td><td className="num"><strong>{subtotales.reduce((a, t) => a + t.usadas, 0)}</strong></td></tr>
            </tbody>
          </table>
        </section>
      )}

      {p.lineas.map(l => { const cs = vigentes.filter(c => c.lineaId === l.id); return (
        <section key={l.id} className="doc-linea" style={{ marginBottom: 16 }} data-linea-impresa={l.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, marginBottom: 4 }}>
            <strong>{etiquetaLinea(l, nombreServicio)}</strong>
            <span>Usadas <strong>{l.usadas}</strong> de {l.cantidad} · Restan <strong>{l.remanente}</strong></span>
          </div>
          {cs.length === 0 ? <div className="doc-mute">Sin pruebas descontadas todavía.</div> : (
            <table className="doc-tabla">
              <colgroup><col style={{ width: '5%' }} /><col style={{ width: '25%' }} /><col style={{ width: '22%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '20%' }} /></colgroup>
              <thead><tr><th>#</th><th>Persona</th><th>Empresa / NIT</th><th>Solicitante</th><th className="num">Resultado el</th><th>Resultado</th></tr></thead>
              <tbody>{cs.map((c, i) => <tr key={c.id}><td className="num">{i + 1}</td><td>{c.persona || c.idExterno}{c.puesto ? <span className="doc-mute"> · {c.puesto}</span> : null}</td><td data-nit-prueba={c.nit}>{c.empresa || '—'}<div className="doc-mute">NIT {c.nit || '—'}</div></td><td>{c.solicitante || '—'}</td><td className="num">{fecha(c.fechaResultado)}</td><td>{resultadoLegible(c.servicio, c.estadoPrueba)}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      ); })}

      <footer style={{ borderTop: '1px solid #111', paddingTop: 8, fontSize: 10.5, display: 'flex', justifyContent: 'space-between' }}>
        <span>Total del paquete: {totalCantidad(p)} pruebas · usadas {totalUsadas(p)} · restan {totalRemanente(p)}{p.lineas.some(l => l.precioUnitario > 0) ? ` · valor del remanente ${Q(p.lineas.reduce((a, l) => a + l.remanente * l.precioUnitario, 0))} sin IVA` : ''}</span>
        <span className="doc-mute">Cada prueba terminada se descuenta del paquete y no se vuelve a facturar.</span>
      </footer>
    </main>
  );
}
