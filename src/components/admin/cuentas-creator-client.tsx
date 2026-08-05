'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { crearCuentaContableAction } from '@/app/(app)/admin/catalogos/actions';
import { naturalezaDeCodigo, sugerirSiguienteCodigo } from '@/lib/contabilidad/plan-cuentas';

interface CuentaPlan {
  id: string;
  codigo: string;
  nombre: string;
  nivel: number;
}

interface Props {
  cuentas: CuentaPlan[];
}

/**
 * F-CUENTAS-CREATOR: pantalla completa. Izquierda: árbol navegable del
 * plan. Derecha: creador guiado — elegís el padre, el código se sugiere
 * solo, escribís únicamente el nombre. Todo lo demás se deriva.
 */
export function CuentasCreatorClient({ cuentas: iniciales }: Props) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set(iniciales.filter(c => c.nivel === 1).map(c => c.codigo)));
  const [padreSel, setPadreSel] = useState<CuentaPlan | null>(null);
  const [codigo, setCodigo] = useState('');
  const [codigoEditado, setCodigoEditado] = useState(false);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [loading, setLoading] = useState(false);
  // Optimista: las recién creadas se suman al árbol sin esperar el refresh.
  const [creadas, setCreadas] = useState<CuentaPlan[]>([]);

  const cuentas = useMemo(() => {
    const todas = [...iniciales, ...creadas];
    const segs = (c: string) => c.split('-').map(Number);
    return todas.sort((a, b) => {
      const x = segs(a.codigo), y = segs(b.codigo);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? -1) - (y[i] ?? -1);
        if (d !== 0) return d;
      }
      return 0;
    });
  }, [iniciales, creadas]);

  const porCodigo = useMemo(() => new Map(cuentas.map(c => [c.codigo, c])), [cuentas]);
  const hijosDe = useMemo(() => {
    const m = new Map<string, CuentaPlan[]>();
    for (const c of cuentas) {
      const segs = c.codigo.split('-');
      const parent = segs.length > 1 ? segs.slice(0, -1).join('-') : '';
      const l = m.get(parent) ?? [];
      l.push(c); m.set(parent, l);
    }
    return m;
  }, [cuentas]);

  const seleccionarPadre = (c: CuentaPlan) => {
    setPadreSel(c);
    setCodigo(sugerirSiguienteCodigo(c.codigo, cuentas.map(x => x.codigo)));
    setCodigoEditado(false);
    setExpandidos(prev => new Set(prev).add(c.codigo));
  };

  // ── Validación en vivo del código (también revalida si lo editan a mano) ──
  const validacion = useMemo(() => {
    const cod = codigo.trim();
    if (!cod) return { ok: false as const, error: 'Elegí un grupo del árbol para sugerir el código.' };
    if (!/^\d+(-\d+)*$/.test(cod)) return { ok: false as const, error: 'Formato inválido — segmentos numéricos con guiones, ej. 1-1-1-5.' };
    const nat = naturalezaDeCodigo(cod);
    if (!nat) return { ok: false as const, error: 'El primer dígito debe ser una naturaleza: 1 Activo · 2 Pasivo · 3 Patrimonio · 4 Ingresos · 5 Egresos · 6 Gastos.' };
    const dup = porCodigo.get(cod);
    if (dup) return { ok: false as const, error: `El código ${cod} ya existe: "${dup.nombre}". Elegí otro.` };
    const segs = cod.split('-');
    const parentPath = segs.length > 1 ? segs.slice(0, -1).join('-') : null;
    const padre = parentPath ? porCodigo.get(parentPath) : null;
    if (parentPath && !padre) return { ok: false as const, error: `La cuenta padre ${parentPath} no existe — creala primero.` };
    return { ok: true as const, nivel: segs.length, naturaleza: nat, parentPath, padre: padre ?? null };
  }, [codigo, porCodigo]);

  const listo = validacion.ok && nombre.trim().length > 0;

  const onConfirm = async () => {
    if (!listo || !validacion.ok) return;
    setLoading(true);
    try {
      const res = await crearCuentaContableAction({
        codigoPath: codigo.trim(),
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
      });
      if (res.ok) {
        toast.success(res.mensaje);
        setCreadas(prev => [...prev, { id: res.id, codigo: codigo.trim(), nombre: nombre.trim(), nivel: codigo.trim().split('-').length }]);
        if (validacion.parentPath) setExpandidos(prev => new Set(prev).add(validacion.parentPath!));
        setNombre(''); setDescripcion('');
        // Nueva sugerencia bajo el mismo padre (por si crea varias seguidas).
        const codigosNuevos = [...cuentas.map(x => x.codigo), codigo.trim()];
        if (padreSel) setCodigo(sugerirSiguienteCodigo(padreSel.codigo, codigosNuevos));
        setCodigoEditado(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  };

  // ── Árbol (filtrado por búsqueda: matchea código o nombre, muestra ancestros) ──
  const visibles = useMemo(() => {
    if (!busqueda.trim()) return null;   // null = sin filtro
    const q = busqueda.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const match = new Set<string>();
    for (const c of cuentas) {
      const nombreNorm = c.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (c.codigo.includes(q) || nombreNorm.includes(q)) {
        // la cuenta y todos sus ancestros
        const segs = c.codigo.split('-');
        for (let i = 1; i <= segs.length; i++) match.add(segs.slice(0, i).join('-'));
      }
    }
    return match;
  }, [busqueda, cuentas]);

  const renderNodo = (c: CuentaPlan): React.ReactNode => {
    if (visibles && !visibles.has(c.codigo)) return null;
    const hijos = hijosDe.get(c.codigo) ?? [];
    const abierto = visibles ? true : expandidos.has(c.codigo);
    const esPadreSel = padreSel?.codigo === c.codigo;
    return (
      <div key={c.codigo}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 8px', paddingLeft: 8 + (c.nivel - 1) * 16,
            borderRadius: 'var(--r-1)', cursor: 'pointer', fontSize: 12.5,
            background: esPadreSel ? 'var(--olive-bg)' : undefined,
            border: esPadreSel ? '1px solid var(--olive)' : '1px solid transparent',
          }}
          onClick={() => seleccionarPadre(c)}
          title={`Crear una cuenta dentro de ${c.codigo} ${c.nombre}`}
        >
          {hijos.length > 0 ? (
            <button
              onClick={e => {
                e.stopPropagation();
                setExpandidos(prev => {
                  const n = new Set(prev);
                  if (n.has(c.codigo)) n.delete(c.codigo); else n.add(c.codigo);
                  return n;
                });
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink-4)', width: 14 }}
            >
              {abierto ? '▾' : '▸'}
            </button>
          ) : (
            <span style={{ width: 14, color: 'var(--ink-5, var(--ink-4))', textAlign: 'center' }}>·</span>
          )}
          <span className="num" style={{ color: 'var(--ink-4)', minWidth: c.nivel > 2 ? 76 : 40 }}>{c.codigo}</span>
          <span style={{ color: esPadreSel ? 'var(--ink)' : 'var(--ink-2)', fontWeight: c.nivel <= 2 ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.nombre}
          </span>
          {hijos.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-4)' }}>{hijos.length}</span>}
        </div>
        {abierto && hijos.map(renderNodo)}
      </div>
    );
  };

  const hijosDelSel = padreSel ? (hijosDe.get(padreSel.codigo) ?? []) : [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Creador de cuentas contables</h1>
          <div className="page-subtitle" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            Navegá al grupo donde va la cuenta — el código correcto se sugiere solo. Vos únicamente escribís el nombre.
          </div>
        </div>
        <Link href="/admin/catalogos" className="btn btn-secondary" style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}>
          <I.ChevLeft size={13} /> Catálogos
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 5fr) minmax(360px, 4fr)', gap: 16, alignItems: 'start' }}>

        {/* ── Árbol del plan ── */}
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Plan de cuentas · {cuentas.length}
            </div>
            <div className="toolbar-search" style={{ marginBottom: 8, border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <I.Search size={12} style={{ color: 'var(--ink-4)' }} />
              <input
                style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', fontSize: 12.5 }}
                placeholder="Buscar cuenta por código o nombre…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
            </div>
          </div>
          <div style={{ padding: '0 10px 12px', maxHeight: 'calc(100vh - 290px)', overflowY: 'auto' }}>
            {(hijosDe.get('') ?? []).map(renderNodo)}
          </div>
        </div>

        {/* ── Creador guiado ── */}
        <div className="card" style={{ position: 'sticky', top: 16 }}>
          <div className="card-pad">
            {!padreSel ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                <I.Journal size={26} style={{ opacity: 0.4, marginBottom: 10 }} />
                <div style={{ color: 'var(--ink-2)', marginBottom: 4 }}>Elegí un grupo en el árbol</div>
                <div style={{ fontSize: 12 }}>Hacé clic en la cuenta DENTRO de la cual va la nueva — el sistema sugiere el siguiente código libre.</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Nueva cuenta
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12 }}>
                  Vas a crear una cuenta dentro de:{' '}
                  <span className="num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{padreSel.codigo}</span>{' '}
                  <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{padreSel.nombre}</span>
                </div>

                {hijosDelSel.length > 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 12, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 'var(--r-1)', maxHeight: 110, overflowY: 'auto' }}>
                    Hijos actuales: {hijosDelSel.map(h => <span key={h.codigo} style={{ whiteSpace: 'nowrap' }}><span className="num">{h.codigo}</span> {h.nombre} · </span>)}
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 12 }}>
                    Este grupo todavía no tiene hijos — la nueva será la primera (…-1).
                  </div>
                )}

                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="label">Código {codigoEditado ? '(editado a mano — se revalida)' : '(sugerido automáticamente)'}</label>
                  <input
                    className="input num"
                    value={codigo}
                    onChange={e => { setCodigo(e.target.value); setCodigoEditado(true); }}
                    disabled={loading}
                    style={{ fontWeight: 600, borderColor: validacion.ok ? 'var(--olive)' : 'var(--wine)' }}
                  />
                  {!validacion.ok && (
                    <div style={{ fontSize: 11.5, color: 'var(--wine)', marginTop: 4 }}>{validacion.error}</div>
                  )}
                </div>

                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="label">Nombre de la cuenta *</label>
                  <input className="input" placeholder="ej. Banco Nuevo Monetaria" value={nombre} onChange={e => setNombre(e.target.value)} disabled={loading} autoFocus />
                </div>
                <div className="field" style={{ marginBottom: 14 }}>
                  <label className="label">Descripción (opcional)</label>
                  <textarea className="input" rows={2} value={descripcion} onChange={e => setDescripcion(e.target.value)} disabled={loading} />
                </div>

                {validacion.ok && (
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', padding: '10px 12px', background: 'var(--olive-bg)', borderRadius: 'var(--r-1)', marginBottom: 14, lineHeight: 1.6 }}>
                    <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--olive)', marginBottom: 4 }}>Se creará</div>
                    <span className="num" style={{ fontWeight: 600 }}>{codigo.trim()}</span> · <b>{nombre.trim() || '[nombre]'}</b>
                    <br />
                    Tipo <b>{validacion.naturaleza.nombre.toUpperCase()}</b> (naturaleza {validacion.naturaleza.esAcreedora ? 'acreedora' : 'deudora'})
                    · Nivel {validacion.nivel} · cuenta de detalle (hoja)
                    {validacion.padre && <> · hija de <span className="num">{validacion.padre.codigo}</span> {validacion.padre.nombre}</>}
                  </div>
                )}

                <button className="btn btn-primary" style={{ width: '100%' }} onClick={onConfirm} disabled={loading || !listo}>
                  {loading ? <><I.Refresh size={13} /> Creando…</> : <><I.Check size={13} /> Confirmar y crear</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
