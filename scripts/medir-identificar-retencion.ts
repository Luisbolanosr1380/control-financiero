/**
 * IDENTIFICAR PAGO: SALDO Y NETO CON RETENCIÓN — verificación con datos reales, SOLO LECTURA (sirve contra Golden).
 *
 * Toma los N cobros reales más recientes con retención de IVA (un grupo de cobro = depósito al banco + retención), de
 * clientes distintos, y SIMULA en memoria el momento previo al cobro: se quitan del historial las filas de ese grupo y la
 * factura vuelve a estar abierta (sus líneas pasan a PENDIENTE si el grupo la liquidó). Con el depósito neto real
 * (la suma de los componentes al banco) pregunta a `calzarFacturas` en «Automático» y reporta en qué lugar quedó la
 * factura y por qué calzó. También mide cuánto tarda la carga de /cobros/identificar y resume los perfiles. No escribe nada.
 *
 * Uso: npx tsx scripts/medir-identificar-retencion.ts [golden|hit] [--casos 5] [--repeticiones 3]
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'golden').toLowerCase();
const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CASOS = Math.max(1, Number(arg('--casos', '5')));
const REP = Math.max(1, Number(arg('--repeticiones', '3')));
const envFile = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const Qf = (v: number) => `Q${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

(async () => {
  const FB = await import('../src/lib/db/facturas-buscar');
  const S = await import('../src/lib/db/identificar-pago');
  const P = await import('../src/lib/cobros/identificar');
  const { fetchAll } = await import('../src/lib/supabase/client');
  const hoy = (await import('../src/lib/utils/fechas')).obtenerFechaHoyGuatemala();
  console.log(`\nMedición solo lectura · ${BASE.toUpperCase()} · ${hoy}`);

  // 1) tiempos de carga de la página (mediana de REP)
  const tiempos: number[] = [];
  let datos = await S.getDatosIdentificar(); tiempos.push(datos.ms);
  for (let i = 1; i < REP; i++) { datos = await S.getDatosIdentificar(); tiempos.push(datos.ms); }
  const med = Math.round(tiempos.sort((a, b) => a - b)[Math.floor(tiempos.length / 2)]);
  const perfiles = Object.values(datos.perfiles).filter(p => p.tasaIva != null);
  const porTasa: Record<string, number> = {};
  for (const p of perfiles) { const k = `${Math.round((p.tasaIva ?? 0) * 100)} %`; porTasa[k] = (porTasa[k] ?? 0) + 1; }
  console.log(`  carga de /cobros/identificar: ${datos.facturas.length} facturas abiertas · ${datos.cobrosConRetencion} cobros con retención · perfil de ${perfiles.length} clientes (${Object.entries(porTasa).map(([k, v]) => `${v} al ${k}`).join(', ')}; ISR: ${Object.values(datos.perfiles).filter(p => p.tasaIsr != null).length}) · ${med} ms (mediana de ${REP})${datos.error ? ' · ERROR ' + datos.error : ''}`);

  // 2) casos reales: grupos de cobro con retención, con las filas crudas a mano para simular
  const { filas, ncs } = await FB.leerFilasBusqueda();
  const crudos = await fetchAll<{ factura_id: string | null; monto_cobrado: number | string | null; monto_retencion_iva: number | string | null; monto_retencion_isr: number | string | null; estado_cobro: string | null; cobro_grupo_id: string | null; fecha_cobro: string | null; metodo: string | null }>('cobros_clientes', { select: 'factura_id, monto_cobrado, monto_retencion_iva, monto_retencion_isr, estado_cobro, cobro_grupo_id, fecha_cobro, metodo' });
  const linea = new Map(filas.map(f => [f.id, f]));
  const grupos = new Map<string, typeof crudos>();
  for (const c of crudos) { if (!c.cobro_grupo_id || String(c.estado_cobro ?? '').toUpperCase().trim() === 'ANULADO') continue; grupos.set(c.cobro_grupo_id, [...(grupos.get(c.cobro_grupo_id) ?? []), c]); }
  // un grupo con retención → su factura → los cobros al banco de esa factura (en Golden la retención se registró en un grupo aparte)
  const esRet = (r: { monto_retencion_iva: unknown; monto_retencion_isr: unknown }) => n(r.monto_retencion_iva) > 0 || n(r.monto_retencion_isr) > 0;
  const activos = crudos.filter(c => String(c.estado_cobro ?? '').toUpperCase().trim() !== 'ANULADO');
  const lineasDe = (nf: string) => new Set(filas.filter(f => String(f.no_factura ?? '').trim() === nf && !/ANULAD|REFACTURAD/i.test(String(f.estado ?? ''))).map(f => f.id));
  const candidatos = [...grupos.entries()]
    .filter(([, rows]) => rows.some(esRet))
    .map(([id, rows]) => {
      const nf = String(linea.get(rows[0].factura_id ?? '')?.no_factura ?? '').trim();
      const lineas = lineasDe(nf);
      const banco = activos.filter(c => c.factura_id && lineas.has(c.factura_id) && !esRet(c));
      return { id, rows, nf, lineas, banco, fecha: rows.map(r => String(r.fecha_cobro ?? '')).sort().at(-1) ?? '', cliente: linea.get(rows[0].factura_id ?? '')?.cliente?.airtable_id ?? '' };
    })
    .filter(g => g.nf && g.banco.length > 0)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const vistos = new Set<string>();
  const casos = candidatos.filter(g => { if (vistos.has(g.cliente)) return false; vistos.add(g.cliente); return true; }).slice(0, CASOS);
  console.log(`\n  ${candidatos.length} facturas con retención registrada y depósito al banco; ${casos.length} casos (clientes distintos, los más recientes):\n`);
  console.log('  | # | Factura | Cliente | Total | Depósito neto | Retención real | Lugar | Calza por | Esperado | Dif. |');
  console.log('  |---|---|---|---|---|---|---|---|---|---|');
  let primeros = 0, conTotal = 0;
  casos.forEach((g, i) => {
    const deposito = r2(g.banco.reduce((s, r) => s + n(r.monto_cobrado), 0));
    const retReal = r2(g.rows.reduce((s, r) => s + n(r.monto_retencion_iva) + n(r.monto_retencion_isr), 0));
    // simulación: la factura vuelve a estar abierta (sin ninguno de sus cobros); el perfil del cliente sin esta retención
    const cobrosSim = crudos.filter(c => !(c.factura_id && g.lineas.has(c.factura_id)));
    const filasSim = filas.map(f => g.lineas.has(f.id) ? { ...f, estado: 'PENDIENTE ' } : f);
    const d = S.datosDesdeFilas(filasSim, cobrosSim, ncs, hoy);
    const res = P.calzarFacturas(d.facturas, d.perfiles, deposito, 0, 'auto');
    const lugar = res.findIndex(c => c.factura.noFactura === g.nf);
    const hit = lugar >= 0 ? res[lugar] : null;
    if (lugar === 0) primeros++;
    if (P.calzarFacturas(d.facturas, d.perfiles, deposito, 0, 'total').some(c => c.factura.noFactura === g.nf)) conTotal++;
    const f = d.facturas.find(x => x.noFactura === g.nf);
    const cliente = f?.cliente ?? g.cliente;
    const perfil = d.perfiles[g.cliente];
    console.log(`  | ${i + 1} | ${g.nf} | ${cliente}${perfil?.tasaIva != null ? ` (perfil ${Math.round(perfil.tasaIva * 100)} %, ${perfil.nIva} cobros)` : ' (sin otro cobro con retención)'} | ${f ? Qf(f.total) : '—'} | ${Qf(deposito)} | ${Qf(retReal)} | ${lugar >= 0 ? `${lugar + 1}º de ${res.length}` : `no calza (${res.length} resultados)`} | ${hit?.etiqueta ?? '—'} | ${hit ? Qf(hit.esperado) : '—'} | ${hit ? Qf(hit.diff) : '—'} |`);
  });
  console.log(`\n  ${primeros}/${casos.length} en el primer lugar con «Automático» y tolerancia exacta.`);
  console.log(`  con la base «Total» (lo de hoy) se habrían encontrado ${conTotal}/${casos.length}.\n`);
})().catch(e => { console.error(e); process.exit(1); });
