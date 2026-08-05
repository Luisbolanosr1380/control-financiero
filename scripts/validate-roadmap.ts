/**
 * F-ROADMAP — semilla + validador del tablero de prioridades.
 *
 * PRERREQUISITO: correr supabase/06_roadmap.sql en el SQL Editor.
 * Uso: npx tsx scripts/validate-roadmap.ts
 *
 * (1) Si la tabla está vacía, carga la SEMILLA (el roadmap actual).
 * (2) Valida CRUD completo con un ítem TEST y lo limpia al final.
 * Idempotente: la semilla no se duplica (matchea por título).
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); if (!(k in process.env)) process.env[k.trim()] = r.join('=').trim();
}

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  🟢 ${msg}`); } else { fail++; console.log(`  🔴 ${msg}`); } };

type Semilla = { titulo: string; categoria: string; estado: 'Pendiente' | 'Hecho'; prioridad?: 'Alta' | 'Media' | 'Baja'; impacto?: string; notas?: string; orden: number };

const SEMILLA: Semilla[] = [
  // ── HECHO ──
  { titulo: 'Migración completa Airtable → Supabase (Capas 1 y 2)', categoria: 'General', estado: 'Hecho', orden: 10, impacto: '27 tablas, 9 operaciones de escritura, adjuntos en Storage — la app vive sin Airtable.' },
  { titulo: 'Motor Estado de Resultados (F-058)', categoria: 'Contable', estado: 'Hecho', orden: 20 },
  { titulo: 'Balance General + comprobación (F-059)', categoria: 'Contable', estado: 'Hecho', orden: 30 },
  { titulo: 'Motor de depreciación (F-057)', categoria: 'Contable', estado: 'Hecho', orden: 40 },
  { titulo: 'Asiento de planilla (F-056.2)', categoria: 'Contable', estado: 'Hecho', orden: 50, notas: 'Flag GENERAR_ASIENTO_PLANILLA off — espera validación del contador.' },
  { titulo: 'Alta de clientes / bancos / centros de costo', categoria: 'Facturación/Cobros', estado: 'Hecho', orden: 60 },
  { titulo: 'Creador inteligente de cuentas contables', categoria: 'Contable', estado: 'Hecho', orden: 70 },
  { titulo: 'Pendientes de cobro + aging', categoria: 'Facturación/Cobros', estado: 'Hecho', orden: 80 },
  { titulo: 'Bitácora de gestión de cobro', categoria: 'Facturación/Cobros', estado: 'Hecho', orden: 90, notas: 'Código listo; correr supabase/05_cobranza.sql + validate-cobranza.ts.' },
  { titulo: 'Fix UI columna Línea (pendientes de cobro)', categoria: 'Facturación/Cobros', estado: 'Hecho', orden: 100 },
  // ── PENDIENTE · Contable ──
  { titulo: 'Reunión con el contador (documento listo)', categoria: 'Contable', estado: 'Pendiente', prioridad: 'Alta', orden: 10, impacto: 'Desbloquea los asientos automáticos y la contabilidad formal completa.' },
  { titulo: 'Cargar saldos de apertura → Balance cuadra', categoria: 'Contable', estado: 'Pendiente', orden: 20 },
  { titulo: 'Prender flags de asientos tras validación del contador', categoria: 'Contable', estado: 'Pendiente', orden: 30 },
  { titulo: 'Cargar operación real (gastos, activos fijos)', categoria: 'Contable', estado: 'Pendiente', orden: 40 },
  // ── PENDIENTE · Multi-empresa ──
  { titulo: 'Migraciones versionadas (molde replicable)', categoria: 'Multi-empresa', estado: 'Pendiente', orden: 10 },
  { titulo: 'Semilla plan de cuentas base', categoria: 'Multi-empresa', estado: 'Pendiente', orden: 20 },
  { titulo: 'Bootstrap "nueva empresa"', categoria: 'Multi-empresa', estado: 'Pendiente', orden: 30 },
  { titulo: 'Abrir las 3 empresas', categoria: 'Multi-empresa', estado: 'Pendiente', orden: 40 },
  { titulo: 'Consolidado del grupo (solo hermanas)', categoria: 'Multi-empresa', estado: 'Pendiente', orden: 50 },
  // ── PENDIENTE · otros ──
  { titulo: 'F-AYUDA-CATCHUP (poner al día el centro de ayuda)', categoria: 'Ayuda', estado: 'Pendiente', orden: 10, notas: '2026-08-05: 8 artículos nuevos creados (catchup + gestión de cobro + creador de cuentas) — revisar si falta algo y cerrar.' },
  { titulo: 'Subcuentas de gasto (limpieza, renta, etc.)', categoria: 'Gastos', estado: 'Pendiente', orden: 10, notas: 'Cuando haya gastos reales cargados.' },
  { titulo: 'Anular fila basura rec05Dc7HW41R2tck', categoria: 'Facturación/Cobros', estado: 'Pendiente', prioridad: 'Baja', orden: 20, notas: 'Factura PENDIENTE con total Q0, sin número ni fecha — excluida de la vista de pendientes.' },
  // ── FINANCIERO (alta prioridad, impacto real) ──
  { titulo: 'Reperfilar Q2.35M de deuda cara (tarjetas + factoraje)', categoria: 'Financiero', estado: 'Pendiente', prioridad: 'Alta', orden: 1, impacto: 'Ahorro de intereses — la decisión de mayor valor del año.' },
  { titulo: 'Formalizar mutuo de Mónica (Q2.6M exposición socios)', categoria: 'Financiero', estado: 'Pendiente', prioridad: 'Alta', orden: 2, impacto: 'Formaliza la mayor exposición con partes relacionadas.' },
];

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase();
  if (!sb) { console.error('Supabase no configurado'); process.exit(1); }

  // 0. ¿Existe la tabla? (GET, no HEAD — HEAD 404 no reporta error)
  const { error: errTabla } = await sb.from('roadmap_items').select('id').limit(1);
  if (errTabla) {
    console.error(`✗ La tabla roadmap_items no existe todavía: ${errTabla.message}`);
    console.error('  → Corré supabase/06_roadmap.sql en el SQL Editor y volvé a correr este script.');
    process.exit(1);
  }
  console.log('0. Tabla roadmap_items existe 🟢');

  const { crearRoadmapItem, editarRoadmapItem, getRoadmapItems } = await import('../src/lib/db/roadmap');

  // 1. Semilla (idempotente por título)
  console.log('1. Semilla');
  const existentes = await getRoadmapItems();
  const titulos = new Set(existentes.map(i => i.titulo));
  let sembrados = 0;
  for (const s of SEMILLA) {
    if (titulos.has(s.titulo)) continue;
    const r = await crearRoadmapItem({
      titulo: s.titulo, categoria: s.categoria, estado: s.estado,
      prioridad: s.prioridad ?? 'Media', impacto: s.impacto, notas: s.notas, orden: s.orden,
    });
    if (r.ok) sembrados++;
    else console.log(`  🔴 semilla "${s.titulo}": ${r.error}`);
  }
  const trasSemilla = await getRoadmapItems();
  ok(trasSemilla.length >= SEMILLA.length, `semilla cargada: ${sembrados} nuevos, ${trasSemilla.length} totales (${SEMILLA.length} esperados mínimo)`);
  ok(trasSemilla.filter(i => i.estado === 'Hecho').every(i => !!i.fechaHecho), 'los Hecho de la semilla tienen fecha_hecho sellada');
  const altas = trasSemilla.filter(i => i.prioridad === 'Alta' && i.estado === 'Pendiente');
  ok(altas.length >= 3, `alta prioridad pendiente: ${altas.length} (financiero ×2 + reunión contador)`);

  // 2. CRUD con ítem TEST
  console.log('2. CRUD');
  const MARCA = `TEST-ROADMAP-${process.hrtime.bigint()}`;
  const c = await crearRoadmapItem({ titulo: MARCA, categoria: 'General', estado: 'Idea', prioridad: 'Baja' });
  ok(c.ok, `crear → ${c.ok ? c.itemId : c.error}`);
  if (!c.ok) process.exit(1);
  const e1 = await editarRoadmapItem(c.itemId, { notas: 'primera nota', prioridad: 'Alta', fechaObjetivo: '2026-09-30' });
  ok(e1.ok, 'editar (notas + prioridad + fecha objetivo)');
  const e2 = await editarRoadmapItem(c.itemId, { estado: 'En progreso' });
  ok(e2.ok, 'cambiar estado → En progreso');
  let item = (await getRoadmapItems()).find(i => i.id === c.itemId);
  ok(item?.estado === 'En progreso' && item?.notas === 'primera nota' && item?.prioridad === 'Alta', 'persiste en Supabase');
  ok(!item?.fechaHecho, 'sin fecha_hecho mientras no está Hecho');

  // 3. Marcar Hecho sella la fecha
  console.log('3. Sello de Hecho');
  await editarRoadmapItem(c.itemId, { estado: 'Hecho' });
  item = (await getRoadmapItems()).find(i => i.id === c.itemId);
  ok(!!item?.fechaHecho, `fecha_hecho sellada (${item?.fechaHecho?.slice(0, 10)})`);
  const sello = item?.fechaHecho;
  await editarRoadmapItem(c.itemId, { notas: 'nota posterior' });
  item = (await getRoadmapItems()).find(i => i.id === c.itemId);
  ok(item?.fechaHecho === sello, 'editar después NO re-sella la fecha');
  await editarRoadmapItem(c.itemId, { estado: 'Pendiente' });
  item = (await getRoadmapItems()).find(i => i.id === c.itemId);
  ok(!item?.fechaHecho, 'salir de Hecho limpia el sello');

  // 4. Descartar (no borrar)
  console.log('4. Descartado');
  await editarRoadmapItem(c.itemId, { estado: 'Descartado' });
  item = (await getRoadmapItems()).find(i => i.id === c.itemId);
  ok(item?.estado === 'Descartado', 'queda registrado como Descartado (no se borra)');
  const invalido = await editarRoadmapItem(c.itemId, { estado: 'Inventado' as never });
  ok(!invalido.ok, `estado inválido rechazado: ${!invalido.ok ? invalido.error : ''}`);

  // 5. Limpieza del TEST (solo el ítem de prueba; la semilla queda)
  console.log('5. Limpieza');
  const { error: delErr } = await sb.from('roadmap_items').delete().eq('airtable_id', c.itemId);
  ok(!delErr, 'ítem TEST borrado (la semilla queda)');

  console.log(`\n${fail === 0 ? '✓ F-ROADMAP VERDE' : '✗ FALLARON CHECKS'} — ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
