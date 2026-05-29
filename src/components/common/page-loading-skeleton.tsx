interface Props {
  variant?: 'list' | 'detail' | 'dashboard' | 'simple';
  rows?: number;
}

/**
 * Skeleton genérico para Next.js loading.tsx. Refleja la silueta del page
 * que está cargando para evitar layout shift cuando el Server Component resuelve.
 */
export function PageLoadingSkeleton({ variant = 'list', rows = 8 }: Props) {
  return (
    <div className="page" aria-busy="true" aria-label="Cargando">
      <div className="page-header">
        <div>
          <span className="sk sk-title" />
          <span className="sk sk-sub sk-block" />
        </div>
      </div>

      {variant === 'dashboard' && (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="sk sk-kpi sk-block" />
          ))}
        </div>
      )}

      {(variant === 'list' || variant === 'dashboard') && (
        <div className="table-wrap" style={{ borderRadius: 'var(--r-3, 10px)' }}>
          <div style={{ padding: 12 }}>
            {Array.from({ length: rows }).map((_, i) => (
              <span key={i} className="sk sk-row sk-block" />
            ))}
          </div>
        </div>
      )}

      {variant === 'detail' && (
        <div style={{ display: 'grid', gap: 22 }}>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="sk sk-kpi sk-block" />
            ))}
          </div>
          <div className="card">
            <div className="card-pad" style={{ display: 'grid', gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="sk sk-line sk-block" />
              ))}
            </div>
          </div>
        </div>
      )}

      {variant === 'simple' && (
        <div className="card">
          <div className="card-pad" style={{ display: 'grid', gap: 10 }}>
            {Array.from({ length: rows }).map((_, i) => (
              <span key={i} className="sk sk-line sk-block" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
