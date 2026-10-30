/**
 * COBRO POR PRUEBA (024) · DRY-RUN DE SOLO LECTURA sobre una base (Golden por default).
 * No escribe nada: lee el espejo (raw de cada expediente), el mapeo y el tarifario, y aplica
 * las reglas del CFO (situacionDePruebas + lookup) para reportar el impacto:
 *   · pruebas que ENTRAN a la cola (polígrafos con resultado de expedientes abiertos / con socio en curso)
 *   · pruebas que SALEN (no_cobra: cancelado, no se presentó, desiste…) con lo que hoy cuenta la cola
 *   · pruebas que quedan PENDIENTES (sin resultado) y las de estado no reconocido
 *   · FEE (socio cancelado con visita realizada) sin tarifa, por cliente
 *
 * Uso: npx tsx scripts/dryrun-cobro-por-prueba.ts [--base golden|hit] [--detalle]
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'golden').toLowerCase();
const DETALLE = process.argv.includes('--detalle');
const envFile = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (BASE === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const { getTarifario } = await import('../src/lib/db/tarifario');
  const { getMapeos, nitPorEmpresa, noFacturaPorEmpresa, arranquePorEmpresa } = await import('../src/lib/db/facturacion-agenda');
  const { clasificarExpediente, cobroPendiente, antesDelArranque, serviciosDe } = await import('../src/lib/facturacion-agenda/mapeo');
  const { servicioPorEstado, SERVICIO_FEE } = await import('../src/lib/facturacion-agenda/situacion');
  const sb = supabase()!;
  const [tarifas, mapeos] = await Promise.all([getTarifario(), getMapeos()]);
  const ctx = { tarifas, nitPorEmpresa: nitPorEmpresa(mapeos), noFacturaEmpresas: noFacturaPorEmpresa(mapeos) };
  const arranque = arranquePorEmpresa(mapeos);
  const razon = new Map<string, string>();
  for (const t of tarifas) if (t.razonSocial && !razon.has(t.nit)) razon.set(t.nit, t.razonSocial);
  type Row = { id_externo: string; raw: Record<string, unknown> | null; terminado: boolean; cancelado: boolean; eliminado: boolean; factura_id: string | null; estado_tarifa: string; monto_calculado: number | string | null; nit_resuelto: string | null; empresa_id_externo: string | null; empresa_nombre_externo: string | null; status_cobro_externo: string | null; estatus_pago_externo: string | null; fecha_ingreso: string | null; persona: string | null };
  const rows: Row[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await sb.from('facturacion_expediente').select('id_externo, raw, terminado, cancelado, eliminado, factura_id, estado_tarifa, monto_calculado, nit_resuelto, empresa_id_externo, empresa_nombre_externo, status_cobro_externo, estatus_pago_externo, fecha_ingreso, persona').eq('fuente', 'agenda').eq('eliminado', false).is('factura_id', null).order('id_externo').range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[])); if ((data ?? []).length < 1000) break;
  }
  console.log(`\nDRY-RUN cobro por prueba · ${BASE.toUpperCase()} · ${rows.length} expedientes vigentes sin factura (solo lectura)`);
  const num = (v: number | string | null) => (v === null ? 0 : Number(v));
  const n2 = (n: number) => Math.round(n * 100) / 100;
  const expGate = (r: Row) => !['excluido_psicometrica', 'excluido_no_factura'].includes(r.estado_tarifa) && cobroPendiente(r.status_cobro_externo, r.estatus_pago_externo) && !(arranque.get(r.empresa_id_externo ?? '') && antesDelArranque(r.fecha_ingreso, arranque.get(r.empresa_id_externo ?? '')));
  // HOY: expediente en cola = terminado + gate; cobrable = resuelta con monto
  let hoyListos = 0, hoyQ = 0;
  // MAÑANA: por prueba
  const entran: string[] = []; const salen: string[] = []; const pend: string[] = []; const noRec: string[] = [];
  const porCliente = new Map<string, { nombre: string; entranN: number; entranQ: number; salenN: number; salenQ: number; pendN: number; feeSinTarifa: number; feeConTarifa: number; listosN: number; listosQ: number }>();
  const cl = (r: Row) => { const k = r.nit_resuelto ?? `e-${r.empresa_id_externo}`; let c = porCliente.get(k); if (!c) { c = { nombre: (r.nit_resuelto && razon.get(r.nit_resuelto)) || r.empresa_nombre_externo || k, entranN: 0, entranQ: 0, salenN: 0, salenQ: 0, pendN: 0, feeSinTarifa: 0, feeConTarifa: 0, listosN: 0, listosQ: 0 }; porCliente.set(k, c); } return c; };
  let manListos = 0, manQ = 0, manSinTarifa = 0, feeSin = 0, feeCon = 0, pendTotal = 0, noRecTotal = 0;
  for (const r of rows) {
    if (!r.raw || typeof r.raw !== 'object') continue;
    const gate = expGate(r);
    const hoyEnCola = r.terminado && !r.cancelado && gate;
    const hoyCobrable = hoyEnCola && r.estado_tarifa === 'resuelta' && num(r.monto_calculado) > 0;
    if (hoyCobrable) { hoyListos++; hoyQ = n2(hoyQ + num(r.monto_calculado)); }
    const c = clasificarExpediente(r.raw as never, ctx);
    const quien = `${r.persona ?? r.id_externo} · ${r.empresa_nombre_externo ?? ''}`;
    const cc = cl(r);
    for (const p of c.pruebas) {
      const enCola = gate && p.situacion === 'cobra' && (servicioPorEstado(p.servicio) || (r.terminado && !r.cancelado));
      const cobrable = enCola && p.estadoTarifa === 'resuelta' && (p.monto ?? 0) > 0;
      if (cobrable) { manListos++; manQ = n2(manQ + (p.monto ?? 0)); cc.listosN++; cc.listosQ = n2(cc.listosQ + (p.monto ?? 0)); }
      if (enCola && p.estadoTarifa === 'sin_tarifa') manSinTarifa++;
      if (p.servicio === SERVICIO_FEE && enCola) { if (p.estadoTarifa === 'resuelta') { feeCon++; cc.feeConTarifa++; } else { feeSin++; cc.feeSinTarifa++; } }
      if (p.situacion === 'pendiente' && gate) { pendTotal++; cc.pendN++; if (/no reconocido/.test(p.motivo)) { noRecTotal++; noRec.push(`${quien} · ${p.servicio}: "${p.estadoPrueba}"`); } else pend.push(`${quien} · ${p.servicio}: ${p.estadoPrueba || '(vacío)'}`); }
      // ENTRA: cobrable mañana pero el expediente NO estaba en cola hoy (abierto / cancelado / parte de un expediente sin precio)
      if (cobrable && !hoyCobrable) { entran.push(`${quien} · ${p.servicio} Q${(p.monto ?? 0).toFixed(2)} · ${p.estadoPrueba} · exp ${r.terminado ? 'terminado' : 'ABIERTO'}`); cc.entranN++; cc.entranQ = n2(cc.entranQ + (p.monto ?? 0)); }
    }
    // SALE: hoy cobrable pero mañana ninguna prueba cobra (todas no_cobra / pendiente) o solo en parte
    if (hoyCobrable) {
      const cobrables = c.pruebas.filter(p => gate && p.situacion === 'cobra' && (servicioPorEstado(p.servicio) || (r.terminado && !r.cancelado)) && p.estadoTarifa === 'resuelta' && (p.monto ?? 0) > 0);
      const mananaQ = n2(cobrables.reduce((s, p) => s + (p.monto ?? 0), 0));
      if (mananaQ < num(r.monto_calculado)) { const dif = n2(num(r.monto_calculado) - mananaQ); salen.push(`${quien} · hoy Q${num(r.monto_calculado).toFixed(2)} → mañana Q${mananaQ.toFixed(2)} · ${c.pruebas.map(p => `${p.servicio}=${p.situacion}(${p.estadoPrueba || '—'})`).join(', ')}`); cc.salenN++; cc.salenQ = n2(cc.salenQ + dif); }
    }
    void serviciosDe;
  }
  console.log(`\nHOY (por expediente): ${hoyListos} cobrables · Q${hoyQ.toFixed(2)} sin IVA`);
  console.log(`MAÑANA (por prueba):  ${manListos} pruebas cobrables · Q${manQ.toFixed(2)} sin IVA · ${manSinTarifa} cobrables sin tarifa · ${pendTotal} pendientes de resultado (${noRecTotal} con estado no reconocido)`);
  console.log(`ENTRAN: ${entran.length} pruebas que hoy no se podían cobrar (Q${n2(entran.reduce((s, x) => s + Number((x.match(/Q([\d.]+)/) ?? [])[1] ?? 0), 0)).toFixed(2)})`);
  console.log(`SALEN / BAJAN: ${salen.length} expedientes hoy cobrables que mañana no cobran o cobran menos`);
  console.log(`FEE visita socio cancelado: ${feeCon} con tarifa · ${feeSin} SIN tarifa`);
  const clientes = [...porCliente.values()].filter(c => c.entranN || c.salenN || c.feeSinTarifa || c.feeConTarifa).sort((a, b) => (b.entranQ + b.salenQ) - (a.entranQ + a.salenQ));
  console.log('\nPor cliente (solo los que cambian):');
  for (const c of clientes) console.log(`  ${c.nombre.padEnd(45).slice(0, 45)} entran ${String(c.entranN).padStart(3)} (Q${c.entranQ.toFixed(2).padStart(10)}) · salen/bajan ${String(c.salenN).padStart(3)} (Q${c.salenQ.toFixed(2).padStart(9)}) · pendientes ${String(c.pendN).padStart(3)} · fee sin tarifa ${c.feeSinTarifa} · fee con tarifa ${c.feeConTarifa}`);
  if (DETALLE) {
    console.log(`\nENTRAN (${entran.length}):`); for (const x of entran) console.log('  + ' + x);
    console.log(`\nSALEN / BAJAN (${salen.length}):`); for (const x of salen) console.log('  - ' + x);
    console.log(`\nESTADO NO RECONOCIDO (${noRec.length}):`); for (const x of noRec) console.log('  ? ' + x);
  }
  console.log('');
})();
