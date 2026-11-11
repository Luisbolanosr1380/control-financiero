/**
 * IDENTIFICAR PAGO: BUSCAR TAMBIÉN POR SALDO Y POR NETO CON RETENCIÓN DE IVA — validador.
 *
 *  A. Estático: la página carga facturas abiertas + perfiles desde el servidor (identificar-pago.ts reusa las lecturas y
 *     la consolidación del #51), la comparación y el orden viven en el módulo puro, el selector «Buscar sobre» y la
 *     tolerancia viajan en la URL, columnas total / saldo / esperado / «Calza por», enlace prellenado al modal de cobro
 *     (que lee cobro / retiva / retisr), atajo al #51 con la base, sin diálogos del navegador, ayuda, sin migración.
 *  B. Puro: perfil de retención (moda de la tasa), montos esperados (Q450 → IVA 48.21 → 15 % = 7.23 → 442.77), la
 *     retención ya registrada NO se descuenta dos veces, candidatos por base, etiquetas, orden (exactas → total/saldo →
 *     perfil → general → días vencida), clientes que calzan por suma de netos, URL ↔ estado, enlaces.
 *  C. HIT (datos sembrados): tres clientes (retiene 15 %, retiene 80 %, nunca retuvo) con historial de cobros con
 *     retención y facturas abiertas; cada caso del brief contra getDatosIdentificar + calzarFacturas / calzarClientes.
 *
 * Uso: npx tsx scripts/validate-identificar-retencion.ts hit [--conservar | --solo-limpiar]   (--conservar deja los datos IR-E2E para el E2E en Chrome)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BaseBusqueda, FacturaIdentificable, PerfilRetencion, RegistroRetencion } from '../src/lib/cobros/identificar';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const SOLO_LIMPIAR = process.argv.includes('--solo-limpiar'), CONSERVAR = process.argv.includes('--conservar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const PREFIJO = 'IR-E2E-';
const CLIENTES = [
  { app: 'sbwIRE2E01', nit: '99990038K', nombre: 'RETIENE 15 E2E', razon: 'RETIENE 15 E2E, S.A.' },
  { app: 'sbwIRE2E02', nit: '99990039K', nombre: 'RETIENE 80 E2E', razon: 'RETIENE 80 E2E, S.A.' },
  { app: 'sbwIRE2E03', nit: '99990040K', nombre: 'NUNCA RETUVO E2E', razon: 'NUNCA RETUVO E2E, S.A.' },
];

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const pg = rd('src/app/(app)/cobros/identificar/page.tsx'), srv = rd('src/lib/db/identificar-pago.ts'), puro = rd('src/lib/cobros/identificar.ts'), cli = rd('src/components/cobros/identificar-client.tsx'), fb = rd('src/lib/db/facturas-buscar.ts'), det = rd('src/app/(app)/facturacion/[id]/page.tsx'), btn = rd('src/components/facturas/registrar-cobro-button.tsx'), bm = rd('src/lib/facturacion/buscar-monto.ts');
  ok(/getDatosIdentificar\(\)/.test(pg) && /leerFilasBusqueda\(\)/.test(srv) && /consolidarParaBusqueda\(filas, cobros, ncs, hoy\)/.test(srv) && /!f\.cobrada && f\.estado !== 'anulada' && f\.estado !== 'refacturada' && f\.saldo > 0\.005/.test(srv) && !/\.from\(|\.rpc\(|supabase\(\)/.test(srv + puro + cli) && /SOLO LECTURA/.test(srv), 'servidor: reusa las lecturas y la consolidación del #51 (mismo saldo), facturas abiertas = vivas, no cobradas (026) y con saldo; solo lectura');
  ok(/monto_retencion_iva, monto_retencion_isr/.test(fb) && /dias_credito\)/.test(fb) && /estadoFacturaCanon\(c\.estado_cobro\) === 'ANULADO'\) continue/.test(srv) && /ivaLinea: iva > 0 \? iva : total - total \/ 1\.12/.test(srv) && /perfilesRetencion\(regs\)/.test(srv), 'perfil: cobros ACTIVOS con retención unidos a su línea (IVA de la línea, cliente); días vencida = emisión + días de crédito');
  ok(/export function montosEsperados/.test(puro) && /export function calzarFacturas/.test(puro) && /export function calzarClientes/.test(puro) && /TASA_GENERAL_IVA = 0\.15/.test(puro) && /REDONDEO_RETENCION = 0\.01/.test(puro) && /RANGO_TIPO: Record<TipoCoincidencia, number> = \{ total: 0, saldo: 0, neto: 1, neto_general: 2 \}/.test(puro) && !/from 'node:|server-only|@\/lib\/db/.test(puro), 'puro: montos esperados, coincidencias por factura y por cliente, tasa general 15 %, un centavo por línea de holgura en el neto, orden por tipo; sin IO');
  ok(/window\.history\.replaceState/.test(cli) && /estadoDesdeParams\(k => sp\.get\(k\)\)/.test(cli) && /data-sobre=\{b\}/.test(cli) && /data-tol=\{p\.key\}/.test(cli) && /<th className="num">Total<\/th>/.test(cli) && /<th className="num">Saldo<\/th>/.test(cli) && /<th className="num">Esperado<\/th>/.test(cli) && /<th>Calza por<\/th>/.test(cli) && /enlaceRegistrarCobro\(m, monto\)/.test(cli) && /puede\('registrar_cobro'\)/.test(cli) && /enlaceBusquedaFacturas\(monto, base\)/.test(cli) && !/window\.(confirm|alert|prompt)/.test(cli + btn), 'pantalla: monto, tolerancia y «Buscar sobre» en la URL; columnas total / saldo / esperado / Calza por; «Registrar cobro» prellenado solo con registrar_cobro; atajo al #51 con la base; sin diálogos del navegador');
  ok(/prellenadoDesdeParams\(k =>/.test(det) && /prellenadoCobro=\{prellenadoCobro\}/.test(det) && /useState\(!!prefill\)/.test(btn) && /metodo: 'Retención IVA', bancoId: undefined, monto: round2\(prefill\.retIva\)/.test(btn) && /data-prellenado=\{prefill \? '1' : '0'\}/.test(btn), 'factura: ?cobro=&retiva=&retisr= abre el modal «Registrar cobro» con el depósito y la retención como componentes (la acción del servidor no cambia)');
  ok(/aviso\?: 'retencion'/.test(bm) && /tolerancia que cubre la retención de IVA/.test(bm) && /Identificar pago busca también por saldo/.test(rd('supabase/ayuda_identificar_saldo_retencion.sql')) && !fs.readdirSync('supabase/migrations').some(f => /identificar|retencion/i.test(f)), 'atajo neto → búsqueda por saldo con tolerancia ampliada y aviso en el chip; línea en la ayuda de Cobros; sin migración');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const P = await import('../src/lib/cobros/identificar');
  const regs: RegistroRetencion[] = [
    { clienteId: 'A', retIva: 17.1, retIsr: 0, ivaLinea: 114, subtotalLinea: 950 }, { clienteId: 'A', retIva: 36, retIsr: 0, ivaLinea: 240, subtotalLinea: 2000 }, { clienteId: 'A', retIva: 96, retIsr: 0, ivaLinea: 120, subtotalLinea: 1000 },
    { clienteId: 'B', retIva: 480, retIsr: 0, ivaLinea: 600, subtotalLinea: 5000 }, { clienteId: 'B', retIva: 96, retIsr: 0, ivaLinea: 120, subtotalLinea: 1000 },
    { clienteId: 'D', retIva: 0, retIsr: 50, ivaLinea: 120, subtotalLinea: 1000 },
  ];
  const perfiles = P.perfilesRetencion(regs);
  ok(perfiles.A.tasaIva === 0.15 && perfiles.A.nIva === 3 && perfiles.B.tasaIva === 0.8 && perfiles.B.nIva === 2 && perfiles.D.tasaIva === null && perfiles.D.tasaIsr === 0.05 && !('C' in perfiles), 'perfil: la tasa más frecuente (A: 15 % aunque un cobro fue al 80 %; B: 80 %); D solo ISR 5 %; C sin perfil');
  const F = (id: string, clienteId: string, total: number, iva: number, extra: Partial<FacturaIdentificable> = {}): FacturaIdentificable => ({ id: 'rec' + id, noFactura: id, clienteId, cliente: 'Cliente ' + clienteId, nit: '1', fechaEmision: '2026-09-01', fechaVencimiento: '2026-10-01', diasVencida: 41, total, iva, cobrado: 0, ncs: 0, saldo: total, lineas: 1, estado: 'emitida', ...extra });
  const a03 = F('A03', 'A', 450, 48.21), c01 = F('C01', 'C', 450, 48.21, { diasVencida: 90 });
  const a04 = F('A04', 'A', 1120, 120, { cobrado: 578, saldo: 542, estado: 'parcial' });   // 560 al banco + 18 de retención ya registrada
  const b03 = F('B03', 'B', 1120, 120), b04 = F('B04', 'B', 2240, 240, { diasVencida: 60 });
  const d01 = F('D01', 'D', 1120, 120);
  const mA = P.montosEsperados(a03, perfiles.A), mC = P.montosEsperados(c01, perfiles.C), mA4 = P.montosEsperados(a04, perfiles.A), mB = P.montosEsperados(b03, perfiles.B), mD = P.montosEsperados(d01, perfiles.D);
  ok(mA.total === 450 && mA.saldo === 450 && mA.retIva === 7.23 && mA.neto === 442.77 && !mA.general, 'Q450 con perfil 15 %: IVA 48.21 → retención 7.23 → neto 442.77');
  ok(mC.retIva === 7.23 && mC.neto === 442.77 && mC.general && mC.tasaIva === 0.15, 'cliente que nunca retuvo: se prueba la tasa general 15 % y se marca general');
  ok(mA4.saldo === 542 && P.ivaPendienteDe(a04) === 58.07 && mA4.retIva === 8.71 && mA4.neto === 533.29, 'parcial con retención ya registrada: saldo 1,120 − 560 − 18 = 542 (la retención registrada es un cobro y no se resta otra vez); IVA pendiente 58.07 → retención 8.71 → neto 533.29');
  ok(mB.retIva === 96 && mB.neto === 1024 && mD.retIva === 18 && mD.retIsr === 50 && mD.neto === 1052 && mD.general, 'perfil 80 %: 1,120 → neto 1,024; perfil solo ISR 5 %: IVA general 18 + ISR 50 → neto 1,052');
  const cand = (m: ReturnType<typeof P.montosEsperados>, b: BaseBusqueda) => P.candidatos(m, b).map(c => `${c.tipo}:${c.monto}`).join(',');
  ok(cand(mA, 'auto') === 'total:450,neto:442.77' && cand(mA4, 'auto') === 'total:1120,saldo:542,neto:533.29' && cand(mC, 'auto') === 'total:450,neto_general:442.77' && cand(mA, 'total') === 'total:450' && cand(mA, 'saldo') === 'saldo:450' && cand(mA, 'neto') === 'neto:442.77', 'candidatos por base: automático compara los tres (sin repetir saldo = total); total / saldo / neto solo el suyo');
  const todas = [a03, c01, a04, b03, b04, d01];
  const nf0 = (c: { factura: FacturaIdentificable }) => c.factura.noFactura;
  const q = (monto: number, tol: number, base: BaseBusqueda) => P.calzarFacturas(todas, perfiles, monto, tol, base).map(c => `${c.factura.noFactura}:${c.tipo}:${c.diff}`).join(',');
  ok(q(442.77, 0, 'auto') === 'A03:neto:0,C01:neto_general:0' && q(442.77, 0, 'total') === '' && q(442.77, 0, 'neto') === 'A03:neto:0,C01:neto_general:0' && q(450, 0, 'auto') === 'C01:total:0,A03:total:0', 'Q442.77: A03 «neto» primero y C01 «posible» abajo aunque esté más vencida; con base Total no calza; Q450 calza por total (la más vencida primero)');
  ok(q(542, 0, 'auto') === 'A04:saldo:0' && q(533.29, 0, 'auto') === 'A04:neto:0' && q(1120, 0, 'total') === 'A04:total:0,B03:total:0,D01:total:0' && q(1024, 0, 'auto') === 'B03:neto:0', 'parcial: 542 calza por saldo y 533.29 por neto; 1,120 por total (A04 → B03 → D01: mismos días vencida, por número); 1,024 por neto 80 %');
  ok(q(443, 1, 'auto') === 'A03:neto:-0.23,C01:neto_general:-0.23' && q(449.5, 1, 'auto') === 'C01:total:0.5,A03:total:0.5' && q(442.77, 10, 'auto') === 'A03:neto:0,C01:neto_general:0', 'tolerancia ±1: diferencia contra el monto con el que calzó; con ±10 el neto exacto sigue primero');
  const e = P.calzarFacturas(todas, perfiles, 442.77, 0, 'auto');
  ok(e[0].etiqueta === 'Neto con retención IVA 15 % (−Q7.23)' && e[1].etiqueta === 'Posible: retención general IVA 15 % (−Q7.23)' && e[1].posible && P.calzarFacturas(todas, perfiles, 542, 0, 'auto')[0].etiqueta === 'Saldo' && P.calzarFacturas(todas, perfiles, 450, 0, 'auto')[0].etiqueta === 'Total exacto' && P.calzarFacturas(todas, perfiles, 449.5, 1, 'auto')[0].etiqueta === 'Total' && P.calzarFacturas([d01], perfiles, 1052, 0, 'auto')[0].etiqueta === 'Posible: retención general IVA 15 % (−Q18.00) · ISR 5 % (−Q50.00)', 'etiquetas: «Neto con retención IVA 15 % (−Q7.23)», «Posible: retención general…», «Saldo», «Total exacto» / «Total», con ISR');
  const i01 = F('I01', 'A', 5950, 637.5, { diasVencida: 10 }), i02 = F('I02', 'A', 2520, 270, { diasVencida: 10, lineas: 2 });
  const rr = P.calzarFacturas([i01, i02, a03], perfiles, 5854.38, 0, 'auto'), rr2 = P.calzarFacturas([i01, i02], perfiles, 2479.5, 0, 'auto'), rr3 = P.calzarFacturas([i01], perfiles, 5854.35, 0, 'auto'), rr4 = P.calzarFacturas([i01], perfiles, 5950.01, 0, 'auto');
  ok(rr.length === 1 && nf0(rr[0]) === 'I01' && rr[0].esperado === 5854.37 && rr[0].diff === -0.01 && rr[0].exacta && rr[0].etiqueta === 'Neto con retención IVA 15 % (−Q95.63)' && rr2.length === 1 && nf0(rr2[0]) === 'I02' && rr2[0].diff === 0 && rr3.length === 0 && rr4.length === 0, 'redondeo de la retención: Q5,950 → 15 % de 637.50 = 95.625; el cliente depositó 5,854.38 (retuvo 95.62) y calza como exacta con −Q0.01 (un centavo por línea; dos líneas → dos centavos); dos centavos en una línea no; el total no tiene holgura');
  const qc = (monto: number, base: BaseBusqueda) => P.calzarClientes(todas, perfiles, monto, 0, base).map(c => `${c.clienteId}:${c.tipo}:${c.suma}`).join(',');
  const cB = P.calzarClientes(todas, perfiles, 3072, 0, 'auto')[0];
  ok(qc(3072, 'auto') === 'B:neto:3072' && cB.etiqueta === 'Suma de netos · Neto con retención IVA 80 % (−Q288.00)' && cB.retIva === 288 && cB.facturas.map(x => x.factura.noFactura).join(',') === 'B04,B03' && qc(3360, 'auto') === 'B:total:3360' && qc(992, 'auto') === 'A:saldo:992' && qc(1570, 'auto') === 'A:total:1570' && qc(3072, 'total') === '', 'clientes que calzan: B con dos facturas netas (1,024 + 2,048 = 3,072, retención 288), por total 3,360, A por saldo 450 + 542; un cliente con una sola factura no se repite; base total no trae el neto');
  const est = P.estadoDesdeParams(k => ({ m: '442.77', tol: 'q10', sobre: 'neto' } as Record<string, string>)[k] ?? null);
  const est2 = P.estadoDesdeParams(k => ({ m: 'abc', tol: 'raro', sobre: 'x' } as Record<string, string>)[k] ?? null);
  ok(est.monto === 442.77 && est.preset === 'q10' && est.base === 'neto' && est2.monto === 0 && est2.preset === 'exacto' && est2.base === 'auto' && P.paramsDeEstado(est) === '?m=442.77&tol=q10&sobre=neto' && P.paramsDeEstado({ monto: 0, preset: 'exacto', base: 'auto' }) === '' && P.paramsDeEstado({ monto: 500, preset: 'exacto', base: 'saldo' }) === '?m=500&sobre=saldo', 'URL ↔ estado: m, tol, sobre; inválidos → por defecto; sin los valores por defecto');
  ok(P.enlaceRegistrarCobro(e[0], 442.77) === '/facturacion/recA03?cobro=442.77&retiva=7.23' && P.enlaceRegistrarCobro(P.calzarFacturas(todas, perfiles, 542, 0, 'auto')[0], 542) === '/facturacion/recA04?cobro=542' && P.enlaceRegistrarCobro({ ...e[0], factura: { ...e[0].factura, id: '' } }, 442.77) === null && JSON.stringify(P.prellenadoDesdeParams(k => ({ cobro: '442.77', retiva: '7.23' } as Record<string, string>)[k] ?? null)) === '{"monto":442.77,"retIva":7.23,"retIsr":0}' && P.prellenadoDesdeParams(() => null) === null, 'enlace prellenado: cobro + retiva solo cuando calzó por neto; sin id → null; la factura lo lee de la URL');
  ok(P.enlaceBusquedaFacturas(9450, 'auto') === '/facturacion?monto=9450&estado=pendientes' && P.enlaceBusquedaFacturas(9450, 'saldo') === '/facturacion?monto=9450&sobre=saldo&estado=pendientes' && P.enlaceBusquedaFacturas(442.77, 'neto') === `/facturacion?monto=442.77&sobre=saldo&tol=${P.toleranciaNetoParaBusqueda(442.77)}&aviso=retencion&estado=pendientes` && P.toleranciaNetoParaBusqueda(442.77) === 42.51 && P.toleranciaNetoParaBusqueda(442.77) >= 450 - 442.77 + 1, 'atajo al #51: automático como antes; saldo → sobre saldo; neto → sobre saldo con tolerancia que cubre hasta el 80 % del IVA (Q442.77 → ±Q42.51) y aviso');
  const BM = await import('../src/lib/facturacion/buscar-monto');
  const cr = BM.criteriosDesdeParams(k => ({ monto: '442.77', tol: '42.51', sobre: 'saldo', estado: 'pendientes', aviso: 'retencion' } as Record<string, string>)[k] ?? null);
  ok(cr.aviso === 'retencion' && BM.describirCriterios(cr) === 'Monto Q442.77 ±Q42.51 · pendientes · sobre saldo pendiente · tolerancia que cubre la retención de IVA' && BM.paramsDeCriterios(cr) === '?monto=442.77&tol=42.51&sobre=saldo&estado=pendientes&aviso=retencion', 'chip del #51 con el aviso: «… · tolerancia que cubre la retención de IVA»');

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: fs2 } = await sb.from('facturas_clientes').select('id').like('no_factura', `${PREFIJO}%`);
    const ids = (fs2 ?? []).map(f => f.id as string);
    if (ids.length) { await sb.from('cobros_clientes').delete().in('factura_id', ids); await sb.from('notas_credito').delete().in('factura_id', ids); await sb.from('facturas_clientes').delete().in('id', ids); }
    await sb.from('clientes').delete().in('nit', CLIENTES.map(c => c.nit));
    const { count } = await sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).like('no_factura', `${PREFIJO}%`);
    const { count: cc } = await sb.from('clientes').select('id', { count: 'exact', head: true }).in('nit', CLIENTES.map(c => c.nit));
    return (count ?? 0) + (cc ?? 0);
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 facturas IR-E2E; cobros y clientes borrados'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const { data: clis, error: eCli } = await sb.from('clientes').insert(CLIENTES.map(c => ({ airtable_id: c.app, nombre_empresa: c.nombre, razon_social: c.razon, nit: c.nit, activo: true, dias_credito: 30 }))).select('id, airtable_id');
  const cliUuid = (app: string) => (clis ?? []).find(c => c.airtable_id === app)?.id as string;
  const [A, B, C] = CLIENTES.map(c => c.app);
  const linea = (nf: string, cliente: string, total: number, iva: number, estado: string, fecha = '2026-09-01') => ({ no_factura: `${PREFIJO}${nf}`, total, subtotal: Math.round((total - iva) * 100) / 100, iva, estado, cliente_id: cliUuid(cliente), fecha_emision: fecha });
  const filas = [
    linea('A01', A, 1064, 114, 'COBRADO ', '2026-06-01'), linea('A02', A, 2240, 240, 'COBRADO ', '2026-07-01'),   // historial con retención 15 %
    linea('A03', A, 450, 48.21, 'EMITIDA'),                                                                        // abierta: Q450 → neto 442.77
    linea('A04', A, 1120, 120, 'COBRADO PARCIAL '),                                                                // parcial: 560 + retención 18 ya registrada → saldo 542
    linea('B01', B, 5600, 600, 'COBRADO ', '2026-06-01'), linea('B02', B, 1120, 120, 'COBRADO ', '2026-07-01'),   // historial con retención 80 %
    linea('B03', B, 1120, 120, 'EMITIDA'), linea('B04', B, 2240, 240, 'EMITIDA', '2026-08-15'),                   // dos abiertas → suma de netos 3,072
    linea('C01', C, 450, 48.21, 'EMITIDA', '2026-07-15'),                                                          // nunca retuvo → «posible»
  ].map((f, i) => ({ ...f, airtable_id: `recIRE2E${String(i + 1).padStart(3, '0')}` }));
  const { data: ins, error: eIns } = await sb.from('facturas_clientes').insert(filas).select('id, no_factura');
  const idDe = (nf: string) => (ins ?? []).find(r => r.no_factura === `${PREFIJO}${nf}`)?.id as string;
  const cobro = (nf: string, monto: number, metodo: 'Transferencia' | 'Retención IVA', fecha: string, grupo: string) => ({ factura_id: idDe(nf), monto_cobrado: monto, monto_cobro_gtq: monto, fecha_cobro: fecha, estado_cobro: 'Activo', metodo, estado: 'Pendiente', monto_retencion_iva: metodo === 'Retención IVA' ? monto : 0, monto_retencion_isr: 0, cobro_grupo_id: `G-IRE2E-${grupo}` });
  const { error: eCob } = await sb.from('cobros_clientes').insert([
    cobro('A01', 1046.9, 'Transferencia', '2026-06-20', 'A01'), cobro('A01', 17.1, 'Retención IVA', '2026-06-20', 'A01'),
    cobro('A02', 2204, 'Transferencia', '2026-07-20', 'A02'), cobro('A02', 36, 'Retención IVA', '2026-07-20', 'A02'),
    cobro('A04', 560, 'Transferencia', '2026-10-01', 'A04'), cobro('A04', 18, 'Retención IVA', '2026-10-01', 'A04'),
    cobro('B01', 5120, 'Transferencia', '2026-06-20', 'B01'), cobro('B01', 480, 'Retención IVA', '2026-06-20', 'B01'),
    cobro('B02', 1024, 'Transferencia', '2026-07-20', 'B02'), cobro('B02', 96, 'Retención IVA', '2026-07-20', 'B02'),
    // un cobro ANULADO con retención al 80 % del cliente A: no debe pesar en su perfil
    { ...cobro('A02', 192, 'Retención IVA', '2026-07-25', 'A02X'), estado_cobro: 'Anulado' },
  ]);
  ok(!eCli && !eIns && !eCob && (ins ?? []).length === 9, `sembrado: 3 clientes, 9 facturas (5 abiertas), 11 cobros (5 retenciones activas + 1 anulada)${eCli ? ' · ' + eCli.message : ''}${eIns ? ' · ' + eIns.message : ''}${eCob ? ' · ' + eCob.message : ''}`);

  const S = await import('../src/lib/db/identificar-pago');
  const d = await S.getDatosIdentificar();
  const mias = d.facturas.filter(f => f.noFactura.startsWith(PREFIJO));
  const nf = (c: { factura: FacturaIdentificable }) => c.factura.noFactura.slice(PREFIJO.length);
  ok(!d.error && mias.map(f => f.noFactura.slice(PREFIJO.length)).sort().join(',') === 'A03,A04,B03,B04,C01' && mias.every(f => f.id.startsWith('recIRE2E')) && mias.find(f => f.noFactura.endsWith('A04'))!.saldo === 542 && mias.find(f => f.noFactura.endsWith('A04'))!.estado === 'parcial' && mias.find(f => f.noFactura.endsWith('A03'))!.diasVencida > 0, `servidor: 5 facturas abiertas de prueba (las cobradas no), ids del listado, saldo de la parcial 542 (560 + retención 18 ya registrada), días vencida > 0 (${d.ms} ms, ${d.facturas.length} abiertas en total)`);
  const pA: PerfilRetencion | undefined = d.perfiles[A], pB = d.perfiles[B], pC = d.perfiles[C];
  ok(pA?.tasaIva === 0.15 && pA.nIva === 3 && pB?.tasaIva === 0.8 && pB.nIva === 2 && pC === undefined, `perfiles desde los cobros: A 15 % (3 retenciones activas; la anulada al 80 % no pesa), B 80 % (2), C sin perfil (${d.cobrosConRetencion} cobros con retención en HIT)`);
  const z = (monto: number, tol: number, base: BaseBusqueda) => P.calzarFacturas(mias, d.perfiles, monto, tol, base);
  const r1 = z(442.77, 0, 'auto');
  ok(r1.map(nf).join(',') === 'A03,C01' && r1[0].tipo === 'neto' && r1[0].etiqueta === 'Neto con retención IVA 15 % (−Q7.23)' && r1[0].diff === 0 && r1[1].tipo === 'neto_general' && r1[1].posible, 'Q442.77 automático: la Q450 del cliente con perfil 15 % calza «Neto con retención IVA 15 % (−Q7.23)»; la del que nunca retuvo sale «posible» y abajo');
  ok(z(442.77, 0, 'total').length === 0 && z(450, 0, 'total').map(nf).sort().join(',') === 'A03,C01', 'el mismo depósito con base «Total» no calza (Q450 sí)');
  const r3 = z(1024, 0, 'auto');
  ok(r3.length === 1 && nf(r3[0]) === 'B03' && r3[0].etiqueta === 'Neto con retención IVA 80 % (−Q96.00)', 'cliente con perfil 80 %: Q1,024 calza su neto (1,120 − 96)');
  const r4 = z(542, 0, 'auto'), r5 = z(533.29, 0, 'auto');
  ok(r4.length === 1 && nf(r4[0]) === 'A04' && r4[0].tipo === 'saldo' && r4[0].etiqueta === 'Saldo' && r5.length === 1 && nf(r5[0]) === 'A04' && r5[0].etiqueta === 'Neto con retención IVA 15 % (−Q8.71)' && r5[0].montos.saldo === 542, 'parcial: Q542 calza por saldo (la retención registrada en el cobro parcial ya está descontada y no se descuenta dos veces); Q533.29 por neto sobre el IVA pendiente');
  const rc = P.calzarClientes(mias, d.perfiles, 3072, 0, 'auto');
  ok(rc.length === 1 && rc[0].clienteId === B && rc[0].tipo === 'neto' && rc[0].facturas.length === 2 && rc[0].etiqueta === 'Suma de netos · Neto con retención IVA 80 % (−Q288.00)' && P.calzarClientes(mias, d.perfiles, 3072, 0, 'total').length === 0, '«Clientes que calzan»: las dos facturas netas de B suman 3,072 (retención 288); con base Total no');
  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: 0 facturas IR-E2E; cobros y clientes borrados');
  else console.log('  ⚪ --conservar: quedan los 3 clientes IR-E2E con sus 9 facturas y 11 cobros para el E2E en Chrome (borrar con --solo-limpiar)');
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
