#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
06_migrar_adjuntos_storage.py — FASE 2.5: adjuntos de Airtable → Supabase Storage.

⚠ URGENTE ANTES DE DESCONECTAR AIRTABLE: las URLs de attachments de Airtable
expiran; al desconectar la base, los PDFs se pierden. Este script:
  1. Crea el bucket público `adjuntos` (si no existe).
  2. Descarga cada attachment con URL FRESCA del API (facturas ~1022 PDFs,
     boletas de planilla, constancias de cobros) y lo sube a Storage.
  3. Guarda la URL nueva en la columna correspondiente.

Idempotente/reanudable: salta filas que ya tienen *_url en Supabase.
Uso: python3 scripts/06_migrar_adjuntos_storage.py [--solo facturas|planilla|cobros]
"""

import json
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.parse
from supabase import create_client

ENV = {}
for line in open('/Users/luisbolanos/Desktop/03-Control Financiero/'
                 'control-financiero/.env.local'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        ENV[k.strip()] = v.strip().strip('"')

SB = create_client(ENV['SUPABASE_URL'], ENV['SUPABASE_SERVICE_KEY'])
BUCKET = 'adjuntos'

def at_all(table):
    out, offset = [], None
    while True:
        url = f"https://api.airtable.com/v0/{ENV['AIRTABLE_BASE_ID']}/{urllib.parse.quote(table)}?pageSize=100"
        if offset:
            url += f"&offset={urllib.parse.quote(offset)}"
        req = urllib.request.Request(url, headers={'Authorization': f"Bearer {ENV['AIRTABLE_API_KEY']}"})
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
        out.extend(data.get('records', []))
        offset = data.get('offset')
        if not offset:
            return out
        time.sleep(0.22)

def sanitizar(nombre):
    s = unicodedata.normalize('NFKD', nombre or 'archivo')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^A-Za-z0-9._-]+', '_', s)[:120]

def asegurar_bucket():
    try:
        SB.storage.create_bucket(BUCKET, options={'public': True})
        print(f"✓ bucket '{BUCKET}' creado (público)")
    except Exception as e:
        if 'already exists' in str(e).lower() or 'Duplicate' in str(e):
            print(f"· bucket '{BUCKET}' ya existía")
        else:
            raise

def migrar(at_table, campo_adjunto, pg_table, col_url, col_nombre, carpeta):
    # filas ya migradas (reanudable)
    hechos = set()
    page = 0
    while True:
        data = (SB.table(pg_table).select('airtable_id')
                .not_.is_(col_url, 'null')
                .order('id').range(page * 1000, page * 1000 + 999).execute().data)
        hechos.update(r['airtable_id'] for r in data)
        if len(data) < 1000:
            break
        page += 1

    recs = at_all(at_table)
    con_adjunto = [r for r in recs if isinstance(r['fields'].get(campo_adjunto), list)
                   and r['fields'][campo_adjunto]]
    print(f"\n{at_table}: {len(con_adjunto)} con adjunto · {len(hechos)} ya migrados")
    ok, err = 0, 0
    for i, rec in enumerate(con_adjunto):
        if rec['id'] in hechos:
            continue
        att = rec['fields'][campo_adjunto][0]           # el principal
        url, filename = att.get('url'), sanitizar(att.get('filename', 'archivo.pdf'))
        if not url:
            continue
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                blob = resp.read()
            path = f"{carpeta}/{rec['id']}/{filename}"
            SB.storage.from_(BUCKET).upload(
                path, blob,
                file_options={'content-type': att.get('type', 'application/pdf'), 'upsert': 'true'},
            )
            publica = SB.storage.from_(BUCKET).get_public_url(path)
            SB.table(pg_table).update({col_url: publica, col_nombre: att.get('filename', filename)}) \
                .eq('airtable_id', rec['id']).execute()
            ok += 1
        except Exception as e:
            err += 1
            print(f"  ✗ {rec['id']} {filename}: {str(e)[:120]}")
        if (i + 1) % 50 == 0:
            print(f"  … {i + 1}/{len(con_adjunto)} (ok={ok} err={err})")
    print(f"✓ {at_table}: migrados {ok}, errores {err}")
    return err

def main():
    solo = None
    if '--solo' in sys.argv:
        solo = sys.argv[sys.argv.index('--solo') + 1]
    asegurar_bucket()
    errores = 0
    if solo in (None, 'facturas'):
        errores += migrar('FACTURAS_CLIENTES', 'ADJUNTO ', 'facturas_clientes',
                          'adjunto_url', 'adjunto_nombre', 'facturas')
    if solo in (None, 'planilla'):
        errores += migrar('PLANILLA', 'ADJUNTO ', 'planilla',
                          'boleta_url', 'boleta_nombre', 'boletas')
    if solo in (None, 'cobros'):
        errores += migrar('COBROS_CLIENTES', 'Constancia_Retencion', 'cobros_clientes',
                          'constancia_url', 'constancia_nombre', 'constancias')
    print(f"\n{'✓ MIGRACIÓN DE ADJUNTOS COMPLETA' if errores == 0 else f'⚠ terminó con {errores} errores — re-correr (es reanudable)'}")
    sys.exit(0 if errores == 0 else 1)

if __name__ == '__main__':
    main()
