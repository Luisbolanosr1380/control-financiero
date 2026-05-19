'use client';

import { I } from '@/components/common/icons';
import { usePathname } from 'next/navigation';

interface AIPanelProps {
  onClose: () => void;
}

const SCREEN_NAMES: Record<string, string> = {
  '/dashboard':   'Dashboard CFO',
  '/facturacion': 'Listado de facturas',
  '/cobros':      'Cobros y recibos',
  '/clientes':    'Listado de clientes',
  '/asientos':    'Asientos contables',
  '/estados':     'Estados financieros',
  '/ai':          'AI Insights Center',
};

function getScreenName(pathname: string | null): string {
  if (!pathname) return 'Inicio';
  if (pathname.startsWith('/facturacion/')) return 'Detalle factura';
  if (pathname.startsWith('/clientes/'))    return 'Cuenta corriente';
  return SCREEN_NAMES[pathname] ?? pathname;
}

export function AIPanel({ onClose }: AIPanelProps) {
  const pathname = usePathname();
  const screenName = getScreenName(pathname);

  const chips = [
    '¿Quiénes son mis 5 deudores más críticos?',
    'Resumen del mes',
    '¿Qué hago hoy primero?',
    'Proyectar cash a 30 días',
  ];

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div className="ai-avatar"></div>
        <div style={{ flex: 1 }}>
          <div className="ai-title">Asistente</div>
          <div className="ai-sub">Modelo financiero · contexto Q2 &apos;26</div>
        </div>
        <button className="modal-close" onClick={onClose}><I.X size={16} /></button>
      </div>

      <div className="ai-context">
        <span className="ctx-label">Contexto</span>
        <span>·</span>
        <span style={{ color: 'var(--ink-2)' }}>{screenName}</span>
      </div>

      <div className="ai-chips">
        {chips.map((c, i) => <button key={i} className="chip">{c}</button>)}
      </div>

      <div className="ai-messages">
        <div className="msg-user">¿Cuál es el estado de la cobranza este mes?</div>

        <div className="msg-ai">
          <div className="ai-label">Asistente</div>
          <div className="ai-text">
            Cobranza de mayo va <strong>18% por debajo</strong> de marzo. Llevás <strong className="num">Q184K</strong> cobrados sobre <strong className="num">Q281K</strong> facturados. La caída es por <em>TalentTrack</em>, que sigue en 0% de cobranza acumulada.
          </div>
          <div className="ai-data-block">
            <div className="ai-data-row"><span className="lbl">Cobrado mayo</span><span className="val num">Q184,000</span></div>
            <div className="ai-data-row"><span className="lbl">Esperado mayo</span><span className="val num">Q225,000</span></div>
            <div className="ai-data-row"><span className="lbl">Gap</span><span className="val num">−Q41,000</span></div>
          </div>
          <div className="ai-action-row">
            <button className="ai-action-btn primary">Ver detalle por línea</button>
            <button className="ai-action-btn">Programar reunión TT</button>
          </div>
        </div>

        <div className="msg-user">Mostrame los clientes que tienen +90 días</div>

        <div className="msg-ai">
          <div className="ai-label">Asistente</div>
          <div className="ai-text">
            5 clientes concentran <strong className="num">Q733K</strong> en el bucket +90 días. <em>Fundación Genesis</em> lidera con <strong className="num">Q246K</strong> y no responde correos desde el 12 de abril.
          </div>
          <div className="ai-action-row">
            <button className="ai-action-btn primary">Abrir top 5 deudores</button>
            <button className="ai-action-btn">Generar cartas de cobro</button>
          </div>
        </div>
      </div>

      <div className="ai-input">
        <div className="ai-input-box">
          <I.Sparkles size={14} style={{ color: 'var(--ink-3)' }} />
          <input placeholder="Preguntá algo o describí una acción…" />
          <button className="ai-send"><I.Send size={12} /></button>
        </div>
      </div>
    </aside>
  );
}
