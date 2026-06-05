'use client';

/**
 * F-046.1 PARTE D — Botón "?" contextual reusable.
 *
 * Inserción típica al lado de un botón de acción del sistema:
 *   <button>Anular factura</button>
 *   <HelpButton tag="anular-factura" />
 *
 * Al click abre un drawer lateral derecho con los artículos cuyo
 * Tags_Contextuales contiene ese tag. Cero match → empty state con link al
 * hub. Match único → renderiza el markdown completo. Múltiples → lista de
 * títulos colapsables.
 *
 * El drawer hace fetch a una server action — la primera apertura tiene un
 * pequeño loading. No hay caché global porque las modificaciones de un admin
 * deben verse de inmediato; el costo (lectura toda la tabla AYUDA) es bajo
 * mientras el volumen sea de decenas.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { I } from '@/components/common/icons';
import { buscarArticulosPorTagAction } from '@/app/(app)/ayuda/actions';
import type { Articulo } from '@/lib/db/ayuda';

export interface HelpButtonProps {
  /** Identificador del contexto. Se compara contra Tags_Contextuales del artículo. */
  tag: string;
  variant?: 'icon' | 'text';
  size?: 'sm' | 'md';
  /** Override de aria-label / title; default "Ayuda sobre esta acción". */
  label?: string;
  className?: string;
}

export function HelpButton({ tag, variant = 'icon', size = 'sm', label = 'Ayuda sobre esta acción', className }: HelpButtonProps) {
  const [open, setOpen] = useState(false);

  const px = size === 'sm' ? 11 : 13;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: variant === 'text' ? '3px 8px' : 3,
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          color: 'var(--ink-3)',
          cursor: 'pointer',
          fontSize: px,
          lineHeight: 1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--paper-2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
      >
        <I.Alert size={px + 2} />
        {variant === 'text' && <span>Ayuda</span>}
      </button>
      {open && <HelpDrawer tag={tag} onClose={() => setOpen(false)} />}
    </>
  );
}

interface DrawerProps { tag: string; onClose: () => void; }

function HelpDrawer({ tag, onClose }: DrawerProps) {
  const [loading, setLoading] = useState(true);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    buscarArticulosPorTagAction(tag)
      .then(arts => {
        if (cancelado) return;
        setArticulos(arts);
        if (arts.length === 1) setExpandido(arts[0].id);    // match único: expandido por default
      })
      .catch(() => { if (!cancelado) setArticulos([]); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [tag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(20, 18, 16, 0.4)',
        }}
      />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 92vw)',
          zIndex: 1000, background: 'var(--paper)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-12px 0 32px rgba(0,0,0,0.25)',
        }}
        role="dialog"
        aria-label="Ayuda contextual"
      >
        <header style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <I.Alert size={15} style={{ color: 'var(--ink-2)' }} />
          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>Ayuda</div>
          <span style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            tag: {tag}
          </span>
          <button type="button" onClick={onClose} className="btn btn-ghost" style={{ marginLeft: 'auto' }} title="Cerrar (Esc)">
            <I.X size={14} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {loading ? (
            <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 }}>
              Cargando…
            </div>
          ) : articulos.length === 0 ? (
            <EmptyTag tag={tag} />
          ) : articulos.length === 1 ? (
            <ArticuloFull articulo={articulos[0]} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6 }}>
                {articulos.length} artículos relacionados — click para expandir
              </div>
              {articulos.map(a => (
                <ArticuloAcordeon
                  key={a.id}
                  articulo={a}
                  abierto={expandido === a.id}
                  onToggle={() => setExpandido(expandido === a.id ? null : a.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function EmptyTag({ tag }: { tag: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 16px' }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>📚</div>
      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
        No encontramos ayuda específica para esta acción todavía
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginBottom: 14, fontStyle: 'italic' }}>
        tag buscado: <code>{tag}</code>
      </div>
      <Link href="/ayuda" className="btn btn-secondary" style={{ fontSize: 11 }}>
        <I.ChevLeft size={11} style={{ transform: 'rotate(180deg)' }} /> Ir al Centro de Ayuda
      </Link>
    </div>
  );
}

function ArticuloFull({ articulo }: { articulo: Articulo }) {
  return (
    <article>
      <div style={{ marginBottom: 4 }}>
        <span className="badge badge-outline" style={{ fontSize: 10 }}>{articulo.categoria}</span>
      </div>
      <h2 style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)', margin: '4px 0 10px' }}>{articulo.titulo}</h2>
      {articulo.descripcionCorta && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 14px', lineHeight: 1.5 }}>{articulo.descripcionCorta}</p>
      )}
      <div className="ayuda-prose" style={{ fontSize: 13 }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...props }) => {
              const externo = href && /^https?:\/\//i.test(href);
              return (
                <a
                  href={href}
                  {...(externo ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                  {...props}
                  style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {articulo.contenido}
        </ReactMarkdown>
      </div>
      <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--line-3)' }}>
        <Link href={`/ayuda/${articulo.slug}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
          Ver artículo completo →
        </Link>
      </div>
    </article>
  );
}

function ArticuloAcordeon({ articulo, abierto, onToggle }: { articulo: Articulo; abierto: boolean; onToggle: () => void }) {
  return (
    <div style={{ border: '1px solid var(--line-3)', borderRadius: 6, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left', background: 'var(--paper-2)',
          border: 'none', padding: '10px 12px',
          fontSize: 12.5, color: 'var(--ink)', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        }}
      >
        <span style={{ display: 'inline-block', transform: abierto ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', color: 'var(--ink-4)' }}>▸</span>
        <span style={{ fontWeight: 500 }}>{articulo.titulo}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-4)' }}>{articulo.categoria}</span>
      </button>
      {abierto && (
        <div style={{ padding: '12px 14px', background: 'var(--paper)' }}>
          <ArticuloFull articulo={articulo} />
        </div>
      )}
    </div>
  );
}
