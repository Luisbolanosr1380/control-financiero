/**
 * TARIFARIO · Normalización a las FORMAS DE PRECIO (canon.ts).
 *
 * Las tarifas de servicios de precio único (INFORNET) o por territorio (SOCIO
 * EMPRESARIAL) que quedaron con categoría/territorio "de matriz" (p. ej.
 * INFORNET · PRE EMPLEO · METROPOLITANA, o categoría 'INFORNET') se llevan al
 * centinela: categoria = 'UNICA' (y territorio = 'UNICA' para único). Por cada
 * NIT + tipo (+ territorio si aplica) se deja UNA fila activa (se prefiere la
 * aprobada; si no, la más vieja) y las demás se DESACTIVAN (nunca se borra:
 * queda el histórico). Si las filas del grupo tienen montos distintos es un
 * conflicto: se reporta y no se toca (igual que los conflictos del tarifario).
 *
 * Dry-run por defecto. Uso:
 *   npx tsx scripts/normalizar-tarifas-formas.ts [--base golden|hit] [--aplicar]
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'golden').toLowerCase();
const APLICAR = process.argv.includes('--aplicar');
const envFile = BASE === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (BASE === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
const ACTOR = 'normalizacion-formas@tarifario';

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const { getTarifario, activarTarifa } = await import('../src/lib/db/tarifario');
  const { formaPrecio, llaveEfectiva, llaveTarifa, canonCategoria, canonTerritorio } = await import('../src/lib/tarifario/canon');
  const sb = supabase()!;
  const todas = await getTarifario();
  const candidatas = todas.filter(t => t.activo && formaPrecio(t.tipoPrueba) !== 'matriz');
  const grupos = new Map<string, typeof candidatas>();
  for (const t of candidatas) { const k = llaveTarifa(t); grupos.set(k, [...(grupos.get(k) ?? []), t]); }
  console.log(`\nNormalización de formas de precio · ${BASE.toUpperCase()} · ${APLICAR ? 'APLICANDO' : 'dry-run'}`);
  console.log(`  ${candidatas.length} tarifa(s) activa(s) de servicios único / por territorio en ${grupos.size} llave(s) efectiva(s)\n`);
  let cambios = 0, desactivadas = 0, conflictos = 0, enOrden = 0;
  for (const [k, filas] of grupos) {
    const e = llaveEfectiva(filas[0]);
    const yaBien = filas.length === 1 && canonCategoria(filas[0].categoria) === e.categoria && canonTerritorio(filas[0].territorio) === e.territorio;
    if (yaBien) { enOrden++; continue; }
    const montos = [...new Set(filas.map(f => Number(f.monto)))];
    const etiqueta = `${filas[0].razonSocial || filas[0].nit} · ${e.tipoPrueba}${e.territorio !== 'UNICA' ? ' · ' + e.territorio : ''}`;
    if (montos.length > 1) {
      conflictos++;
      console.log(`  ⚠ CONFLICTO ${etiqueta}: ${filas.map(f => `${f.categoria}/${f.territorio} Q${f.monto.toFixed(2)}`).join(' · ')} → no se toca; dejá un solo precio a mano.`);
      continue;
    }
    const orden = [...filas].sort((a, b) => (b.aprobadoEn ? 1 : 0) - (a.aprobadoEn ? 1 : 0) || a.id.localeCompare(b.id));
    const [principal, ...resto] = orden;
    console.log(`  → ${etiqueta}: Q${principal.monto.toFixed(2)} · ${principal.categoria}/${principal.territorio} → ${e.categoria}/${e.territorio}${resto.length ? ` · desactivar ${resto.length}: ${resto.map(f => `${f.categoria}/${f.territorio}`).join(', ')}` : ''}`);
    cambios++; desactivadas += resto.length;
    if (!APLICAR) continue;
    // 1) desactivar duplicadas (por la RPC → bitácora 'desactivacion'); 2) mover la principal a la llave efectiva (UPDATE directo: no cambia monto → sin renglón de bitácora)
    for (const f of resto) { const r = await activarTarifa(f.id, false, ACTOR); if (!r.ok) console.log(`     ✗ desactivar ${f.id}: ${r.error}`); }
    const { error } = await sb.from('tarifario').update({ categoria: e.categoria, territorio: e.territorio, updated_at: new Date().toISOString() }).eq('id', principal.id);
    if (error) console.log(`     ✗ ${principal.id}: ${error.message}`);
    void k;
  }
  console.log(`\n  ${enOrden} llave(s) ya en orden · ${cambios} a normalizar · ${desactivadas} fila(s) duplicada(s) a desactivar · ${conflictos} conflicto(s)${APLICAR ? ' · APLICADO' : ' · (dry-run: nada escrito; agregá --aplicar)'}\n`);
  process.exit(conflictos ? 2 : 0);
})().catch(e => { console.error(e); process.exit(1); });
