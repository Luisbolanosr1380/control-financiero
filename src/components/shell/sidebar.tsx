'use client';

import { I, type IconName } from '@/components/common/icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/auth/allowlist';
import { PERMISSIONS } from '@/lib/auth/permissions';

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

function buildNav(opts: { deudasVencidasCount?: number; rol?: Role } = {}): NavGroup[] {
  const deudasBadge = opts.deudasVencidasCount && opts.deudasVencidasCount > 0
    ? { text: `${opts.deudasVencidasCount} vencidas`, kind: 'wine' as const }
    : undefined;
  const rol = opts.rol;
  const verAvanzada = rol && PERMISSIONS[rol].verAnaliticaAvanzada;
  const esAdmin = rol === 'admin';

  const groups: NavGroup[] = [
    { group: 'Operación', items: [
      { href: '/dashboard',    label: 'Dashboard',    icon: 'Dashboard' },
      { href: '/facturacion',  label: 'Facturación',  icon: 'Receipt', badge: { text: '5 vencidas', kind: 'wine' } },
      { href: '/cobros',       label: 'Cobros',       icon: 'Coins' },
      { href: '/cobros/identificar', label: 'Identificar pago', icon: 'Search' },
      { href: '/clientes',     label: 'Clientes',     icon: 'Users' },
    ]},
    { group: 'Gastos', items: [
      { href: '/gastos',       label: 'Gastos',         icon: 'Expense' },
      { href: '/bancos',       label: 'Bancos',         icon: 'Bank' },
      { href: '/planilla',     label: 'Planilla',       icon: 'Payroll' },
      { href: '/deudas',       label: 'Deudas',         icon: 'Debt', badge: deudasBadge },
      { href: '/pagos-deudas', label: 'Pagos a deudas', icon: 'Coins' },
    ]},
    { group: 'Contabilidad', items: [
      { href: '/asientos', label: 'Asientos',            icon: 'Journal' },
      { href: '/estados',  label: 'Estados Financieros', icon: 'Statement' },
    ]},
  ];

  // Inteligencia: visible solo si el rol ve analítica avanzada (admin/gerencia).
  if (verAvanzada) {
    groups.push({ group: 'Inteligencia', items: [
      { href: '/analitica', label: 'Analítica',   icon: 'TrendUp' },
      { href: '/ai',        label: 'AI Insights', icon: 'Sparkles', badge: { text: '3 alertas', kind: 'warn' } },
    ]});
  }

  // Admin: solo si rol = admin.
  if (esAdmin) {
    groups.push({ group: 'Admin', items: [
      { href: '/admin/usuarios', label: 'Usuarios y AI', icon: 'Users' },
    ]});
  }

  return groups;
}

interface SidebarProps {
  deudasVencidasCount?: number;
  rol?: Role;
  email?: string;
}

export function Sidebar({ deudasVencidasCount, rol }: SidebarProps = {}) {
  const pathname = usePathname();
  const NAV = buildNav({ deudasVencidasCount, rol });

  // El item activo es el de href más específico que matchea (evita que
  // /cobros y /cobros/identificar se marquen ambos a la vez).
  const activeHref = NAV
    .flatMap(g => g.items)
    .filter(it => pathname === it.href || pathname?.startsWith(it.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

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
            const active = it.href === activeHref;
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
