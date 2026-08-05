'use client';

/**
 * F-046.1 — Centro de Ayuda · hub central.
 *
 * Buscador full-text (titulo + descripción + contenido) sobre los artículos
 * ya filtrados a activos en el server. Sin query: 6 secciones por categoría
 * (las vacías no se muestran). Con query: lista plana de matches. El admin
 * ve botón "+ Nuevo artículo" que abre el modal de ArticuloFormModal.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { I } from '@/components/common/icons';
import { ArticuloFormModal } from './articulo-form-modal';
import { CATEGORIAS_AYUDA, type Articulo, type CategoriaAyuda } from '@/lib/db/ayuda';

interface Props {
  articulos: Articulo[];
  esAdmin: boolean;
}

const ICONO_CATEGORIA: Record<CategoriaAyuda, string> = {
  'Facturación':            '🧾',
  'Cobros y Retenciones':   '💰',
  'Clientes':               '🤝',
  'Empleados y Planilla':   '👥',
  'Deudas y Pasivos':       '🏦',
  'Notas de Crédito':       '📝',
  'Reportes':               '📊',
  'Conceptos contables':    '📚',
  'Configuración':          '⚙️',
  'Auros':                  '✨',
};

function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function AyudaHubClient({ articulos, esAdmin }: Props) {
  const [search, setSearch] = useState('');
  const [openCrear, setOpenCrear] = useState(false);

  const filtrados = useMemo(() => {
    const q = normalizarTexto(search.trim());
    if (!q) return articulos;
    return articulos.filter(a =>
      normalizarTexto(`${a.titulo} ${a.descripcionCorta} ${a.contenido}`).includes(q),
    );
  }, [articulos, search]);

  const porCategoria = useMemo(() => {
    const map = new Map<CategoriaAyuda, Articulo[]>();
    for (const a of filtrados) {
      const list = map.get(a.categoria) ?? [];
      list.push(a);
      map.set(a.categoria, list);
    }
    return map;
  }, [filtrados]);

  const hayBusqueda = search.trim().length > 0;
  const sinContenido = articulos.length === 0;
  const sinResultados = filtrados.length === 0 && hayBusqueda;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Centro de Ayuda</h1>
          <div className="page-subtitle">Guía operativa de Control Financiero</div>
        </div>
        <div className="page-actions">
          {esAdmin && (
            <button className="btn btn-primary" onClick={() => setOpenCrear(true)}>
              <I.Plus size={13} /> Nuevo artículo
            </button>
          )}
        </div>
      </div>

      {/* Buscador */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', marginBottom: 24,
        background: 'var(--paper-2)', border: '1px solid var(--line-2)', borderRadius: 8,
      }}>
        <I.Search size={18} style={{ color: 'var(--ink-3)' }} />
        <input
          type="search"
          placeholder="Buscar en el centro de ayuda…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, border: 'none', background: 'transparent', outline: 'none',
            fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit',
          }}
          autoFocus
        />
        {hayBusqueda && (
          <button
            type="button"
            onClick={() => setSearch('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)' }}
            title="Limpiar"
          >
            <I.X size={14} />
          </button>
        )}
      </div>

      {sinContenido ? (
        <EmptyState
          icono="📚"
          titulo="Aún no hay contenido publicado"
          mensaje={esAdmin
            ? 'Empezá creando el primer artículo. Puede ser una guía operativa, un concepto contable o una explicación de un flujo del sistema.'
            : 'Los administradores pueden crear artículos para guiar a los usuarios del sistema.'}
        />
      ) : sinResultados ? (
        <EmptyState
          icono="🔍"
          titulo={`No encontramos resultados para "${search.trim()}"`}
          mensaje="Probá con otros términos o navegá las categorías arriba."
        />
      ) : hayBusqueda ? (
        // Vista de búsqueda: lista plana
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginBottom: 4 }}>
            {filtrados.length} resultado{filtrados.length === 1 ? '' : 's'}
          </div>
          {filtrados.map(a => <ArticuloCard key={a.id} articulo={a} compacto />)}
        </div>
      ) : (
        // Vista por categorías
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {CATEGORIAS_AYUDA.map(cat => {
            const lista = porCategoria.get(cat) ?? [];
            if (lista.length === 0) return null;
            return (
              <section key={cat}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 18 }}>{ICONO_CATEGORIA[cat]}</span>
                  <h2 style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                    {cat}
                  </h2>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    {lista.length} artículo{lista.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {lista.map(a => <ArticuloCard key={a.id} articulo={a} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {openCrear && (
        <ArticuloFormModal
          modo="crear"
          onClose={() => setOpenCrear(false)}
        />
      )}
    </div>
  );
}

function ArticuloCard({ articulo, compacto }: { articulo: Articulo; compacto?: boolean }) {
  return (
    <Link
      href={`/ayuda/${articulo.slug}`}
      style={{
        display: 'block',
        padding: compacto ? '12px 16px' : 14,
        background: 'var(--paper-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 120ms',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--line-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--line-3)')}
    >
      {compacto && (
        <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          {articulo.categoria}
        </div>
      )}
      <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>
        {articulo.titulo}
      </div>
      {articulo.descripcionCorta && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>
          {articulo.descripcionCorta}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>
        Leer →
      </div>
    </Link>
  );
}

function EmptyState({ icono, titulo, mensaje }: { icono: string; titulo: string; mensaje: string }) {
  return (
    <div className="card" style={{ padding: '48px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icono}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>{mensaje}</div>
    </div>
  );
}
