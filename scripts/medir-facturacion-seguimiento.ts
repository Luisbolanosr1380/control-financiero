/**
 * SEGUIMIENTO DE COBRO A LA VISTA — medición de rendimiento, SOLO LECTURA (sirve contra Golden).
 *
 * Mide lo que carga /facturacion en una pestaña de cartera: la cartera abierta (getFacturasPendientesCobro, la misma
 * de Cobros → Pendientes) + UNA consulta a cobranza_evento (getEventosParaCartera) y el cálculo de la columna
 * «Cobranza»; y la búsqueda de texto en el servidor («fogel» sobre todas las facturas). No escribe nada.
 *
 * Uso: npx tsx scripts/medir-facturacion-seguimiento.ts [golden|hit] [--repeticiones 3] [--texto fogel]
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'golden').toLowerCase();
const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const REP = Math.max(1, Number(arg('--repeticiones', '3')));
const TEXTO = arg('--texto', 'fogel');
const envFile = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}

(async () => {
  const CF = await import('../src/lib/db/cobranza-facturas');
  const FB = await import('../src/lib/db/facturas-buscar');
  const P = await import('../src/lib/facturacion/buscar-monto');
  const S = await import('../src/lib/cobranza/seguimiento');
  console.log(`\nMedición solo lectura · ${BASE.toUpperCase()} · ${REP} corrida(s)`);
  const tiempos: Array<{ cartera: number; cobranza: number; total: number }> = [];
  let ultima: Awaited<ReturnType<typeof CF.getCarteraConSeguimiento>> | null = null;
  for (let i = 0; i < REP; i++) { ultima = await CF.getCarteraConSeguimiento(); tiempos.push(ultima.ms); }
  const med = (k: 'cartera' | 'cobranza' | 'total') => Math.round(tiempos.map(t => t[k]).sort((a, b) => a - b)[Math.floor(tiempos.length / 2)]);
  const filas = ultima!.filas;
  const abiertas = filas.filter(f => !f.cedida);
  const conBadge = filas.filter(f => f.seguimiento.badge);
  const porBadge: Record<string, number> = {};
  for (const f of filas) { const c = f.seguimiento.badge?.clave ?? '—'; porBadge[c] = (porBadge[c] ?? 0) + 1; }
  console.log(`  cartera abierta (todos los meses): ${filas.length} facturas (${abiertas.length} propias) · saldo Q${abiertas.reduce((s, f) => s + f.saldo, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`  tiempos (mediana): cartera ${med('cartera')} ms · cobranza (1 consulta a cobranza_evento) ${med('cobranza')} ms · total ${med('total')} ms · consultas de cobranza por página: ${ultima!.consultasCobranza}`);
  console.log(`  columna Cobranza: ${conBadge.length} facturas con badge · ${Object.entries(porBadge).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  KPI promesas de esta semana: ${ultima!.kpiPromesas.n} · Q${ultima!.kpiPromesas.monto}`);
  const masVieja = [...filas].sort((a, b) => b.diasVencidos - a.diasVencidos)[0];
  if (masVieja) console.log(`  la más vieja sin pagar: ${masVieja.noFactura} · ${masVieja.cliente} · ${masVieja.diasVencidos} días · Q${masVieja.saldo}`);
  const conteo = Object.fromEntries(S.FILTROS_COBRANZA.map(fc => [fc, filas.filter(f => S.pasaFiltroCobranza(f.seguimiento, fc, ultima!.hoy)).length]));
  console.log(`  chips: ${Object.entries(conteo).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const t0 = Date.now();
  const r = await FB.buscarFacturas({ ...P.CRITERIOS_VACIOS, texto: TEXTO });
  console.log(`  búsqueda «${TEXTO}» en todas las facturas: ${r.cantidad} resultado(s) en ${Date.now() - t0} ms (universo ${r.universo} facturas)${r.filas[0] ? ` · primera: ${r.filas[0].noFactura} · ${r.filas[0].clienteNombre} · ${r.filas[0].fechaEmision} · ${r.filas[0].estado}` : ''}`);
  console.log('');
})();
