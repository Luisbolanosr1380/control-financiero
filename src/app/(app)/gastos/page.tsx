import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { getFacturasInRecientes, getKPIsFacturasIn } from '@/lib/db/facturas-in';
import { Q } from '@/lib/utils';
import { UploadFacturas } from './_components/UploadFacturas';
import { FacturasInList } from './_components/FacturasInList';
import { HelpButton } from '@/components/ayuda/help-button';

export const revalidate = 30;

export default async function GastosPage() {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);

  // F-049: por ahora solo admin. Sin permisos granulares todavía
  // (operativo/gerencia van en F-046.4).
  if (rol !== 'admin') {
    redirect('/no-acceso');
  }

  const [facturas, kpis] = await Promise.all([
    getFacturasInRecientes(200),
    getKPIsFacturasIn(),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Gastos
            <HelpButton tag="modulo-gastos" />
          </h1>
          <div className="page-subtitle">
            Captura, OCR y bandeja de revisión. La validación final vendrá en F-050.
          </div>
        </div>
      </div>

      {/* KPIs ligeros */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 22 }}>
        <Kpi
          label="⏳ Pendientes de revisión"
          value={String(kpis.totalPendientes)}
          hint={kpis.totalPendientes > 0 ? `${Q(kpis.montoTotalPendientes)} en bandeja` : 'al día'}
          alarma={kpis.totalPendientes > 20}
        />
        <Kpi
          label="📥 Subidas últimos 7 días"
          value={String(kpis.subidasUltimos7Dias)}
          hint="captura activa"
        />
        <Kpi
          label="👥 Operadores"
          value={String(kpis.porSubidor.length)}
          hint={kpis.porSubidor.slice(0, 3).map(s => `${s.email.split('@')[0]} (${s.cantidad})`).join(' · ') || 'sin actividad'}
        />
      </div>

      <UploadFacturas />
      <FacturasInList facturas={facturas} />
    </div>
  );
}

function Kpi({ label, value, hint, alarma }: { label: string; value: string; hint?: string; alarma?: boolean }) {
  return (
    <div className="kpi" style={alarma ? { borderColor: 'var(--wine)' } : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: alarma ? 'var(--wine)' : 'var(--ink)' }}>{value}</div>
      {hint && <div className="kpi-delta"><span className="vs">{hint}</span></div>}
    </div>
  );
}
