/**
 * PAQUETE DE VARIOS NIT (036) — medición SOLO LECTURA (sirve contra Golden): la vista previa de un paquete de prueba SIN
 * crearlo, con un titular y sus NIT adicionales. No escribe nada: solo llama a paquete_vista_previa (función `stable`).
 *
 * Si la base ya tiene la 036 usa la firma nueva (p_nits text[]). Si todavía no (Golden antes de aplicarla), pide la vista
 * previa de la 034 por cada NIT y las une por fecha: como cada prueba es de un solo NIT, el resultado es el mismo FIFO global.
 * Sin nombres de personas en la salida (va pegada en el PR): fecha, NIT y expediente.
 *
 * Uso: npx tsx scripts/medir-paquete-varios-nit.ts [golden|hit] [--titular 1083171] [--adicional 21076383] [--desde 2026-01-01] [--cantidad 100]
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'golden').toLowerCase();
const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const envFile = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
const TITULAR = arg('--titular', '1083171'), ADICIONALES = arg('--adicional', '21076383').split(',').filter(Boolean), DESDE = arg('--desde', '2026-01-01'), CANT = Number(arg('--cantidad', '100'));
const LINEAS = [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: null, cantidad: CANT }, { servicio: 'PSICOMETRICAS', categoria: 'UNICA', territorio: null, cantidad: CANT }];
type Prueba = { nit?: string; id_externo: string; fecha: string; resultado: string; componente_id: string };
type Linea = { n: number; servicio: string; categoria: string; cantidad: number; candidatas: number; tomaria: number; pruebas: Prueba[] };

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const nits = [TITULAR, ...ADICIONALES];
  console.log(`\nVista previa SOLO LECTURA · ${BASE.toUpperCase()} · titular ${TITULAR} + adicional ${ADICIONALES.join(', ')} · desde ${DESDE} · sin crear nada`);
  const { data: clis } = await sb.from('clientes').select('nit, nombre_empresa, razon_social').in('nit', nits);
  for (const n of nits) { const c = (clis ?? []).find(x => String(x.nit) === n); console.log(`  ${n === TITULAR ? 'titular  ' : 'adicional'} ${n} · ${c ? `${c.nombre_empresa} · ${c.razon_social}` : 'SIN cliente con ese NIT'}`); }
  let lineas: Linea[]; let modo: string;
  const nueva = await sb.rpc('paquete_vista_previa', { p_nits: nits, p_fecha_inicio: DESDE, p_vence_en: null, p_lineas: LINEAS });
  if (!nueva.error) { lineas = nueva.data as Linea[]; modo = '036 aplicada: paquete_vista_previa(p_nits)'; }
  else {
    modo = `036 sin aplicar en esta base: se unen las vistas previas de la 034 por NIT (${nueva.error.message.slice(0, 60)}…)`;
    const porNit = await Promise.all(nits.map(async n => { const r = await sb.rpc('paquete_vista_previa', { p_nit: n, p_fecha_inicio: DESDE, p_vence_en: null, p_lineas: LINEAS }); if (r.error) throw new Error(r.error.message); return (r.data as Linea[]).map(l => ({ ...l, pruebas: l.pruebas.map(p => ({ ...p, nit: n })) })); }));
    lineas = LINEAS.map((l, i) => { const pruebas = porNit.flatMap(x => x[i]?.pruebas ?? []).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.componente_id.localeCompare(b.componente_id)); return { n: i + 1, servicio: l.servicio, categoria: l.categoria, cantidad: l.cantidad, candidatas: pruebas.length, tomaria: Math.min(pruebas.length, l.cantidad), pruebas }; });
  }
  console.log(`  modo: ${modo}`);
  for (const l of lineas) {
    const cuenta: Record<string, number> = {}; for (const p of l.pruebas) cuenta[p.nit ?? '?'] = (cuenta[p.nit ?? '?'] ?? 0) + 1;
    console.log(`\n  ${l.servicio} ${l.categoria}: ${l.candidatas} terminadas y sin facturar · descontaría ${l.tomaria} de ${l.cantidad} · por NIT: ${nits.map(n => `${n} → ${cuenta[n] ?? 0}`).join(' · ')}`);
    l.pruebas.forEach((p, i) => console.log(`    ${String(i + 1).padStart(2)}. ${p.fecha} · NIT ${p.nit} · exp ${p.id_externo} · ${p.resultado}`));
  }
  if (process.argv.includes('--desglose')) await desglose(nits, DESDE);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

/**
 * Desglose (solo lectura) de por qué la vista previa trae menos que «todas las terminadas»: la vista previa (como el
 * descuento) solo toma pruebas `cobra` SIN factura, sin detalle vivo y con cobro pendiente en la Agenda.
 * Uso: npx tsx scripts/medir-paquete-varios-nit.ts golden --desglose
 */
