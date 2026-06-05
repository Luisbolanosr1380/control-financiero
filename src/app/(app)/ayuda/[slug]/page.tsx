import Link from 'next/link';
import { currentUser } from '@clerk/nextjs/server';
import { getArticuloPorSlug, getArticulos } from '@/lib/db/ayuda';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { I } from '@/components/common/icons';
import { ArticuloDetalleClient } from '@/components/ayuda/articulo-detalle-client';

export const revalidate = 60;

export default async function ArticuloDetallePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const articulo = await getArticuloPorSlug(slug);

  if (!articulo) {
    return (
      <div className="page">
        <div className="card" style={{ marginTop: 40 }}>
          <div className="card-pad" style={{ textAlign: 'center', padding: 56 }}>
            <I.Receipt size={28} style={{ opacity: 0.4, marginBottom: 10, color: 'var(--ink-4)' }} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
              Este artículo no existe o fue movido
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginBottom: 18 }}>
              El enlace puede estar desactualizado. Volvé al centro y usá el buscador para encontrar lo que necesitás.
            </div>
            <Link href="/ayuda" className="btn btn-secondary">
              <I.ChevLeft size={13} /> Ir al Centro de Ayuda
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);

  // Artículos relacionados: misma categoría, distintos al actual, top 3 por orden.
  const todos = await getArticulos({ soloActivos: true, categoria: articulo.categoria });
  const relacionados = todos.filter(a => a.id !== articulo.id).slice(0, 3);

  return (
    <ArticuloDetalleClient
      articulo={articulo}
      relacionados={relacionados}
      esAdmin={rol === 'admin'}
    />
  );
}
