/**
 * PRECIO ESPECIAL POR PRUEBA (037) — validador.
 *
 *  A. Estático: la 037 (columnas, bitácora con RLS, RPC, las seis funciones que cobran con el monto efectivo, el sync sin
 *     tocar, ayuda idempotente) y la app (ningún lugar que cobra lee monto_calculado directo; acción con permiso; pantallas).
 *  B. Puro: monto efectivo, con IVA 274.40 → 245.00 sin IVA → la línea FEL suma 274.40, documento / factura / write-back con
 *     el monto efectivo, el PDF renderizado (precio ajustado sin tachar; en Observaciones solo el motivo de tipo cliente).
 *  C. Base (datos sembrados, prefijo PEP-): ajustar → el sync no lo pisa; el detalle enviado recalcula su total, sube de
 *     versión y el link viejo deja de servir; un detalle aprobado, una prueba facturada o cubierta por paquete rechazan;
 *     quitar el ajuste vuelve a la tarifa; bitácora; link público (precio y motivo solo si es de tipo cliente); y la
 *     PARIDAD SQL / TS de los totales (detalle, Por facturar, producción, huella del link).
 *  D. Solo HIT: lo mismo por la capa de datos de la app (ajustarPrecioPrueba con IVA, getDetalle, listarExpedientesLocal).
 *
 * Uso: npx tsx scripts/validate-precio-especial.ts hit [--solo-limpiar | --sin-hit]
 *        (--sin-hit corre solo A y B: no toca ninguna base)
 *      npx tsx scripts/validate-precio-especial.ts local
 *        (A, B y C contra un Postgres EN MEMORIA con la cadena 001 → 037 aplicada: no toca HIT ni Golden. Necesita
 *         @electric-sql/pglite, que no es dependencia del repo: `npm i --no-save @electric-sql/pglite`, o instalarlo en
 *         otra carpeta y pasarla en PGLITE_DIR.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { ExpedienteLocal, PruebaLocal } from '../src/lib/facturacion-agenda/tipos';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit' && BASE !== 'local') { console.error('Este validador siembra datos: solo corre contra HIT o contra un Postgres local en memoria (local).'); process.exit(2); }
const SOLO_LIMPIAR = process.argv.includes('--solo-limpiar'), SIN_HIT = process.argv.includes('--sin-hit');
if (BASE === 'hit') for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
const NIT = '99990061K', PREFIJO = 'PEP-', ACTOR = 'validador@pep.example', EMPRESA = 'pep-emp-a';
const MOTIVO_CLIENTE = 'Proceso incompleto: faltó papelería', MOTIVO_INTERNO = 'Precio pactado con el cliente';

type Row = Record<string, unknown>;
/** Lo mínimo que usa la parte C: igual contra PostgREST (HIT) que contra SQL directo (Postgres en memoria). */
interface Db {
  rpc<T = unknown>(fn: string, args: Row): Promise<T>;
  insert(tabla: string, filas: Row[]): Promise<Row[]>;
  select(tabla: string, donde: Record<string, unknown>): Promise<Row[]>;
  selectLike(tabla: string, col: string, patron: string): Promise<Row[]>;
  update(tabla: string, cambio: Row, donde: Record<string, unknown>): Promise<void>;
  del(tabla: string, donde: Record<string, unknown>): Promise<void>;
  existe(tabla: string): Promise<string | null>;
}

async function dbHit(): Promise<Db> {
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtrar = (q: any, donde: Record<string, unknown>) => { for (const [k, v] of Object.entries(donde)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v); return q; };
  return {
    rpc: async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; },
    insert: async (t, filas) => { const { data, error } = await sb.from(t).insert(filas).select('*'); if (error) throw new Error(`${t}: ${error.message}`); return (data ?? []) as Row[]; },
    select: async (t, donde) => { const { data, error } = await filtrar(sb.from(t).select('*'), donde); if (error) throw new Error(`${t}: ${error.message}`); return (data ?? []) as Row[]; },
    selectLike: async (t, col, patron) => { const { data, error } = await sb.from(t).select('*').like(col, patron); if (error) throw new Error(`${t}: ${error.message}`); return (data ?? []) as Row[]; },
    update: async (t, cambio, donde) => { const { error } = await filtrar(sb.from(t).update(cambio), donde); if (error) throw new Error(`${t}: ${error.message}`); },
    del: async (t, donde) => { const { error } = await filtrar(sb.from(t).delete(), donde); if (error) throw new Error(`${t}: ${error.message}`); },
    existe: async t => { const { error } = await sb.from(t).select('*', { count: 'exact', head: true }); return error ? error.message : null; },
  };
}

