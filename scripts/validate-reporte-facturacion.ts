/**
 * F-REPORTE-FACTURACION — seed + validación del reporte de facturación emitida.
 *
 * Uso: npx tsx scripts/validate-reporte-facturacion.ts
 *
 * (1) Seed idempotente: artículo del centro de ayuda (por slug) + ítem
 *     de roadmap (por título).
 * (2) Valida que el motor del reporte (getFacturasReporte + filtrarReporte)
 *     cuadre contra agregados SQL directos de Supabase:
 *     total histórico, un cliente, un centro de costo, un trimestre, y
 *     la coherencia interna de las 4 agrupaciones.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); if (!(k in process.env)) process.env[k.trim()] = r.join('=').trim();
}

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  🟢 ${msg}`); } else { fail++; console.log(`  🔴 ${msg}`); } };
const aprox = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

const SLUG_ARTICULO = 'reporte-de-facturacion-informes-por-cliente-linea-y-periodo';
const TITULO_ROADMAP = 'Reporte de facturación emitida (informes por cliente/línea/período)';

const CONTENIDO_ARTICULO = `## Qué es

El **Reporte de Facturación** (menú Operación → Reporte Facturación) genera informes de la facturación **emitida** — es decir, de ventas. Responde preguntas como "¿cuánto le facturamos a Génesis este trimestre?" o "¿cuánto facturó Poligrafía en el año?", para entregar a clientes, gerentes y socios.

**Importante:** es distinto de *Pendientes de cobro*. Acá se mide lo FACTURADO (cada factura cuenta por su total, en su mes de emisión); allá se persigue lo que falta cobrar. Las facturas **anuladas y refacturadas quedan excluidas** de los totales (se indican aparte), para no doble-contar.

## Filtros (combinables)

- **Período**: presets rápidos (Este mes, Mes anterior, Este trimestre, Este año, Año anterior, Histórico), un mes específico, o un rango de fechas desde/hasta para trimestres o períodos custom.
- **Cliente**: uno o varios, con buscador (para "el reporte de un cliente").
- **Línea de negocio / centro de costo**: Poligrafía, Socioeconómicos, TalentTrack, etc. Una factura con líneas de varios centros aporta a cada uno solo su porción.
- **Estado** (opcional): solo cobradas, solo por cobrar o solo pendientes.

Arriba siempre se ven los totales del filtro: total facturado (con subtotal e IVA), número de facturas, ticket promedio y la variación % contra el período igual anterior.

## Las 4 vistas

1. **Por cliente** — ranking de clientes con su total, número de facturas y % de participación. Con gráfico de top 10.
2. **Por línea** — cuánto facturó cada centro de costo, con su mezcla en gráfico.
3. **Por mes** — evolución mensual en tabla y gráfico de barras, con Δ% mes a mes.
4. **Detalle** — la lista de facturas que respalda los totales: número, fecha, cliente, centro, subtotal, IVA, total y estado.

Las 4 vistas siempre cuadran entre sí: son el mismo total agrupado distinto.

## Exportar y entregar

- **Exportar CSV** descarga la vista activa con los filtros aplicados, lista para abrir en Excel (acentos incluidos).
- **Imprimir** usa el encabezado en pantalla (período + filtros) como carátula — desde ahí se puede guardar como PDF para entregar formal.

## Auros

Podés pedirle el reporte al asistente directamente: *"¿cuánto le facturamos a Génesis en el Q2?"*, *"¿cuánto facturó TalentTrack este año?"* — usa el mismo motor que esta pantalla.`;

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase();
  if (!sb) { console.error('Supabase no configurado'); process.exit(1); }

  /* ── 1. Seed centro de ayuda ─────────────────────────────────── */
  console.log('1. Artículo del centro de ayuda');
  const { getArticulos, crearArticulo } = await import('../src/lib/db/ayuda');
  const articulos = await getArticulos({ soloActivos: false });
  if (articulos.some(a => a.slug === SLUG_ARTICULO)) {
    ok(true, 'ya existe (idempotente)');
  } else {
    const r = await crearArticulo({
      titulo: 'Reporte de facturación — informes por cliente, línea y período',
      slug: SLUG_ARTICULO,
      categoria: 'Reportes',
      descripcionCorta:
        'Cómo generar informes de facturación filtrando por mes o rango de fechas, por cliente o por línea de negocio, y exportarlos para clientes, gerentes y socios.',
      contenido: CONTENIDO_ARTICULO,
      orden: 20,
      tagsContextuales: ['reportes', 'facturación', 'ventas', 'informes', 'exportar'],
    }, 'sistema@controlfinanciero');
    ok(r.ok, r.ok ? `creado (${r.articuloId})` : `falló: ${r.error}`);
  }

  /* ── 2. Seed roadmap ─────────────────────────────────────────── */
  console.log('2. Ítem de roadmap');
  const { getRoadmapItems, crearRoadmapItem } = await import('../src/lib/db/roadmap');
  const items = await getRoadmapItems();
  if (items.some(i => i.titulo === TITULO_ROADMAP)) {
    ok(true, 'ya existe (idempotente)');
  } else {
    const r = await crearRoadmapItem({
      titulo: TITULO_ROADMAP,
      categoria: 'Facturación/Cobros',
      estado: 'Hecho',
      orden: 110,
      impacto: 'Informes de ventas por cliente/línea/período con export CSV — responde los pedidos de socios y gerentes sin Excel manual.',
      notas: 'Vista /reportes/facturacion + Auros tool getReporteFacturacion + artículo de ayuda.',
    });
    ok(r.ok, r.ok ? `creado (${r.ok ? r.itemId : ''})` : `falló: ${'error' in r ? r.error : ''}`);
  }

  /* ── 3. Validación de números vs SQL directo ─────────────────── */
  console.log('3. Motor del reporte vs agregados SQL');
  const { getFacturasReporte } = await import('../src/lib/db/facturas');
  const { filtrarReporte, totalesReporte, reportePorCliente, reportePorCentroCosto, reportePorMes } =
    await import('../src/lib/facturacion/reporte');

  // SQL crudo: excluye ANULADO/REFACTURADO (con trim por los trailing spaces).
  // fetchAll pagina — .select() directo trunca en 1000 filas (default PostgREST).
  const { fetchAll } = await import('../src/lib/supabase/client');
  const crudas = await fetchAll<Record<string, unknown>>('facturas_clientes', {
    select: 'no_factura, cliente_id, centro_costo_id, fecha_emision, total, estado',
  });
  type Cruda = { no_factura: string | null; cliente_id: string | null; centro_costo_id: string | null; fecha_emision: string | null; total: number | null; estado: string | null };
  const esAnulada = (e: string | null) => {
    const s = (e ?? '').toUpperCase().trim();
    return s === 'ANULADO' || s === 'ANULADA' || s === 'REFACTURADO' || s === 'REFACTURADA';
  };
  const emitidas = (crudas as Cruda[]).filter(r => !esAnulada(r.estado));
  const sqlTotal = emitidas.reduce((s, r) => s + Number(r.total ?? 0), 0);

  const facturas = await getFacturasReporte();
  const { filtradas } = filtrarReporte(facturas, {});
  const tot = totalesReporte(filtradas);

  ok(aprox(tot.totalQ, sqlTotal), `total histórico: motor ${tot.totalQ.toFixed(2)} = SQL ${sqlTotal.toFixed(2)} (${emitidas.length} líneas crudas)`);
  const lineasMotor = filtradas.reduce((s, x) => s + x.f.numLineas, 0);
  ok(lineasMotor === emitidas.length, `líneas crudas: motor ${lineasMotor} = SQL ${emitidas.length}`);
  console.log(`     (facturas consolidadas: ${tot.numFacturas} · ticket promedio Q${tot.ticketPromedioQ.toFixed(2)})`);

  // Coherencia interna: las 4 agrupaciones suman el mismo total.
  const porCli = reportePorCliente(filtradas);
  const porCC = reportePorCentroCosto(filtradas);
  const porMes = reportePorMes(filtradas);
  const sum = (xs: Array<{ montoQ: number }>) => xs.reduce((s, x) => s + x.montoQ, 0);
  ok(aprox(sum(porCli), tot.totalQ), `Σ por cliente = total (${sum(porCli).toFixed(2)})`);
  ok(aprox(sum(porCC), tot.totalQ), `Σ por centro de costo = total (${sum(porCC).toFixed(2)})`);
  ok(aprox(sum(porMes), tot.totalQ), `Σ por mes = total (${sum(porMes).toFixed(2)})`);

  // Cliente top 1: motor vs SQL (por uuid → el motor usa airtable_id, mapear).
  const { data: mapaCli } = await sb.from('clientes').select('id, airtable_id, nombre_empresa');
  const uuidToApp = new Map((mapaCli ?? []).map(c => [String(c.id), String(c.airtable_id)]));
  const top = porCli[0];
  if (top) {
    const sqlCliente = emitidas
      .filter(r => uuidToApp.get(String(r.cliente_id ?? '')) === top.key)
      .reduce((s, r) => s + Number(r.total ?? 0), 0);
    const nombreTop = (mapaCli ?? []).find(c => String(c.airtable_id) === top.key)?.nombre_empresa ?? top.key;
    ok(aprox(top.montoQ, sqlCliente), `cliente top "${nombreTop}": motor ${top.montoQ.toFixed(2)} = SQL ${sqlCliente.toFixed(2)}`);
  }

  // Centro de costo top 1: motor vs SQL.
  const { data: mapaCC } = await sb.from('centros_costo').select('id, airtable_id, nombre');
  const uuidToAppCC = new Map((mapaCC ?? []).map(c => [String(c.id), String(c.airtable_id)]));
  const topCC = porCC[0];
  if (topCC) {
    const sqlCC = emitidas
      .filter(r => uuidToAppCC.get(String(r.centro_costo_id ?? '')) === topCC.key)
      .reduce((s, r) => s + Number(r.total ?? 0), 0);
    const nombreCC = (mapaCC ?? []).find(c => String(c.airtable_id) === topCC.key)?.nombre ?? topCC.key;
    const { filtradas: soloCC } = filtrarReporte(facturas, { centroCostoIds: [topCC.key] });
    const totCC = totalesReporte(soloCC);
    ok(aprox(topCC.montoQ, sqlCC), `CC top "${nombreCC}" (agrupación): motor ${topCC.montoQ.toFixed(2)} = SQL ${sqlCC.toFixed(2)}`);
    ok(aprox(totCC.totalQ, sqlCC), `CC top "${nombreCC}" (filtro): motor ${totCC.totalQ.toFixed(2)} = SQL ${sqlCC.toFixed(2)}`);
  }

  // Rango trimestral (Q2 del año en curso de los datos: tomar el trimestre del último mes con datos).
  const mesesConDatos = porMes.map(g => g.key).filter(Boolean);
  const ultimoMes = mesesConDatos[mesesConDatos.length - 1];
  if (ultimoMes) {
    const y = Number(ultimoMes.slice(0, 4));
    const q0 = Math.floor((Number(ultimoMes.slice(5, 7)) - 1) / 3) * 3 + 1;
    const desde = `${y}-${String(q0).padStart(2, '0')}-01`;
    const mFin = q0 + 2;
    const hasta = `${y}-${String(mFin).padStart(2, '0')}-${new Date(y, mFin, 0).getDate()}`;
    const sqlTrim = emitidas
      .filter(r => { const f = (r.fecha_emision ?? '').slice(0, 10); return f >= desde && f <= hasta; })
      .reduce((s, r) => s + Number(r.total ?? 0), 0);
    const { filtradas: trim } = filtrarReporte(facturas, { desde, hasta });
    const totTrim = totalesReporte(trim);
    ok(aprox(totTrim.totalQ, sqlTrim), `trimestre ${desde} → ${hasta}: motor ${totTrim.totalQ.toFixed(2)} = SQL ${sqlTrim.toFixed(2)}`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})();
