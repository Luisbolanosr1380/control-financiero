/**
 * DETALLE FIRMADO EN PAPEL (032) — validador.
 *
 *  A. Estático: migración 032 (canal papel, tabla con RLS y revoke a anon, bucket PRIVADO con tope y mimes, ayuda; sin
 *     drop de tablas / delete / begin / commit), módulo del servidor (server-only, nunca getPublicUrl, URL firmada de 5
 *     min, tipo real por bytes), ruta de descarga con autorizar('ver'), acciones con permiso, UI sin diálogos del navegador,
 *     imprimible con «Firmado en papel por …».
 *  B. Puro: tipo real por magic (PDF / JPG / PNG / HEIC / otro), nombre saneado, meta (firmado por obligatorio, fecha),
 *     topes (15 MB, 5 archivos), estados, matriz de permisos.
 *  C. HIT (datos sembrados): subir PDF, foto por URL firmada de subida (el flujo del navegador) y 3 hojas; no PDF ni
 *     imagen → rechazado y borrado del bucket; > 15 MB → rechazado (declarado y en el bucket); 6.º archivo → rechazado;
 *     aprobar en papel → aprobada con canal papel y link revocado; desde facturada solo adjunta; reemplazar conserva el
 *     anterior; quitar conserva el anterior; la URL firmada vence; anon no lee tabla ni bucket; sha256 real.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-detalle-firmado.ts hit [--conservar | --solo-limpiar]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const CONSERVAR = process.argv.includes('--conservar'), SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
process.env.DETALLE_LINK_SECRET ||= 'secreto-de-prueba-del-validador-0123456789';
process.env.CORREO_MOCK = '1';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export const NIT = '99990034K', EMPRESA = 'recDFPE2E01', PREFIJO = 'dfpE2E';
export const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(64)]);
const TEXTO = Buffer.from('esto no es una imagen ni un pdf, es un texto plano con extensión jpg\n', 'utf8');

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático: migración 032, servidor, ruta, acciones, pantallas');
  const m32 = rd('supabase/migrations/032_detalle_firmado_papel.sql'), sin32 = m32.replace(/--.*$/gm, '');
  const srv = rd('src/lib/db/detalle-archivo.ts'), puro = rd('src/lib/detalle-archivo/puro.ts'), ruta = rd('src/app/api/detalle-archivo/[id]/route.ts'), acts = rd('src/app/(app)/por-facturar/actions.ts'), perm = rd('scripts/validate-permisos.ts');
  const dv = rd('src/components/por-facturar/detalle-view.tsx'), imp = rd('src/components/por-facturar/detalle-imprimible.tsx'), pfc = rd('src/components/por-facturar/por-facturar-client.tsx'), roles = rd('src/lib/auth/roles.ts'), det = rd('src/lib/facturacion-agenda/detalle.ts');
  ok(/drop constraint if exists detalle_facturacion_aprobado_canal_check/.test(m32) && /aprobado_canal in \('correo', 'link', 'otro', 'papel'\)/.test(m32) && /create table if not exists detalle_facturacion_archivo/.test(m32) && /path\s+text not null unique/.test(m32) && /bytes > 0 and bytes <= 15728640/.test(m32) && /length\(sha256\) = 64/.test(m32) && /reemplazado_por\s+uuid references detalle_facturacion_archivo\(id\)/.test(m32) && /alter table detalle_facturacion_archivo enable row level security/.test(m32) && /revoke all on table detalle_facturacion_archivo from public, anon, authenticated/.test(m32) && /grant all on table detalle_facturacion_archivo to service_role/.test(m32), '032: canal papel en el check; tabla de archivos con path único, tope de bytes, sha256, trazabilidad del reemplazo, RLS y sin anon / authenticated');
  ok(/insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*\nvalues \('detalles-firmados', 'detalles-firmados', false, 15728640, array\['application\/pdf', 'image\/jpeg', 'image\/png', 'image\/heic'\]\)/.test(m32) && /on conflict \(id\) do update set public = false/.test(m32) && !/create policy/.test(m32) && !/\bdrop\s+(table|function|bucket)\b/i.test(sin32) && !/\bdelete\s+from\b/i.test(sin32) && !/^\s*(begin|commit)\s*;/im.test(sin32) && /update ayuda/.test(m32) && /Subir detalle firmado/.test(m32) && /contenido not like '%Subir detalle firmado%'/.test(m32), '032: bucket detalles-firmados PRIVADO (15 MB, solo PDF / JPG / PNG / HEIC, sin políticas de storage: solo service_role); ayuda idempotente; sin drop de tablas, delete, begin ni commit');
  ok(!/'use client'/.test(srv) && /node:crypto/.test(srv) && !/getPublicUrl/.test(srv) && /createSignedUploadUrl\(path\)/.test(srv) && /createSignedUrl\(archivo\.path, Math\.min\(Math\.max\(opts\.segundos \?\? SEGUNDOS_URL_FIRMADA, 1\), SEGUNDOS_URL_FIRMADA\)/.test(srv) && /SEGUNDOS_URL_FIRMADA = 300/.test(puro) && /tipoRealDe\(buf\.subarray\(0, 16\)\)/.test(srv) && /\.remove\(\[path\]\)/.test(srv) && /p\.path\.startsWith\(`\$\{detalleId\}\/`\)/.test(srv) && /canal: 'papel'/.test(srv) && /revocarLinkDetalle\(detalleId, actor, 'aprobado con el detalle firmado en papel'\)/.test(srv) && !/\.delete\(\)\.eq\('id', (anterior|archivoId)/.test(srv), 'servidor: módulo de servidor (node:crypto, llave de servicio; la frontera la vigila validate-frontera-cliente), nunca URL pública; subida por URL firmada a un path fijo del detalle; descarga firmada ≤ 5 min; tipo real por los primeros bytes y borrado de lo que no pasa; aprobar en papel revoca el link; reemplazar / quitar no borran el anterior');
  ok(/const permiso = await autorizar\('ver'\);/.test(ruta) && /NextResponse\.redirect\(r\.url, \{ status: 302, headers: NO_STORE \}\)/.test(ruta) && /'Cache-Control': 'no-store'/.test(ruta) && /export const dynamic = 'force-dynamic'/.test(ruta) && !/export async function (POST|PUT)/.test(ruta), 'ruta /api/detalle-archivo/[id]: GET con sesión (ver), redirige a la URL firmada, no-store; sin POST');
  ok(['prepararSubidaFirmadoAction', 'confirmarSubidaFirmadoAction'].every(a => new RegExp(`export async function ${a}\\([\\s\\S]*?\\{\\n  const permiso = await autorizar\\('facturar_agenda'\\);`).test(acts) && new RegExp(`${a}: 'facturar_agenda'`).test(perm)) && /export async function quitarArchivoFirmadoAction\([\s\S]*?\{\n  const permiso = await autorizar\('gestionar_archivo_detalle'\);/.test(acts) && /quitarArchivoFirmadoAction: 'gestionar_archivo_detalle'/.test(perm) && /gestionar_archivo_detalle: CONTROL/.test(roles) && /'otro' \| .*'papel'/.test(det) && /con_observaciones: \['enviada', 'aprobada'/.test(det), 'acciones: subir = facturar_agenda; reemplazar / quitar = gestionar_archivo_detalle (admin y contador); canal papel en TS; con_observaciones → aprobada permitido para el papel');
  ok(/data-accion="subir-firmado"/.test(dv) && /puedeSubirFirmadoEn\(d\.estado\)/.test(dv) && /data-campo="aprobar-papel"/.test(dv) && /puedeAprobarEnPapelEn\(d\.estado\)/.test(dv) && /method: 'PUT', headers: \{ 'content-type': s\.mime, 'x-upsert': 'false' \}, body: a\.file, credentials: 'omit'/.test(dv) && /tipoRealDe\(cab\)/.test(dv) && /\/api\/detalle-archivo\/\$\{a\.id\}/.test(dv) && /\?descargar=1/.test(dv) && /data-accion="reemplazar-archivo"/.test(dv) && /data-accion="quitar-archivo"/.test(dv) && /data-archivos-anteriores/.test(dv) && /puedeGestionarArchivo = usePuede\(\)\('gestionar_archivo_detalle'\)/.test(dv) && !/window\.(confirm|alert|prompt)/.test(dv), 'Finanzas: Subir detalle firmado en la tarjeta del flujo (estados correctos), «y marcar como aprobado» solo en enviada / con observaciones, PUT directo al bucket, pre-chequeo por bytes en el navegador, Ver / Descargar por la ruta, reemplazar / quitar con motivo y versiones anteriores; sin diálogos del navegador');
  ok(/data-firmado-papel/.test(imp) && /Firmado en papel por <strong>\{firmadoPapel\.firmadoPor\}<\/strong>/.test(imp) && /respaldo en el sistema/.test(imp) && /!digital && !firmadoPapel/.test(imp) && /data-firmado="si"/.test(pfc) && /detallesConFirmado\(detallesLista\.map\(d => d\.id\)\)/.test(rd('src/app/(app)/por-facturar/page.tsx')), 'imprimible: «Firmado en papel por … el … · respaldo en el sistema» (sin el bloque de firma en blanco); lista con el ícono de firmado');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const P = await import('../src/lib/detalle-archivo/puro');
  const R = await import('../src/lib/auth/roles');
  ok(P.tipoRealDe(PDF.subarray(0, 16)) === 'application/pdf' && P.tipoRealDe(JPEG.subarray(0, 16)) === 'image/jpeg' && P.tipoRealDe(PNG.subarray(0, 16)) === 'image/png' && P.tipoRealDe(HEIC.subarray(0, 16)) === 'image/heic' && P.tipoRealDe(TEXTO.subarray(0, 16)) === null && P.tipoRealDe(new Uint8Array(0)) === null && P.tipoRealDe(Buffer.from('GIF89a......')) === null, 'tipo real por los primeros bytes: PDF, JPG, PNG, HEIC; texto / GIF / vacío → rechazado (la extensión no cuenta)');
  ok(P.sanearNombre('Detalle Firmado · ACME (nov).PDF', 'application/pdf') === 'Detalle-Firmado-ACME-nov.pdf' && P.sanearNombre('IMG_0042.HEIC', 'image/heic') === 'IMG_0042.heic' && P.sanearNombre('', 'image/jpeg') === 'detalle-firmado.jpg' && P.sanearNombre('../../x.png', 'image/png') === 'x.png' && P.sanearNombre('foto.jpg', 'image/png') === 'foto.png', 'nombre saneado: sin tildes ni símbolos, extensión según el tipo real, sin "..", con fallback');
  const hoy = '2026-11-10';
  ok(!P.validarMetaFirmado({ firmadoPor: ' ' }, hoy).ok && !P.validarMetaFirmado({ firmadoPor: 'Ana', firmadoFecha: '2026-11-11' }, hoy).ok && !P.validarMetaFirmado({ firmadoPor: 'Ana', firmadoFecha: '11/10/2026' }, hoy).ok && (() => { const m = P.validarMetaFirmado({ firmadoPor: '  Ana   Pérez ', firmadoCargo: 'Gerente', notas: 'x' }, hoy); return m.ok && m.meta.firmadoPor === 'Ana Pérez' && m.meta.firmadoFecha === hoy; })(), 'meta: firmado por obligatorio (normalizado), fecha YYYY-MM-DD no futura, hoy por defecto');
  ok(!P.validarArchivosDeclarados([], 0).ok && !P.validarArchivosDeclarados([{ nombre: 'a.pdf', bytes: P.MAX_BYTES_ARCHIVO + 1, mime: 'application/pdf' }], 0).ok && !P.validarArchivosDeclarados([{ nombre: 'a.gif', bytes: 10, mime: 'image/gif' }], 0).ok && !P.validarArchivosDeclarados([{ nombre: 'a.pdf', bytes: 10, mime: 'application/pdf' }], 5).ok && P.validarArchivosDeclarados(Array(5).fill({ nombre: 'a.jpg', bytes: 10, mime: 'image/jpeg' }), 0).ok && !P.validarArchivosDeclarados(Array(6).fill({ nombre: 'a.jpg', bytes: 10, mime: 'image/jpeg' }), 0).ok, 'declarados: vacío, > 15 MB, mime fuera de la lista, 6.º archivo → rechazados; 5 fotos → ok');
  ok(['enviada', 'con_observaciones', 'aprobada', 'facturada'].every(e => P.puedeSubirFirmadoEn(e as never)) && !P.puedeSubirFirmadoEn('borrador') && !P.puedeSubirFirmadoEn('anulada') && P.puedeAprobarEnPapelEn('enviada') && P.puedeAprobarEnPapelEn('con_observaciones') && !P.puedeAprobarEnPapelEn('aprobada') && !P.puedeAprobarEnPapelEn('facturada'), 'estados: subir en enviada / con observaciones / aprobada / facturada; aprobar en papel solo en enviada / con observaciones');
  ok(R.puede('contador', 'facturar_agenda') && R.puede('admin', 'gestionar_archivo_detalle') && R.puede('contador', 'gestionar_archivo_detalle') && !R.puede('auxiliar', 'gestionar_archivo_detalle') && !R.puede('lectura', 'gestionar_archivo_detalle') && !R.puede('auxiliar', 'facturar_agenda') && R.puede('lectura', 'ver') && !R.puede(null, 'ver'), 'permisos: subir = quien marca aprobado (admin / contador); reemplazar / quitar = admin y contador; ver / descargar = quien ve el detalle; sin sesión nada');

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${CONSERVAR ? ' (--conservar)' : SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: dets } = await sb.from('detalle_facturacion').select('id').eq('nit', NIT);
    for (const d of (dets ?? []) as { id: string }[]) {
      const { data: objs } = await sb.storage.from(P.BUCKET_FIRMADOS).list(d.id, { limit: 100 });
      if (objs?.length) await sb.storage.from(P.BUCKET_FIRMADOS).remove(objs.map(o => `${d.id}/${o.name}`));
    }
    const { data: exps } = await sb.from('facturacion_expediente').select('id').like('id_externo', `${PREFIJO}%`);
    const ids = (exps ?? []).map(e => e.id as string);
    if (ids.length) { await sb.from('facturacion_componente').delete().in('expediente_id', ids); await sb.from('facturacion_expediente').delete().in('id', ids); }
    await sb.from('detalle_facturacion').delete().eq('nit', NIT);   // archivos, links, respuestas y envíos en cascada
    await sb.from('cliente_externo').delete().eq('nit', NIT);
    await sb.from('clientes').delete().eq('nit', NIT);
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PREFIJO}%`);
    const { count: nDet } = await sb.from('detalle_facturacion').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    return (count ?? 0) + (nDet ?? 0);
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes dfpE2E y 0 detalles del NIT de prueba; objetos del bucket, archivos (cascada), mapeo y cliente borrados'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const { data: cliRow } = await sb.from('clientes').insert({ airtable_id: 'sbwDFPE2E01', nombre_empresa: 'DFP E2E FIRMADO', razon_social: 'DFP E2E FIRMADO, S.A.', nit: NIT, activo: true, email_cobros: 'cobros@dfp-e2e.example' }).select('id').single();
  await sb.from('cliente_externo').insert({ fuente: 'agenda', empresa_id_externo: EMPRESA, empresa_nombre_externo: 'DFP E2E FIRMADO', nit: NIT, cliente_id: cliRow?.id ?? null, activo: true, creado_por: 'e2e' });
  const seeds = [['Ana Papel', 'POLIGRAFO', 'RUTINA', 350], ['Beto Papel', 'POLIGRAFO', 'PRE EMPLEO', 350], ['Caro Papel', 'SOCIOECONOMICO', 'PRE EMPLEO', 400], ['Dani Papel', 'POLIGRAFO', 'RUTINA', 350]] as const;
  const exps = seeds.map((s, i) => ({ fuente: 'agenda', id_externo: `${PREFIJO}${String(i + 1).padStart(3, '0')}`, empresa_id_externo: EMPRESA, empresa_nombre_externo: 'DFP E2E FIRMADO', nit_resuelto: NIT, cliente_id: cliRow?.id ?? null, persona: s[0], puesto: 'Puesto', solicitante: 'MARTA PAPEL', tipo_prueba: s[1], categoria_prueba: s[2], proceso_solicitado: `SOLO ${s[1]}`, depto_visita: 'GUATEMALA', fecha_ingreso: '2026-10-05', fecha_entrega: '2026-10-20', status_proceso: 'APROBO', terminado: true, cancelado: false, eliminado: false, estado_tarifa: 'resuelta', monto_calculado: s[3], status_cobro_externo: 'PENDIENTE', actualizado_en_externo: '2026-10-21T12:00:00.000Z' }));
  const { data: insExps, error: eExp } = await sb.from('facturacion_expediente').insert(exps).select('id, id_externo');
  const idPorExt = new Map((insExps ?? []).map(e => [e.id_externo as string, e.id as string]));
  const { data: comps, error: eComp } = await sb.from('facturacion_componente').insert(seeds.map((s, i) => ({ fuente: 'agenda', expediente_id: idPorExt.get(`${PREFIJO}${String(i + 1).padStart(3, '0')}`), id_externo: `${PREFIJO}${String(i + 1).padStart(3, '0')}`, servicio: s[1], estado_prueba: 'APROBO', situacion: 'cobra', motivo: 'E2E', categoria: s[2], territorio: 'METROPOLITANA', monto_calculado: s[3], estado_tarifa: 'resuelta', fecha_resultado: '2026-10-20T15:00:00.000Z', fecha_resultado_fuente: 'agenda' }))).select('id');
  ok(!eExp && !eComp && (comps ?? []).length === 4, `sembrado: cliente ${NIT}, 4 pruebas cobrables${eExp ? ' · ' + eExp.message : ''}${eComp ? ' · ' + eComp.message : ''}`);
  const DB = await import('../src/lib/db/detalle-facturacion');
  const DL = await import('../src/lib/db/detalle-link');
  const DA = await import('../src/lib/db/detalle-archivo');
  const ids = (comps ?? []).map(c => c.id as string);
  const actor = 'luis@dfp-e2e.example';
  const d1 = await DB.crearDetalle({ componenteIds: ids.slice(0, 3), titulo: 'Papel · Oct 2026' }, actor);
  if (!d1.ok) { console.error(d1.error); process.exit(1); }
  const D1 = d1.detalle.id;
  // en borrador no se sube
  const rB = await DA.subirArchivoDirecto(D1, { nombre: 'firmado.pdf', mime: 'application/pdf', data: PDF }, { firmadoPor: 'Marta Papel' }, actor);
  const e1 = await DL.emitirLinkDetalle(D1, { email: actor, nombre: 'Luis' }, { destinatarios: ['cobros@dfp-e2e.example'], baseUrl: 'http://localhost:3012' });
  ok(!rB.ok && /enviado, con observaciones, aprobado o facturado/.test(rB.error) && e1.ok && e1.detalle.estado === 'enviada' && e1.link.vigente, 'en borrador no se sube; enviado por link → enviada con link vigente');
  const t1 = e1.ok ? e1.url.split('#')[1] : '';
  // PDF (directo), foto por URL firmada de subida (lo que hace el navegador), 3 hojas
  const r1 = await DA.subirArchivoDirecto(D1, { nombre: 'Detalle firmado ACME.pdf', mime: 'application/pdf', data: PDF }, { firmadoPor: 'Marta Papel', firmadoCargo: 'Gerente RRHH', notas: 'marcó NO en la línea 2, se quitó' }, actor);
  ok(r1.ok && r1.archivos.length === 1 && r1.archivos[0].mime === 'application/pdf' && r1.archivos[0].nombre === 'Detalle-firmado-ACME.pdf' && r1.archivos[0].sha256 === sha(PDF) && r1.archivos[0].bytes === PDF.length && r1.archivos[0].path.startsWith(`${D1}/`) && !r1.aprobado, `PDF subido: tipo real, nombre saneado, sha256 y bytes reales, path del detalle; sin aprobar (no se pidió)${r1.ok ? '' : ' · ' + r1.error}`);
  const prep = await DA.prepararSubida(D1, [{ nombre: 'IMG_0042.jpg', bytes: JPEG.length, mime: 'image/jpeg' }]);
  let put: Response | null = null;
  if (prep.ok) put = await fetch(prep.subidas[0].url, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' }, body: new Uint8Array(JPEG) });
  const put2 = prep.ok ? await fetch(prep.subidas[0].url, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' }, body: new Uint8Array(JPEG) }) : null;
  const r2 = prep.ok ? await DA.confirmarSubida(D1, { archivos: [{ path: prep.subidas[0].path, nombre: 'IMG_0042.jpg' }], firmadoPor: 'Marta Papel' }, actor) : null;
  ok(prep.ok && put?.ok === true && put2 !== null && !put2.ok && !!r2?.ok && r2.archivos[0].mime === 'image/jpeg' && r2.archivos[0].sha256 === sha(JPEG) && /\/object\/upload\/sign\/detalles-firmados\//.test(prep.subidas[0].url), `foto por URL firmada de subida (PUT directo al bucket, ${put?.status}); la misma URL no sirve dos veces (${put2?.status}); confirmada con tipo real y sha256${r2 && !r2.ok ? ' · ' + r2.error : ''}`);
  const prep3 = await DA.prepararSubida(D1, [1, 2, 3].map(i => ({ nombre: `hoja-${i}.png`, bytes: PNG.length, mime: 'image/png' })));
  if (prep3.ok) for (const s of prep3.subidas) await fetch(s.url, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-upsert': 'false' }, body: new Uint8Array(PNG) });
  const r3 = prep3.ok ? await DA.confirmarSubida(D1, { archivos: prep3.subidas.map(s => ({ path: s.path, nombre: s.nombre })), firmadoPor: 'Marta Papel' }, actor) : null;
  const vig1 = (await DA.archivosDeDetalle(D1, { miniaturas: true })).filter(a => a.vigente);
  ok(prep3.ok && !!r3?.ok && r3.archivos.length === 3 && vig1.length === 5 && vig1.filter(a => a.mime === 'image/png').length === 3 && vig1.filter(a => a.mime !== 'image/heic' && a.mime.startsWith('image/')).every(a => !!a.miniaturaUrl && /token=/.test(a.miniaturaUrl)), `3 hojas en fotos separadas → 5 archivos vigentes; miniaturas firmadas para las imágenes${r3 && !r3.ok ? ' · ' + r3.error : ''}`);
  // 6.º archivo → rechazado
  const r6 = await DA.prepararSubida(D1, [{ nombre: 'otra.pdf', bytes: 10, mime: 'application/pdf' }]);
  ok(!r6.ok && /Hasta 5 archivos/.test(r6.error), '6.º archivo → rechazado (hasta 5 por detalle)');
  // reemplazar conserva el anterior
  const r7 = await DA.subirArchivoDirecto(D1, { nombre: 'hoja-1-mejor.png', mime: 'image/png', data: PNG }, { firmadoPor: 'Marta Papel', reemplazaId: vig1[0].id, motivo: 'la foto salió movida' }, actor);
  const todos = await DA.archivosDeDetalle(D1);
  const ant = todos.find(a => a.id === vig1[0].id);
  const bajada = await sb.storage.from(P.BUCKET_FIRMADOS).download(vig1[0].path);
  ok(r7.ok && !!ant && !ant.vigente && ant.reemplazadoPor === r7.archivos[0].id && /la foto salió movida/.test(ant.motivoReemplazo) && !!ant.reemplazadoEn && todos.filter(a => a.vigente).length === 5 && !bajada.error && (await bajada.data!.arrayBuffer()).byteLength === PNG.length, 'reemplazar conserva el anterior (marcado reemplazado_por / motivo, sigue en el bucket); 5 vigentes');
  const r7b = await DA.subirArchivoDirecto(D1, { nombre: 'x.png', mime: 'image/png', data: PNG }, { firmadoPor: 'Marta Papel', reemplazaId: vig1[0].id, motivo: 'otra vez' }, actor);
  ok(!r7b.ok && /ya no está vigente/.test(r7b.error), 'reemplazar un archivo ya reemplazado → rechazado');
  // quitar conserva el anterior
  const rq = await DA.quitarArchivo(r7.ok ? r7.archivos[0].id : '', 'duplicada', 'admin@dfp-e2e.example');
  const rq2 = await DA.quitarArchivo(r7.ok ? r7.archivos[0].id : '', 'duplicada', 'admin@dfp-e2e.example');
  const rq3 = await DA.quitarArchivo(vig1[1].id, 'x', 'admin@dfp-e2e.example');
  const trasQuitar = await DA.archivosDeDetalle(D1);
  ok(rq.ok && !rq.archivo.vigente && !rq.archivo.reemplazadoPor && /duplicada · quitado por admin@dfp-e2e\.example/.test(rq.archivo.motivoReemplazo) && !rq2.ok && !rq3.ok && trasQuitar.filter(a => a.vigente).length === 4 && trasQuitar.length === 6, 'quitar conserva el anterior (sin reemplazado_por, con motivo y quién); motivo corto o ya quitado → rechazado; 4 vigentes de 6');
  // no PDF ni imagen → rechazado y borrado del bucket
  const prepT = await DA.prepararSubida(D1, [{ nombre: 'texto.jpg', bytes: TEXTO.length, mime: 'image/jpeg' }]);
  if (prepT.ok) await fetch(prepT.subidas[0].url, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' }, body: new Uint8Array(TEXTO) });
  const rT = prepT.ok ? await DA.confirmarSubida(D1, { archivos: [{ path: prepT.subidas[0].path, nombre: 'texto.jpg' }], firmadoPor: 'Marta Papel' }, actor) : null;
  // list (no download): el CDN puede servir unos segundos el objeto recién borrado si ya se había descargado
  const enBucket = prepT.ok ? ((await sb.storage.from(P.BUCKET_FIRMADOS).list(D1, { limit: 100 })).data ?? []).some(o => `${D1}/${o.name}` === prepT.subidas[0].path) : true;
  ok(prepT.ok && !!rT && !rT.ok && /no es PDF ni imagen/.test(rT.error) && !enBucket && (await DA.archivosDeDetalle(D1)).length === 6, `un texto con extensión .jpg → rechazado por los bytes y borrado del bucket; sin fila (${rT && !rT.ok ? rT.error : 'ok?'})`);
  const rG = await DA.prepararSubida(D1, [{ nombre: 'a.gif', bytes: 10, mime: 'image/gif' }]);
  ok(!rG.ok && /no es PDF ni imagen/.test(rG.error), 'mime declarado fuera de la lista (gif) → rechazado antes de pedir la URL');
  // > 15 MB → rechazado (declarado) y en el bucket (file_size_limit)
  const rBig = await DA.prepararSubida(D1, [{ nombre: 'grande.pdf', bytes: P.MAX_BYTES_ARCHIVO + 1, mime: 'application/pdf' }]);
  const prepBig = await DA.prepararSubida(D1, [{ nombre: 'grande2.pdf', bytes: 1000, mime: 'application/pdf' }]);
  const big = Buffer.concat([PDF, Buffer.alloc(P.MAX_BYTES_ARCHIVO + 1 - PDF.length)]);
  const putBig = prepBig.ok ? await fetch(prepBig.subidas[0].url, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: new Uint8Array(big) }) : null;
  ok(!rBig.ok && /más de 15 MB/.test(rBig.error) && prepBig.ok && putBig !== null && !putBig.ok && [400, 413].includes(putBig.status), `> 15 MB → rechazado al declarar y el bucket rechaza el PUT (${putBig?.status})`);
  // la ruta de descarga: URL firmada que vence
  const u1 = await DA.urlFirmadaArchivo(r1.ok ? r1.archivos[0].id : '', { segundos: 4 });
  const g1 = u1.ok ? await fetch(u1.url) : null;
  await new Promise(r => setTimeout(r, 6000));
  const g2 = u1.ok ? await fetch(u1.url) : null;
  const uD = await DA.urlFirmadaArchivo(r1.ok ? r1.archivos[0].id : '', { descargar: true });
  ok(u1.ok && g1?.ok === true && (g1.headers.get('content-type') ?? '').includes('pdf') && g2 !== null && !g2.ok && uD.ok && /download=/.test(uD.url) && !/detalles-firmados\/public/.test(uD.url) && !(await DA.urlFirmadaArchivo('00000000-0000-0000-0000-000000000000')).ok, `URL firmada: sirve (${g1?.status}) y vence (${g2?.status}); descarga con nombre; nunca pública; id inexistente → error`);
  // aprobar en papel: revoca el link
  const aA = await DL.abrirLinkPublico(t1);
  const r8 = await DA.subirArchivoDirecto(D1, { nombre: 'firmado-final.jpg', mime: 'image/jpeg', data: JPEG }, { firmadoPor: 'Marta Papel', firmadoCargo: 'Gerente RRHH', aprobar: true }, actor);
  const d1b = await DB.getDetalleBasico(D1);
  const aB = await DL.abrirLinkPublico(t1);
  const lk = await DB.ultimoLinkDeDetalle(D1);
  ok(aA.estado === 'vigente' && r8.ok && r8.aprobado && r8.linkRevocado === 1 && d1b!.estado === 'aprobada' && d1b!.aprobadoCanal === 'papel' && d1b!.aprobadoPor === 'Marta Papel' && !!d1b!.aprobadaEn && aB.estado === 'nueva_version' && !!lk?.revocadoEn && !lk.vigente, 'aprobar en papel: aprobada con canal papel y quién firmó; el link digital queda revocado (el cliente ve "versión más nueva")');
  const comp1 = await DB.getDetalle(D1);
  ok(!!comp1 && comp1.archivos.length === 7 && comp1.archivos.filter(a => a.vigente).length === 5 && comp1.archivos[0].id === (r8.ok ? r8.archivos[0].id : '') && (await DA.detallesConFirmado([D1, 'no-uuid'])).join() === D1, 'getDetalle trae los archivos (vigentes y anteriores, el más nuevo primero); la lista sabe qué detalles tienen firmado');
  // ya aprobada: solo adjunta (aunque se pida aprobar); desde facturada solo adjunta
  const r9 = await DA.subirArchivoDirecto(D1, { nombre: 'otra.pdf', mime: 'application/pdf', data: PDF }, { firmadoPor: 'Marta Papel', aprobar: true }, actor);
  ok(!r9.ok && /Hasta 5 archivos/.test(r9.error), 'con 5 vigentes no entra otro (ni reemplazando a nadie)');
  // con_observaciones → aprobar en papel (el papel manda sobre las observaciones del link)
  const d2 = await DB.crearDetalle({ componenteIds: [ids[3]], titulo: 'Papel 2' }, actor);
  const D2 = d2.ok ? d2.detalle.id : '';
  await DB.marcarEnviada(D2, actor);
  await sb.from('detalle_facturacion').update({ estado: 'con_observaciones' }).eq('id', D2);
  const r10 = await DA.subirArchivoDirecto(D2, { nombre: 'firmado-con-obs.pdf', mime: 'application/pdf', data: PDF }, { firmadoPor: 'Marta Papel', aprobar: true }, actor);
  const d2b = await DB.getDetalleBasico(D2);
  ok(r10.ok && r10.aprobado && d2b!.estado === 'aprobada' && d2b!.aprobadoCanal === 'papel', 'con observaciones + papel firmado → aprobada con canal papel');
  // desde facturada solo adjunta (a veces el papel llega después de facturar)
  await sb.from('detalle_facturacion').update({ estado: 'facturada', facturado_en: new Date().toISOString(), no_factura: 'E2E-0001' }).eq('id', D2);
  const r11 = await DA.subirArchivoDirecto(D2, { nombre: 'llegó después.pdf', mime: 'application/pdf', data: PDF }, { firmadoPor: 'Marta Papel', aprobar: true }, actor);
  const d2c = await DB.getDetalleBasico(D2);
  ok(r11.ok && !r11.aprobado && r11.linkRevocado === 0 && d2c!.estado === 'facturada' && r11.archivos[0].nombre === 'llego-despues.pdf' && (await DA.archivosDeDetalle(D2)).filter(a => a.vigente).length === 2, 'desde facturada solo adjunta: el estado no cambia (2 archivos vigentes)');
  // anon: ni la tabla ni el bucket
  const anon = process.env.SUPABASE_ANON_KEY;
  if (anon) {
    const { createClient } = await import('@supabase/supabase-js');
    const pub = createClient(process.env.SUPABASE_URL!, anon, { auth: { persistSession: false } });
    const { data: dA, error: eA } = await pub.from('detalle_facturacion_archivo').select('id').limit(1);
    const { error: eB } = await pub.storage.from(P.BUCKET_FIRMADOS).download(r1.ok ? r1.archivos[0].path : 'x');
    const { data: dC } = await pub.storage.from(P.BUCKET_FIRMADOS).list(D1);
    ok(!dA?.length && /permission denied|42501/i.test(`${eA?.code} ${eA?.message}`) && !!eB && !(dC ?? []).length, `anon: la tabla responde permiso denegado (${eA?.code}) y el bucket no entrega ni lista (${eB?.message?.slice(0, 40)})`);
  } else console.log('  ⚪ SUPABASE_ANON_KEY no está en el entorno: prueba con la llave pública omitida (RLS + revoke verificados en estático y con has_table_privilege en SQL)');
  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: 0 expedientes dfpE2E y 0 detalles del NIT de prueba; objetos del bucket, archivos (cascada), mapeo y cliente borrados');
  else {
    // para el E2E en Chrome: un detalle NUEVO en enviada con link vigente y sin archivos, con las 3 pruebas del detalle 1
    await DB.anularDetalle(D1, 'e2e: liberar', actor);
    const d4 = await DB.crearDetalle({ componenteIds: ids.slice(0, 3), titulo: 'Corte E2E papel · Oct 2026', dirigidoA: 'Marta Papel' }, actor);
    const e4 = d4.ok ? await DL.emitirLinkDetalle(d4.detalle.id, { email: actor, nombre: 'Luis' }, { destinatarios: ['cobros@dfp-e2e.example'], baseUrl: 'http://localhost:3012' }) : null;
    console.log(`  ⚪ --conservar: queda el detalle ${d4.ok ? d4.detalle.id : d4.error} en enviada con link ${e4?.ok ? 'vigente' : 'SIN emitir'} para el E2E en Chrome (borrar con --solo-limpiar)`);
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
