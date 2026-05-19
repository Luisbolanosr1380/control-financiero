'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { I, type IconName } from '@/components/common/icons';
import { CUSTOMERS, INVOICES } from '@/lib/mock-data';

interface CommandPaletteProps {
  onClose: () => void;
}

interface PaletteItem {
  type: 'action' | 'nav' | 'customer' | 'invoice';
  label: string;
  hint?: string;
  icon: IconName;
  action: () => void;
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const go = (path: string) => { router.push(path); onClose(); };

  const allItems: PaletteItem[] = [
    { type: 'action', label: 'Nueva factura',       hint: '⌘N',  icon: 'Plus',       action: () => go('/facturacion?new=1') },
    { type: 'action', label: 'Registrar cobro',     hint: 'G C', icon: 'Coins',      action: () => go('/cobros?register=1') },
    { type: 'action', label: 'Generar reporte',     hint: 'G R', icon: 'Download',   action: () => onClose() },
    { type: 'nav',    label: 'Dashboard',           hint: 'G D', icon: 'Dashboard',  action: () => go('/dashboard') },
    { type: 'nav',    label: 'Facturación',         hint: 'G F', icon: 'Receipt',    action: () => go('/facturacion') },
    { type: 'nav',    label: 'Cobros',              hint: 'G P', icon: 'Coins',      action: () => go('/cobros') },
    { type: 'nav',    label: 'Clientes',            hint: 'G U', icon: 'Users',      action: () => go('/clientes') },
    { type: 'nav',    label: 'AI Insights',         hint: 'G I', icon: 'Sparkles',   action: () => go('/ai') },
    { type: 'nav',    label: 'Estados financieros', hint: 'G E', icon: 'Statement',  action: () => go('/estados') },
    { type: 'nav',    label: 'Asientos',            hint: 'G A', icon: 'Journal',    action: () => go('/asientos') },
    ...CUSTOMERS.slice(0, 6).map<PaletteItem>(c => ({
      type: 'customer', label: c.short, hint: c.nit, icon: 'Building',
      action: () => go(`/clientes/${c.id}`),
    })),
    ...INVOICES.slice(0, 6).map<PaletteItem>(inv => ({
      type: 'invoice', label: inv.id,
      hint: CUSTOMERS.find(c => c.id === inv.custId)?.short,
      icon: 'Receipt',
      action: () => go(`/facturacion/${inv.id}`),
    })),
  ];

  const filtered = q
    ? allItems.filter(it =>
        it.label.toLowerCase().includes(q.toLowerCase()) ||
        (it.hint ?? '').toLowerCase().includes(q.toLowerCase()))
    : allItems;

  const groups: Record<string, PaletteItem[]> = {
    'Acciones rápidas': filtered.filter(i => i.type === 'action'),
    'Navegar a':        filtered.filter(i => i.type === 'nav'),
    'Clientes':         filtered.filter(i => i.type === 'customer'),
    'Facturas':         filtered.filter(i => i.type === 'invoice'),
  };

  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <div className="modal" style={{ alignItems: 'flex-start', paddingTop: '12vh' }}>
        <div className="modal-card" style={{ maxWidth: 580, maxHeight: 480 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-3)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <I.Search size={16} style={{ color: 'var(--ink-3)' }} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar facturas, clientes, asientos o ejecutar una acción…"
              style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 14, color: 'var(--ink)' }}
            />
            <span className="kbd">Esc</span>
          </div>
          <div style={{ overflowY: 'auto', padding: '6px 0' }}>
            {Object.entries(groups).map(([label, items]) => items.length > 0 && (
              <div key={label}>
                <div style={{ padding: '8px 16px 4px', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500 }}>
                  {label}
                </div>
                {items.map((it, i) => {
                  const Ico = I[it.icon];
                  return (
                    <button
                      key={i}
                      onClick={it.action}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', textAlign: 'left', color: 'var(--ink-2)', fontSize: 13, cursor: 'pointer', background: 'transparent', borderRadius: 0 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-tint)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Ico size={14} style={{ color: 'var(--ink-3)' }} />
                      <span style={{ flex: 1 }}>{it.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: it.type === 'customer' ? 'var(--mono)' : 'var(--sans)' }}>{it.hint}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                Sin resultados para &quot;{q}&quot;
              </div>
            )}
          </div>
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line-3)', display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-4)', background: 'var(--bg-2)' }}>
            <span><span className="kbd">↑↓</span> Navegar</span>
            <span><span className="kbd">↵</span> Seleccionar</span>
            <span><span className="kbd">⌘K</span> Cerrar</span>
            <span style={{ marginLeft: 'auto' }}><I.Sparkles size={11} style={{ verticalAlign: '-1px' }} /> Powered by AI</span>
          </div>
        </div>
      </div>
    </>
  );
}
