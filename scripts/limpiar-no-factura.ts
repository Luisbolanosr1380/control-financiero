/**
 * NO.FACTURA con espacios — chequeo y limpieza única (por base).
 *
 * Un espacio heredado en facturas_clientes.no_factura (import de Airtable)
 * hacía que la factura "no existiera" para los lookups por número y que
 * sus líneas no se consolidaran con las demás líneas de la MISMA factura.
 *
 * Sin --aplicar es SIEMPRE dry-run: lista cada fila sucia con su contexto
 * (cliente, fecha, centro, total, cobros, NC, cesiones) y, cuando el número
 * recortado ya existe en otras filas, muestra esas filas para decidir si
 * son líneas de la misma factura (mismo cliente y fecha, distinto centro)
 * o duplicados reales. Con --aplicar recorta fila por fila (por id) y
 * verifica que no quede ninguna.
 *
 * Uso: npx tsx scripts/limpiar-no-factura.ts [hit|golden] [--aplicar]
 */
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'hit';
const aplicar = process.argv.includes('--aplicar');
const envFile = base === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (base === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
const limpio = (v: string) => v.replace(/^[\s ]+|[\s ]+$/g, '');
const vis = (v: string) => `[${v.replace(/ /g, '⍽').replace(/\t/g, '⇥')}]`;

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const { fetchAll } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  type Row = Record<string, unknown>;
  const s = (v: unknown) => (v == null ? '' : String(v));
  const filas = await fetchAll<Row>('facturas_clientes', {
    select: 'id, airtable_id, no_factura, estado, total, fecha_emision, cliente:clientes!facturas_clientes_cliente_id_fkey(razon_social), centro:centros_costo!facturas_clientes_centro_costo_id_fkey(nombre)',
  });
  const sucias = filas.filter(f => f.no_factura != null && s(f.no_factura) !== limpio(s(f.no_factura)));
  console.log(`\n${base.toUpperCase()}: ${filas.length} líneas de factura · ${sucias.length} con espacios en no_factura${aplicar ? ' · MODO APLICAR' : ' · dry-run'}`);
  if (sucias.length === 0) { console.log('  Nada que limpiar.\n'); process.exit(0); }

  const [cobros, ncs, cesiones] = await Promise.all([
    fetchAll<Row>('cobros_clientes', { select: 'factura_id, monto_cobrado, estado_cobro' }),
    fetchAll<Row>('notas_credito', { select: 'factura_id, monto, estado' }),
    fetchAll<Row>('factoraje_facturas', { select: 'factura_id, estado' }).catch(() => [] as Row[]),
  ]);
  const cuenta = (lista: Row[], id: string) => lista.filter(x => s(x.factura_id) === id).length;
  const desc = (f: Row) => `${vis(s(f.no_factura))} ${s(f.estado).trim()} · ${(f.cliente as { razon_social?: string } | null)?.razon_social ?? '—'} · ${s(f.fecha_emision)} · ${(f.centro as { nombre?: string } | null)?.nombre ?? 'sin centro'} · Q${Number(f.total ?? 0).toLocaleString('en-US')} · cobros ${cuenta(cobros, s(f.id))} · NC ${cuenta(ncs, s(f.id))} · cesiones ${cuenta(cesiones, s(f.id))} · ${s(f.airtable_id)}`;

  for (const f of sucias) {
    const nf = limpio(s(f.no_factura));
    const otras = filas.filter(x => s(x.id) !== s(f.id) && limpio(s(x.no_factura)) === nf);
    console.log(`\n  ${desc(f)}`);
    if (otras.length === 0) console.log(`     → "${nf}" queda único: solo se recorta.`);
    else {
      const mismaFactura = otras.every(o => s(o.cliente_id ?? '') === s(f.cliente_id ?? '') || ((o.cliente as { razon_social?: string } | null)?.razon_social === (f.cliente as { razon_social?: string } | null)?.razon_social && s(o.fecha_emision) === s(f.fecha_emision)));
      console.log(`     → "${nf}" ya existe en ${otras.length} línea(s) más — ${mismaFactura ? 'MISMO cliente y fecha: líneas de la misma factura (se consolidan al recortar)' : 'OJO: cliente o fecha distintos — revisar antes de unificar'}:`);
      for (const o of otras) console.log(`        · ${desc(o)}`);
    }
  }

  if (!aplicar) { console.log('\n  Dry-run: nada se tocó. Para aplicar: --aplicar\n'); process.exit(0); }

  console.log('\n  Aplicando…');
  for (const f of sucias) {
    const nf = limpio(s(f.no_factura));
    const { error } = await sb.from('facturas_clientes').update({ no_factura: nf }).eq('id', s(f.id));
    console.log(`  ${error ? '✗' : '✓'} ${s(f.airtable_id)}: ${vis(s(f.no_factura))} → [${nf}]${error ? ` · ${error.message}` : ''}`);
  }
  const despues = await fetchAll<Row>('facturas_clientes', { select: 'id, no_factura' });
  const quedan = despues.filter(f => f.no_factura != null && s(f.no_factura) !== limpio(s(f.no_factura))).length;
  console.log(`\n  Verificación: ${quedan} fila(s) con espacios después de la limpieza.${quedan === 0 ? ' ✓' : ' ✗'}\n`);
  process.exit(quedan === 0 ? 0 : 1);
})();
