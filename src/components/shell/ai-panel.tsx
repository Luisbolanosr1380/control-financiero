'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/common/icons';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/auth/allowlist';
import { useAurosChat, type ChatMensaje } from '@/components/auros/use-auros-chat';
import { MensajeAuros } from '@/components/auros/mensaje-auros';

export type { ChatMensaje };

interface AIPanelProps {
  onClose: () => void;
  mensajes: ChatMensaje[];
  setMensajes: React.Dispatch<React.SetStateAction<ChatMensaje[]>>;
  rol: Role;
  consumoMensual: number;     // del server al abrir el drawer
  limiteMensual: number;       // 0 si rol sin permiso, Infinity (admin) o número
  dueno?: string;              // cómo saluda Auros (config de la empresa del deploy)
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

const SUGERENCIAS = [
  '¿Quiénes son mis 5 deudores más críticos?',
  'Resumen del mes',
  '¿Qué hago hoy primero?',
  'Proyectar cash a 30 días',
];

export function AIPanel({ onClose, mensajes, setMensajes, rol, consumoMensual, limiteMensual, dueno }: AIPanelProps) {
  const pathname = usePathname();
  const screenName = getScreenName(pathname);

  const [input, setInput] = useState('');
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chat = useAurosChat({
    rol, mensajes, setMensajes, consumoMensual, limiteMensual,
    onDespuesDeEnviar: () => inputRef.current?.focus(),
  });
  const { tienePermiso, consumoVivo, limiteVivo, sinLimite, limiteAlcanzado, cercaDelLimite, pendiente, error, reintentar, costoTotal } = chat;

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, pendiente]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const enviar = async (texto?: string) => {
    const msg = (texto ?? input).trim();
    if (!msg || pendiente) return;
    setInput('');
    await chat.enviar(msg);
  };

  const nuevoChat = () => {
    chat.nuevoChat();
    setInput('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div className="ai-avatar"></div>
        <div style={{ flex: 1 }}>
          <div className="ai-title">Auros</div>
          <div className="ai-sub">Auros · Modelo financiero · Q2 2026</div>
        </div>
        {mensajes.length > 0 && (
          <button
            className="modal-close"
            onClick={nuevoChat}
            disabled={pendiente}
            title="Nuevo chat"
            style={{ marginRight: 4 }}
          >
            <I.Plus size={14} />
          </button>
        )}
        <button className="modal-close" onClick={onClose} title="Cerrar"><I.X size={16} /></button>
      </div>

      <div className="ai-context">
        <span className="ctx-label">Contexto</span>
        <span>·</span>
        <span style={{ color: 'var(--ink-2)' }}>{screenName}</span>
      </div>

      {/* Aviso de uso */}
      <div style={{
        margin: '8px 16px 0',
        padding: '8px 10px',
        background: 'var(--paper-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 6,
        fontSize: 11.5,
        color: 'var(--ink-3)',
        lineHeight: 1.45,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
      }}>
        <I.Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Auros usa datos del sistema. Validá antes de decidir.</span>
      </div>

      {/* Sugerencias iniciales */}
      {mensajes.length === 0 && (
        <div className="ai-chips">
          {SUGERENCIAS.map((c, i) => (
            <button
              key={i}
              className="chip"
              onClick={() => void enviar(c)}
              disabled={pendiente}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="ai-messages" ref={msgsRef}>
        {mensajes.length === 0 ? (
          <div style={{ padding: '16px 4px 8px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            Hola{dueno ? ` ${dueno}` : ''}, soy <strong>Auros</strong>. Te ayudo a leer tus datos financieros. ¿Qué querés saber hoy?
          </div>
        ) : mensajes.map((m, i) => (
          m.rol === 'user'
            ? <div key={i} className="msg-user">{m.contenido}</div>
            : <MensajeAuros key={i} mensaje={m} />
        ))}

        {pendiente && (
          <div className="msg-ai" style={{ paddingTop: 4 }}>
            <div className="ai-label">Auros</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-3)' }}>
              <span className="ai-dots"><span /><span /><span /></span> Escribiendo...
            </div>
          </div>
        )}

        {error && (
          <div style={{
            margin: '6px 0', padding: '10px 12px', borderRadius: 6,
            background: 'rgba(138, 42, 42, 0.06)', border: '1px solid var(--wine)', color: 'var(--wine)',
            fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}>
            <span><strong>Error:</strong> {error}</span>
            <button className="ai-action-btn" onClick={reintentar} style={{ fontSize: 11 }}>Reintentar</button>
          </div>
        )}
      </div>

      <div className="ai-input">
        {!tienePermiso ? (
          <div style={{
            padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--line-2)',
            borderRadius: 6, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5,
          }}>
            Auros está disponible solo para roles <strong>Gerencia</strong> y <strong>Admin</strong>.
            Si necesitás acceso, hablá con un administrador.
          </div>
        ) : (
          <div className="ai-input-box" style={{ alignItems: 'flex-end', gap: 6 }}>
            <I.Sparkles size={14} style={{ color: 'var(--ink-3)', marginBottom: 6 }} />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={limiteAlcanzado ? 'Llegaste al límite mensual' : 'Preguntá algo o describí una acción...'}
              disabled={pendiente || limiteAlcanzado}
              rows={1}
              style={{
                flex: 1, resize: 'none', border: 'none', background: 'transparent',
                outline: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)',
                padding: '4px 0', lineHeight: 1.5, maxHeight: 96,
              }}
            />
            <button
              className="ai-send"
              onClick={() => void enviar()}
              disabled={pendiente || !input.trim() || limiteAlcanzado}
              title={limiteAlcanzado ? 'Límite alcanzado' : 'Enviar (Enter)'}
            >
              <I.Send size={12} />
            </button>
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'right' }}>
          Sesión: ${costoTotal.toFixed(4)} USD
          {mensajes.length > 0 && <> · {mensajes.filter(m => m.rol === 'assistant').length} respuesta(s)</>}
        </div>
        {tienePermiso && (
          <div style={{
            marginTop: 4, fontSize: 10.5, textAlign: 'right',
            color: limiteAlcanzado ? 'var(--wine)' : cercaDelLimite ? 'var(--burnt)' : 'var(--ink-4)',
            fontWeight: (limiteAlcanzado || cercaDelLimite) ? 500 : 400,
          }}>
            {sinLimite
              ? 'Consultas ilimitadas este mes'
              : `Consumiste ${consumoVivo} de ${limiteVivo} consultas este mes`
            }
          </div>
        )}
      </div>

      <style jsx>{`
        .ai-dots { display: inline-flex; gap: 3px; align-items: center; }
        .ai-dots span {
          width: 4px; height: 4px; border-radius: 50%; background: var(--ink-4);
          animation: aiBlink 1.2s infinite ease-in-out;
        }
        .ai-dots span:nth-child(2) { animation-delay: 0.2s; }
        .ai-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes aiBlink {
          0%, 80%, 100% { opacity: 0.3; }
          40%           { opacity: 1; }
        }
      `}</style>
    </aside>
  );
}
