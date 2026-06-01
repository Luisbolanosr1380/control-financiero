'use client';

import { useEffect, useState } from 'react';
import { I } from '@/components/common/icons';

const STORAGE_KEY = 'cf:banner-operativo-dismissed';

/**
 * Banner educativo para usuarios con rol 'operativo'. Aparece UNA vez la
 * primera que entran al dashboard; el dismiss se persiste en localStorage.
 * El server pasa `mostrar` como prop — el cliente decide si tiene que
 * mostrarlo según el storage local.
 */
export function BannerOperativo({ mostrar }: { mostrar: boolean }) {
  const [oculto, setOculto] = useState(true);

  useEffect(() => {
    if (!mostrar) return;
    try {
      const dismissed = window.localStorage.getItem(STORAGE_KEY);
      if (!dismissed) setOculto(false);
    } catch {
      setOculto(false);
    }
  }, [mostrar]);

  if (!mostrar || oculto) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* sin storage */ }
    setOculto(true);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px', marginBottom: 18,
      background: 'var(--paper-2)', border: '1px solid var(--line-2)',
      borderLeft: '3px solid var(--olive)', borderRadius: 6,
    }}>
      <I.Info size={16} style={{ color: 'var(--olive)', flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        <strong>Bienvenido.</strong> Como <strong>operativo</strong>, podés crear y editar
        facturas, cobros, deudas y gastos. Las funciones de análisis estratégico
        (<em>Auros</em>, <em>AI Insights</em>) están reservadas para roles de gerencia.
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Cerrar aviso"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--ink-4)', padding: 2, marginLeft: 4,
        }}
      >
        <I.X size={14} />
      </button>
    </div>
  );
}