/** Postgres en memoria (pglite) con los roles de Supabase y la cadena de migraciones 001 → 037. */
async function dbLocal(): Promise<Db> {
  let entrada: string;
  try { entrada = createRequire(path.join(process.env.PGLITE_DIR ?? process.cwd(), 'x.js')).resolve('@electric-sql/pglite'); }
  catch { console.error('Falta @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` (o instalalo en otra carpeta y pasala en PGLITE_DIR).'); process.exit(2); }
  const { PGlite } = await import(pathToFileURL(entrada).href) as { PGlite: new () => { exec(sql: string): Promise<unknown>; query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> } };
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role; create schema if not exists storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  const dir = path.join(process.cwd(), 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter(x => /^\d{3}_.*\.sql$/.test(x) && !/ 2\.sql$/.test(x)).sort()) {
    try { await pg.exec(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error(`migración ${f}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  // sin PostgREST: los valores viajan como texto (JSON para objetos, literal de arreglo para listas simples) y Postgres los convierte al tipo del argumento / columna
  const lit = (v: unknown): unknown => v === null || v === undefined ? null : Array.isArray(v) ? (v.some(x => x && typeof x === 'object') ? JSON.stringify(v) : `{${v.map(x => `"${String(x).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`) : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? v : String(v);
  const tipos = new Map<string, Map<string, string>>();
  const tiposDe = async (t: string) => { if (!tipos.has(t)) { const { rows } = await pg.query<{ column_name: string; udt: string }>(`select column_name, format_type(a.atttypid, a.atttypmod) as udt from information_schema.columns c join pg_attribute a on a.attrelid = ('public.' || c.table_name)::regclass and a.attname = c.column_name where c.table_schema = 'public' and c.table_name = $1`, [t]); tipos.set(t, new Map(rows.map(r => [r.column_name, r.udt]))); } return tipos.get(t)!; };
  const donde = async (t: string, d: Record<string, unknown>, desde = 1) => { const ty = await tiposDe(t); const ks = Object.keys(d); return { sql: ks.map((k, i) => Array.isArray(d[k]) ? `${k} = any($${i + desde}::${ty.get(k)}[])` : `${k} = $${i + desde}::${ty.get(k)}`).join(' and ') || 'true', vals: ks.map(k => lit(d[k])) }; };
  return {
    rpc: async (fn, args) => {
      const { rows: firmas } = await pg.query<{ nombres: string[]; tipos: string[] }>(`select p.proargnames as nombres, (select array_agg(format_type(t, null) order by o) from unnest(p.proargtypes) with ordinality as x(t, o)) as tipos from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
      const ks = Object.keys(args);
      const firma = firmas.find(f => ks.every(k => (f.nombres ?? []).includes(k)) && (f.nombres ?? []).length >= ks.length && (firmas.length === 1 || (f.nombres ?? []).length === Math.min(...firmas.filter(g => ks.every(k => (g.nombres ?? []).includes(k))).map(g => (g.nombres ?? []).length))));
      if (!firma) throw new Error(`Could not find the function ${fn}(${ks.join(', ')})`);
      const { rows } = await pg.query<{ r: unknown }>(`select ${fn}(${ks.map((k, i) => `${k} => $${i + 1}::${firma.tipos[firma.nombres.indexOf(k)]}`).join(', ')}) as r`, ks.map(k => lit(args[k])));
      return rows[0]?.r as never;
    },
    insert: async (t, filas) => {
      const ty = await tiposDe(t); const out: Row[] = [];
      for (const f of filas) { const ks = Object.keys(f); const { rows } = await pg.query<Row>(`insert into ${t} (${ks.join(', ')}) values (${ks.map((k, i) => `$${i + 1}::${ty.get(k)}`).join(', ')}) returning *`, ks.map(k => lit(f[k]))); out.push(rows[0]); }
      return out;
    },
    select: async (t, d) => { const w = await donde(t, d); return (await pg.query<Row>(`select * from ${t} where ${w.sql}`, w.vals)).rows; },
    selectLike: async (t, col, patron) => (await pg.query<Row>(`select * from ${t} where ${col} like $1`, [patron])).rows,
    update: async (t, cambio, d) => { const ty = await tiposDe(t); const ks = Object.keys(cambio); const w = await donde(t, d, ks.length + 1); await pg.query(`update ${t} set ${ks.map((k, i) => `${k} = $${i + 1}::${ty.get(k)}`).join(', ')} where ${w.sql}`, [...ks.map(k => lit(cambio[k])), ...w.vals]); },
    del: async (t, d) => { const w = await donde(t, d); await pg.query(`delete from ${t} where ${w.sql}`, w.vals); },
    existe: async t => { try { await pg.query(`select 1 from ${t} limit 1`); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } },
  };
}

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const sql = rd('supabase/migrations/037_precio_especial_prueba.sql');
  const fnSql = (nombre: string) => { const i = sql.indexOf(`create or replace function ${nombre}(`); return i < 0 ? '' : sql.slice(i, sql.indexOf('$fn$;', i)); };
  ok(/add column if not exists monto_ajustado numeric\(12,2\)/.test(sql) && /add column if not exists ajuste_motivo text/.test(sql) && /add column if not exists ajustado_por text/.test(sql) && /add column if not exists ajustado_en timestamptz/.test(sql) && /add column if not exists ajuste_motivo_cliente boolean not null default false/.test(sql)
    && /check \(monto_ajustado is null or monto_ajustado >= 0\)/.test(sql) && /check \(monto_ajustado is null or length\(btrim\(coalesce\(ajuste_motivo, ''\)\)\) >= 3\)/.test(sql),
    '037: facturacion_componente gana monto_ajustado numeric(12,2) ≥ 0, ajuste_motivo (obligatorio si hay monto), ajuste_motivo_cliente, ajustado_por y ajustado_en');
  ok(/create table if not exists facturacion_componente_ajuste \(/.test(sql) && /alter table facturacion_componente_ajuste enable row level security/.test(sql) && /revoke all on table facturacion_componente_ajuste from public, anon, authenticated/.test(sql) && /grant all on table facturacion_componente_ajuste to service_role/.test(sql)
    && /revoke all on function facturacion_componente_ajustar\(text, uuid, numeric, text, boolean\) from public, anon, authenticated/.test(sql) && /grant execute on function facturacion_componente_ajustar\(text, uuid, numeric, text, boolean\) to service_role/.test(sql),
    '037: bitácora facturacion_componente_ajuste con RLS y solo service_role; la RPC solo la ejecuta service_role');
  ok(!/^\s*(begin|commit)\s*;/im.test(sql) && !/drop table|drop function|truncate|delete from/i.test(sql.replace(/--.*$/gm, '')), '037: idempotente, sin drop de tablas / funciones, delete, truncate ni begin / commit');
  const aj = fnSql('facturacion_componente_ajustar');
  ok(/p_actor text, p_componente_id uuid, p_monto_sin_iva numeric, p_motivo text, p_motivo_cliente boolean default null/.test(aj) && /PRUEBA_FACTURADA/.test(aj) && /PRUEBA_CUBIERTA_POR_PAQUETE/.test(aj) && /DETALLE_APROBADO: el detalle % ya está aprobado por el cliente; anulá o reabrí el detalle primero/.test(aj) && /MONTO_INVALIDO/.test(aj) && /MOTIVO_OBLIGATORIO/.test(aj) && /PRUEBA_SIN_TARIFA/.test(aj),
    'RPC facturacion_componente_ajustar(p_actor, p_componente_id, p_monto_sin_iva | null, p_motivo): rechaza facturada, cubierta por paquete y detalle aprobado («anulá o reabrí el detalle primero»)');
  ok(/perform detalle_facturacion_recalcular\(v_d\.id\)/.test(aj) && /if v_d\.estado = 'enviada' then/.test(aj) && /set version = version \+ 1/.test(aj) && /update detalle_facturacion_link set revocado_en = now\(\)/.test(aj) && /insert into facturacion_componente_ajuste/.test(aj)
    && aj.indexOf('from detalle_facturacion where id = v_det for update') < aj.indexOf('from facturacion_componente where id = p_componente_id for update') && aj.indexOf('from detalle_facturacion where id = v_det for update') > 0,
    'RPC: en un detalle vivo recalcula los totales; si estaba enviada sube la versión y revoca el link; deja la bitácora; bloquea primero el detalle y después la prueba (mismo orden que quitar línea / emitir / responder)');
  const EFECTIVO = /coalesce\(c\.monto_ajustado, c\.monto_calculado(, 0)?\)/;
  const cobran = ['detalle_facturacion_recalcular', 'detalle_facturacion_crear_pruebas', 'detalle_link_contenido', 'detalle_link_responder', 'facturacion_agenda_resumen', 'facturacion_produccion_mensual'];
  ok(cobran.every(f => { const t = fnSql(f); return t && EFECTIVO.test(t) && !/(?<!c\.monto_ajustado, )c\.monto_calculado/.test(t.replace(/pl\.precio_unitario, c\.monto_ajustado, c\.monto_calculado/g, '')); }),
    `las ${cobran.length} funciones que cobran usan coalesce(monto_ajustado, monto_calculado) y ninguna lee c.monto_calculado sola: ${cobran.join(', ')}`);
  ok(!/create or replace function (facturacion_componentes_sincronizar|fel_totales|fel_precio_con_iva|paquete_\w+|facturacion_agenda_emitir|facturacion_factura_cobrada|precios_mapa|facturacion_componente_en_cola)\(/.test(sql)
    && !/monto_ajustado|ajuste_motivo|ajustado_/.test(rd('supabase/migrations/025_fecha_resultado_prueba.sql')),
    'no toca: el sync (025: su upsert no nombra las columnas del ajuste → nunca lo pisa), la regla FEL (030), los paquetes (034/036), la 026, el mapa de precios ni la emisión');
  ok(/'nota_precio', case when c\.monto_ajustado is not null and c\.ajuste_motivo_cliente then c\.ajuste_motivo end/.test(fnSql('detalle_link_contenido')), 'link público: el motivo viaja solo si es de tipo cliente (los internos no salen de la base)');
  ok(/\*\*Precio especial:\*\* si a una prueba se le cobra distinto a la tarifa \(por ejemplo, un proceso que no se terminó por falta de papelería\), usá el lápiz de la línea y escribí el motivo\. Si el detalle ya se envió, hay que reenviarlo\./.test(sql) && /where slug = 'detalle-de-facturacion-armar-el-corte' and contenido not like '%\*\*Precio especial:\*\*%'/.test(sql), 'ayuda de Por facturar: línea «Precio especial» (append idempotente)');

  // La app: nadie que cobra lee montoCalculado directo. Lista blanca = lo que NO cobra (mostrar la tarifa, espejo del expediente, sync).
  const PERMITIDOS: Record<string, RegExp[]> = {
    'src/lib/facturacion-agenda/tipos.ts': [/montoCalculado: number \| null;/, /montoEfectivo = \(p: \{ montoCalculado/, /p\.montoAjustado \?\? p\.montoCalculado/],
    'src/lib/facturacion-agenda/mapeo.ts': [/montoCalculado: c\.monto,/, /Pick<PruebaLocal, 'estadoTarifa' \| 'montoCalculado' \| 'montoAjustado'>/, /Pick<ExpedienteLocal, 'pruebas' \| 'noFactura' \| 'montoCalculado'>/, /montoSinIva: e\.montoCalculado \?\? 0/],
    'src/lib/facturacion-agenda/detalle.ts': [/montoTarifa: round2\(p\.montoCalculado \?\? 0\), montoTarifaConIva: precioConIva\(p\.montoCalculado \?\? 0\)/],
    'src/lib/db/facturacion-agenda.ts': [/montoCalculado: num\(r\.monto_calculado\)/, /monto_calculado: l\.montoCalculado/],
    'src/components/por-facturar/grupo-detalle.tsx': [/p\.estadoTarifa === 'resuelta' && p\.montoCalculado !== null/, /tarifa=\{p\.montoCalculado\}/, /: Q\(p\.montoCalculado\)\}/, /p\.montoCalculado > 0 && <PrecioEspecialBoton/, /montoTarifa: ajustando\.p\.montoCalculado \?\? 0/, /e\.estadoTarifa === 'resuelta' && e\.montoCalculado !== null/, /\{Q\(e\.montoCalculado\)\}/],
  };
  const fuentes = (dir: string): string[] => fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap(d => d.isDirectory() ? fuentes(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) && !/ 2\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []);
  const sueltos: string[] = [];
  for (const f of fuentes('src')) {
    const lineas = rd(f).split('\n');
    lineas.forEach((l, i) => { if (!/montoCalculado/.test(l)) return; let resto = l; for (const re of PERMITIDOS[f] ?? []) resto = resto.replace(new RegExp(re.source, 'g'), ''); if (/montoCalculado/.test(resto)) sueltos.push(`${f}:${i + 1}`); });
  }
  ok(sueltos.length === 0, `app: ningún lugar que cobra lee montoCalculado directo (solo la tarifa que se muestra, el espejo del expediente y el sync)${sueltos.length ? ' · sueltos: ' + sueltos.join(', ') : ''}`);
  const mapeo = rd('src/lib/facturacion-agenda/mapeo.ts'), det = rd('src/lib/facturacion-agenda/detalle.ts'), dbd = rd('src/lib/db/detalle-facturacion.ts'), dbl = rd('src/lib/db/detalle-link.ts'), dbf = rd('src/lib/db/facturacion-agenda.ts');
  ok(/pruebasEnCola\(e\)\.filter\(conPrecioEfectivo\)/.test(mapeo) && /s \+ \(montoEfectivo\(p\) \?\? 0\)/.test(mapeo) && /precioConIva\(montoEfectivo\(p\) \?\? 0\)/.test(mapeo) && /monto: round2\(montoEfectivo\(p\) \?\? 0\), persona/.test(mapeo) && /fact\.reduce\(\(s, p\) => s \+ \(montoEfectivo\(p\) \?\? 0\), 0\)/.test(mapeo)
    && /const efectivo = montoEfectivo\(p\) \?\? 0;/.test(det) && /monto: precioConIva\(montoEfectivo\(p\) \?\? 0\)/.test(dbl) && /conPrecioEfectivo\(p\) && pruebaEnCola/.test(dbf) && /pruebas\.push\(pruebaParaFactura\(p, e\.persona\)\)/.test(dbf) && /Number\(c\.monto_ajustado \?\? c\.monto_calculado \?\? 0\)/.test(dbf),
    'app: cola y totales de Por facturar, documento del detalle (PDF), huella / link público, emisión FEL, write-back a la Agenda y el resumen sin RPC usan el monto efectivo');
  const acc = rd('src/app/(app)/por-facturar/actions.ts');
  ok(/export async function ajustarPrecioPruebaAction\(componenteId: string, input: AjustarPrecioInput\)[\s\S]{0,200}autorizar\('facturar_agenda'\)/.test(acc) && /facturar_agenda:\s+CONTROL/.test(rd('src/lib/auth/roles.ts')) && /const CONTROL: readonly Rol\[\] = \['admin', 'contador'\]/.test(rd('src/lib/auth/roles.ts'))
    && /rpc<[\s\S]{0,260}>\(\s*'facturacion_componente_ajustar'/.test(dbd) && !/from\('facturacion_componente'\)\.update\([^)]*monto_ajustado/.test(dbd + dbf),
    'permisos: la acción exige facturar_agenda (admin y contador) y el ajuste va SOLO por la RPC (ningún update directo de monto_ajustado)');
  const pe = rd('src/components/por-facturar/precio-especial.tsx'), gd = rd('src/components/por-facturar/grupo-detalle.tsx'), dv = rd('src/components/por-facturar/detalle-view.tsx'), imp = rd('src/components/por-facturar/detalle-imprimible.tsx'), ad = rd('src/components/aprobar-detalle/aprobar-detalle-client.tsx');
  ok(/data-base="con_iva"/.test(pe) && /data-base="sin_iva"/.test(pe) && /montoSinIvaDe\(numero, base\)/.test(pe) && /precioConIva\(sinIva\)/.test(pe) && /MOTIVOS_PRECIO_ESPECIAL\.map/.test(pe) && /!montoOk \|\| !motivoOk/.test(pe) && /data-accion="quitar-precio-especial"/.test(pe) && /<s className="cell-mute"/.test(pe) && /data-badge-precio-especial>Precio especial</.test(pe) && /title=\{`\$\{motivo/.test(pe) && !/window\.(confirm|alert|prompt)|[^.\w](confirm|alert|prompt)\(/.test(pe),
    'modal: monto con selector sin IVA / con IVA y el precio con IVA resultante, motivo obligatorio con sugerencias, quitar; la línea muestra la tarifa tachada, el nuevo y el badge «Precio especial» con el motivo en el title; sin diálogos del navegador');
  ok(/<PrecioEspecialBoton onClick=\{onPrecio\}/.test(gd) && /<PrecioEspecialDialogo/.test(gd) && /<PrecioEspecialBoton onClick=\{\(\) => setAjustando\(l\.componenteId\)\}/.test(dv) && /puedeAjustar = puede && \(d\.estado === 'borrador' \|\| d\.estado === 'enviada' \|\| conObs\)/.test(dv) && /data-cambio-tras-envio/.test(dv) && /Cambió después de enviado: reenviar\./.test(dv) && /data-historial-precios/.test(dv),
    'pantallas: lápiz en el detalle del cliente (Por facturar) y en la vista del detalle (borrador / enviada / con observaciones), aviso «Cambió después de enviado: reenviar» e historial de precios especiales');
  ok(/observacionesPrecioEspecial\(doc\)/.test(imp) && !/<s[ >]|line-through|montoTarifa/.test(imp) && /l\.notaPrecio \?/.test(ad) && !/<s[ >]|line-through/.test(ad) && /notaPrecio: String\(l\.nota_precio \?\? ''\)\.trim\(\)/.test(dbl),
    'PDF y link público: el precio ajustado sin tachar y el motivo en Observaciones (solo lo que la base / el documento marcan de tipo cliente)');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const T = await import('../src/lib/facturacion-agenda/tipos');
  const M = await import('../src/lib/facturacion-agenda/mapeo');
  const D = await import('../src/lib/facturacion-agenda/detalle');
  const C = await import('../src/lib/tarifario/canon');
  const H = await import('../src/lib/detalle-link/documento');
  type P = PruebaLocal; type E = ExpedienteLocal;
  const P0 = (o: Partial<P>): P => ({ id: 'p', expedienteId: 'e', idExterno: 'x', servicio: 'SOCIOECONOMICO', estadoPrueba: 'TERMINADO', situacion: 'cobra', motivo: '', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', montoCalculado: 375, estadoTarifa: 'resuelta', detalleTarifa: '', tarifarioId: null, aprobada: true, detalleId: null, facturaId: null, noFactura: null, facturadoEn: null, facturadoPor: null, fechaResultado: null, fechaResultadoFuente: null, ...o } as P);
  const E0 = (o: Partial<E>): E => ({ id: 'e', fuente: 'agenda', idExterno: 'x', empresaIdExterno: EMPRESA, empresaNombreExterno: 'PEP', nitResuelto: NIT, clienteId: null, persona: 'P', puesto: '', solicitante: '', tipoPrueba: 'SOCIOECONOMICO', categoriaPrueba: '', procesoSolicitado: '', deptoVisita: '', tipoCobrado: 'SOCIOECONOMICO', categoriaCanon: 'PRE EMPLEO', territorioResuelto: 'METROPOLITANA', fechaIngreso: '2026-10-01', fechaEntrega: null, statusProceso: 'TERMINADO', terminado: true, cancelado: false, eliminado: false, enVistaFacturacion: null, statusCobroExterno: 'PENDIENTE', estatusPagoExterno: null, montoExterno: null, numeroFacturaExterno: null, fechaFacturaExterno: null, cobroMegapaca: null, costoVisita: null, montoCalculado: 375, estadoTarifa: 'resuelta', detalleTarifa: '', componentes: [], estadoPoligrafo: null, estadoSocio: null, fechaResultadoPoligrafo: null, fechaResultadoSocio: null, pruebas: [], creadoEnExterno: null, actualizadoEnExterno: null, actualizadoEnExternoCrudo: null, facturaId: null, facturaAppId: null, noFactura: null, facturadoEn: null, facturadoPor: null, writebackEstado: null, writebackDetalle: null, writebackEn: null, cobroWritebackEstado: null, cobroWritebackDetalle: null, detalleId: null, updatedAt: null, ...o } as E);
  ok(T.montoSinIvaDe(274.40, 'con_iva') === 245 && C.precioConIva(245) === 274.4 && T.montoSinIvaDe(245, 'sin_iva') === 245 && T.montoSinIvaDe(420, 'con_iva') === 375 && T.montoSinIvaDe(450, 'con_iva') === 401.79 && C.precioConIva(401.79) === 450,
    `con IVA 274.40 → ${T.montoSinIvaDe(274.40, 'con_iva').toFixed(2)} sin IVA → la línea FEL suma ${C.precioConIva(245).toFixed(2)} (y 420 → 375 → 420; 450 → 401.79 → 450)`);
  const pTar = P0({ id: 'a' }), pEsp = P0({ id: 'b', montoAjustado: 245, ajusteMotivo: MOTIVO_CLIENTE, ajusteMotivoCliente: true });
  ok(T.montoEfectivo(pTar) === 375 && T.montoEfectivo(pEsp) === 245 && T.montoEfectivo(P0({ montoAjustado: null })) === 375 && T.montoEfectivo(P0({ montoCalculado: null })) === null && !T.tienePrecioEspecial(pTar) && T.tienePrecioEspecial(pEsp) && T.motivoEsDeCliente(MOTIVO_CLIENTE) && !T.motivoEsDeCliente(MOTIVO_INTERNO) && !T.motivoEsDeCliente('Cortesía parcial') && T.MOTIVOS_PRECIO_ESPECIAL.map(m => m.texto).join('|') === 'Proceso incompleto: faltó papelería|Precio pactado con el cliente|Cortesía parcial',
    'monto efectivo = precio especial si lo tiene, si no la tarifa; sugerencias de motivo; solo «Proceso incompleto…» es de tipo cliente por defecto');
  // DET-0031 en chico: 31 líneas a tarifa + 2 socioeconómicos a 245 → Q13,820.80 (los montos reales se simulan con medir-precio-especial.ts golden)
  const eA = E0({ id: 'ea', idExterno: 'xa', persona: 'ZOILA', pruebas: [] }), eB = E0({ id: 'eb', idExterno: 'xb', persona: 'MILENA', pruebas: [] });
  const a = P0({ id: 'a', expedienteId: 'ea', idExterno: 'xa' }), b = P0({ id: 'b', expedienteId: 'eb', idExterno: 'xb', montoAjustado: 245, ajusteMotivo: MOTIVO_CLIENTE, ajusteMotivoCliente: true, ajustadoPor: ACTOR, ajustadoEn: '2026-11-23T12:00:00Z' });
  const c = P0({ id: 'c', expedienteId: 'ea', idExterno: 'xa', servicio: 'POLIGRAFO', montoCalculado: 401.79, montoAjustado: 300, ajusteMotivo: MOTIVO_INTERNO, ajusteMotivoCliente: false });
  eA.pruebas = [a, c]; eB.pruebas = [b];
  const doc = D.documentoDetalle([eA, eB], [a, b, c]);
  const lb = doc.lineas.find(l => l.componenteId === 'b')!, la = doc.lineas.find(l => l.componenteId === 'a')!, lc = doc.lineas.find(l => l.componenteId === 'c')!;
  const felDoc = C.totalesFel([375, 245, 300]);
  ok(lb.monto === 245 && lb.montoConIva === 274.4 && lb.precioEspecial?.montoTarifa === 375 && lb.precioEspecial?.montoTarifaConIva === 420 && lb.precioEspecial?.cliente === true && la.precioEspecial === null && la.montoConIva === 420 && lc.monto === 300 && lc.montoConIva === 336 && lc.precioEspecial?.cliente === false
    && doc.total === 1030.4 && doc.total === felDoc.total && doc.subtotal === felDoc.base && doc.iva === felDoc.iva && r2(doc.subtotal + doc.iva) === doc.total,
    `documentoDetalle: la línea ajustada vale 245.00 / 274.40 con IVA y conserva la tarifa (375 / 420) para tacharla en pantalla; total ${doc.total} = totalesFel (base ${doc.subtotal} + IVA ${doc.iva})`);
  const obs = D.observacionesPrecioEspecial(doc);
  ok(obs.length === 1 && obs[0].componenteId === 'b' && obs[0].motivo === MOTIVO_CLIENTE && obs[0].persona === 'MILENA', 'Observaciones para el cliente: solo el motivo de tipo cliente (el interno no sale)');
  const fac = M.armarFactura([M.pruebaParaFactura(a, 'ZOILA'), M.pruebaParaFactura(b, 'MILENA'), M.pruebaParaFactura(c, 'ZOILA')], () => 'cc');
  ok(fac.total === 1030.4 && fac.subtotal === doc.subtotal && fac.iva === doc.iva && fac.detalle.find(d => d.componenteId === 'b')!.monto === 245 && fac.detalle.find(d => d.componenteId === 'c')!.monto === 300, `emisión FEL: armarFactura cobra el monto efectivo por línea; total ${fac.total} = el del detalle`);
  ok(M.montoFacturable(eA) === 675 && M.montoFacturableConIva(eA) === 756 && M.montoFacturable(eB) === 245 && M.montoFacturableConIva(eB) === 274.4 && M.pruebasFacturables(eB).length === 1 && M.conPrecioEfectivo(b),
    'Por facturar: montoFacturable / montoFacturableConIva suman el monto efectivo');
  const eFact = E0({ id: 'ef', idExterno: 'xf', noFactura: 'F-1', pruebas: [P0({ id: 'f', facturaId: 'u', noFactura: 'F-1', facturadoEn: '2026-11-01', montoAjustado: 245, ajusteMotivo: MOTIVO_CLIENTE })] });
  ok(M.facturasDelExpediente(eFact).montoSinIva === 245 && M.montoParaAgenda(M.facturasDelExpediente(eFact).montoSinIva, 'con_iva') === 274.4, 'write-back a la Agenda: el monto del expediente es lo facturado con el precio especial (245.00 → 274.40 con IVA)');
  let html = '';
  try {
    const React = await import('react'); const { createElement } = React;
    (globalThis as unknown as { React: unknown }).React = React;   // tsx compila el JSX con el runtime clásico
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DetalleImprimible } = await import('../src/components/por-facturar/detalle-imprimible');
    const detalle = { id: 'd1', fuente: 'agenda', clienteId: null, nit: NIT, correlativo: 'DET-9999', estado: 'enviada', subtotal: doc.subtotal, iva: doc.iva, total: doc.total, expedientes: 2, pruebas: 3, creadoPor: 'x', createdAt: '2026-11-16T12:00:00Z', enviadaEn: '2026-11-16T12:00:00Z', enviadaPor: 'x', aprobadaEn: null, aprobadoPor: '', aprobadoCanal: null, facturaId: null, facturaAppId: null, noFactura: null, facturadoEn: null, anuladaEn: null, anuladaPor: '', motivoAnulacion: '', notas: '', updatedAt: null, titulo: '', dirigidoA: '', version: 2, destinatarios: [], respondidoEn: null, respondidoPorNombre: '', respondidoPorCargo: '', respondidoPorCorreo: '', firmaPng: null, documentoHash: null };
    const datos = { detalle, expedientes: [eA, eB], pruebas: [a, b, c], documento: doc, clienteNombre: 'PEP CLIENTE', clienteAppId: null, centros: [], empresaNombreExterno: 'PEP', respuestas: [], link: null, links: [], envios: [], correosCliente: [], aperturas: [], archivos: [], ajustes: [] };
    html = renderToStaticMarkup(createElement(DetalleImprimible as never, { datos, emisor: { nombre: 'Emisor', nit: '1', direccion: '' } } as never));
  } catch (e) { html = 'ERROR ' + (e instanceof Error ? e.message : String(e)); }
  ok(/data-precio-iva="274\.4"[^>]*>Q\s?274\.40</.test(html) && /data-precio-iva="336"/.test(html) && !/375\.00|420\.00|401\.79|450\.00/.test(html.replace(/data-[a-z-]+="[^"]*"/g, '')) && !/<s[ >]|line-through/.test(html) && /data-observaciones-precio="1"/.test(html) && html.includes(MOTIVO_CLIENTE) && !html.includes(MOTIVO_INTERNO) && /data-total="1030\.4"/.test(html),
    `PDF renderizado: la línea sale en Q274.40 sin tachar ni mostrar la tarifa; en Observaciones «${MOTIVO_CLIENTE}» y el motivo interno no aparece${html.startsWith('ERROR') ? ' · ' + html : ''}`);

  if (SIN_HIT) { console.log(`\n${pass} 🟢 / ${fail} 🔴 (sin base: solo A y B)`); process.exit(fail ? 1 : 0); }

  /* ───────────── C. Base ───────────── */
  console.log(`\nC. ${BASE === 'hit' ? 'HIT' : 'Postgres en memoria (001 → 037)'}${SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const db = BASE === 'hit' ? await dbHit() : await dbLocal();
  const falta = await db.existe('facturacion_componente_ajuste');
  if (falta) { ok(false, `la 037 NO está aplicada en ${BASE.toUpperCase()} (facturacion_componente_ajuste: ${falta}): la parte C no se puede correr`); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(1); }

  const limpiar = async (): Promise<number> => {
    const exps = await db.selectLike('facturacion_expediente', 'id_externo', `${PREFIJO}%`);
    const eids = exps.map(e => String(e.id));
    if (eids.length) {
      const cids = (await db.select('facturacion_componente', { expediente_id: eids })).map(x => String(x.id));
      if (cids.length) { await db.del('paquete_consumo', { componente_id: cids }); await db.del('facturacion_componente_ajuste', { componente_id: cids }); }
      await db.del('facturacion_componente', { expediente_id: eids });
      await db.del('facturacion_expediente', { id: eids });
    }
    const pqs = (await db.select('paquete', { nit: NIT })).map(p => String(p.id));
    if (pqs.length) { await db.del('paquete_linea', { paquete_id: pqs }); await db.del('paquete', { id: pqs }); }
    const dets = (await db.select('detalle_facturacion', { nit: NIT })).map(d => String(d.id));
    if (dets.length) await db.del('detalle_facturacion', { id: dets });   // links / respuestas / envíos / aperturas caen en cascada
    await db.del('facturas_clientes', { no_factura: `${PREFIJO}F-1` });
    return (await db.selectLike('facturacion_expediente', 'id_externo', `${PREFIJO}%`)).length + (await db.select('detalle_facturacion', { nit: NIT })).length + (await db.select('paquete', { nit: NIT })).length + (await db.select('facturas_clientes', { no_factura: `${PREFIJO}F-1` })).length;
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes PEP, detalles, paquetes ni facturas'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();

  try {
    // ── sembrado: 9 expedientes del mismo cliente; las pruebas entran por el SYNC real (facturacion_componentes_sincronizar)
    const SEEDS: Array<{ ext: string; persona: string; servicio: string; monto: number | null; estado: string }> = [
      { ext: 'S1', persona: 'ZOILA PEP', servicio: 'SOCIOECONOMICO', monto: 375, estado: 'resuelta' }, { ext: 'S2', persona: 'MILENA PEP', servicio: 'SOCIOECONOMICO', monto: 375, estado: 'resuelta' },
      { ext: 'P1', persona: 'ANA PEP', servicio: 'POLIGRAFO', monto: 401.79, estado: 'resuelta' }, { ext: 'P2', persona: 'BETO PEP', servicio: 'POLIGRAFO', monto: 401.79, estado: 'resuelta' }, { ext: 'P3', persona: 'CARLA PEP', servicio: 'POLIGRAFO', monto: 401.79, estado: 'resuelta' },
      { ext: 'Q1', persona: 'QUINO PEP', servicio: 'SOCIOECONOMICO', monto: 375, estado: 'resuelta' }, { ext: 'F1', persona: 'FACTURADA PEP', servicio: 'POLIGRAFO', monto: 401.79, estado: 'resuelta' },
      { ext: 'K1', persona: 'CUBIERTA PEP', servicio: 'POLIGRAFO', monto: 401.79, estado: 'resuelta' }, { ext: 'T1', persona: 'SIN TARIFA PEP', servicio: 'SOCIOECONOMICO', monto: null, estado: 'sin_tarifa' },
    ];
    const filaExp = (s: (typeof SEEDS)[number]) => ({ fuente: 'agenda', id_externo: `${PREFIJO}${s.ext}`, empresa_id_externo: EMPRESA, empresa_nombre_externo: 'PEP CLIENTE', nit_resuelto: NIT, persona: s.persona, puesto: 'Puesto', solicitante: 'RRHH', tipo_prueba: s.servicio, categoria_prueba: 'PRE EMPLEO', proceso_solicitado: s.servicio, fecha_ingreso: '2026-10-01', fecha_entrega: '2026-10-15', status_proceso: 'TERMINADO', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', estatus_pago_externo: null, estado_tarifa: s.estado, tipo_cobrado: s.servicio, monto_calculado: s.monto, categoria_canon: 'PRE EMPLEO', territorio_resuelto: 'METROPOLITANA' });
    const insExps = await db.insert('facturacion_expediente', SEEDS.map(filaExp));
    const itemSync = (s: (typeof SEEDS)[number], monto: number | null = s.monto) => ({ id_externo: `${PREFIJO}${s.ext}`, componentes: [{ servicio: s.servicio, estado_prueba: 'TERMINADO', situacion: 'cobra', motivo: 'E2E', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto_calculado: monto, estado_tarifa: s.estado, detalle_tarifa: 'tarifa de prueba', tarifario_id: null, aprobada: true, fecha_resultado: '2026-10-05T15:00:00Z', fecha_resultado_fuente: 'agenda' }] });
    const sync = (items: unknown[]) => db.rpc<number>('facturacion_componentes_sincronizar', { p_fuente: 'agenda', p_items: items });
    await sync(SEEDS.map(s => itemSync(s)));
    const eids = insExps.map(e => String(e.id));
    const comps = async () => db.select('facturacion_componente', { expediente_id: eids });
    const iniciales = await comps();
    const cid = (ext: string) => String(iniciales.find(x => x.id_externo === `${PREFIJO}${ext}`)?.id ?? '');
    const comp = async (ext: string) => (await db.select('facturacion_componente', { id: cid(ext) }))[0];
    ok(insExps.length === 9 && iniciales.length === 9 && iniciales.every(x => x.monto_ajustado === null || x.monto_ajustado === undefined) && r2((await comp('S1')).monto_calculado) === 375, 'sembrado: 9 expedientes del cliente y sus 9 pruebas por el sync real; nacen sin ajuste (monto efectivo = tarifa)');

    type Aj = { sin_cambio: boolean; componente: Row; detalle: Row | null; reenviar: boolean; monto_anterior: number | string | null; monto_nuevo: number | string | null };
    const ajustar = (ext: string, monto: number | null, motivo: string | null, extra: Row = {}) => db.rpc<Aj>('facturacion_componente_ajustar', { p_actor: ACTOR, p_componente_id: cid(ext), p_monto_sin_iva: monto, p_motivo: motivo, ...extra });
    const rechaza = async (fn: () => Promise<unknown>, codigo: RegExp): Promise<string> => { try { await fn(); return 'NO RECHAZÓ'; } catch (e) { const m = e instanceof Error ? e.message : String(e); return codigo.test(m) ? 'ok' : m; } };
    const detRow = async (id: string) => (await db.select('detalle_facturacion', { id }))[0];
    const bitacora = async (ext: string) => (await db.select('facturacion_componente_ajuste', { componente_id: cid(ext) })).sort((x, y) => String(x.creado_en).localeCompare(String(y.creado_en)));

    // 1) detalle en borrador con S1, S2, P1, P2, P3 → 420 × 2 + 450 × 3 = 2,190.00
    const d1 = await db.rpc<Row>('detalle_facturacion_crear_pruebas', { p_actor: ACTOR, p_componente_ids: ['S1', 'S2', 'P1', 'P2', 'P3'].map(cid), p_notas: null });
    const D1 = String(d1.id);
    ok(r2(d1.total) === 2190 && r2(d1.subtotal) === 1955.36 && r2(d1.iva) === 234.64 && Number(d1.version ?? 1) === 1, `detalle ${d1.correlativo} en borrador: 5 pruebas a tarifa, total ${r2(d1.total)} (base ${r2(d1.subtotal)} + IVA ${r2(d1.iva)})`);

    // 2) ajustar S1 a 245.00 sin IVA (274.40 con IVA) con el motivo de tipo cliente: borrador → recalcula, no sube versión
    const a1 = await ajustar('S1', T.montoSinIvaDe(274.40, 'con_iva'), MOTIVO_CLIENTE);
    const s1 = await comp('S1'); let dr = await detRow(D1);
    ok(!a1.sin_cambio && r2(a1.monto_anterior) === 375 && r2(a1.monto_nuevo) === 245 && r2(s1.monto_ajustado) === 245 && r2(s1.monto_calculado) === 375 && s1.ajuste_motivo === MOTIVO_CLIENTE && s1.ajuste_motivo_cliente === true && s1.ajustado_por === ACTOR && !!s1.ajustado_en
      && r2(dr.total) === 2044.4 && r2(dr.subtotal) === 1825.36 && r2(dr.iva) === 219.04 && Number(dr.version) === 1 && a1.reenviar === false && r2((a1.detalle ?? {}).total) === 2044.4,
      `ajustar S1: 375.00 → 245.00 sin IVA con motivo; el detalle en borrador recalcula a ${r2(dr.total)} (base ${r2(dr.subtotal)} + IVA ${r2(dr.iva)}) y sigue en versión 1`);

    // 3) el sync NO lo pisa: cambia la tarifa (375 → 380 → 375) y el ajuste sigue
    await sync([itemSync(SEEDS[0], 380)]);
    const s1b = await comp('S1');
    await sync([itemSync(SEEDS[0], 375)]);
    const s1c = await comp('S1');
    ok(r2(s1b.monto_calculado) === 380 && r2(s1b.monto_ajustado) === 245 && s1b.ajuste_motivo === MOTIVO_CLIENTE && s1b.ajustado_por === ACTOR && String(s1b.detalle_id) === D1 && r2(s1c.monto_calculado) === 375 && r2(s1c.monto_ajustado) === 245,
      'ajustar → el sync no lo pisa: recalcula monto_calculado (375 → 380 → 375) y deja intactos monto_ajustado, motivo, quién y la reserva en el detalle');

    // 4) enviar (link v1) con la huella que arma la app; el link público muestra 274.40 y el motivo de tipo cliente
    const aPrueba = (x: Row): P => P0({ id: String(x.id), expedienteId: String(x.expediente_id), idExterno: String(x.id_externo), servicio: String(x.servicio), montoCalculado: x.monto_calculado === null ? null : Number(x.monto_calculado), montoAjustado: x.monto_ajustado === null || x.monto_ajustado === undefined ? null : Number(x.monto_ajustado), ajusteMotivo: String(x.ajuste_motivo ?? ''), ajusteMotivoCliente: x.ajuste_motivo_cliente === true, estadoTarifa: x.estado_tarifa as P['estadoTarifa'], situacion: x.situacion as P['situacion'], detalleId: (x.detalle_id as string | null) ?? null, facturaId: (x.factura_id as string | null) ?? null, noFactura: (x.no_factura as string | null) ?? null });
    const expLocal = new Map(insExps.map(e => [String(e.id), E0({ id: String(e.id), idExterno: String(e.id_externo), persona: String(e.persona) })]));
    const docDe = async (detalleId: string) => { const ps = (await comps()).filter(x => String(x.detalle_id) === detalleId).map(aPrueba); const es = [...new Set(ps.map(p => p.expedienteId))].map(id => expLocal.get(id)!); return { ps, es, doc: D.documentoDetalle(es, ps) }; };
    const huellaTs = async (detalleId: string, version: number) => { const { ps, es, doc: dd } = await docDe(detalleId); const persona = new Map(es.map(e => [e.idExterno, e.persona])); const incl = new Set(dd.incluidas.map(l => l.componenteId)); return H.hashDocumento({ correlativo: String(d1.correlativo), version, nit: NIT, lineas: ps.filter(p => incl.has(p.id)).map(p => ({ componenteId: p.id, persona: persona.get(p.idExterno) ?? '', servicio: p.servicio, categoria: p.categoria ?? '', territorio: p.territorio ?? '', monto: C.precioConIva(T.montoEfectivo(p) ?? 0) })), subtotal: dd.subtotal, iva: dd.iva, total: dd.total }); };
    type Contenido = { version: number; subtotal: number | string; iva: number | string; total: number | string; nit: string; correlativo: string; lineas: Array<{ componente_id: string; persona: string | null; servicio: string; categoria: string | null; territorio: string | null; monto: number | string; nota_precio?: string | null }> };
    type Apertura = { estado: string; version?: number; huella?: string; contenido?: Contenido };
    const huellaSql = (ap: Apertura) => H.hashDocumento({ correlativo: ap.contenido!.correlativo, version: Number(ap.version), nit: ap.contenido!.nit, lineas: ap.contenido!.lineas.map(l => ({ componenteId: l.componente_id, persona: l.persona ?? '', servicio: l.servicio, categoria: l.categoria ?? '', territorio: l.territorio ?? '', monto: r2(l.monto) })), subtotal: r2(ap.contenido!.subtotal), iva: r2(ap.contenido!.iva), total: r2(ap.contenido!.total) });
    const emitir = async (version: number) => { const token = createHash('sha256').update(randomBytes(32)).digest('hex'); const huella = await huellaTs(D1, version); const r = await db.rpc<{ detalle: Row; link: Row }>('detalle_link_emitir', { p_actor: ACTOR, p_detalle_id: D1, p_token_hash: token, p_documento_hash: huella, p_destinatarios: ['cliente@pep.example'], p_dias: 30, p_creador_ip_hash: null }); return { token, huella, r }; };
    const abrir = (token: string) => db.rpc<Apertura>('detalle_link_abrir', { p_token_hash: token, p_ip_hash: null, p_dispositivo: null, p_navegador: null });
    const l1 = await emitir(1);
    const ap1 = await abrir(l1.token);
    const linS1 = ap1.contenido?.lineas.find(l => l.componente_id === cid('S1')), linS2 = ap1.contenido?.lineas.find(l => l.componente_id === cid('S2'));
    ok(l1.r.detalle.estado === 'enviada' && Number(l1.r.detalle.version) === 1 && ap1.estado === 'vigente' && r2(linS1?.monto) === 274.4 && linS1?.nota_precio === MOTIVO_CLIENTE && r2(linS2?.monto) === 420 && !linS2?.nota_precio && r2(ap1.contenido?.total) === 2044.4,
      `con IVA 274.40 → 245.00 sin IVA → la línea del link público (la que firma el cliente y va a la FEL) suma ${r2(linS1?.monto).toFixed(2)}, con el motivo «${linS1?.nota_precio ?? ''}»`);
    ok(huellaSql(ap1) === l1.huella && ap1.huella === l1.huella, 'paridad SQL / TS de la huella: el contenido del link (SQL) da la misma huella que el documento que arma la app (TS) con el monto efectivo');

    // 5) detalle ENVIADO: ajustar S2 (motivo interno) → recalcula, sube de versión, revoca el link
    const a2 = await ajustar('S2', 245, MOTIVO_INTERNO);
    dr = await detRow(D1);
    const ap1b = await abrir(l1.token);
    const linksV1 = await db.select('detalle_facturacion_link', { detalle_id: D1 });
    ok(a2.reenviar === true && r2(dr.total) === 1898.8 && r2(dr.subtotal) === 1695.36 && r2(dr.iva) === 203.44 && Number(dr.version) === 2 && dr.estado === 'enviada' && Number((a2.detalle ?? {}).version) === 2,
      `el detalle enviado recalcula su total (2,044.40 → ${r2(dr.total)}; base ${r2(dr.subtotal)} + IVA ${r2(dr.iva)}) y sube de versión (1 → ${dr.version}); la RPC avisa «reenviar»`);
    ok(ap1b.estado === 'nueva_version' && linksV1.length === 1 && !!linksV1[0].revocado_en && /precio especial/.test(String(linksV1[0].revocado_motivo)), 'el link viejo deja de servir para aprobar: quedó revocado y responde «hay una versión nueva» (igual que cuando cambia el contenido)');
    ok((await rechaza(() => db.rpc('detalle_link_responder', { p_token_hash: l1.token, p_respuestas: [], p_firma: null, p_ip: null, p_user_agent: null, p_documento_hash: l1.huella }), /LINK_NUEVA_VERSION/)) === 'ok', 'responder con el link viejo → LINK_NUEVA_VERSION');

    // 6) reenviar (link v2): S2 sale en 274.40 SIN motivo (es interno); S1 conserva el suyo
    const l2 = await emitir(2);
    const ap2 = await abrir(l2.token);
    const l2S2 = ap2.contenido?.lineas.find(l => l.componente_id === cid('S2')), l2S1 = ap2.contenido?.lineas.find(l => l.componente_id === cid('S1'));
    ok(Number(l2.r.detalle.version) === 2 && ap2.estado === 'vigente' && r2(l2S2?.monto) === 274.4 && !l2S2?.nota_precio && l2S1?.nota_precio === MOTIVO_CLIENTE && r2(ap2.contenido?.total) === 1898.8 && huellaSql(ap2) === l2.huella,
      'reenviado en la versión 2: el link nuevo abre, S2 sale en 274.40 y su motivo interno NO sale; la huella SQL = TS');

    // 7) paridad SQL / TS de los totales del detalle (documento, factura) con los dos ajustes
    const p7 = await docDe(D1);
    const fac7 = M.armarFactura(p7.ps.map(p => M.pruebaParaFactura(p, expLocal.get(p.expedienteId)!.persona)), () => 'cc');
    ok(p7.doc.total === r2(dr.total) && p7.doc.subtotal === r2(dr.subtotal) && p7.doc.iva === r2(dr.iva) && fac7.total === r2(dr.total) && fac7.subtotal === r2(dr.subtotal) && fac7.iva === r2(dr.iva) && p7.doc.incluidas.length === 5,
      `paridad SQL / TS de los totales del detalle: SQL ${r2(dr.subtotal)} + ${r2(dr.iva)} = ${r2(dr.total)} · documentoDetalle ${p7.doc.subtotal} + ${p7.doc.iva} = ${p7.doc.total} · armarFactura ${fac7.total}`);

    // 8) quitar el ajuste de S2 vuelve a la tarifa (y, como sigue enviada, sube otra versión)
    const a3 = await ajustar('S2', null, null);
    const s2 = await comp('S2'); dr = await detRow(D1);
    ok(!a3.sin_cambio && r2(a3.monto_anterior) === 245 && r2(a3.monto_nuevo) === 375 && s2.monto_ajustado === null && s2.ajuste_motivo === null && s2.ajuste_motivo_cliente === false && s2.ajustado_por === null && s2.ajustado_en === null && r2(dr.total) === 2044.4 && Number(dr.version) === 3 && a3.reenviar === true && (await abrir(l2.token)).estado === 'nueva_version',
      `quitar el ajuste vuelve a la tarifa: S2 245.00 → 375.00, sin motivo ni autor; el detalle vuelve a ${r2(dr.total)} y sube a la versión ${dr.version}`);

    // 8b) varios ajustes seguidos sin reenviar suben UNA sola versión (las dos líneas de DET-0031 → versión siguiente, no dos más)
    const a3b = await ajustar('S2', 245, MOTIVO_INTERNO); const v3b = Number((await detRow(D1)).version), t3b = r2((await detRow(D1)).total);
    const a3c = await ajustar('S2', null, null); dr = await detRow(D1);
    ok(a3b.reenviar === true && a3c.reenviar === true && v3b === 3 && t3b === 1898.8 && Number(dr.version) === 3 && r2(dr.total) === 2044.4, `varios ajustes seguidos antes de reenviar suben una sola versión: el detalle sigue en la ${dr.version} (totales ${t3b} → ${r2(dr.total)}) y sigue pidiendo reenviar`);

    // 9) sin cambio: mismo monto y motivo no registra nada ni sube versión; quitar donde no hay ajuste tampoco
    const nBit = (await bitacora('S1')).length;
    const a4 = await ajustar('S1', 245, MOTIVO_CLIENTE), a5 = await ajustar('S2', null, null);
    dr = await detRow(D1);
    ok(a4.sin_cambio === true && a5.sin_cambio === true && Number(dr.version) === 3 && (await bitacora('S1')).length === nBit, 'sin cambio (mismo monto y motivo, o quitar donde no hay ajuste): no sube la versión ni ensucia la bitácora');

    // 10) bitácora: quién, cuándo, de cuánto a cuánto, por qué, y el total del detalle antes y después
    const bS1 = await bitacora('S1'), bS2 = await bitacora('S2');
    ok(bS1.length === 1 && r2(bS1[0].monto_anterior) === 375 && r2(bS1[0].monto_nuevo) === 245 && r2(bS1[0].monto_tarifa) === 375 && bS1[0].motivo === MOTIVO_CLIENTE && bS1[0].motivo_cliente === true && bS1[0].actor === ACTOR && String(bS1[0].detalle_id) === D1 && r2(bS1[0].total_anterior) === 2190 && r2(bS1[0].total_nuevo) === 2044.4 && !!bS1[0].creado_en
      && bS2.length === 4 && Number(bS2[2].detalle_version) === 3 && Number(bS2[3].detalle_version) === 3 && r2(bS2[0].monto_nuevo) === 245 && bS2[0].motivo_cliente === false && Number(bS2[0].detalle_version) === 2 && r2(bS2[0].total_nuevo) === 1898.8 && bS2[1].quita_ajuste === true && r2(bS2[1].monto_anterior) === 245 && r2(bS2[1].monto_nuevo) === 375 && Number(bS2[1].detalle_version) === 3,
      'historial: cada ajuste deja quién, cuándo, de cuánto a cuánto, por qué, la versión y el total del detalle antes y después (también al quitarlo)');

    // 11) validaciones de la RPC
    const v = [await rechaza(() => ajustar('P1', 0, MOTIVO_INTERNO), /MONTO_INVALIDO/), await rechaza(() => ajustar('P1', -5, MOTIVO_INTERNO), /MONTO_INVALIDO/), await rechaza(() => ajustar('P1', 300, '  '), /MOTIVO_OBLIGATORIO/), await rechaza(() => ajustar('P1', 300, null), /MOTIVO_OBLIGATORIO/), await rechaza(() => ajustar('T1', 300, MOTIVO_INTERNO), /PRUEBA_SIN_TARIFA/), await rechaza(() => db.rpc('facturacion_componente_ajustar', { p_actor: ACTOR, p_componente_id: '00000000-0000-4000-8000-000000000000', p_monto_sin_iva: 300, p_motivo: MOTIVO_INTERNO }), /PRUEBA_NO_EXISTE/)];
    ok(v.every(x => x === 'ok') && (await comp('P1')).monto_ajustado === null && Number((await detRow(D1)).version) === 3, `la RPC rechaza monto 0 o negativo, motivo vacío, una prueba sin tarifa y una prueba inexistente, sin cambiar nada${v.every(x => x === 'ok') ? '' : ' · ' + v.join(' | ')}`);

    // 12) cola (sin detalle): Q1 con precio especial → Por facturar suma el monto efectivo (paridad SQL / TS)
    const aQ = await ajustar('Q1', 245, MOTIVO_INTERNO, { p_motivo_cliente: true });
    const qRow = await comp('Q1');
    const resumen = await db.rpc<{ grupos: Array<{ nit_resuelto: string; listos: number; total_sin_iva: number | string; total_con_iva: number | string; sin_tarifa: number; en_detalle: number }> }>('facturacion_agenda_resumen', { p_fuente: 'agenda' });
    const g = resumen.grupos.find(x => x.nit_resuelto === NIT);
    const enColaTs = (await comps()).map(aPrueba).filter(p => p.situacion === 'cobra' && !p.facturaId && !p.detalleId && M.conPrecioEfectivo(p));
    const tsSin = r2(enColaTs.reduce((s, p) => s + (T.montoEfectivo(p) ?? 0), 0)), tsCon = r2(enColaTs.reduce((s, p) => s + C.precioConIva(T.montoEfectivo(p) ?? 0), 0));
    ok(aQ.detalle === null && aQ.reenviar === false && qRow.ajuste_motivo_cliente === true && !!g && Number(g.listos) === 3 && Number(g.listos) === enColaTs.length && r2(g.total_sin_iva) === tsSin && r2(g.total_con_iva) === tsCon && tsSin === 1048.58 && tsCon === 1174.4 && Number(g.sin_tarifa) === 1 && Number(g.en_detalle) === 5,
      `Por facturar: una prueba en cola también lleva precio especial (sin detalle que recalcular); paridad SQL / TS de los totales: ${g?.listos} listas, ${r2(g?.total_sin_iva)} sin IVA / ${r2(g?.total_con_iva)} con IVA = TS ${tsSin} / ${tsCon}`);

    // 13) producción (025): lo terminado vale el monto efectivo; la cubierta por paquete, su precio unitario
    const pq = (await db.insert('paquete', [{ nit: NIT, nombre: 'PEP paquete', fecha_inicio: '2026-10-01', estado: 'activo', creado_por: ACTOR, retroactivo_confirmado: true }]))[0];
    const pl = (await db.insert('paquete_linea', [{ paquete_id: pq.id, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', cantidad: 5, precio_unitario: 350 }]))[0];
    await db.insert('paquete_consumo', [{ paquete_linea_id: pl.id, componente_id: cid('K1'), fecha: '2026-10-06T00:00:00Z', creado_por: ACTOR }]);
    const prod = await db.rpc<{ por_cliente: Array<{ nit_resuelto: string | null; terminado_n: number; terminado_q: number | string; cubierta_q: number | string; sin_tarifa_n: number }> }>('facturacion_produccion_mensual', { p_desde: '2026-10-01', p_hasta: '2026-10-31', p_fuente: 'agenda' });
    const pc = prod.por_cliente.find(x => x.nit_resuelto === NIT);
    const esperadoProd = r2((await comps()).map(aPrueba).filter(p => p.estadoTarifa === 'resuelta').reduce((s, p) => s + (p.id === cid('K1') ? 350 : (T.montoEfectivo(p) ?? 0)), 0));
    ok(!!pc && Number(pc.terminado_n) === 9 && r2(pc.terminado_q) === esperadoProd && esperadoProd === 2822.16 && r2(pc.cubierta_q) === 350 && Number(pc.sin_tarifa_n) === 1,
      `producción del mes: terminado ${r2(pc?.terminado_q)} = Σ monto efectivo (S1 y Q1 a 245.00) + la cubierta a su precio unitario (350.00); TS ${esperadoProd}`);

    // 14) rechazos: cubierta por paquete, facturada, detalle aprobado
    const rK = await rechaza(() => ajustar('K1', 300, MOTIVO_INTERNO), /PRUEBA_CUBIERTA_POR_PAQUETE/);
    const fc = (await db.insert('facturas_clientes', [{ airtable_id: `pep${Date.now()}`, no_factura: `${PREFIJO}F-1`, fecha_emision: '2026-11-01', total: 450, iva: 48.21, subtotal: 401.79, estado: 'EMITIDA' }]))[0];
    await db.update('facturacion_componente', { factura_id: fc.id, no_factura: `${PREFIJO}F-1`, facturado_en: '2026-11-01T00:00:00Z' }, { id: cid('F1') });
    const rF = await rechaza(() => ajustar('F1', 300, MOTIVO_INTERNO), /PRUEBA_FACTURADA/);
    await db.update('detalle_facturacion', { estado: 'aprobada', aprobada_en: '2026-11-20T00:00:00Z', aprobado_por: 'Cliente PEP', aprobado_canal: 'correo' }, { id: D1 });
    const rA = await rechaza(() => ajustar('P1', 300, MOTIVO_INTERNO), /DETALLE_APROBADO.*anulá o reabrí el detalle primero/), rA2 = await rechaza(() => ajustar('S1', null, null), /DETALLE_APROBADO/);
    dr = await detRow(D1);
    ok(rK === 'ok' && rF === 'ok' && rA === 'ok' && rA2 === 'ok' && r2(dr.total) === 2044.4 && Number(dr.version) === 3 && r2((await comp('S1')).monto_ajustado) === 245 && (await comp('F1')).monto_ajustado === null && (await comp('K1')).monto_ajustado === null,
      `un detalle aprobado («anulá o reabrí el detalle primero»), una prueba facturada y una cubierta por paquete rechazan el ajuste (y quitarlo), sin cambiar nada${[rK, rF, rA, rA2].every(x => x === 'ok') ? '' : ' · ' + [rK, rF, rA, rA2].join(' | ')}`);

    // 15) armar un detalle nuevo con la prueba ajustada en cola: nace con el monto efectivo
    const d2 = await db.rpc<Row>('detalle_facturacion_crear_pruebas', { p_actor: ACTOR, p_componente_ids: [cid('Q1')], p_notas: null });
    ok(r2(d2.total) === 274.4 && r2(d2.subtotal) === 245 && r2(d2.iva) === 29.4, `armar el detalle con una prueba ya ajustada: nace en ${r2(d2.total)} (245.00 + IVA 29.40)`);

    /* ───────────── D. Solo HIT: la capa de datos de la app ───────────── */
    if (BASE === 'hit') {
      console.log('\nD. HIT · capa de datos de la app');
      const DF = await import('../src/lib/db/detalle-facturacion');
      const FA = await import('../src/lib/db/facturacion-agenda');
      const dApp = await DF.getDetalle(String(d2.id));
      const lq = dApp?.documento.lineas.find(l => l.componenteId === cid('Q1'));
      ok(!!dApp && dApp.documento.total === 274.4 && lq?.monto === 245 && lq?.precioEspecial?.montoTarifa === 375 && lq?.precioEspecial?.motivo === MOTIVO_INTERNO && dApp.ajustes.length === 1 && dApp.ajustes[0].montoAnterior === 375 && dApp.ajustes[0].montoNuevo === 245 && dApp.ajustes[0].actor === ACTOR,
        'getDetalle: la línea trae el monto efectivo, la tarifa que reemplaza, el motivo y el historial de ajustes');
      const rApp = await DF.ajustarPrecioPrueba(cid('Q1'), { monto: 302.40, base: 'con_iva', motivo: 'Cortesía parcial' }, ACTOR);
      const d2b = await detRow(String(d2.id));
      ok(rApp.ok && !rApp.sinCambio && rApp.montoAnterior === 245 && rApp.montoNuevo === 270 && rApp.detalle?.total === 302.4 && r2(d2b.total) === 302.4 && Number(d2b.version) === 1 && !rApp.reenviar && r2((await comp('Q1')).monto_ajustado) === 270 && (await comp('Q1')).ajuste_motivo_cliente === false,
        `ajustarPrecioPrueba con IVA 302.40 → guarda 270.00 sin IVA; el detalle en borrador queda en ${r2(d2b.total)} sin subir versión; «Cortesía parcial» es interno por defecto`);
      const rMal = [await DF.ajustarPrecioPrueba(cid('Q1'), { monto: 0, motivo: 'x y z' }, ACTOR), await DF.ajustarPrecioPrueba(cid('Q1'), { monto: 100, motivo: '' }, ACTOR), await DF.ajustarPrecioPrueba(cid('F1'), { monto: 100, motivo: MOTIVO_INTERNO }, ACTOR), await DF.ajustarPrecioPrueba(cid('P1'), { monto: 100, motivo: MOTIVO_INTERNO }, ACTOR)];
      ok(rMal.every(r => !r.ok) && /mayor a 0/.test((rMal[0] as { error: string }).error) && /motivo/.test((rMal[1] as { error: string }).error) && /ya está facturada/.test((rMal[2] as { error: string }).error) && /anulá o reabrí el detalle primero/.test((rMal[3] as { error: string }).error), 'la app devuelve mensajes legibles: monto 0, sin motivo, prueba facturada y detalle aprobado («anulá o reabrí el detalle primero»)');
      const rQuita = await DF.ajustarPrecioPrueba(cid('Q1'), { monto: null }, ACTOR);
      const exps = await FA.listarExpedientesLocal({ nit: NIT });
      const pQ = exps.flatMap(e => e.pruebas).find(p => p.id === cid('Q1')), pS1 = exps.flatMap(e => e.pruebas).find(p => p.id === cid('S1'));
      ok(rQuita.ok && rQuita.montoNuevo === 375 && rQuita.detalle?.total === 420 && pQ?.montoAjustado === null && T.montoEfectivo(pQ!) === 375 && pS1?.montoAjustado === 245 && pS1?.ajusteMotivo === MOTIVO_CLIENTE && pS1?.ajusteMotivoCliente === true && T.montoEfectivo(pS1!) === 245,
        'quitar por la app vuelve a la tarifa (detalle en 420.00) y listarExpedientesLocal trae el ajuste de cada prueba (rowToPrueba)');
    }
  } catch (e) {
    ok(false, `el escenario se cortó: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (BASE === 'hit') ok((await limpiar()) === 0, 'limpieza: HIT queda sin datos PEP (expedientes, pruebas, bitácora, detalles, links, paquete, factura)');
  }

  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})();
