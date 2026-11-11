/**
 * CENTRO DE COBROS · PR 2 (035) — medición SOLO LECTURA (sirve contra Golden): cuántos recordatorios propondría hoy el
 * sistema con las reglas por defecto, cuántos saldrían bloqueados (disputa / promesa vigente), cuántos clientes con cartera
 * no tienen contacto con correo, y cuánto tarda la carga (las tres lecturas del #51 + cesiones + clientes + contactos +
 * eventos). No escribe nada: ni eventos, ni correos (no se llama a enviar).
 *
 * Uso: npx tsx --conditions=react-server scripts/medir-recordatorios.ts [golden|hit]
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'golden').toLowerCase();
const envFile = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}

(async () => {
  const DB = await import('../src/lib/db/cobranza-recordatorios');
  const R = await import('../src/lib/cobranza/recordatorios');
  const Q = (n: number) => `Q${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  console.log(`\nMedición solo lectura · ${BASE.toUpperCase()}`);
  const t0 = Date.now();
  const carga = await DB.cargarRecordatorios();
  const { reglas, disponible } = await DB.getReglas();
  const ms = Date.now() - t0;
  const conCartera = carga.clientes.filter(c => c.facturas.some(f => !f.cedida && f.saldo > 0.005));
  const abiertas = conCartera.flatMap(c => c.facturas.filter(f => !f.cedida && f.saldo > 0.005));
  const sinCorreo = conCartera.filter(c => !R.destinatarioPropuesto(c.contactos).destinatario);
  console.log(`  carga: ${ms} ms · ${carga.clientes.length} clientes con algo (cartera, promesas o eventos) · ${conCartera.length} con cartera abierta · ${abiertas.length} facturas · saldo ${Q(abiertas.reduce((s, f) => s + f.saldo, 0))} · vencido ${Q(abiertas.filter(f => f.diasVencida > 0).reduce((s, f) => s + f.saldo, 0))}`);
  console.log(`  035 en esta base: ${disponible ? 'sí (reglas de la tabla)' : 'no (reglas por defecto; la 035 no está aplicada)'} · clientes con cartera SIN contacto con correo: ${sinCorreo.length} (${Q(sinCorreo.flatMap(c => c.facturas.filter(f => !f.cedida)).reduce((s, f) => s + f.saldo, 0))})`);
  const bs = R.proponerRecordatorios(carga.clientes, reglas, carga.hoy, { nombre: 'Golden Talent', nit: '—' }, 'medición');
  const res = R.resumenBorradores(bs);
  const porBloqueo: Record<string, number> = {};
  for (const b of bs) if (b.bloqueo) porBloqueo[b.bloqueo.tipo] = (porBloqueo[b.bloqueo.tipo] ?? 0) + 1;
  console.log(`  borradores que se propondrían hoy (${carga.hoy}): ${res.total} · listos ${res.listos} · bloqueados ${res.bloqueados} (${Object.entries(porBloqueo).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}) · sin correo ${res.sinCorreo} · omitidos ${res.omitidos}`);
  console.log(`  por regla: ${R.ORDEN_REGLA.map(k => `${R.ETIQUETA_REGLA[k]} ${res.porRegla[k]} (${Q(bs.filter(b => b.regla === k).reduce((s, b) => s + b.monto, 0))})`).join(' · ')}`);
  const clientesCon = new Set(bs.map(b => b.clienteId)).size;
  console.log(`  clientes con al menos un borrador: ${clientesCon} · monto total en recordatorios: ${Q(bs.reduce((s, b) => s + b.monto, 0))}`);
  const top = [...bs].sort((a, b) => b.monto - a.monto).slice(0, 5);
  for (const b of top) console.log(`    · ${R.ETIQUETA_REGLA[b.regla]} · ${b.clienteNombre} · ${Q(b.monto)} · ${b.facturas.length} factura(s) · ${b.destinatario ? b.destinatario.nombre : 'SIN CORREO'}${b.bloqueo ? ` · bloqueado: ${b.bloqueo.tipo}` : ''}`);
  // estado de cuenta del cliente con más saldo (solo totales)
  const mayor = [...conCartera].sort((a, b) => b.facturas.reduce((s, f) => s + (f.cedida ? 0 : f.saldo), 0) - a.facturas.reduce((s, f) => s + (f.cedida ? 0 : f.saldo), 0))[0];
  if (mayor) {
    const ec = R.armarEstadoCuenta({ clienteId: mayor.clienteId, clienteUuid: mayor.clienteUuid, nombre: mayor.nombre, nit: mayor.nit, diasCredito: 0 }, mayor.facturas, [], '', carga.hoy);
    console.log(`  estado de cuenta del cliente con más saldo: ${ec.totales.n} facturas · saldo ${Q(ec.totales.saldo)} · vencido ${Q(ec.totales.vencido)} · tramos ${ec.aging.filter(a => a.n).map(a => `${a.etiqueta} ${a.n}`).join(', ')}`);
  }
  console.log('  (nada se escribió: ni eventos ni correos)');
})().catch(e => { console.error(e); process.exit(1); });
