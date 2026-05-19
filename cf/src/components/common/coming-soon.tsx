'use client';

import { I, type IconName } from '@/components/common/icons';

interface ComingSoonProps {
  title: string;
  subtitle: string;
  icon: IconName;
}

export function ComingSoon({ title, subtitle, icon }: ComingSoonProps) {
  const Ico = I[icon];
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="page-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="card" style={{ padding: 60, textAlign: 'center' }}>
        <Ico size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
        <div className="serif" style={{ fontSize: 22, fontStyle: 'italic', color: 'var(--ink-2)', marginBottom: 8 }}>
          Próximamente
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>
          Este módulo estará disponible en una próxima iteración. Por ahora gestionalo desde Airtable mientras lo construimos.
        </div>
      </div>
    </div>
  );
}
