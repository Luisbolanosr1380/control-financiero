'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Camera, LayoutGrid, Sparkles } from 'lucide-react';
import { PermisosProvider } from '@/components/auth/permisos';
import type { Role } from '@/lib/auth/allowlist';
import type { SeccionMovil } from '@/lib/movil/secciones';
import { BannerInstalar } from './banner-instalar';
import s from './movil.module.css';

interface Props {
  children: React.ReactNode;
  rol: Role;
  secciones: SeccionMovil[];
  empresa: string;
  nombreApp: string;
  iniciales: string;
  iconoUrl: string | null;
  colorMarca: string;
}

const ROL_LABEL: Record<Role, string> = { admin: 'Admin', contador: 'Contador', auxiliar: 'Auxiliar', lectura: 'Solo lectura' };
const SECCION: Record<SeccionMovil, { href: string; label: string; Icono: typeof Sparkles }> = {
  auros: { href: '/m/auros', label: 'Auros', Icono: Sparkles },
  captura: { href: '/m/captura', label: 'Capturar', Icono: Camera },
  resumen: { href: '/m/resumen', label: 'Resumen', Icono: LayoutGrid },
};

export function MovilShell({ children, rol, secciones, empresa, nombreApp, iniciales, iconoUrl, colorMarca }: Props) {
  const pathname = usePathname() ?? '';
  return (
    <PermisosProvider rol={rol}>
      <div className={s.app}>
        <header className={s.head}>
          <div className={s.marca} style={{ background: colorMarca }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {iconoUrl ? <img src={iconoUrl} alt="" /> : iniciales}
          </div>
          <div className={s.headTxt}>
            <div className={s.headTitulo}>{nombreApp}</div>
            <div className={s.headSub}>{empresa} · {ROL_LABEL[rol]}</div>
          </div>
        </header>
        <BannerInstalar />
        <main className={s.contenido}>{children}</main>
        <nav className={s.nav} aria-label="Secciones">
          {secciones.map(k => {
            const { href, label, Icono } = SECCION[k];
            const activo = pathname.startsWith(href);
            return (
              <Link key={k} href={href} className={`${s.navItem} ${activo ? s.navItemActivo : ''}`} aria-current={activo ? 'page' : undefined}>
                <Icono size={20} strokeWidth={activo ? 2.2 : 1.7} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </PermisosProvider>
  );
}
