/**
 * CENTRO DE COBROS · PR 1 (033: ficha de cobranza + bandeja del día) — validador.
 *
 *  A. Estático: migración 033 (tablas con RLS y sin anon, backfill, migración de gestiones como función, estado y cierre
 *     de promesas con la 026, bucket privado, ayuda), rol cobranza en roles.ts (solo ver + cobranza), gate de rutas en el
 *     layout por x-ruta del middleware, páginas y acciones con exigir / autorizar, Pendientes apuntando al formulario
 *     nuevo (una sola forma de registrar), eventos automáticos en factura / cobro / detalle; sin diálogos del navegador.
 *  B. Puro: estado de factura en cada caso (al día, por vencer, vencida, promesa vigente, promesa incumplida, disputa,
 *     pide documentos, dice que pagó, parcial, cobrada, anulada), seguimiento obligatorio, bandeja por prioridad, resumen
 *     en una línea, rutas del rol cobranza.
 *  C. HIT (datos sembrados): backfill de contacto desde email_cobros / correo_cobro / whatsapp_cobros, migración de
 *     gestiones viejas (3 filas legacy → 3 gestiones + 1 promesa, idempotente), estado SQL = estado TS en cada factura,
 *     gestión con promesa → la promesa se cierra sola al cobrar (cumplida) y pasa a incumplida al vencer, seguimiento
 *     obligatorio, bandeja con las prioridades, ficha con resumen, adjunto por el bucket privado y URL firmada, eventos
 *     automáticos, limpieza.
 *  (Recordatorios, correo entrante y asignación de correos son PR 2 y PR 3.)
 *
 * Uso: npx tsx scripts/validate-cobranza.ts hit [--conservar | --solo-limpiar]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ClienteBandeja, EntradaEstado, GestionInput } from '../src/lib/cobranza/estado';

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
const NIT = '99990036K', PREFIJO = 'CB-E2E-', APP = 'sbwCBE2E01', ACTOR = 'cobranza@cb-e2e.example';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const EML = Buffer.from('From: pagos@cliente.example\r\nTo: cobros@golden-talent.com\r\nSubject: Re: Factura CB-E2E-001\r\nDate: Mon, 10 Nov 2026 10:00:00 -0600\r\nMessage-ID: <abc@cliente.example>\r\n\r\nPagamos el viernes.\r\n', 'utf8');

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const m33 = rd('supabase/migrations/033_cobranza_nucleo.sql'), sin33 = m33.replace(/--.*$/gm, '');
  const roles = rd('src/lib/auth/roles.ts'), lay = rd('src/app/(app)/layout.tsx'), mw = rd('src/middleware.ts'), acts = rd('src/app/(app)/cobranza/actions.ts'), perm = rd('scripts/validate-permisos.ts');
  const pB = rd('src/app/(app)/cobranza/page.tsx'), pF = rd('src/app/(app)/cobranza/[id]/page.tsx'), pI = rd('src/app/imprimir/cobranza/[id]/page.tsx'), ruta = rd('src/app/api/cobranza-adjunto/[id]/route.ts');
  const db = rd('src/lib/db/cobranza.ts'), puro = rd('src/lib/cobranza/estado.ts'), ban = rd('src/components/cobranza/bandeja-client.tsx'), fic = rd('src/components/cobranza/ficha-client.tsx'), form = rd('src/components/cobranza/gestion-form.tsx');
  ok(['cliente_contacto', 'cobranza_evento', 'cobranza_adjunto'].every(t => new RegExp(`create table if not exists ${t}`).test(m33) && new RegExp(`alter table ${t} enable row level security`).test(m33) && new RegExp(`revoke all on table ${t} from public, anon, authenticated`).test(m33)) && /create or replace function cobranza_estado_factura\(p_no_factura text, p_hoy date default current_date\)/.test(m33) && /create or replace function cobranza_cerrar_promesas\(p_hoy date default current_date\)/.test(m33) && /create or replace function cobranza_migrar_gestiones_legacy\(\)/.test(m33) && /facturacion_factura_cobrada\(p_no_factura\)/.test(m33) && /not facturacion_factura_cobrada\(nf\)/.test(m33) && !/upper\(btrim\(coalesce\(f\.estado, ''\)\)\) in \('COBRADO'/.test(m33), '033: tres tablas con RLS y sin anon / authenticated; estado, cierre de promesas y migración legacy como funciones; «cobrada» siempre por la 026');
  ok(/insert into cliente_contacto \(cliente_id, nombre, rol, correo, whatsapp, preferido, notas, origen, creado_por\)/.test(m33) && /x\.origen = 'backfill'/.test(m33) && /gestion_legacy_id\s+uuid unique/.test(m33) && /insert into storage\.buckets[\s\S]*'cobranza-adjuntos', 'cobranza-adjuntos', false, 10485760/.test(m33) && /slug = 'centro-de-cobros'|'centro-de-cobros'/.test(m33) && /on conflict \(slug\) do nothing/.test(m33) && !/\bdrop\s+(table|function)\b/i.test(sin33) && !/\bdelete\s+from\b/i.test(sin33) && !/^\s*(begin|commit)\s*;/im.test(sin33) && !/alter table clientes drop column/i.test(m33), '033: backfill idempotente, migración idempotente por gestion_legacy_id, bucket privado de 10 MB, artículo de ayuda; sin drop de tablas / funciones, delete, begin / commit');
  ok(/'cobranza'\] as const;/.test(roles) && /ver_cobranza:\s+COBRANZA/.test(roles) && /gestionar_cobranza: COBRANZA/.test(roles) && /const COBRANZA: readonly Rol\[\] = \['admin', 'contador', 'cobranza'\]/.test(roles) && /ver_presupuesto:\s+\['admin', 'contador', 'auxiliar', 'lectura'\]/.test(roles) && /export function rutaPermitidaParaRol/.test(roles) && /h\.set\('x-ruta', req\.nextUrl\.pathname\)/.test(mw) && /if \(!rutaPermitidaParaRol\(rol, rutaPedida\)\) redirect\('\/cobranza'\)/.test(lay), 'rol cobranza: en ROLES, ver_cobranza / gestionar_cobranza = admin + contador + cobranza, fuera del presupuesto; el middleware pone x-ruta y el layout de la app redirige lo que no es suyo');
  ok(/exigirPagina\('ver_cobranza'\)/.test(pB) && /exigirPagina\('ver_cobranza'\)/.test(pF) && /exigirPagina\('ver_cobranza'\)/.test(pI) && /autorizar\('ver_cobranza'\)/.test(ruta) && ['registrarGestionCobranzaAction', 'marcarSeguimientoHechoAction', 'crearContactoCobroAction', 'editarContactoCobroAction', 'desactivarContactoCobroAction', 'editarCondicionesCobroAction', 'prepararAdjuntosCobranzaAction', 'confirmarAdjuntosCobranzaAction'].every(a => new RegExp(`export async function ${a}\\([\\s\\S]*?\\{\\n  const permiso = await autorizar\\('gestionar_cobranza'\\);`).test(acts)) && /registrarGestionAction[\s\S]*?autorizar\('gestionar_cobranza'\)/.test(rd('src/app/(app)/facturacion/pendientes/actions.ts')) && /ver_cobranza', 'Centro de Cobros/.test(perm), 'páginas con exigirPagina(ver_cobranza), ruta de adjuntos con autorizar, las 8 acciones con gestionar_cobranza (también la de Pendientes); validate-permisos conoce el rol');
  ok(/import \{ GestionForm \} from '@\/components\/cobranza\/gestion-form'/.test(rd('src/components/facturas/gestion-cobro-modal.tsx')) && /return getResumenCobranza\(\);/.test(rd('src/lib/db/gestiones-cobro.ts')) && /registrarGestion\(input\.custId/.test(rd('src/lib/db/gestiones-cobro.ts')) && /gestiones\.porFactura\[f\.noFactura\]/.test(rd('src/components/facturas/pendientes-client.tsx')), 'Pendientes: el modal viejo abre el formulario nuevo y la bitácora vieja escribe y lee el historial nuevo (una sola forma de registrar)');
  ok(/tipo: 'factura_emitida'/.test(rd('src/lib/db/facturas.ts')) && /tipo: 'cobro_recibido'/.test(rd('src/lib/db/cobros.ts')) && /await cerrarPromesas\(\);/.test(rd('src/lib/db/cobros.ts')) && /tipo: 'detalle_enviado'/.test(rd('src/lib/db/detalle-link.ts')) && /'detalle_aprobado' : 'detalle_observaciones'/.test(rd('src/lib/db/detalle-link.ts')) && /tipo: 'detalle_aprobado'/.test(rd('src/lib/db/detalle-facturacion.ts')) && /tipo: 'cambio_condicion'/.test(db), 'eventos automáticos: factura emitida, cobro recibido (+ cierre de promesas), detalle enviado / aprobado / con observaciones, cambio de condición; todos fail-soft');
  ok(/const seguimiento = String\(input\.proximoSeguimiento \?\? ''\)\.trim\(\);\n  if \(!esFecha\(seguimiento\)\) return \{ ok: false/.test(puro) && /ORDEN_CATEGORIA: CategoriaBandeja\[\] = \['seguimiento', 'promesa_incumplida', 'promesa_por_vencer', 'vencida_sin_gestion', 'por_vencer', 'dice_que_pago'\]/.test(puro) && /DIAS_POR_VENCER = 5/.test(puro) && /data-accion="registrar-gestion"/.test(ban) && /data-accion="exportar-csv"/.test(ban) && /data-accion="exportar-pdf"/.test(fic) && /data-accion="desactivar-contacto"/.test(fic) && !/eliminar-contacto|\.delete\(\)/.test(fic + db.split('registrarGestion')[0]) && /data-campo="seguimiento"/.test(form) && !/window\.(confirm|alert|prompt)/.test(ban + fic + form) && /PUT/.test(form) && /tipoRealAdjunto\(cab, file\.name\)/.test(form), 'pantallas: bandeja con las 6 prioridades en orden, registrar gestión y CSV; ficha con PDF, contactos que se desactivan (nunca se borran) y seguimiento obligatorio en el formulario; adjuntos por URL firmada con pre-chequeo; sin diálogos del navegador');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const E = await import('../src/lib/cobranza/estado');
  const R = await import('../src/lib/auth/roles');
  const hoy = '2026-11-10';
  const est = (e: Partial<EntradaEstado>) => E.estadoFactura({ fechaEmision: '2026-10-01', diasCredito: 30, cobrada: false, parcial: false, ...e }, hoy);
  const str = (e: Partial<EntradaEstado>) => { const s = est(e); return [s.estado, ...s.modificadores].join('+'); };
  ok(str({ fechaEmision: '2026-11-01' }) === 'al_dia' && str({ fechaEmision: '2026-10-15' }) === 'por_vencer' && str({ fechaEmision: '2026-10-11' }) === 'por_vencer' && str({ fechaEmision: '2026-10-10' }) === 'vencida' && est({ fechaEmision: '2026-10-01' }).diasVencida === 10 && est({}).vence === '2026-10-31', 'estado base: al día (vence en más de 5 días), por vencer (≤ 5 días, incluido el día que vence), vencida (días contados desde emisión + crédito)');
  ok(str({ cobrada: true, parcial: true, ultimaPromesa: { fecha: '2026-11-01', estado: 'pendiente' } }) === 'cobrada' && str({ viva: false }) === 'anulada' && str({ parcial: true }) === 'vencida+cobrada_parcial', 'cobrada manda (sin modificadores); anulada; parcial');
  ok(str({ ultimaPromesa: { fecha: '2026-11-15', estado: 'pendiente' } }) === 'vencida+con_promesa' && str({ ultimaPromesa: { fecha: '2026-11-09', estado: 'pendiente' } }) === 'vencida+promesa_incumplida' && str({ ultimaPromesa: { fecha: '2026-11-15', estado: 'incumplida' } }) === 'vencida+promesa_incumplida' && str({ ultimaPromesa: { fecha: '2026-11-15', estado: 'cumplida' } }) === 'vencida' && str({ ultimaPromesa: { fecha: '2026-11-15', estado: 'reprogramada' } }) === 'vencida', 'promesa: vigente → con promesa; vencida sin cobro o marcada incumplida → promesa incumplida; cumplida / reprogramada no suman');
  ok(str({ ultimaGestion: { resultado: 'disputa' } }) === 'vencida+en_disputa' && str({ ultimaGestion: { resultado: 'pide_documentos' } }) === 'vencida+pide_documentos' && str({ ultimaGestion: { resultado: 'dice_que_pago' } }) === 'vencida+dice_que_pago' && str({ ultimaGestion: { resultado: 'contactado' } }) === 'vencida' && str({ parcial: true, ultimaPromesa: { fecha: '2026-11-20', estado: 'pendiente' }, ultimaGestion: { resultado: 'pide_documentos' } }) === 'vencida+cobrada_parcial+con_promesa+pide_documentos', 'última gestión: disputa, pide documentos, dice que ya pagó; una gestión posterior «contactado» los levanta; los modificadores se combinan');
  const v = (i: Partial<GestionInput>) => E.validarGestion({ canal: 'llamada', resultado: 'contactado', comentario: 'ok', proximoSeguimiento: '2026-11-17', ...i }, hoy);
  ok(!v({ proximoSeguimiento: '' }).ok && !v({ proximoSeguimiento: undefined }).ok && !v({ proximoSeguimiento: '2026-11-09' }).ok && v({}).ok && !v({ resultado: 'promesa', promesaFecha: '' }).ok && v({ resultado: 'promesa', promesaFecha: '2026-11-20', promesaMonto: 1234.567, comentario: '' }).ok && !v({ resultado: 'disputa', comentario: '' }).ok && v({ resultado: 'disputa', disputaMotivo: 'precio' , comentario: '' }).ok && !v({ canal: 'telegrama' }).ok && !v({ resultado: 'pago_confirmado' }).ok && v({ resultado: 'sin_respuesta', comentario: '' }).ok, 'validarGestion: seguimiento obligatorio y no pasado; promesa con fecha; disputa con motivo; canal y resultado de la lista; «sin respuesta» no exige comentario');
  const g = v({ resultado: 'promesa', promesaFecha: '2026-11-20', promesaMonto: 1234.567, facturas: ['A', 'A', ' B '] });
  ok(g.ok && g.gestion.promesaMonto === 1234.57 && g.gestion.facturas.join() === 'A,B' && g.gestion.proximoSeguimiento === '2026-11-17', 'validarGestion normaliza monto (2 decimales) y facturas (sin repetidos ni espacios)');
  const cli = (extra: Partial<ClienteBandeja>): ClienteBandeja => ({ clienteId: 'c1', clienteUuid: 'u1', nombre: 'ACME', responsable: null, facturas: [{ noFactura: 'F1', facturaId: 'r1', saldo: 1000, total: 1000, fechaEmision: '2026-09-01', diasCredito: 30, parcial: false }], contactoPreferido: null, ultimaGestion: null, promesas: [], seguimientos: [], ...extra });
  const cats = (cs: ClienteBandeja[]) => E.armarBandeja(cs, hoy).map(i => `${i.nombre}:${i.categoria}`).join(',');
  ok(cats([cli({})]) === 'ACME:vencida_sin_gestion' && cats([cli({ ultimaGestion: { fecha: '2026-11-08T12:00:00Z', canal: 'llamada', contacto: 'Ana', resultado: 'contactado', comentario: '' } })]) === '' && cats([cli({ ultimaGestion: { fecha: '2026-10-20T12:00:00Z', canal: 'llamada', contacto: 'Ana', resultado: 'contactado', comentario: '' } })]) === 'ACME:vencida_sin_gestion', 'bandeja: vencida sin gestión en 7 días aparece; con gestión reciente no');
  const todo = [
    cli({ nombre: 'Seg', seguimientos: [{ id: 's', fecha: '2026-11-09', resultado: 'reprogramar', comentario: 'llamar' }], ultimaGestion: { fecha: '2026-11-09T12:00:00Z', canal: 'llamada', contacto: 'Ana', resultado: 'reprogramar', comentario: '' } }),
    cli({ nombre: 'Inc', promesas: [{ id: 'p', fecha: '2026-11-05', monto: 500, estado: 'pendiente', facturas: ['F1'] }], ultimaGestion: { fecha: '2026-11-04T12:00:00Z', canal: 'correo', contacto: '', resultado: 'promesa', comentario: '' } }),
    cli({ nombre: 'PV', promesas: [{ id: 'p2', fecha: '2026-11-11', monto: 700, estado: 'pendiente', facturas: ['F1'] }], ultimaGestion: { fecha: '2026-11-09T12:00:00Z', canal: 'correo', contacto: '', resultado: 'promesa', comentario: '' } }),
    cli({ nombre: 'Vieja' }),
    cli({ nombre: 'PorV', facturas: [{ noFactura: 'F9', facturaId: 'r9', saldo: 300, total: 300, fechaEmision: '2026-10-15', diasCredito: 30, parcial: false }] }),
    cli({ nombre: 'Pago', ultimaGestion: { fecha: '2026-11-09T12:00:00Z', canal: 'whatsapp', contacto: 'Luis', resultado: 'dice_que_pago', comentario: 'mandó boleta' } }),
  ];
  const b = E.armarBandeja(todo, hoy);
  ok(b.map(i => i.categoria).join(',') === 'seguimiento,promesa_incumplida,promesa_por_vencer,vencida_sin_gestion,por_vencer,dice_que_pago' && b[0].nombre === 'Seg' && b[1].monto === 500 && b[1].diasAtraso === 5 && b[3].nombre === 'Vieja' && /El cliente dice que ya pagó/.test(b[5].detalle), 'bandeja ordenada: 1 seguimientos atrasados, 2 promesas incumplidas (monto y días), 3 promesas que vencen mañana, 4 vencidas sin gestión, 5 por vencer, 6 «dice que ya pagó»');
  ok(E.textoUltimoContacto(todo[5].ultimaGestion, hoy) === 'ayer, whatsapp a Luis: dice que ya pagó · mandó boleta' && E.textoUltimoContacto(null, hoy) === 'sin gestión', 'último contacto: «ayer, whatsapp a Luis: dice que ya pagó · mandó boleta»');
  ok(E.resumenUnaLinea({ ultimaGestion: { fecha: '2026-11-03T12:00:00Z', canal: 'correo', contacto: 'Liseth Ramírez', resultado: 'promesa', comentario: '' }, promesas: [{ id: 'p', fecha: '2026-11-15', monto: 4200, estado: 'pendiente', facturas: ['1053'] }], seguimientos: [{ id: 's', fecha: '2026-11-14', resultado: 'promesa', comentario: '' }] }, hoy) === 'Último contacto: 3-nov, correo a Liseth Ramírez. Prometió pagar la F-1053 el 15-nov (Q4,200.00). Próximo seguimiento: 14-nov.', 'resumen en una línea con datos: «Último contacto: 3-nov, correo a Liseth Ramírez. Prometió pagar la F-1053 el 15-nov (Q4,200.00). Próximo seguimiento: 14-nov.»');
  ok(R.puede('cobranza', 'ver') && R.puede('cobranza', 'ver_cobranza') && R.puede('cobranza', 'gestionar_cobranza') && !R.puede('cobranza', 'registrar_cobro') && !R.puede('cobranza', 'emitir_factura') && !R.puede('cobranza', 'conciliar') && !R.puede('cobranza', 'planilla') && !R.puede('cobranza', 'ver_mapa_precios') && !R.puede('auxiliar', 'ver_cobranza') && R.puede('contador', 'gestionar_cobranza') && !R.rutaPermitidaParaRol('cobranza', '/conciliacion') && !R.rutaPermitidaParaRol('cobranza', '/planillas') && !R.rutaPermitidaParaRol('cobranza', '/gastos') && !R.rutaPermitidaParaRol('cobranza', '/admin/precios') && R.rutaPermitidaParaRol('cobranza', '/cobranza/x') && R.rutaPermitidaParaRol('cobranza', '/clientes/x'), 'rol cobranza: ve y gestiona lo suyo; no registra cobros ni factura ni concilia; no entra por URL a bancos, planilla, gastos ni mapa de precios');

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${CONSERVAR ? ' (--conservar)' : SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: cl } = await sb.from('clientes').select('id').eq('nit', NIT);
    const ids = (cl ?? []).map(c => c.id as string);
    if (ids.length) {
      const { data: evs } = await sb.from('cobranza_evento').select('id').in('cliente_id', ids);
      for (const e of (evs ?? []) as { id: string }[]) { const { data: objs } = await sb.storage.from('cobranza-adjuntos').list(e.id, { limit: 100 }); if (objs?.length) await sb.storage.from('cobranza-adjuntos').remove(objs.map(o => `${e.id}/${o.name}`)); }
      await sb.from('gestiones_cobro').delete().in('cliente_id', ids);   // cascada a gestion_facturas
      const { data: fs2 } = await sb.from('facturas_clientes').select('id').in('cliente_id', ids);
      const fids = (fs2 ?? []).map(f => f.id as string);
      if (fids.length) { await sb.from('cobros_clientes').delete().in('factura_id', fids); await sb.from('facturas_clientes').delete().in('id', fids); }
      await sb.from('clientes').delete().in('id', ids);   // cascada a contactos y eventos
    }
    const { count } = await sb.from('clientes').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    return count ?? 0;
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: cliente de prueba borrado con facturas, cobros, gestiones legacy, eventos, contactos y adjuntos'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const hoyR = (await import('../src/lib/utils/fechas')).obtenerFechaHoyGuatemala();
  const d = (n: number) => E.sumarDias(hoyR, n);
  const { data: cli1, error: eCli } = await sb.from('clientes').insert({ airtable_id: APP, nombre_empresa: 'CB E2E COBRANZA', razon_social: 'CB E2E COBRANZA, S.A.', nit: NIT, activo: true, dias_credito: 30, email_cobros: 'Marta Pagos', correo_cobro: 'pagos@cb-e2e.example', whatsapp_cobros: '5555-1234', instrucciones_cobro: 'Pagan jueves' }).select('id').single();
  const U = String(cli1?.id ?? '');
  const facturas = [
    { no: `${PREFIJO}001`, fecha: d(-70), total: 1000, estado: 'EMITIDA' },        // vencida hace 40 días
    { no: `${PREFIJO}002`, fecha: d(-32), total: 2000, estado: 'COBRADO PARCIAL ' }, // vencida hace 2, parcial
    { no: `${PREFIJO}003`, fecha: d(-27), total: 3000, estado: 'EMITIDA' },        // por vencer (vence en 3)
    { no: `${PREFIJO}004`, fecha: d(-5), total: 4000, estado: 'EMITIDA' },         // al día
    { no: `${PREFIJO}005`, fecha: d(-60), total: 500, estado: 'COBRADO ' },        // cobrada
    { no: `${PREFIJO}006`, fecha: d(-60), total: 700, estado: 'ANULADO' },         // anulada
  ].map((f, i) => ({ airtable_id: `recCBE2E${String(i + 1).padStart(3, '0')}`, no_factura: f.no, cliente_id: U, fecha_emision: f.fecha, subtotal: Math.round(f.total / 1.12 * 100) / 100, iva: Math.round((f.total - f.total / 1.12) * 100) / 100, total: f.total, estado: f.estado }));
  const { data: insF, error: eF } = await sb.from('facturas_clientes').insert(facturas).select('id, no_factura');
  const fid = (no: string) => (insF ?? []).find(r => r.no_factura === no)?.id as string;
  const { error: eCob } = await sb.from('cobros_clientes').insert([{ factura_id: fid(`${PREFIJO}002`), monto_cobrado: 800, monto_cobro_gtq: 800, fecha_cobro: d(-1), estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' }, { factura_id: fid(`${PREFIJO}005`), monto_cobrado: 500, monto_cobro_gtq: 500, fecha_cobro: d(-20), estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' }]);
  // gestiones legacy (como las 3 de Golden): dos notas y una con promesa + factura
  const { data: g1 } = await sb.from('gestiones_cobro').insert([{ airtable_id: `sbwCBG1${Date.now().toString(36)}`, cliente_id: U, fecha_gestion: d(-20), usuario: 'alejandra@cb-e2e.example', canal: 'Otro', comentario: 'Cliente de Ricardo, envía facturas por WhatsApp' }, { airtable_id: `sbwCBG2${Date.now().toString(36)}`, cliente_id: U, fecha_gestion: d(-15), usuario: 'alejandra@cb-e2e.example', canal: 'Email', contacto_cliente: 'Recepción Facturas', comentario: 'Indican que corrieron la fecha de pago', fecha_pago_promesa: d(-3), proximo_seguimiento: d(-2) }, { airtable_id: `sbwCBG3${Date.now().toString(36)}`, cliente_id: U, fecha_gestion: d(-10), usuario: 'alejandra@cb-e2e.example', canal: 'Llamada', comentario: 'No contestaron' }]).select('id, fecha_pago_promesa');
  const gProm = (g1 ?? []).find(x => x.fecha_pago_promesa)?.id as string;
  if (gProm) await sb.from('gestion_facturas').insert({ gestion_id: gProm, factura_id: fid(`${PREFIJO}001`), fecha_pago_promesa_factura: d(-3) });
  ok(!eCli && !eF && !eCob && (insF ?? []).length === 6 && (g1 ?? []).length === 3, `sembrado: cliente ${NIT} (30 días de crédito, contacto en texto libre), 6 facturas, 2 cobros, 3 gestiones legacy${eCli ? ' · ' + eCli.message : ''}${eF ? ' · ' + eF.message : ''}${eCob ? ' · ' + eCob.message : ''}`);
  const C = await import('../src/lib/db/cobranza');
  const A = await import('../src/lib/db/cobranza-adjuntos');
  // backfill: el contacto «Cobros» se arma con la misma regla de la migración (acá a mano, porque la migración ya corrió)
  await sb.from('cliente_contacto').insert({ cliente_id: U, nombre: 'Marta Pagos', rol: 'otro', correo: 'pagos@cb-e2e.example', whatsapp: '5555-1234', preferido: true, notas: 'Migrado de la ficha del cliente (email_cobros / correo_cobro / whatsapp_cobros).', origen: 'backfill', creado_por: 'migracion-033' });
  const { data: bfGolden } = await sb.from('cliente_contacto').select('id', { count: 'exact', head: true }).eq('origen', 'backfill');
  void bfGolden;
  const contactos0 = await C.getContactos(U);
  ok(contactos0.length === 1 && contactos0[0].preferido && contactos0[0].correo === 'pagos@cb-e2e.example' && contactos0[0].whatsapp === '5555-1234' && contactos0[0].nombre === 'Marta Pagos' && /^[a-z0-9._%+-]+@/.test(contactos0[0].correo), 'backfill: un contacto preferido con el nombre de email_cobros (no es un correo), el correo de correo_cobro y el WhatsApp');
  // migración legacy (función idempotente)
  const { data: mig1 } = await sb.rpc('cobranza_migrar_gestiones_legacy');
  const { data: mig2 } = await sb.rpc('cobranza_migrar_gestiones_legacy');
  const ev0 = await C.getEventos(U);
  const gest0 = ev0.filter(e => e.tipo === 'gestion'), prom0 = ev0.filter(e => e.tipo === 'promesa');
  const m1 = mig1 as { gestiones_migradas: number; promesas_nuevas: number }, m2 = mig2 as { gestiones_migradas: number; promesas_nuevas: number };
  ok(gest0.length === 3 && prom0.length === 1 && prom0[0].facturas.join() === `${PREFIJO}001` && prom0[0].fechaPromesa === d(-3) && gest0.some(e => e.resultado === 'promesa' && e.canal === 'correo' && e.contactoTexto === 'Recepción Facturas' && e.proximoSeguimiento === d(-2)) && gest0.some(e => e.canal === 'nota') && m1.promesas_nuevas === 1 && m2.promesas_nuevas === 0 && m2.gestiones_migradas >= 3, `migración de las gestiones viejas: 3 gestiones (canal mapeado, contacto en texto, seguimiento) + 1 promesa con su factura; repetirla no duplica (${m1.promesas_nuevas} → ${m2.promesas_nuevas})`);
  // estado SQL = TS en cada factura
  await C.cerrarPromesas();   // la promesa migrada venció hace 3 días → incumplida
  const estadoSql = async (no: string) => { const { data, error } = await sb.rpc('cobranza_estado_factura', { p_no_factura: no, p_hoy: hoyR }); if (error || !data) { console.error('  cobranza_estado_factura:', error?.message ?? 'sin datos'); return { estado: 'error', modificadores: [] as string[] }; } return data as { estado: string; modificadores: string[]; dias_vencida?: number }; };
  const ficha0 = await C.getFichaCobranza(APP);
  const ts = (no: string) => ficha0!.facturas.find(f => f.noFactura === no)?.estadoCobro;
  const sqls = await Promise.all([1, 2, 3, 4, 5, 6].map(i => estadoSql(`${PREFIJO}00${i}`)));
  const tsStr = (no: string) => { const s = ts(no); return s ? [s.estado, ...s.modificadores].join('+') : '—'; };
  const sqlStr = (s: { estado: string; modificadores: string[] }) => [s.estado, ...s.modificadores].join('+');
  ok(sqlStr(sqls[0]) === 'vencida+promesa_incumplida' && tsStr(`${PREFIJO}001`) === 'vencida+promesa_incumplida' && sqlStr(sqls[1]) === 'vencida+cobrada_parcial' && tsStr(`${PREFIJO}002`) === 'vencida+cobrada_parcial' && sqlStr(sqls[2]) === 'por_vencer' && tsStr(`${PREFIJO}003`) === 'por_vencer' && sqlStr(sqls[3]) === 'al_dia' && tsStr(`${PREFIJO}004`) === 'al_dia' && sqls[4].estado === 'cobrada' && sqls[5].estado === 'anulada' && sqls[0].dias_vencida === 40, `estado SQL = TS: 001 ${sqlStr(sqls[0])} (40 días), 002 ${sqlStr(sqls[1])}, 003 ${sqlStr(sqls[2])}, 004 ${sqlStr(sqls[3])}, 005 ${sqls[4].estado}, 006 ${sqls[5].estado}`);
  ok(!!ficha0 && ficha0.facturas.length === 4 && ficha0.saldo === 1000 + 1200 + 3000 + 4000 && ficha0.vencido === 2200 && ficha0.proximoSeguimiento === d(-2) && /Incumplió la promesa de pagar/.test(ficha0.resumen) && /Próximo seguimiento:/.test(ficha0.resumen) && ficha0.contactos.length === 1, `ficha: 4 facturas abiertas, saldo ${ficha0?.saldo} (la parcial con 1,200), vencido ${ficha0?.vencido}, seguimiento atrasado, resumen: «${ficha0?.resumen}»`);
  // seguimiento obligatorio
  const sinSeg = await C.registrarGestion(APP, { canal: 'llamada', resultado: 'contactado', comentario: 'x', proximoSeguimiento: '' }, ACTOR);
  ok(!sinSeg.ok && /seguimiento es obligatoria/.test(sinSeg.error), 'registrar una gestión sin próximo seguimiento → rechazada');
  // gestión con promesa sobre la 003 y la 004, seguimiento en 7 días
  const gp = await C.registrarGestion(APP, { canal: 'llamada', resultado: 'promesa', comentario: 'Pagan el viernes', contactoId: contactos0[0].id, facturas: [`${PREFIJO}003`, `${PREFIJO}004`], promesaMonto: 7000, promesaFecha: d(2), proximoSeguimiento: d(3) }, ACTOR);
  const ev1 = await C.getEventos(U);
  const p1 = ev1.find(e => e.tipo === 'promesa' && e.gestionId === (gp.ok ? gp.gestionId : ''));
  const gLegacy = ev1.find(e => e.tipo === 'gestion' && e.proximoSeguimiento === d(-2));
  ok(gp.ok && !!gp.promesaId && !!p1 && p1.promesaEstado === 'pendiente' && p1.monto === 7000 && p1.facturas.length === 2 && p1.contactoNombre === 'Marta Pagos' && !!gLegacy?.seguimientoHechoEn, 'gestión con promesa: evento gestión + evento promesa (monto, fecha, facturas, contacto); el seguimiento atrasado anterior queda hecho');
  const ficha1 = await C.getFichaCobranza(APP);
  ok(ficha1!.facturas.find(f => f.noFactura === `${PREFIJO}003`)!.estadoCobro.modificadores.includes('con_promesa') && ficha1!.promesaVigente?.fecha === d(2) && ficha1!.proximoSeguimiento === d(3) && ficha1!.ultimoContactoPorContacto[contactos0[0].id] !== undefined, 'ficha: la 003 queda «con promesa», promesa vigente y próximo seguimiento nuevos; último contacto con Marta registrado');
  // la promesa se cierra sola al cobrar (003 y 004 cobradas)
  await sb.from('facturas_clientes').update({ estado: 'COBRADO ' }).in('no_factura', [`${PREFIJO}003`, `${PREFIJO}004`]);
  const cerr1 = await C.cerrarPromesas();
  const { data: p1b } = await sb.from('cobranza_evento').select('promesa_estado').eq('id', gp.ok ? gp.promesaId! : '').single();
  ok(cerr1.cumplidas === 1 && p1b?.promesa_estado === 'cumplida', 'la promesa se cierra sola al entrar el cobro que cubre sus facturas → cumplida');
  // promesa que pasa de fecha → incumplida (fecha de ayer sobre la 001)
  await sb.from('cobranza_evento').insert({ cliente_id: U, tipo: 'promesa', origen: 'manual', fecha: new Date().toISOString(), facturas: [`${PREFIJO}001`], monto: 1000, fecha_promesa: d(-1), promesa_estado: 'pendiente', creado_por: ACTOR });
  const cerr2 = await C.cerrarPromesas();
  const e001 = await estadoSql(`${PREFIJO}001`);
  ok(cerr2.incumplidas === 1 && sqlStr(e001) === 'vencida+promesa_incumplida', 'una promesa cuya fecha pasó sin cobro → incumplida, y la factura queda «promesa incumplida»');
  // disputa + dice que pagó sobre la 001 → la última gestión manda
  await C.registrarGestion(APP, { canal: 'correo', resultado: 'disputa', comentario: 'No reconocen la línea 2', disputaMotivo: 'línea 2', facturas: [`${PREFIJO}001`], proximoSeguimiento: d(5) }, ACTOR);
  const eDisp = await estadoSql(`${PREFIJO}001`);
  await C.registrarGestion(APP, { canal: 'whatsapp', resultado: 'dice_que_pago', comentario: 'Mandó boleta', facturas: [`${PREFIJO}001`], proximoSeguimiento: d(1) }, ACTOR);
  const ePago = await estadoSql(`${PREFIJO}001`);
  ok(eDisp.modificadores.includes('en_disputa') && ePago.modificadores.includes('dice_que_pago') && !ePago.modificadores.includes('en_disputa'), 'disputa → «en disputa»; después «dice que ya pagó» lo reemplaza (la última gestión manda)');
  // bandeja
  const band = await C.getDatosBandeja({ email: ACTOR, rol: 'cobranza' });
  const mios = band.items.filter(i => i.clienteId === APP);
  ok(mios.some(i => i.categoria === 'dice_que_pago') && mios.some(i => i.categoria === 'promesa_incumplida') && mios[0].categoria !== 'por_vencer' && !!mios.find(i => i.categoria === 'dice_que_pago')?.contactoPreferido?.whatsapp && band.kpis.carteraTotal > 0 && band.clientes[APP]?.contactos.length === 1, `bandeja del rol cobranza: el cliente aparece en «dice que ya pagó» y «promesa incumplida» con su contacto preferido (${mios.map(i => i.categoria).join(', ')}); KPIs y datos del formulario`);
  const bandTodos = await C.getDatosBandeja({ email: 'otro@x.com', rol: 'admin' });
  await C.editarCondiciones(APP, { responsableCobro: 'otra@cb-e2e.example', diaPago: 'jueves', reqContrasena: true, reqContrasenaNota: 'al recibir la física', formaPago: 'cheque', reqPortal: true, portalUrl: 'https://portal.example', portalUsuario: 'Luis' }, ACTOR);
  const bandAjena = await C.getDatosBandeja({ email: ACTOR, rol: 'cobranza' });
  const ficha2 = await C.getFichaCobranza(APP);
  ok(bandTodos.items.some(i => i.clienteId === APP) && !bandAjena.items.some(i => i.clienteId === APP) && ficha2!.condiciones.formaPago === 'cheque' && ficha2!.condiciones.reqContrasena && ficha2!.condiciones.portalUsuario === 'Luis' && ficha2!.eventos.some(e => e.tipo === 'cambio_condicion' && /responsableCobro/.test(e.comentario)), 'admin ve todo; con responsable ajeno el cliente sale de «mis clientes» del rol cobranza; condiciones guardadas (cheque, contraseña, portal sin clave) y evento de cambio de condición');
  const malUrl = await C.editarCondiciones(APP, { reqPortal: true, portalUrl: 'portal.example' }, ACTOR);
  ok(!malUrl.ok && /http/.test(malUrl.error), 'URL del portal sin http(s) → rechazada');
  // contactos: nuevo preferido, desactivar (no se borra)
  const c2 = await C.crearContacto(APP, { nombre: 'Andrea Blanco', cargo: 'Tesorería', rol: 'pagos', correo: 'andrea@cb-e2e.example', telefono: '2222-3333', preferido: true }, ACTOR);
  const des = await C.desactivarContacto(contactos0[0].id, ACTOR, 'ya no trabaja ahí');
  const cTodos = await C.getContactos(U, { incluirInactivos: true });
  const malCorreo = await C.crearContacto(APP, { nombre: 'X', rol: 'otro', correo: 'no-es-correo' }, ACTOR);
  ok(c2.ok && des.ok && cTodos.length === 2 && cTodos.find(x => x.id === contactos0[0].id)!.activo === false && !cTodos.find(x => x.id === contactos0[0].id)!.preferido && cTodos.find(x => x.id === c2.contacto.id)!.preferido && !malCorreo.ok, 'contactos: el nuevo queda preferido (el anterior deja de serlo); desactivar conserva la fila (activo = false) y el historial sigue apuntando a ella; correo inválido → rechazado');
  // adjuntos por el bucket privado
  const gAdj = await C.registrarGestion(APP, { canal: 'whatsapp', resultado: 'contactado', comentario: 'captura', proximoSeguimiento: d(4) }, ACTOR);
  const a1 = gAdj.ok ? await A.subirAdjuntoDirecto(gAdj.gestionId, { nombre: 'captura.png', mime: 'image/png', data: PNG }, ACTOR) : null;
  const a2 = gAdj.ok ? await A.subirAdjuntoDirecto(gAdj.gestionId, { nombre: 'respuesta.eml', mime: 'message/rfc822', data: EML }, ACTOR) : null;
  const a3 = gAdj.ok ? await A.subirAdjuntoDirecto(gAdj.gestionId, { nombre: 'texto.png', mime: 'image/png', data: Buffer.from('no es una imagen') }, ACTOR) : null;
  const u1 = a1?.ok ? await A.urlFirmadaAdjunto(a1.adjuntos[0].id, { segundos: 4 }) : null;
  const r1 = u1?.ok ? await fetch(u1.url) : null;
  const evAdj = (await C.getEventos(U)).find(e => e.id === (gAdj.ok ? gAdj.gestionId : ''));
  ok(!!a1?.ok && a1.adjuntos[0].mime === 'image/png' && !!a2?.ok && a2.adjuntos[0].mime === 'message/rfc822' && !!a3 && !a3.ok && r1?.ok === true && /\/object\/sign\/cobranza-adjuntos\//.test(u1?.ok ? u1.url : '') && evAdj?.adjuntos.length === 2, 'adjuntos: PNG y .eml entran al bucket privado (tipo real por bytes), un texto .png se rechaza, la URL firmada sirve y el evento los lista');
  // evento automático por factura emitida (hook) + cobro: simulados con el helper
  const evAuto = await C.registrarEventoAutomatico({ noFactura: `${PREFIJO}003` }, { tipo: 'cobro_recibido', facturas: [`${PREFIJO}003`], monto: 3000, comentario: 'Cobro de prueba' });
  const evNo = await C.registrarEventoAutomatico({ noFactura: 'NO-EXISTE' }, { tipo: 'cobro_recibido' });
  ok(!!evAuto && evNo === null && (await C.getEventos(U)).some(e => e.id === evAuto && e.origen === 'automatico'), 'evento automático: por número de factura llega al cliente; sin cliente no se registra (fail-soft)');
  // compat Pendientes
  const G = await import('../src/lib/db/gestiones-cobro');
  const res = await G.getResumenGestiones();
  const viejas = await G.getGestionesCliente(APP);
  const viaVieja = await G.crearGestionCobro({ custId: APP, usuario: ACTOR, canal: 'WhatsApp', comentario: 'Desde Pendientes', fechaPagoPromesa: d(6), facturas: [{ facturaId: 'recCBE2E001' }] });
  const evVieja = viaVieja.ok ? (await C.getEventos(U)).find(e => e.id === viaVieja.gestionId) : null;
  ok(res.porCliente[APP]?.numGestiones >= 4 && res.porFactura[`${PREFIJO}001`]?.promesaVencida === true && viejas.length >= 4 && viaVieja.ok && evVieja?.resultado === 'promesa' && evVieja.facturas.join() === `${PREFIJO}001` && evVieja.proximoSeguimiento === d(7), 'compatibilidad: el resumen de Pendientes (por cliente y por número de factura) y la bitácora vieja leen y escriben el historial nuevo (una gestión desde Pendientes con promesa → promesa con seguimiento al día siguiente)');
  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: cliente de prueba borrado con facturas, cobros, gestiones legacy, eventos, contactos y adjuntos');
  else { await sb.from('clientes').update({ responsable_cobro: null }).eq('id', U); await C.registrarGestion(APP, { canal: 'whatsapp', resultado: 'dice_que_pago', comentario: 'Mandó boleta por WhatsApp', facturas: [`${PREFIJO}001`], proximoSeguimiento: hoyR }, ACTOR); console.log(`  ⚪ --conservar: queda el cliente ${APP} (${NIT}) sin responsable, con sus facturas, eventos y contactos para el E2E en Chrome (borrar con --solo-limpiar)`); }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
