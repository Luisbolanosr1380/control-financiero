'use client';

import { I, type IconName } from '@/components/common/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: { text: string; kind?: 'warn' | 'wine' };
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { group: 'Operación', items: [
    { href: '/dashboard',    label: 'Dashboard',    icon: 'Dashboard' },
    { href: '/facturacion',  label: 'Facturación',  icon: 'Receipt', badge: { text: '5 vencidas', kind: 'wine' } },
    { href: '/cobros',       label: 'Cobros',       icon: 'Coins' },
    { href: '/clientes',     label: 'Clientes',     icon: 'Users' },
  ]},
  { group: 'Gastos', items: [
    { href: '/gastos',   label: 'Gastos',   icon: 'Expense' },
    { href: '/bancos',   label: 'Bancos',   icon: 'Bank' },
    { href: '/planilla', label: 'Planilla', icon: 'Payroll' },
    { href: '/deudas',   label: 'Deudas',   icon: 'Debt' },
  ]},
  { group: 'Contabilidad', items: [
    { href: '/asientos', label: 'Asientos',            icon: 'Journal' },
    { href: '/estados',  label: 'Estados Financieros', icon: 'Statement' },
  ]},
  { group: 'Inteligencia', items: [
    { href: '/ai',       label: 'AI Insights',         icon: 'Sparkles', badge: { text: '3 alertas', kind: 'warn' } },
  ]},
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">CF</div>
        <div>
          <div className="brand-name">Control Financiero</div>
          <div className="brand-sub">Sistema operativo</div>
        </div>
      </div>

      {NAV.map((grp) => (
        <div className="nav-group" key={grp.group}>
          <div className="nav-group-label">{grp.group}</div>
          {grp.items.map((it) => {
            const Ico = I[it.icon];
            const active = pathname?.startsWith(it.href) ?? false;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={'nav-item' + (active ? ' active' : '')}
              >
                <Ico className="icon" />
                <span>{it.label}</span>
                {it.badge && (
                  <span className={'nav-badge' + (it.badge.kind === 'warn' ? ' warn' : '')}>
                    {it.badge.text}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}

      <div className="sidebar-footer">
        <div className="avatar">S</div>
        <div>
          <div className="user-name">Stark Méndez</div>
          <div className="user-role">CFO · Control Op.</div>
        </div>
      </div>
    </aside>
  );
}
