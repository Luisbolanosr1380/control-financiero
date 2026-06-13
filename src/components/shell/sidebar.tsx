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

function buildNav(opts: { facturasVencidasCount?: number; deudasVencidasCount?: number; pagosPendientesCount?: number; pagosPendientesAlertasRojas?: number; ncsPendientesCount?: number; rol?: Role } = {}): NavGroup[] {
  // F-043: badge dinámico de facturas vencidas (antes hardcoded "5 vencidas").
  // Fuente: getFacturasLiviano + predicadoFiltro('vencidas') vía getSidebarBadges.
  const facturasBadge = opts.facturasVencidasCount && opts.facturasVencidasCount > 0
    ? { text: `${opts.facturasVencidasCount} vencidas`, kind: 'wine' as const }
    : undefined;
  const deudasBadge = opts.deudasVencidasCount && opts.deudasVencidasCount > 0
    ? { text: `${opts.deudasVencidasCount} vencidas`, kind: 'wine' as const }
    : undefined;
  // F-038.4: badge dinámico de pagos pendientes a empleados. Wine si hay alertas
  // rojas (10+ días), warn si solo hay pendientes en general.
  const pagosPendBadge = opts.pagosPendientesAlertasRojas && opts.pagosPendientesAlertasRojas > 0
    ? { text: `${opts.pagosPendientesAlertasRojas} críticos`, kind: 'wine' as const }
    : opts.pagosPendientesCount && opts.pagosPendientesCount > 0
      ? { text: `${opts.pagosPendientesCount} pend.`, kind: 'warn' as const }
      : undefined;
  const rol = opts.rol;
  const esAdmin0 = rol === 'admin';
  // F-045: badge "X aprobar" SOLO para admin (los demás usuarios no aprueban).
  const ncsBadge = esAdmin0 && opts.ncsPendientesCount && opts.ncsPendientesCount > 0
    ? { text: `${opts.ncsPendientesCount} aprobar`, kind: 'warn' as const }
    : undefined;
  const verAvanzada = rol && PERMISSIONS[rol].verAnaliticaAvanzada;
  const esAdmin = rol === 'admin';

  const groups: NavGroup[] = [
    { group: 'Operación', items: [
      { href: '/dashboard',    label: 'Dashboard',    icon: 'Dashboard' },
      { href: '/facturacion',  label: 'Facturación',  icon: 'Receipt', badge: facturasBadge },
      { href: '/notas-credito',label: 'Notas de Crédito', icon: 'Receipt', badge: ncsBadge },   // F-045
      { href: '/cobros',       label: 'Cobros',       icon: 'Coins' },
      { href: '/cobros/identificar', label: 'Identificar pago', icon: 'Search' },
      { href: '/clientes',     label: 'Clientes',     icon: 'Users' },
    ]},
    { group: 'Gastos', items: [
      { href: '/gastos',       label: 'Gastos',         icon: 'Expense' },
      { href: '/flujo',        label: 'Centro de Pagos',icon: 'Calendar' },  // F-051
      { href: '/bancos',       label: 'Bancos',         icon: 'Bank' },
      { href: '/empleados',    label: 'Empleados',      icon: 'Users' },   // F-037
      { href: '/planillas',    label: 'Planillas',      icon: 'Payroll' }, // F-038
      { href: '/planillas/pendientes', label: 'Pagos pendientes', icon: 'Clock', badge: pagosPendBadge },   // F-038.4
      { href: '/deudas',       label: 'Deudas',         icon: 'Debt', badge: deudasBadge },
      { href: '/pagos-deudas', label: 'Pagos a deudas', icon: 'Coins' },
    ]},
    { group: 'Contabilidad', items: [
      { href: '/asientos',                       label: 'Asientos',            icon: 'Journal' },
      { href: '/reportes/estado-resultados',     label: 'Estado de Resultados',icon: 'TrendUp' },   // F-058
      { href: '/reportes/balance-general',       label: 'Balance General',     icon: 'PieChart' }, // F-059
      { href: '/estados',                        label: 'Estados Financieros', icon: 'Statement' },
      { href: '/retenciones',                    label: 'Retenciones',         icon: 'Statement' },
    ]},
  ];

  // Inteligencia: visible solo si el rol ve analítica avanzada (admin/gerencia).
  if (verAvanzada) {
    groups.push({ group: 'Inteligencia', items: [
      { href: '/analitica', label: 'Analítica',   icon: 'TrendUp' },
      // F-043: el badge "3 alertas" anterior era literal hardcoded sin fuente real
      // (la tabla AI_ANALISIS no tiene concepto de "alertas"). Eliminado hasta que
      // exista una métrica con sentido para mostrar acá.
      { href: '/ai',        label: 'AI Insights', icon: 'Sparkles' },
    ]});
  }

  // Admin: solo si rol = admin.
  if (esAdmin) {
    groups.push({ group: 'Admin', items: [
      { href: '/admin/usuarios',     label: 'Usuarios y AI',   icon: 'Users' },
      { href: '/admin/intercompany', label: 'Intercompany',    icon: 'Journal' },   // F-056.1
    ]});
  }

  // F-046: ayuda al final, accesible para todos los roles.
  groups.push({ group: 'Ayuda', items: [
    { href: '/ayuda', label: 'Centro de Ayuda', icon: 'Help' },
  ]});

  return groups;
}

interface SidebarProps {
  facturasVencidasCount?: number;         // F-043
  deudasVencidasCount?: number;
  pagosPendientesCount?: number;          // F-038.4
  pagosPendientesAlertasRojas?: number;   // F-038.4
  ncsPendientesCount?: number;            // F-045
  rol?: Role;
  email?: string;
}

export function Sidebar({ facturasVencidasCount, deudasVencidasCount, pagosPendientesCount, pagosPendientesAlertasRojas, ncsPendientesCount, rol }: SidebarProps = {}) {
  const pathname = usePathname();
  const NAV = buildNav({ facturasVencidasCount, deudasVencidasCount, pagosPendientesCount, pagosPendientesAlertasRojas, ncsPendientesCount, rol });

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
