#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FASE MOLDE · Pieza 2 — Generador del seed del plan de cuentas base.

LEE (solo lectura) el catálogo contable de la base indicada en .env.local
(cuentas, centros de costo, mapeos ER/BS con sus puentes) y escribe
supabase/seeds/seed_plan_cuentas_base.sql — SIN datos transaccionales.

El seed generado:
  - Es IDEMPOTENTE: solo siembra si `cuentas` está vacía (DO block).
  - Usa airtable_id DETERMINÍSTICOS ('cta-<codigo>', 'cc-<slug>', …).
    ¿Por qué no NULL? La capa de ids de la app (id-bridge, pseudo-records)
    usa airtable_id como id público — con NULL la edición desde la UI no
    matchea (el bug que rompió el roadmap el 2026-08-27). Determinístico
    = estable entre empresas y sin colisiones.
  - Marca con comentario ⚠ las cuentas específicas de Golden (intercompany
    HIT/Poligrafy/BYDSA) para que el usuario decida si van en el molde.

Uso: python3 scripts/generar-seed-plan-cuentas.py
NO ejecuta nada contra ninguna base — solo lee y escribe el archivo.
"""

import json
import re
import unicodedata
from pathlib import Path
from supabase import create_client

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / 'supabase' / 'seeds' / 'seed_plan_cuentas_base.sql'

ENV = {}
for line in open(RAIZ / '.env.local'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        ENV[k.strip()] = v.strip().strip('"')

SB = create_client(ENV['SUPABASE_URL'], ENV['SUPABASE_SERVICE_KEY'])

# Palabras que delatan cuentas específicas de Golden (se marcan, NO se quitan).
MARCAS_GOLDEN = ('HIT', 'POLIGRAFY', 'BYDSA', 'INTERCOMP', 'GOLDEN')


def allrows(tabla: str, sel: str):
    out, page = [], 0
    while True:
        d = SB.table(tabla).select(sel).range(page * 1000, page * 1000 + 999).execute().data
        out += d
        if len(d) < 1000:
            return out
        page += 1


def q(v) -> str:
    """Literal SQL seguro (NULL, boolean, número o texto escapado)."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def slug(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:40]


