'use client';

/**
 * F-046.1 — Modal de crear / editar artículo (PARTE F).
 *
 * Solo admin lo invoca — el gateo está en el server action; acá no validamos
 * rol porque el server lo rechaza si no lo es y mostramos el error en toast.
 *
 * Flujo:
 *  - Modo "crear": campos vacíos, slug auto-sugerido del título mientras se
 *    escribe (siempre que el usuario no haya tocado el slug manualmente).
 *  - Modo "editar": campos pre-poblados con `articulo.*`.
 *  - Validaciones cliente: título no vacío, slug formateado válido,
 *    contenido >= 50 chars (mismo umbral que el backend).
 *  - Categoría: select con las 6 fijas de CATEGORIAS_AYUDA.
 *  - Tags: input "tag1, tag2" parseado a string[] al submit.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import {
  crearArticuloAction,
  editarArticuloAction,
} from '@/app/(app)/ayuda/actions';
import {
  CATEGORIAS_AYUDA,
  generarSlug,
  type Articulo,
  type CategoriaAyuda,
} from '@/lib/db/ayuda';

const MIN_CONTENIDO = 50;
const MAX_DESC_CORTA = 200;

interface PropsCrear { modo: 'crear'; onClose: () => void; }
interface PropsEditar { modo: 'editar'; articulo: Articulo; onClose: () => void; }
type Props = PropsCrear | PropsEditar;

export function ArticuloFormModal(props: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const inicial: Articulo | null = props.modo === 'editar' ? props.articulo : null;
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '');
  const [slug, setSlug] = useState(inicial?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [categoria, setCategoria] = useState<CategoriaAyuda>(inicial?.categoria ?? 'Facturación');
  const [descripcion, setDescripcion] = useState(inicial?.descripcionCorta ?? '');
  const [contenido, setContenido] = useState(inicial?.contenido ?? '');
  const [tags, setTags] = useState((inicial?.tagsContextuales ?? []).join(', '));
  const [orden, setOrden] = useState(String(inicial?.orden ?? 100));
  const [activo, setActivo] = useState(inicial?.activo ?? true);

  const tituloRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { tituloRef.current?.focus(); }, []);

  // Auto-sugerir slug desde el título hasta que el usuario lo edite manualmente.
  useEffect(() => {
    if (props.modo === 'crear' && !slugTouched) {
      setSlug(generarSlug(titulo));
    }
  }, [titulo, slugTouched, props.modo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) props.onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [props, loading]);

  const errores = useMemo(() => {
    const e: string[] = [];
    if (!titulo.trim())                                   e.push('El título es requerido.');
    if (!slug.trim())                                     e.push('El slug es requerido.');
    if (slug.trim() && !/^[a-z0-9-]+$/.test(slug.trim())) e.push('El slug solo puede tener minúsculas, números y guiones.');
    if (descripcion.length > MAX_DESC_CORTA)              e.push(`Descripción corta no puede exceder ${MAX_DESC_CORTA} caracteres.`);
    if (contenido.trim().length < MIN_CONTENIDO)          e.push(`El contenido debe tener al menos ${MIN_CONTENIDO} caracteres (lleva ${contenido.trim().length}).`);
    return e;
  }, [titulo, slug, descripcion, contenido]);

  const puedeGuardar = errores.length === 0 && !loading;

  if (typeof document === 'undefined') return null;

  const submit = async () => {
    setLoading(true);
    try {
      const payload = {
        titulo: titulo.trim(),
        slug: slug.trim(),
        categoria,
        descripcionCorta: descripcion.trim(),
        contenido,
        tagsContextuales: tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
        orden: Number(orden) || 100,
        activo,
      };
      const res = props.modo === 'crear'
        ? await crearArticuloAction(payload)
        : await editarArticuloAction(props.articulo.id, payload);
      if (res.ok) {
        toast.success(props.modo === 'crear' ? 'Artículo creado.' : 'Artículo actualizado.');
        props.onClose();
        router.refresh();
        if (props.modo === 'crear' && res.slug) router.push(`/ayuda/${res.slug}`);
      } else {
        toast.error(res.error ?? 'No se pudo guardar.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de red.');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      onClick={() => { if (!loading) props.onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(820px, 96vw)', maxHeight: '94vh',
          background: 'var(--paper)', borderRadius: 'var(--r-3)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Edit size={15} style={{ color: 'var(--ink-2)' }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {props.modo === 'crear' ? 'Nuevo artículo' : `Editar · ${props.articulo.titulo}`}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={props.onClose} disabled={loading} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="field">
              <label className="label" htmlFor="af-titulo">Título</label>
              <input
                id="af-titulo"
                ref={tituloRef}
                type="text"
                className="input"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={loading}
                placeholder="Ej. Cómo emitir una nota de crédito"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="af-categoria">Categoría</label>
              <select
                id="af-categoria"
                className="input"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as CategoriaAyuda)}
                disabled={loading}
              >
                {CATEGORIAS_AYUDA.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="field">
              <label className="label" htmlFor="af-slug">Slug</label>
              <input
                id="af-slug"
                type="text"
                className="input"
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                disabled={loading}
                placeholder="como-emitir-nota-credito"
              />
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                URL: /ayuda/<span className="num">{slug || '…'}</span>
                {props.modo === 'crear' && !slugTouched && titulo && ' · auto-sugerido del título'}
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="af-orden">Orden</label>
              <input
                id="af-orden"
                type="number"
                className="input num"
                value={orden}
                onChange={(e) => setOrden(e.target.value)}
                disabled={loading}
              />
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                Menor = primero
              </div>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label" htmlFor="af-desc">
              Descripción corta <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>({descripcion.length}/{MAX_DESC_CORTA})</span>
            </label>
            <textarea
              id="af-desc"
              className="input"
              rows={2}
              maxLength={MAX_DESC_CORTA}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={loading}
              placeholder="Resumen de una línea que aparece en las cards del hub."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label" htmlFor="af-contenido">
              Contenido (markdown) <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>({contenido.trim().length} caracteres · mín. {MIN_CONTENIDO})</span>
            </label>
            <textarea
              id="af-contenido"
              className="input"
              rows={20}
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              disabled={loading}
              placeholder={`# Encabezado\n\nTexto con **bold**, *italic*, [link](https://...), listas:\n\n- Punto 1\n- Punto 2\n\n> Cita destacada.`}
              style={{ resize: 'vertical', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 12 }}
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label className="label" htmlFor="af-tags">Tags contextuales</label>
            <input
              id="af-tags"
              type="text"
              className="input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={loading}
              placeholder="emitir-nc, nota-credito, refacturacion"
            />
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
              Separados por coma. El HelpButton con `tag={'{nombre}'}` busca por estos.
            </div>
          </div>

          <div className="field" style={{ marginBottom: 6 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)' }}>
              <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} disabled={loading} />
              Artículo activo (visible para los usuarios)
            </label>
          </div>

          {errores.length > 0 && (
            <div style={{ padding: '8px 12px', marginTop: 10, fontSize: 12, color: 'var(--wine)', background: '#F5E2DD', border: '1px solid var(--wine)', borderRadius: 4 }}>
              {errores.map(e => <div key={e}>⛔ {e}</div>)}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={props.onClose} disabled={loading}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!puedeGuardar}>
            {loading
              ? <><I.Refresh size={13} /> Guardando…</>
              : props.modo === 'crear' ? 'Crear artículo' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
