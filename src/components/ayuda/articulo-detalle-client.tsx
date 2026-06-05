'use client';

/**
 * F-046.1 — Detalle de artículo /ayuda/[slug].
 *
 * Renderiza markdown con react-markdown + remark-gfm (tablas, autolink,
 * tachado, listas con checkboxes). Links externos abren en nueva pestaña;
 * los internos (mismo origen) navegan en la pestaña actual.
 *
 * Solo admin ve "Editar" y "Desactivar". El desactivar pide confirmación
 * porque deja el artículo invisible (no se borra).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { I } from '@/components/common/icons';
import { formatearFecha, fechaRelativa } from '@/lib/utils/fechas';
import { desactivarArticuloAction } from '@/app/(app)/ayuda/actions';
import { ArticuloFormModal } from './articulo-form-modal';
import type { Articulo } from '@/lib/db/ayuda';

interface Props {
  articulo: Articulo;
  relacionados: Articulo[];
  esAdmin: boolean;
}

export function ArticuloDetalleClient({ articulo, relacionados, esAdmin }: Props) {
  const router = useRouter();
  const [editar, setEditar] = useState(false);
  const [confirmandoDesactivar, setConfirmandoDesactivar] = useState(false);
  const [loading, setLoading] = useState(false);

  const desactivar = async () => {
    setLoading(true);
    try {
      const res = await desactivarArticuloAction(articulo.id);
      if (res.ok) {
        toast.success('Artículo desactivado.');
        router.push('/ayuda');
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo desactivar.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      {/* Breadcrumb */}
      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Link href="/ayuda" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Centro de Ayuda</Link>
        <span>›</span>
        <span>{articulo.categoria}</span>
        <span>›</span>
        <span style={{ color: 'var(--ink-2)' }}>{articulo.titulo}</span>
      </div>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <div style={{ marginBottom: 8 }}>
            <span className="badge badge-outline" style={{ fontSize: 10, padding: '2px 8px' }}>
              {articulo.categoria}
            </span>
            {!articulo.activo && (
              <span className="badge badge-mute" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 6 }}>
                Inactivo
              </span>
            )}
          </div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>{articulo.titulo}</h1>
          {articulo.descripcionCorta && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 720, lineHeight: 1.5 }}>
              {articulo.descripcionCorta}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
            Actualizado {fechaRelativa(articulo.fechaModificacion)} ({formatearFecha(articulo.fechaModificacion)})
            {articulo.modificadoPor && ` · por ${articulo.modificadoPor}`}
          </div>
        </div>
        <div className="page-actions">
          {esAdmin && (
            <>
              <button className="btn btn-secondary" onClick={() => setEditar(true)}>
                <I.Edit size={13} /> Editar
              </button>
              {!confirmandoDesactivar ? (
                <button className="btn btn-ghost" style={{ color: 'var(--wine)' }} onClick={() => setConfirmandoDesactivar(true)}>
                  <I.X size={13} /> Desactivar
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>¿Seguro?</span>
                  <button className="btn btn-danger" style={{ fontSize: 11, padding: '3px 10px' }} onClick={desactivar} disabled={loading}>
                    {loading ? 'Desactivando…' : 'Sí, desactivar'}
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setConfirmandoDesactivar(false)} disabled={loading}>
                    No
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Contenido markdown */}
      <article className="card" style={{ padding: '24px 32px', marginBottom: 22 }}>
        <div className="ayuda-prose">
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
      </article>

      {/* Relacionados */}
      {relacionados.length > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-head">
            <div className="card-title">Otros artículos de {articulo.categoria}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, padding: 14 }}>
            {relacionados.map(r => (
              <Link
                key={r.id}
                href={`/ayuda/${r.slug}`}
                style={{
                  display: 'block', padding: 12,
                  background: 'var(--paper-2)', border: '1px solid var(--line-3)', borderRadius: 6,
                  textDecoration: 'none', color: 'inherit',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 3 }}>{r.titulo}</div>
                {r.descripcionCorta && <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.4 }}>{r.descripcionCorta}</div>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Footer back */}
      <div>
        <Link href="/ayuda" className="btn btn-secondary">
          <I.ChevLeft size={13} /> Volver al Centro de Ayuda
        </Link>
      </div>

      {editar && (
        <ArticuloFormModal
          modo="editar"
          articulo={articulo}
          onClose={() => setEditar(false)}
        />
      )}
    </div>
  );
}