def main() -> None:
    cuentas = sorted(
        allrows('cuentas', 'codigo_path,nombre,nivel,parent_path,numero_orden,'
                           'naturaleza_bs,naturaleza_er,tipo_estado,descripcion,observaciones,activo'),
        key=lambda c: [int(x) for x in c['codigo_path'].split('-')])
    centros = sorted(allrows('centros_costo', 'nombre,codigo_cc,naturaleza,activo,observaciones'),
                     key=lambda c: c['nombre'])
    mapeos = {}
    for tabla in ('mapeo_er', 'mapeo_bs'):
        filas = sorted(
            allrows(tabla, f'linea,orden,tipo,signo,prefijos,cuentas:{tabla}_cuentas(cuenta:cuentas(codigo_path))'),
            key=lambda m: (m['orden'] or 0))
        for m in filas:
            m['codigos'] = sorted(x['cuenta']['codigo_path'] for x in (m.pop('cuentas') or []) if x.get('cuenta'))
        mapeos[tabla] = filas

    L: list[str] = []
    w = L.append
    w('-- ============================================================')
    w('-- SEED · Plan de cuentas base (FASE MOLDE · Pieza 2)')
    w('-- Generado por scripts/generar-seed-plan-cuentas.py — NO editar a mano;')
    w('-- regenerar desde la base de referencia si el catálogo cambia.')
    w('--')
    w(f'-- Contenido: {len(cuentas)} cuentas · {len(centros)} centros de costo · '
      f'{len(mapeos["mapeo_er"])} líneas ER · {len(mapeos["mapeo_bs"])} líneas BS.')
    w('-- Sin datos transaccionales. IDEMPOTENTE: solo siembra si cuentas está vacía.')
    w('-- airtable_id determinísticos (la capa de ids de la app los requiere; ver')
    w('-- encabezado del generador). Cuentas específicas de Golden marcadas con ⚠.')
    w('-- ============================================================')
    w('')
    w('do $seed$')
    w('begin')
    w('  if exists (select 1 from cuentas limit 1) then')
    w("    raise notice 'seed_plan_cuentas_base: la tabla cuentas ya tiene datos — seed omitido';")
    w('    return;')
    w('  end if;')
    w('')
    w('  -- ── Plan de cuentas (pass 1: filas; parent por codigo_path en pass 2) ──')
    for c in cuentas:
        golden = any(m in (c['nombre'] or '').upper() for m in MARCAS_GOLDEN)
        marca = '  -- ⚠ específica de Golden (intercompany): revisar si va en el molde base' if golden else ''
        w(f"  insert into cuentas (airtable_id, codigo_path, nombre, nivel, parent_path, numero_orden,"
          f" naturaleza_bs, naturaleza_er, tipo_estado, descripcion, observaciones, activo) values"
          f" ({q('cta-' + c['codigo_path'])}, {q(c['codigo_path'])}, {q(c['nombre'])}, {q(c['nivel'])},"
          f" {q(c['parent_path'])}, {q(c['numero_orden'])}, {q(c['naturaleza_bs'])}, {q(c['naturaleza_er'])},"
          f" {q(c['tipo_estado'])}, {q(c['descripcion'])}, {q(c['observaciones'])}, {q(c['activo'])});{marca}")
    w('')
    w('  -- pass 2: resolver la jerarquía')
    w('  update cuentas hija set parent_id = padre.id')
    w('    from cuentas padre')
    w('   where hija.parent_path is not null and padre.codigo_path = hija.parent_path;')
    w('')
    w('  -- ── Centros de costo ──')
    w('  -- ⚠ Las líneas de negocio son de Golden (Poligrafía/Socio/TT…): una empresa')
    w('  -- nueva probablemente las reemplace — se siembran como punto de partida.')
    for c in centros:
        w(f"  insert into centros_costo (airtable_id, nombre, codigo_cc, naturaleza, activo, observaciones) values"
          f" ({q('cc-' + slug(c['nombre']))}, {q(c['nombre'])}, {q(c['codigo_cc'])}, {q(c['naturaleza'])},"
          f" {q(c['activo'])}, {q(c['observaciones'])});")
    for tabla, prefijo in (('mapeo_er', 'mer'), ('mapeo_bs', 'mbs')):
        w('')
        w(f'  -- ── {tabla} (estructura del reporte) + puente a cuentas por codigo_path ──')
        for m in mapeos[tabla]:
            at = f"{prefijo}-{m['orden'] or slug(m['linea'])}"
            w(f"  insert into {tabla} (airtable_id, linea, orden, tipo, signo, prefijos) values"
              f" ({q(at)}, {q(m['linea'])}, {q(m['orden'])}, {q(m['tipo'])}, {q(m['signo'])}, {q(m['prefijos'])});")
            if m['codigos']:
                lista = ', '.join(q(x) for x in m['codigos'])
                w(f"  insert into {tabla}_cuentas select m.id, c.id from {tabla} m, cuentas c"
                  f" where m.airtable_id = {q(at)} and c.codigo_path in ({lista});")
    w('')
    w("  raise notice 'seed_plan_cuentas_base: catálogo sembrado (% cuentas)',"
      " (select count(*) from cuentas);")
    w('end $seed$;')
    w('')

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text('\n'.join(L), encoding='utf-8')
    print(f'✓ {DESTINO.relative_to(RAIZ)} escrito — {len(cuentas)} cuentas, {len(centros)} CC, '
          f'{len(mapeos["mapeo_er"])}+{len(mapeos["mapeo_bs"])} líneas de mapeo')


if __name__ == '__main__':
    main()