export async function desglose(nits: string[], desde: string) {
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { data, error } = await sb.from('facturacion_componente')
    .select('id, servicio, categoria, situacion, factura_id, no_factura, detalle_id, fecha_resultado, expediente:facturacion_expediente!inner(nit_resuelto, eliminado, fecha_ingreso, estado_tarifa, status_cobro_externo, estatus_pago_externo)')
    .in('expediente.nit_resuelto', nits).in('servicio', ['POLIGRAFO', 'PSICOMETRICAS']).limit(2000);
  if (error) throw new Error(error.message);
  type F = { id: string; servicio: string; categoria: string | null; situacion: string; factura_id: string | null; no_factura: string | null; detalle_id: string | null; fecha_resultado: string | null; expediente: { nit_resuelto: string; eliminado: boolean; fecha_ingreso: string | null; estado_tarifa: string; status_cobro_externo: string | null; estatus_pago_externo: string | null } };
  const filas = ((data ?? []) as unknown as F[]).filter(f => !f.expediente.eliminado).map(f => ({ ...f, dia: f.fecha_resultado ? new Date(f.fecha_resultado).toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }) : f.expediente.fecha_ingreso })).filter(f => f.dia && f.dia >= desde);
  const detIds = [...new Set(filas.map(f => f.detalle_id).filter(Boolean))] as string[];
  const { data: dets } = detIds.length ? await sb.from('detalle_facturacion').select('id, estado').in('id', detIds) : { data: [] as Array<{ id: string; estado: string }> };
  const estadoDet = new Map((dets ?? []).map(d => [d.id as string, d.estado as string]));
  for (const [servicio, cat] of [['POLIGRAFO', 'PRE EMPLEO'], ['PSICOMETRICAS', null]] as const) {
    const fs2 = filas.filter(f => f.servicio === servicio && (!cat || (f.categoria ?? '').toUpperCase() === cat));
    console.log(`\n  ${servicio}${cat ? ' ' + cat : ''} con fecha desde ${desde}: ${fs2.length} pruebas en total`);
    for (const n of nits) {
      const x = fs2.filter(f => f.expediente.nit_resuelto === n);
      const cobra = x.filter(f => f.situacion === 'cobra');
      const facturadas = cobra.filter(f => f.factura_id), enDetalle = cobra.filter(f => !f.factura_id && f.detalle_id && estadoDet.get(f.detalle_id) !== 'anulada');
      const libres = cobra.filter(f => !f.factura_id && !(f.detalle_id && estadoDet.get(f.detalle_id) !== 'anulada'));
      const porCobro: Record<string, number> = {}; for (const f of libres) { const k = `${f.expediente.status_cobro_externo ?? '∅'} / ${f.expediente.estatus_pago_externo ?? '∅'}`; porCobro[k] = (porCobro[k] ?? 0) + 1; }
      const sit: Record<string, number> = {}; for (const f of x) sit[f.situacion] = (sit[f.situacion] ?? 0) + 1;
      console.log(`    NIT ${n}: ${x.length} (${Object.entries(sit).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}) · cobra ${cobra.length} = ya facturadas ${facturadas.length} + en un detalle vivo ${enDetalle.length} + sin factura ni detalle ${libres.length} [cobro en la Agenda: ${Object.entries(porCobro).map(([k, v]) => `${k} → ${v}`).join(' · ') || '—'}]`);
    }
  }
}
