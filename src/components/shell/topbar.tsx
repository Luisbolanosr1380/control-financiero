'use client';

import { I } from '@/components/common/icons';
import { UserButton } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';

interface TopbarProps {
  aiOpen: boolean;
  setAiOpen: (open: boolean) => void;
  onSearch: () => void;
}

const ROUTE_CRUMBS: Record<string, string[]> = {
  '/dashboard':   ['Dashboard'],
  '/facturacion': ['Operación', 'Facturación'],
  '/cobros':      ['Operación', 'Cobros'],
  '/clientes':    ['Operación', 'Clientes'],
  '/gastos':      ['Gastos'],
  '/bancos':      ['Gastos', 'Bancos'],
  '/planilla':    ['Gastos', 'Planilla'],
  '/deudas':      ['Gastos', 'Deudas'],
  '/asientos':    ['Contabilidad', 'Asientos'],
  '/estados':     ['Contabilidad', 'Estados'],
  '/ai':          ['Inteligencia'],
};

function getCrumbs(pathname: string | null): string[] {
  if (!pathname) return ['Inicio'];
  // facturacion/[id]
  if (pathname.startsWith('/facturacion/')) return ['Operación', 'Facturación', 'Detalle'];
  if (pathname.startsWith('/clientes/'))    return ['Operación', 'Clientes', 'Cliente'];
  return ROUTE_CRUMBS[pathname] ?? [pathname.slice(1)];
}

export function Topbar({ aiOpen, setAiOpen, onSearch }: TopbarProps) {
  const pathname = usePathname();
  const crumbs = getCrumbs(pathname);

  return (
    <header className="topbar">
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? 'crumb-current' : ''}>{c}</span>
          </span>
        ))}
      </div>

      <div className="period-picker">
        <I.Calendar size={13} /> Mayo 2026 <I.ChevDown size={13} />
      </div>

      <button className="global-search" onClick={onSearch}>
        <I.Search size={14} />
        <span>Buscar facturas, clientes, asientos…</span>
        <span className="kbd">⌘K</span>
      </button>

      <div className="topbar-right">
        <button className="btn btn-secondary">
          <I.Plus size={13} /> Nuevo <span className="kbd">⌘N</span>
        </button>
        <button
          className={'btn ' + (aiOpen ? 'btn-secondary' : 'btn-primary')}
          onClick={() => setAiOpen(!aiOpen)}
        >
          <I.Sparkles size={13} /> Asistente AI
        </button>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 4 }}>
          <UserButton />
        </div>
      </div>
    </header>
  );
}
