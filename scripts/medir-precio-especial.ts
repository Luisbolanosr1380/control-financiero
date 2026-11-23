/**
 * PRECIO ESPECIAL POR PRUEBA (037) — simulación de SOLO LECTURA sobre un detalle real.
 *
 * Lee el detalle y sus pruebas, recalcula los totales con la regla FEL (030) tal como están hoy (deben coincidir con lo
 * guardado) y simula cómo quedan con un precio especial en las pruebas indicadas. NO escribe nada: ni aplica el ajuste ni
 * toca el detalle. El ajuste real se hace desde la pantalla (o con facturacion_componente_ajustar) después del merge.
 *
 * Uso: npx tsx scripts/medir-precio-especial.ts golden [DET-0031] [monto sin IVA = 245] [componente_id …]
 *      (sin argumentos: el caso del brief, DET-0031 de NIT 320501 con los dos socioeconómicos a Q245.00)
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'golden').toLowerCase();
const ENV = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), ENV), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
const CORRELATIVO = process.argv[3] ?? 'DET-0031';
const MONTO = Number(process.argv[4] ?? 245);
const IDS = process.argv.slice(5).length ? process.argv.slice(5) : ['a274c242-fc5f-4fab-a0fa-e2631cbf1fdd', '9edabaf3-962e-4b55-adc4-f8b6dad36879'];
const q = (n: number) => 'Q' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const { precioConIva, totalesFel } = await import('../src/lib/tarifario/canon');
  const sb = supabase()!;
  const { data: d, error } = await sb.from('detalle_facturacion').select('id, correlativo, nit, estado, version, subtotal, iva, total, pruebas, enviada_en').eq('correlativo', CORRELATIVO).maybeSingle();
  if (error || !d) { console.error(`No se encontró ${CORRELATIVO} en ${BASE}: ${error?.message ?? 'sin filas'}`); process.exit(1); }
  const { data: cs, error: e2 } = await sb.from('facturacion_componente').select('*, facturacion_expediente!inner(persona)').eq('detalle_id', d.id);
  if (e2) { console.error(e2.message); process.exit(1); }
  type C = { id: string; servicio: string; situacion: string; estado_tarifa: string; monto_calculado: number | string | null; monto_ajustado?: number | string | null; factura_id: string | null; facturacion_expediente: { persona: string | null } };
  const comps = (cs ?? []) as unknown as C[];
  const efectivo = (c: C) => Number(c.monto_ajustado ?? c.monto_calculado ?? 0);
  const incluidas = comps.filter(c => c.situacion === 'cobra' && c.estado_tarifa === 'resuelta' && efectivo(c) > 0);
  const hoy = totalesFel(incluidas.map(efectivo));
  const sim = totalesFel(incluidas.map(c => (IDS.includes(c.id) ? MONTO : efectivo(c))));
  console.log(`\n${BASE.toUpperCase()} · ${d.correlativo} · NIT ${d.nit} · estado ${d.estado} · versión ${d.version ?? 1} · enviada ${String(d.enviada_en ?? '—').slice(0, 10)} (solo lectura)`);
  console.log(`  pruebas: ${comps.length} reservadas, ${incluidas.length} con precio (el detalle guarda ${d.pruebas})`);
  console.log(`  guardado en el detalle : base ${q(Number(d.subtotal))} + IVA ${q(Number(d.iva))} = ${q(Number(d.total))}`);
  console.log(`  recalculado hoy (FEL)  : base ${q(hoy.base)} + IVA ${q(hoy.iva)} = ${q(hoy.total)}  ${hoy.total === Number(d.total) && hoy.base === Number(d.subtotal) ? '🟢 coincide' : '🔴 NO coincide con lo guardado'}`);
  console.log(`\n  líneas a ajustar (${q(MONTO)} sin IVA → ${q(precioConIva(MONTO))} con IVA):`);
  let faltan = 0;
  for (const id of IDS) {
    const c = comps.find(x => x.id === id);
    if (!c) { faltan++; console.log(`    🔴 ${id} NO está en ${d.correlativo}`); continue; }
    console.log(`    ${c.factura_id ? '🔴 FACTURADA' : '🟢'} ${c.facturacion_expediente.persona ?? '—'} · ${c.servicio} · hoy ${q(efectivo(c))} sin IVA (${q(precioConIva(efectivo(c)))} con IVA) → ${q(MONTO)} (${q(precioConIva(MONTO))})${c.monto_ajustado !== null && c.monto_ajustado !== undefined ? ' · ya tiene un precio especial' : ''} · ${c.id}`);
  }
  console.log(`\n  SIMULACIÓN con las ${IDS.length - faltan} línea(s) a ${q(MONTO)}: base ${q(sim.base)} + IVA ${q(sim.iva)} = ${q(sim.total)}  (diferencia ${q(Math.round((sim.total - hoy.total) * 100) / 100)})`);
  const rechazo = d.estado === 'aprobada' ? 'el detalle está APROBADO: la RPC rechaza («anulá o reabrí el detalle primero»)' : d.estado === 'facturada' || d.estado === 'anulada' ? `el detalle está ${d.estado}: no aplica` : d.estado === 'enviada' ? `está ENVIADO: al ajustar sube a la versión ${Number(d.version ?? 1) + 1} (una sola vez, aunque sean varias líneas) y hay que reenviarlo` : `está en ${d.estado}: recalcula sin subir versión`;
  console.log(`  al aplicarlo de verdad: ${rechazo}.`);
  console.log('\n  No se escribió nada.\n');
  process.exit(faltan ? 1 : 0);
})();
