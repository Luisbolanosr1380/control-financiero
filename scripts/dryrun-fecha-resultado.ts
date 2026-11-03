/**
 * FECHA DE RESULTADO POR PRUEBA (025) · DRY-RUN DE SOLO LECTURA sobre una base (Golden por default).
 * No escribe nada: lee las pruebas (facturacion_componente) con su expediente y aplica la MISMA regla
 * del backfill de la 025 (agenda → fecha_entrega confiable → sin_dato) para reportar:
 *   · cuántas pruebas quedarían por fuente (agenda / fecha_entrega / detectado / sin_dato)
 *   · la tabla de producción por mes de terminación (sep–nov 2026 por default): terminado,
 *     facturado, cobrado, backlog, fuera de la cola, no se cobra; y por línea de negocio
 *   · las inconsistencias (entrega antes del ingreso, entrega en expedientes abiertos)
 * Si la base YA tiene la 025, usa la fecha_resultado real de cada prueba (y la RPC de reporte para comparar).
 *
 * Uso: npx tsx scripts/dryrun-fecha-resultado.ts [--base golden|hit] [--desde 2026-09] [--hasta 2026-11]
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'golden').toLowerCase();
const DESDE = arg('--desde', '2026-09'), HASTA = arg('--hasta', '2026-11');
const envFile = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (BASE === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const { getMapeos, arranquePorEmpresa, produccionMensual } = await import('../src/lib/db/facturacion-agenda');
  const { cobroPendiente, antesDelArranque } = await import('../src/lib/facturacion-agenda/mapeo');
  const { servicioPorEstado } = await import('../src/lib/facturacion-agenda/situacion');
  const { fechasResultadoDeAgenda, normalizarFecha, diaGuatemala, mesGuatemala } = await import('../src/lib/facturacion-agenda/fecha-resultado');
  const { lineaNegocio, mesesEntre, primerDia, ultimoDia } = await import('../src/lib/facturacion-agenda/produccion');
  const sb = supabase()!;
  const arranque = arranquePorEmpresa(await getMapeos());

  type Exp = { id: string; raw: Record<string, unknown> | null; terminado: boolean; cancelado: boolean; eliminado: boolean; estado_tarifa: string; fecha_ingreso: string | null; fecha_entrega: string | null; nit_resuelto: string | null; empresa_id_externo: string | null; empresa_nombre_externo: string | null; status_cobro_externo: string | null; estatus_pago_externo: string | null; fuente: string };
  type Comp = { id: string; expediente_id: string; servicio: string; situacion: string; estado_tarifa: string; monto_calculado: number | string | null; factura_id: string | null; no_factura: string | null; fecha_resultado?: string | null; fecha_resultado_fuente?: string | null; facturacion_expediente: Exp };
  const comps: Comp[] = [];
  const cols = 'id, expediente_id, servicio, situacion, estado_tarifa, monto_calculado, factura_id, no_factura, facturacion_expediente!inner(id, raw, terminado, cancelado, eliminado, estado_tarifa, fecha_ingreso, fecha_entrega, nit_resuelto, empresa_id_externo, empresa_nombre_externo, status_cobro_externo, estatus_pago_externo, fuente)';
  let con025 = true;
  for (let p = 0; ; p++) {
    const pedir = (sel: string): PromiseLike<{ data: unknown; error: { message: string } | null }> => sb.from('facturacion_componente').select(sel).eq('fuente', 'agenda').in('situacion', ['cobra', 'no_cobra']).eq('facturacion_expediente.eliminado', false).order('id').range(p * 1000, p * 1000 + 999);
    let r = await pedir(`${cols}, fecha_resultado, fecha_resultado_fuente`);
    if (r.error && /fecha_resultado/.test(r.error.message)) { con025 = false; r = await pedir(cols); }
    if (r.error) throw new Error(r.error.message);
    const filas = (r.data ?? []) as Comp[]; comps.push(...filas); if (filas.length < 1000) break;
  }
  const porExp = new Map<string, number>();
  for (const c of comps) porExp.set(c.expediente_id, (porExp.get(c.expediente_id) ?? 0) + 1);
  // Facturas cobradas (todas las líneas de cada número)
  const nfs = [...new Set(comps.map(c => c.no_factura).filter((x): x is string => !!x))];
  const noCobrada = new Set<string>();
  for (let i = 0; i < nfs.length; i += 200) {
    const { data } = await sb.from('facturas_clientes').select('no_factura, estado').in('no_factura', nfs.slice(i, i + 200));
    for (const f of (data ?? []) as { no_factura: string; estado: string | null }[]) if (!/^COBRAD[OA]$/i.test(String(f.estado ?? ''))) noCobrada.add(f.no_factura);
  }
  const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
  const n2 = (n: number) => Math.round(n * 100) / 100;
  const vigente = (e: Exp) => !e.eliminado && !['excluido_psicometrica', 'excluido_no_factura'].includes(e.estado_tarifa);

  /** Regla del backfill de la 025 (idéntica a facturacion_fecha_resultado_backfill). */
  const backfill = (c: Comp): { fecha: string | null; fuente: string; inconsistencia?: string } => {
    const e = c.facturacion_expediente;
    const ingreso = (e.fecha_ingreso ?? '').slice(0, 10);
    const fa = e.raw ? fechasResultadoDeAgenda(e.raw) : { poligrafo: null, socio: null };
    const linea = lineaNegocio(c.servicio);
    const ag = linea === 'poligrafo' ? fa.poligrafo : linea === 'socio' ? fa.socio : null;
    if (ag && (!ingreso || diaGuatemala(ag) >= ingreso)) return { fecha: ag, fuente: 'agenda' };
    const ent = normalizarFecha(e.fecha_entrega);
    if (ent && e.terminado) {
      if (ingreso && diaGuatemala(ent) < ingreso) return { fecha: null, fuente: 'sin_dato', inconsistencia: 'entrega antes del ingreso' };
      if (!servicioPorEstado(c.servicio) || porExp.get(c.expediente_id) === 1) return { fecha: ent, fuente: 'fecha_entrega' };
      return { fecha: null, fuente: 'sin_dato', inconsistencia: 'COMPLETO: la entrega no sirve por prueba' };
    }
    if (ent && !e.terminado) return { fecha: null, fuente: 'sin_dato', inconsistencia: 'entrega en expediente abierto (prometida, no real)' };
    return { fecha: null, fuente: 'sin_dato' };
  };

  const out: string[] = [];
  const log = (s = '') => { out.push(s); console.log(s); };
  const vig = comps.filter(c => vigente(c.facturacion_expediente));
  log(`\nDRY-RUN fecha de resultado (025) · ${BASE.toUpperCase()} · ${vig.length} pruebas con resultado (cobra / no_cobra) de expedientes vigentes · solo lectura · ${con025 ? 'la base YA tiene la 025 (se usa fecha_resultado real)' : 'la base NO tiene la 025 (se simula el backfill)'}`);
  const fuentes = new Map<string, number>(); const inc = new Map<string, number>();
  const fechaDe = new Map<string, string | null>();
  for (const c of vig) {
    const r = con025 && c.fecha_resultado_fuente ? { fecha: c.fecha_resultado ?? null, fuente: c.fecha_resultado_fuente } : backfill(c);
    fuentes.set(r.fuente, (fuentes.get(r.fuente) ?? 0) + 1);
    if ('inconsistencia' in r && r.inconsistencia) inc.set(r.inconsistencia, (inc.get(r.inconsistencia) ?? 0) + 1);
    fechaDe.set(c.id, r.fecha);
  }
  log('\nPruebas por fuente de la fecha (tras el backfill):');
  for (const [f, n] of [...fuentes].sort((a, b) => b[1] - a[1])) log(`  ${f.padEnd(14)} ${String(n).padStart(6)}  (${Math.round((n / vig.length) * 100)} %)`);
  if (inc.size) { log('\nInconsistencias (no se usa la fecha):'); for (const [k, n] of inc) log(`  ${k}: ${n}`); }
  const soloCobra = vig.filter(c => c.situacion === 'cobra');
  const sinFecha = soloCobra.filter(c => !fechaDe.get(c.id));
  log(`\nCobrables sin fecha (no entran en ningún mes): ${sinFecha.length} de ${soloCobra.length} · Q${n2(sinFecha.filter(c => c.estado_tarifa === 'resuelta').reduce((s, c) => s + num(c.monto_calculado), 0)).toLocaleString('en-US')} sin IVA · ${sinFecha.filter(c => !c.factura_id).length} sin factura`);

  // Tabla por mes
  type Fila = { terminado_n: number; terminado_q: number; sin_tarifa_n: number; facturado_n: number; facturado_q: number; cobrado_n: number; cobrado_q: number; backlog_n: number; backlog_q: number; fuera_n: number; fuera_q: number; no_cobra_n: number };
  const fila = (): Fila => ({ terminado_n: 0, terminado_q: 0, sin_tarifa_n: 0, facturado_n: 0, facturado_q: 0, cobrado_n: 0, cobrado_q: 0, backlog_n: 0, backlog_q: 0, fuera_n: 0, fuera_q: 0, no_cobra_n: 0 });
  const meses = mesesEntre(DESDE, HASTA);
  const porMes = new Map<string, Fila>(meses.map(m => [m, fila()]));
  const porLinea = new Map<string, Fila>();
  const enCola = (c: Comp) => { const e = c.facturacion_expediente; return !c.factura_id && cobroPendiente(e.status_cobro_externo, e.estatus_pago_externo) && !antesDelArranque(e.fecha_ingreso, arranque.get(e.empresa_id_externo ?? '')) && (servicioPorEstado(c.servicio) || (e.terminado && !e.cancelado)); };
  for (const c of vig) {
    const f = fechaDe.get(c.id); if (!f) continue;
    const mes = mesGuatemala(f); const row = porMes.get(mes); if (!row) continue;
    const lk = `${mes}|${lineaNegocio(c.servicio)}`; const lrow = porLinea.get(lk) ?? porLinea.set(lk, fila()).get(lk)!;
    const q = c.estado_tarifa === 'resuelta' ? num(c.monto_calculado) : 0;
    for (const r of [row, lrow]) {
      if (c.situacion === 'no_cobra') { r.no_cobra_n++; continue; }
      r.terminado_n++; r.terminado_q = n2(r.terminado_q + q); if (!q) r.sin_tarifa_n++;
      if (c.factura_id) { r.facturado_n++; r.facturado_q = n2(r.facturado_q + q); if (c.no_factura && !noCobrada.has(c.no_factura)) { r.cobrado_n++; r.cobrado_q = n2(r.cobrado_q + q); } }
      else if (enCola(c)) { r.backlog_n++; r.backlog_q = n2(r.backlog_q + q); }
      else { r.fuera_n++; r.fuera_q = n2(r.fuera_q + q); }
    }
  }
  const Q = (v: number) => `Q${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const linea = (k: string, r: Fila) => `  ${k.padEnd(22)} ${String(r.terminado_n).padStart(5)} ${Q(r.terminado_q).padStart(10)} ${String(r.sin_tarifa_n).padStart(5)} │ ${String(r.facturado_n).padStart(5)} ${Q(r.facturado_q).padStart(10)} │ ${String(r.cobrado_n).padStart(5)} ${Q(r.cobrado_q).padStart(10)} │ ${String(r.backlog_n).padStart(5)} ${Q(r.backlog_q).padStart(10)} │ ${String(r.fuera_n).padStart(5)} ${Q(r.fuera_q).padStart(10)} │ ${String(r.no_cobra_n).padStart(5)}`;
  log(`\nProducción por mes de terminación (${DESDE} → ${HASTA}, zona Guatemala, montos sin IVA):`);
  log(`  ${'mes'.padEnd(22)} ${'term.'.padStart(5)} ${'Q term.'.padStart(10)} ${'s/tar'.padStart(5)} │ ${'fact.'.padStart(5)} ${'Q fact.'.padStart(10)} │ ${'cobr.'.padStart(5)} ${'Q cobr.'.padStart(10)} │ ${'backl'.padStart(5)} ${'Q backlog'.padStart(10)} │ ${'fuera'.padStart(5)} ${'Q fuera'.padStart(10)} │ ${'no cobra'}`);
  const tot = fila();
  for (const m of meses) { const r = porMes.get(m)!; log(linea(m, r)); for (const k of Object.keys(tot) as (keyof Fila)[]) tot[k] = n2(tot[k] + r[k]); }
  log(linea('TOTAL', tot));
  log('\nPor línea de negocio:');
  for (const m of meses) for (const l of ['poligrafo', 'socio', 'otros']) { const r = porLinea.get(`${m}|${l}`); if (r) log(linea(`${m} · ${l}`, r)); }
  log('\nLectura: "fuera" = terminado sin factura nuestra pero ya resuelto en la Agenda (pagado por provisión / facturado fuera de la app / antes del arranque del cliente). "backlog" = terminado, sin factura y todavía en la cola.');

  if (con025) {
    const rpc = await produccionMensual({ desde: primerDia(DESDE), hasta: ultimoDia(HASTA) });
    if (rpc) {
      const dif = meses.filter(m => { const a = porMes.get(m)!, b = rpc.meses.find(x => x.mes === m); return b ? (a.terminado_n !== b.terminado_n || n2(a.terminado_q) !== n2(b.terminado_q) || a.facturado_n !== b.facturado_n || a.cobrado_n !== b.cobrado_n || a.backlog_n !== b.backlog_n || a.no_cobra_n !== b.no_cobra_n) : a.terminado_n + a.no_cobra_n > 0; });
      log(`\nParidad con la RPC facturacion_produccion_mensual: ${dif.length ? `DIFIEREN los meses ${dif.join(', ')}` : 'idéntica mes a mes (terminado, facturado, cobrado, backlog, no se cobra)'}; RPC sin fecha = ${rpc.sin_fecha.n}, inconsistencias = ${rpc.inconsistencias}`);
    }
  }
  const dir = path.join(process.env.HOME ?? '.', 'Downloads', 'capturas-fecha-resultado');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `dryrun-${BASE}-fecha-resultado.txt`);
  fs.writeFileSync(file, out.join('\n') + '\n');
  console.log(`\nReporte guardado en ${file}`);
})().catch(e => { console.error(e); process.exit(1); });
