/**
 * DETALLE DIGITAL · PR 1 (filtros para armar el corte + documento imprimible + 028) — validador.
 *
 *  A. Estático: filtros por servicio / categoría / territorio / solicitante en la lista del cliente (en la URL),
 *     título del corte + "dirigido a" al generar y editables en el detalle, imprimible con solicitante, letra
 *     compacta, casillas, observaciones, firma y CSS de impresión; migración 028 solo agrega columnas (+ ayuda);
 *     la acción nueva valida permiso.
 *  B. Puro: opciones solo de lo que el cliente tiene, filtros a nivel prueba (COMPLETO → solo el polígrafo),
 *     solicitante normalizado y "Sin solicitante", URL ida y vuelta, título propuesto, documento con solicitante.
 *  C. E2E en HIT: siembra un cliente con 36 pruebas (solicitantes variados, un COMPLETO, una pendiente, una sin
 *     tarifa), crea un detalle con título y "dirigido a" por la capa de datos, lo lee, edita el encabezado,
 *     y verifica que un detalle anulado ya no se edita. Limpia al final (--conservar deja los datos para el E2E
 *     en Chrome; --solo-limpiar solo borra).
 *
 * Uso: npx tsx scripts/validate-detalle-filtros.ts hit [--conservar | --solo-limpiar]
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const CONSERVAR = process.argv.includes('--conservar'), SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

export const NIT = '99990031K', EMPRESA = 'recDFE2E01', PREFIJO = 'dfE2E';
/** Dataset: 36 pruebas cobrables + 1 pendiente + 1 sin tarifa; solicitantes variados (uno en minúsculas con espacios, 4 vacíos); un COMPLETO con dos pruebas. */
type Seed = { persona: string; solicitante: string | null; pruebas: Array<{ servicio: string; categoria: string | null; territorio: string | null; monto: number; situacion?: string; estado_tarifa?: string; fecha?: string | null }> };
export const SEEDS: Seed[] = [];
for (let i = 1; i <= 12; i++) SEEDS.push({ persona: `Candidato Adela ${i}`, solicitante: 'ADELA CEBALLOS', pruebas: [{ servicio: 'POLIGRAFO', categoria: i <= 8 ? 'RUTINA' : 'PRE EMPLEO', territorio: i % 3 === 0 ? 'DEPARTAMENTAL' : 'METROPOLITANA', monto: 350, fecha: '2026-10-15T15:00:00.000Z' }] });
for (let i = 1; i <= 10; i++) SEEDS.push({ persona: `Candidato Jose ${i}`, solicitante: 'JOSE RUIZ', pruebas: [{ servicio: i <= 6 ? 'SOCIOECONOMICO' : 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: i <= 6 ? 400 : 350, fecha: '2026-10-20T15:00:00.000Z' }] });
for (let i = 1; i <= 8; i++) SEEDS.push({ persona: `Candidato Maria ${i}`, solicitante: ' maria   lopez ', pruebas: [{ servicio: i <= 4 ? 'POLIGRAFO BASIC' : 'INFORNET', categoria: i <= 4 ? 'PRE EMPLEO' : null, territorio: i <= 4 ? 'METROPOLITANA' : null, monto: i <= 4 ? 300 : 50, fecha: '2026-11-02T15:00:00.000Z' }] });
for (let i = 1; i <= 4; i++) SEEDS.push({ persona: `Candidato Sin ${i}`, solicitante: i % 2 ? null : '   ', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'METROPOLITANA', monto: 350, fecha: '2026-10-28T15:00:00.000Z' }] });
// COMPLETO en un registro: polígrafo rutina + socio pre empleo (filtrar "Polígrafo" deja solo el polígrafo)
SEEDS.push({ persona: 'Candidato Completo', solicitante: 'ADELA CEBALLOS', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'METROPOLITANA', monto: 350, fecha: '2026-10-16T15:00:00.000Z' }, { servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'DEPARTAMENTAL', monto: 450, fecha: '2026-10-19T15:00:00.000Z' }] });
// no entran al corte: pendiente de resultado y sin tarifa
SEEDS.push({ persona: 'Candidato Pendiente', solicitante: 'ADELA CEBALLOS', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'METROPOLITANA', monto: 350, situacion: 'pendiente', fecha: null }] });
SEEDS.push({ persona: 'Candidato Sin tarifa', solicitante: 'JOSE RUIZ', pruebas: [{ servicio: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: null, monto: 0, estado_tarifa: 'sin_tarifa', fecha: '2026-10-21T15:00:00.000Z' }] });

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const gd = rd('src/components/por-facturar/grupo-detalle.tsx'), imp = rd('src/components/por-facturar/detalle-imprimible.tsx'), dv = rd('src/components/por-facturar/detalle-view.tsx');
  const m28 = rd('supabase/migrations/028_detalle_titulo_dirigido.sql'), sin28 = m28.replace(/--.*$/gm, '');
  ok(/data-filtro="servicio"/.test(gd) && /data-filtro="categoria"/.test(gd) && /data-filtro="territorio"/.test(gd) && /data-filtro="solicitante"/.test(gd) && /opcionesFiltros\(exps\)/.test(gd) && /pruebasQueCumplen\(porMes, e, fp\)/.test(gd) && /\.filter\(e => expedienteCumple\(e, fp\)\)/.test(gd), 'lista del cliente: 4 filtros nuevos (servicio, categoría, territorio, solicitante) con opciones solo de lo que el cliente tiene; filtran a nivel prueba');
  ok(/useSearchParams\(\)/.test(gd) && /filtrosDesdeParams\(k => searchParams\.get\(k\)\)/.test(gd) && /router\.replace\(`\$\{pathname\}\$\{qs\}`, \{ scroll: false \}\)/.test(gd), 'los filtros viajan en la URL (search params): arrancan desde ella y se escriben al cambiar');
  ok(/const facturablesVisibles = filas\.flatMap\(e => pruebasVisibles\(e\)\.filter\(p => pruebaEnCola\(p, e\)/.test(gd) && /data-campo="titulo"/.test(gd) && /data-campo="dirigido-a"/.test(gd) && /crearDetalleAction\(\{ componenteIds: seleccion\.map\(p => p\.id\), titulo: titulo\.trim\(\) \|\| undefined, dirigidoA: dirigidoA\.trim\(\) \|\| undefined \}\)/.test(gd) && /tituloPropuesto\(filtrosLista\)/.test(gd), '"Seleccionar todo" sigue marcando solo lo visible y cobrable; al generar se mandan título (propuesto desde los filtros, editable) y "dirigido a"');
  ok(/alter table detalle_facturacion add column if not exists titulo text;/.test(m28) && /alter table detalle_facturacion add column if not exists dirigido_a text;/.test(m28) && !/\b(drop|truncate|delete)\b/i.test(sin28) && !/^\s*(begin|commit)\s*;/im.test(sin28) && !/create or replace function/.test(sin28) && /on conflict \(slug\) do update/.test(sin28) && !/\b(update|insert)\b/i.test(sin28.replace(/insert into ayuda[\s\S]*?updated_at = now\(\);/, '')), '028: solo dos columnas + el artículo de ayuda (upsert por slug); sin drop/delete/commit, sin tocar RPCs');
  const db = rd('src/lib/db/detalle-facturacion.ts'), acts = rd('src/app/(app)/por-facturar/actions.ts');
  ok(/titulo: r\.titulo \?\? '', dirigidoA: r\.dirigido_a \?\? ''/.test(db) && /export async function editarEncabezadoDetalle\(/.test(db) && /d\.estado === 'facturada' \|\| d\.estado === 'anulada'/.test(db) && /const falta028 =/.test(db) && /rpc<Row>\('detalle_facturacion_crear_pruebas'/.test(db), 'capa de datos: titulo / dirigido_a en el detalle, se guardan al crear (la RPC no cambia) y se editan mientras no esté facturado ni anulado; sin la 028 el detalle igual se crea');
  ok(/export async function editarEncabezadoDetalleAction\(id: string, input: \{ titulo\?: string \| null; dirigidoA\?: string \| null \}\): Promise<DetalleResult> \{\n  const permiso = await autorizar\('facturar_agenda'\);/.test(acts) && /editarEncabezadoDetalleAction: 'facturar_agenda'/.test(rd('scripts/validate-permisos.ts')), 'acción editarEncabezadoDetalleAction: permiso facturar_agenda en la primera línea; en la lista del validador de permisos');
  ok(/data-encabezado/.test(dv) && /data-accion="editar-encabezado"/.test(dv) && /editarEncabezadoDetalleAction\(d\.id, \{ titulo, dirigidoA \}\)/.test(dv) && /<th title="[^"]*">Solicitante<\/th>/.test(dv) && /data-solicitante=\{l\.solicitante\}/.test(dv), 'detalle: encabezado (corte / dirigido a) editable y columna Solicitante');
  ok(/\.doc-tabla \{ width: 100%; border-collapse: collapse; font-size: 10\.5px;/.test(imp) && /\.doc-tabla th \{[^}]*padding: 4px 4px; font-size: 9\.5px;/.test(imp) && /\.doc-tabla td \{ padding: 4px 4px;/.test(imp), 'imprimible: tabla 10.5 px, encabezados 9.5 px, padding 4 px');
  ok(/\.doc-tabla thead \{ display: table-header-group; \}/.test(imp) && /\.doc-tabla tr \{ break-inside: avoid; page-break-inside: avoid; \}/.test(imp) && /@page \{ size: letter portrait;/.test(imp), 'impresión: el encabezado de la tabla se repite en cada hoja, las filas no se parten, hoja carta vertical');
  ok(/<th>Solicitante<\/th>/.test(imp) && /data-solicitante=\{l\.solicitante\}[^>]*>\{l\.solicitante \|\| '—'\}/.test(imp) && /className=\{'cb' \+ \(si \? ' on' : ''\)\} aria-hidden \/><span className="cb-lbl">Sí<\/span><span className=\{'cb' \+ \(no \? ' on' : ''\)\} aria-hidden \/><span className="cb-lbl">No<\/span>/.test(imp) && /\.cb \{ display: inline-block; width: 9px; height: 9px; border: 1px solid #111;/.test(imp) && /<th className="obs">Observaciones<\/th>/.test(imp), 'imprimible: columna Solicitante ("—" si vacío), casillas Sí / No vacías de verdad (CSS) a la izquierda del monto y columna de Observaciones en blanco');
  ok(/const paraRevisar = !facturado && d\.estado !== 'anulada' && !digital;/.test(imp) && /\{paraRevisar && \(\s*<section className="doc-firma" data-firma>/.test(imp) && /Nombre:<span className="linea" \/>/.test(imp) && /Cargo:<span className="linea" \/>/.test(imp) && /Firma:<span className="linea"/.test(imp) && /Fecha:<span className="linea"/.test(imp) && /\{d\.titulo && <div data-titulo><strong>Corte:<\/strong>/.test(imp) && /\{d\.dirigidoA && <div data-dirigido-a>/.test(imp), 'imprimible: bloque de firma (autorizado por, nombre, cargo, firma, fecha) solo mientras no está facturado; título del corte y "dirigido a" bajo los datos del cliente');
  ok(/solicitante: String\(e\?\.solicitante \?\? ''\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.toUpperCase\(\)/.test(rd('src/lib/facturacion-agenda/detalle.ts')) && /titulo: string; dirigidoA: string;/.test(rd('src/lib/facturacion-agenda/detalle.ts')), 'documento: cada línea lleva el solicitante del expediente; el detalle lleva titulo / dirigidoA');
  ok(!/window\.(confirm|alert|prompt)/.test(gd + dv + imp), 'sin diálogos del navegador');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const F = await import('../src/lib/facturacion-agenda/filtros-detalle');
  const D = await import('../src/lib/facturacion-agenda/detalle');
  type P = import('../src/lib/facturacion-agenda/tipos').PruebaLocal; type E = import('../src/lib/facturacion-agenda/tipos').ExpedienteLocal;
  const P0 = (o: Partial<P>): P => ({ id: 'p', expedienteId: 'e', idExterno: 'x', servicio: 'POLIGRAFO', estadoPrueba: 'APROBO', situacion: 'cobra', motivo: '', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', montoCalculado: 350, estadoTarifa: 'resuelta', detalleTarifa: '', tarifarioId: null, aprobada: true, detalleId: null, facturaId: null, noFactura: null, facturadoEn: null, fechaResultado: null, fechaResultadoFuente: null, ...o } as P);
  const E0 = (o: Partial<E>): E => ({ id: 'e', fuente: 'agenda', idExterno: 'x', empresaIdExterno: 'rec', empresaNombreExterno: 'A', nitResuelto: '1', clienteId: null, persona: 'P', puesto: '', solicitante: '', tipoPrueba: 'POLIGRAFO', categoriaPrueba: '', procesoSolicitado: '', deptoVisita: '', tipoCobrado: 'POLIGRAFO', categoriaCanon: 'PRE EMPLEO', territorioResuelto: 'METROPOLITANA', fechaIngreso: '2026-10-01', fechaEntrega: null, statusProceso: '', terminado: true, cancelado: false, eliminado: false, enVistaFacturacion: null, statusCobroExterno: 'PENDIENTE', estatusPagoExterno: null, montoExterno: null, numeroFacturaExterno: null, fechaFacturaExterno: null, cobroMegapaca: null, costoVisita: null, montoCalculado: 350, estadoTarifa: 'resuelta', detalleTarifa: '', componentes: [], estadoPoligrafo: null, estadoSocio: null, pruebasFirma: null, pruebas: [], actualizadoEn: null, creadoEn: null, facturaId: null, facturaAppId: null, noFactura: null, facturadoEn: null, facturadoPor: null, writebackEstado: null, writebackDetalle: null, writebackEn: null, cobroWritebackEstado: null, cobroWritebackDetalle: null, cobroWritebackEn: null, detalleId: null, fechaResultadoPoligrafo: null, fechaResultadoSocio: null, ...o } as E);
  const completo = E0({ idExterno: 'c', solicitante: 'Adela Ceballos', pruebas: [P0({ id: 'c1', idExterno: 'c', servicio: 'POLIGRAFO', categoria: 'RUTINA' }), P0({ id: 'c2', idExterno: 'c', servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'DEPARTAMENTAL', montoCalculado: 450 })] });
  const socio = E0({ idExterno: 's', solicitante: ' jose   ruiz ', pruebas: [P0({ id: 's1', idExterno: 's', servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO' })] });
  const sinSol = E0({ idExterno: 'n', solicitante: '   ', pruebas: [P0({ id: 'n1', idExterno: 'n', servicio: 'INFORNET', categoria: 'UNICA', territorio: 'UNICA' })] });
  const elim = E0({ idExterno: 'z', eliminado: true, solicitante: 'FANTASMA', pruebas: [P0({ id: 'z1', servicio: 'PDA' })] });
  const sinPruebas = E0({ idExterno: 'v', solicitante: 'ADELA CEBALLOS', pruebas: [] });
  const op = F.opcionesFiltros([completo, socio, sinSol, elim, sinPruebas]);
  ok(op.servicios.join() === 'INFORNET,POLIGRAFO,SOCIOECONOMICO' && op.categorias.join() === 'PRE EMPLEO,RUTINA' && op.territorios.join() === 'DEPARTAMENTAL,METROPOLITANA' && op.solicitantes.join() === `ADELA CEBALLOS,JOSE RUIZ,${F.SIN_SOLICITANTE}`, 'opciones: solo lo que el cliente tiene (sin UNICA, sin eliminados); solicitantes normalizados (trim + mayúsculas) y "Sin solicitante" al final');
  ok(F.normalizarSolicitante(' jose   ruiz ') === 'JOSE RUIZ' && F.claveSolicitante(sinSol) === F.SIN_SOLICITANTE && F.etiquetaSolicitante(F.SIN_SOLICITANTE) === 'Sin solicitante' && F.etiquetaSolicitante('JOSE RUIZ') === 'JOSE RUIZ', 'solicitante: trim + mayúsculas; vacío → Sin solicitante');
  const soloPoli = F.pruebasQueCumplen(completo.pruebas, completo, { servicio: 'POLIGRAFO' });
  ok(soloPoli.length === 1 && soloPoli[0].id === 'c1' && F.pruebasQueCumplen(completo.pruebas, completo, { categoria: 'PRE EMPLEO' })[0]?.id === 'c2' && F.pruebasQueCumplen(completo.pruebas, completo, { territorio: 'DEPARTAMENTAL' })[0]?.id === 'c2' && F.pruebasQueCumplen(completo.pruebas, completo, {}).length === 2, 'COMPLETO: filtrar "Polígrafo" deja solo el polígrafo; "Pre empleo" o "Depto" dejan solo el socio; sin filtros, las dos');
  ok(F.expedienteCumple(completo, { servicio: 'POLIGRAFO' }) && !F.expedienteCumple(socio, { servicio: 'POLIGRAFO' }) && F.expedienteCumple(socio, { solicitante: 'JOSE RUIZ' }) && !F.expedienteCumple(socio, { solicitante: 'ADELA CEBALLOS' }) && F.expedienteCumple(sinSol, { solicitante: F.SIN_SOLICITANTE }) && F.expedienteCumple(sinPruebas, { solicitante: 'ADELA CEBALLOS' }) && !F.expedienteCumple(sinPruebas, { servicio: 'POLIGRAFO' }) && !F.expedienteCumple(completo, { servicio: 'POLIGRAFO', solicitante: 'JOSE RUIZ' }), 'expediente visible solo si alguna prueba pasa; el solicitante es del expediente; sin pruebas calculadas solo pasa el filtro de solicitante; los filtros se combinan');
  const f1 = F.filtrosDesdeParams(k => ({ servicio: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'METROPOLITANA', solicitante: 'ADELA CEBALLOS', mes: '2026-10', termino: '2026-11', cobro: 'todos', listos: '1' } as Record<string, string>)[k] ?? null);
  ok(f1.servicio === 'POLIGRAFO' && f1.categoria === 'RUTINA' && f1.territorio === 'METROPOLITANA' && f1.solicitante === 'ADELA CEBALLOS' && f1.mes === '2026-10' && f1.mesResultado === '2026-11' && f1.cobro === 'todos' && f1.soloListos === true, 'URL → filtros (todos los filtros de la lista, también los que ya existían)');
  ok(F.paramsDeFiltros(f1) === '?servicio=POLIGRAFO&categoria=RUTINA&territorio=METROPOLITANA&solicitante=ADELA+CEBALLOS&mes=2026-10&termino=2026-11&cobro=todos&listos=1' && F.paramsDeFiltros({}) === '' && F.paramsDeFiltros({ cobro: 'por_facturar' }) === '' && F.paramsDeFiltros({ servicio: 'POLIGRAFO' }, new URLSearchParams('generar=1&servicio=X')) === '?generar=1&servicio=POLIGRAFO', 'filtros → URL: sin los vacíos ni el cobro por defecto; conserva otros params (generar=1) y reemplaza los propios');
  const f2 = F.filtrosDesdeParams(k => ({ mes: '2026-13', termino: 'x', cobro: 'raro', listos: '0' } as Record<string, string>)[k] ?? null);
  ok(!f2.mes && !f2.mesResultado && !f2.cobro && !f2.soloListos, 'valores inválidos en la URL se ignoran');
  ok(F.tituloPropuesto({ servicio: 'POLIGRAFO', categoria: 'RUTINA', solicitante: 'ADELA CEBALLOS', mesResultado: '2026-10' }) === 'Polígrafos rutina · Solicitante ADELA CEBALLOS · Oct 2026' && F.tituloPropuesto({ servicio: 'SOCIOECONOMICO', territorio: 'DEPARTAMENTAL', mes: '2026-09' }) === 'Socios depto · Ingreso Sep 2026' && F.tituloPropuesto({ solicitante: F.SIN_SOLICITANTE }) === 'Sin solicitante' && F.tituloPropuesto({}) === '' && F.tituloPropuesto({ categoria: 'PRE EMPLEO', mesResultado: '2026-10', mes: '2026-09' }) === 'Pre empleo · Oct 2026', 'título propuesto: "Polígrafos rutina · Solicitante ADELA CEBALLOS · Oct 2026"; el mes de terminación gana sobre el de ingreso; sin filtros, vacío');
  const docu = D.documentoDetalle([completo, socio, sinSol], [completo.pruebas[0], socio.pruebas[0], sinSol.pruebas[0]]);
  ok(docu.lineas[0].solicitante === 'ADELA CEBALLOS' && docu.lineas[1].solicitante === 'JOSE RUIZ' && docu.lineas[2].solicitante === '' && docu.incluidas.length === 3, 'documento: cada línea lleva el solicitante normalizado (trim + mayúsculas, igual que el filtro); vacío queda vacío (el imprimible muestra "—")');

  /* ───────────── C. E2E en HIT ───────────── */
  console.log(`\nC. E2E en HIT${CONSERVAR ? ' (--conservar)' : SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: exps } = await sb.from('facturacion_expediente').select('id').like('id_externo', `${PREFIJO}%`);
    const ids = (exps ?? []).map(e => e.id as string);
    if (ids.length) { await sb.from('facturacion_componente').delete().in('expediente_id', ids); await sb.from('facturacion_expediente').delete().in('id', ids); }
    await sb.from('detalle_facturacion').delete().eq('nit', NIT);
    await sb.from('cliente_externo').delete().eq('nit', NIT);
    await sb.from('clientes').delete().eq('nit', NIT);
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PREFIJO}%`);
    return count ?? 0;
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes dfE2E; detalles, mapeo y cliente de prueba borrados'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const { data: cli, error: eCli } = await sb.from('clientes').insert({ airtable_id: 'sbwDFE2E01', nombre_empresa: 'DF E2E CORTE', razon_social: 'DF E2E CORTE, SOCIEDAD ANONIMA', nit: NIT, activo: true, email_cobros: 'cobros@df-e2e.example' }).select('id').single();
  const { error: eMap } = await sb.from('cliente_externo').insert({ fuente: 'agenda', empresa_id_externo: EMPRESA, empresa_nombre_externo: 'DF E2E CORTE', nit: NIT, cliente_id: cli?.id ?? null, activo: true, creado_por: 'e2e' });
  const exps: Record<string, unknown>[] = []; const comps: Array<Record<string, unknown> & { ext: string }> = [];
  let k = 0;
  for (const s of SEEDS) {
    const ext = `${PREFIJO}${String(++k).padStart(3, '0')}`;
    const completo = s.pruebas.length === 2;
    exps.push({ fuente: 'agenda', id_externo: ext, empresa_id_externo: EMPRESA, empresa_nombre_externo: 'DF E2E CORTE', nit_resuelto: NIT, cliente_id: cli?.id ?? null, persona: s.persona, puesto: 'Puesto', solicitante: s.solicitante, tipo_prueba: completo ? 'POLIGRAFO, SOCIOECONOMICO' : s.pruebas[0].servicio, categoria_prueba: s.pruebas[0].categoria, proceso_solicitado: completo ? 'COMPLETO' : `SOLO ${s.pruebas[0].servicio}`, depto_visita: 'GUATEMALA', fecha_ingreso: '2026-10-05', fecha_entrega: '2026-10-20', status_proceso: 'APROBO', terminado: true, cancelado: false, eliminado: false, estado_tarifa: s.pruebas.every(p => p.estado_tarifa === 'sin_tarifa') ? 'sin_tarifa' : 'resuelta', monto_calculado: s.pruebas.reduce((t, p) => t + p.monto, 0), status_cobro_externo: 'PENDIENTE', actualizado_en_externo: '2026-10-21T12:00:00.000Z' });
    for (const p of s.pruebas) comps.push({ ext, fuente: 'agenda', id_externo: ext, servicio: p.servicio, estado_prueba: p.situacion === 'pendiente' ? 'EN PROCESO' : 'APROBO', situacion: p.situacion ?? 'cobra', motivo: 'E2E', categoria: p.categoria, territorio: p.territorio, monto_calculado: p.monto, estado_tarifa: p.estado_tarifa ?? 'resuelta', fecha_resultado: p.fecha ?? null, fecha_resultado_fuente: p.fecha ? 'agenda' : null });
  }
  const { data: insExps, error: eExp } = await sb.from('facturacion_expediente').insert(exps).select('id, id_externo');
  const idPorExt = new Map((insExps ?? []).map(e => [e.id_externo as string, e.id as string]));
  const { data: insComps, error: eComp } = await sb.from('facturacion_componente').insert(comps.map(({ ext, ...c }) => ({ ...c, expediente_id: idPorExt.get(ext) }))).select('id, id_externo, servicio, situacion, estado_tarifa');
  ok(!eCli && !eMap && !eExp && !eComp && idPorExt.size === exps.length && (insComps ?? []).length === comps.length, `sembrado: cliente ${NIT} mapeado, ${exps.length} expedientes, ${comps.length} pruebas (36 cobrables + 1 pendiente + 1 sin tarifa)${[eCli, eMap, eExp, eComp].filter(Boolean).map(e => ' · ' + e!.message).join('')}`);

  const DB = await import('../src/lib/db/detalle-facturacion');
  const FA = await import('../src/lib/db/facturacion-agenda');
  const grupo = await FA.getGrupo(`n-${NIT}`);
  const exLocal = grupo?.expedientes ?? [];
  const op2 = F.opcionesFiltros(exLocal);
  ok(!!grupo && exLocal.length === exps.length && op2.solicitantes.join() === `ADELA CEBALLOS,JOSE RUIZ,MARIA LOPEZ,${F.SIN_SOLICITANTE}` && op2.servicios.join() === 'INFORNET,POLIGRAFO,POLIGRAFO BASIC,SOCIOECONOMICO,SOCIOECONOMICO VIRTUAL', `grupo del cliente desde la base: ${exLocal.length} expedientes; solicitantes ${op2.solicitantes.map(F.etiquetaSolicitante).join(' / ')}`);
  // Corte: polígrafos de rutina de ADELA (8 de 12 + el polígrafo del COMPLETO; la pendiente no entra) → las cobrables visibles
  const corte = exLocal.filter(e => F.expedienteCumple(e, { servicio: 'POLIGRAFO', categoria: 'RUTINA', solicitante: 'ADELA CEBALLOS' })).flatMap(e => F.pruebasQueCumplen(e.pruebas, e, { servicio: 'POLIGRAFO', categoria: 'RUTINA', solicitante: 'ADELA CEBALLOS' }));
  const cobrables = corte.filter(p => p.situacion === 'cobra' && p.estadoTarifa === 'resuelta' && (p.montoCalculado ?? 0) > 0);
  ok(corte.length === 10 && cobrables.length === 9 && cobrables.every(p => p.servicio === 'POLIGRAFO' && p.categoria === 'RUTINA'), `corte "polígrafos rutina · ADELA CEBALLOS": ${corte.length} pruebas visibles (incluye la pendiente), ${cobrables.length} cobrables; del COMPLETO entra solo el polígrafo`);
  const titulo = F.tituloPropuesto({ servicio: 'POLIGRAFO', categoria: 'RUTINA', solicitante: 'ADELA CEBALLOS', mesResultado: '2026-10' });
  const r1 = await DB.crearDetalle({ componenteIds: cobrables.map(p => p.id), titulo, dirigidoA: '  Adela   Ceballos  ' }, 'e2e@test');
  ok(r1.ok && r1.detalle.titulo === 'Polígrafos rutina · Solicitante ADELA CEBALLOS · Oct 2026' && r1.detalle.dirigidoA === 'Adela Ceballos' && r1.detalle.pruebas === 9 && r1.detalle.subtotal === 3150, `detalle creado con título y "dirigido a" (limpios): ${r1.ok ? `${r1.detalle.correlativo} · "${r1.detalle.titulo}" · ${r1.detalle.dirigidoA} · Q${r1.detalle.subtotal}` : r1.error}`);
  const det = r1.ok ? await DB.getDetalle(r1.detalle.id) : null;
  ok(!!det && det.detalle.titulo === titulo && det.documento.incluidas.length === 9 && det.documento.incluidas.every(l => l.solicitante === 'ADELA CEBALLOS') && det.documento.faltantes.length === 0, 'leer el detalle: título conservado; las 9 líneas del documento llevan el solicitante');
  const r2 = r1.ok ? await DB.editarEncabezadoDetalle(r1.detalle.id, { titulo: ' Corte  octubre ', dirigidoA: '' }, 'e2e@test') : null;
  ok(!!r2 && r2.ok && r2.detalle.titulo === 'Corte octubre' && r2.detalle.dirigidoA === '', 'editar encabezado: título limpio y "dirigido a" vaciado');
  const r3 = r1.ok ? await DB.crearDetalle({ componenteIds: cobrables.slice(0, 1).map(p => p.id) }, 'e2e@test') : null;
  ok(!!r3 && !r3.ok && /otro detalle/.test(r3.error), 'las pruebas del corte quedan reservadas: un segundo detalle con una de ellas es rechazado');
  const r4 = r1.ok ? await DB.crearDetalle({ componenteIds: cobrables.map(p => p.id).slice(0, 0).concat([(insComps ?? []).find(c => c.situacion === 'pendiente')!.id as string]) }, 'e2e@test') : null;
  ok(!!r4 && !r4.ok && /resultado cobrable|en cola/.test(r4.error), 'la prueba pendiente no entra a un detalle');
  // Un detalle anulado ya no se edita
  const r5 = await DB.crearDetalle({ componenteIds: exLocal.flatMap(e => F.pruebasQueCumplen(e.pruebas, e, { solicitante: 'JOSE RUIZ', servicio: 'SOCIOECONOMICO' })).filter(p => p.situacion === 'cobra' && p.estadoTarifa === 'resuelta').map(p => p.id), titulo: 'Socios · JOSE RUIZ' }, 'e2e@test');
  const r6 = r5.ok ? await DB.anularDetalle(r5.detalle.id, 'e2e', 'e2e@test') : null;
  const r7 = r5.ok ? await DB.editarEncabezadoDetalle(r5.detalle.id, { titulo: 'otro' }, 'e2e@test') : null;
  ok(r5.ok && r5.detalle.pruebas === 6 && !!r6 && r6.ok && !!r7 && !r7.ok && /anulada/.test(r7.error), 'segundo detalle (6 socios de JOSE RUIZ) anulado → su encabezado ya no se edita; las pruebas vuelven a la cola');
  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: 0 expedientes dfE2E; detalles, mapeo y cliente de prueba borrados');
  else { if (r1.ok) await DB.anularDetalle(r1.detalle.id, 'e2e: liberar para el E2E en Chrome', 'e2e@test'); console.log('  ⚪ --conservar: quedan los datos (las 36 pruebas cobrables libres) para el E2E en Chrome (borrar con --solo-limpiar)'); }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
