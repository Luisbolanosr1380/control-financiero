'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { VistaResumen } from '@/lib/movil/secciones';
import s from './movil.module.css';

const VISTA: Record<VistaResumen, { href: string; label: string }> = {
  hoy: { href: '/m/resumen', label: 'Hoy' },
  flujo: { href: '/m/resumen/flujo', label: 'Flujo' },
  cobrar: { href: '/m/resumen/cobrar', label: 'Por cobrar' },
};

export function TabsResumen({ vistas }: { vistas: VistaResumen[] }) {
  const pathname = usePathname() ?? '';
  return (
    <nav className={s.segmentos} aria-label="Vistas del resumen">
      {vistas.map(v => {
        const { href, label } = VISTA[v];
        const activo = v === 'hoy' ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={v} href={href} className={`${s.segmento} ${activo ? s.segmentoActivo : ''}`} aria-current={activo ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
