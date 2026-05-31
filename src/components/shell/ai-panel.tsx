'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/common/icons';
import { usePathname } from 'next/navigation';

export interface ChatMensaje {
  rol: 'user' | 'assistant';
  contenido: string;
  funcionesUsadas?: Array<{ nombre: string; argumentos: unknown }>;
  costoUSD?: number;
  ms?: number;
}

interface ChatResponse {
  ok: boolean;
  error?: string;
  respuesta?: string;
  costoUSD?: number;
  funcionesUsadas?: Array<{ nombre: string; argumentos: unknown }>;
  ms?: number;
}

interface AIPanelProps {
  onClose: () => void;
  mensajes: ChatMensaje[];
  setMensajes: React.Dispatch<React.SetStateAction<ChatMensaje[]>>;
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

export function AIPanel({ onClose, mensajes, setMensajes }: AIPanelProps) {
  const pathname = usePathname();
  const screenName = getScreenName(pathname);

  const [input, setInput] = useState('');
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const costoTotal = mensajes.reduce((s, m) => s + (m.costoUSD ?? 0), 0);

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, pendiente]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const enviar = async (texto?: string) => {
    const msg = (texto ?? input).trim();
    if (!msg || pendiente) return;
    setError(null);
    setInput('');
    const historial = mensajes.map(m => ({ role: m.rol, content: m.contenido }));
    setMensajes(prev => [...prev, { rol: 'user', contenido: msg }]);
    setPendiente(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historial, newMessage: msg }),
      });
      const data: ChatResponse = await res.json();
      if (!data.ok || !data.respuesta) {
        setError(data.error ?? 'Respuesta vacía del servidor');
        return;
      }
      setMensajes(prev => [...prev, {
        rol: 'assistant',
        contenido: data.respuesta!,
        funcionesUsadas: data.funcionesUsadas,
        costoUSD: data.costoUSD,
        ms: data.ms,
      }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendiente(false);
      inputRef.current?.focus();
    }
  };

  const reintentar = () => {
    const ult = mensajes[mensajes.length - 1];
    if (!ult || ult.rol !== 'user') return;
    setMensajes(prev => prev.slice(0, -1));
    void enviar(ult.contenido);
  };

  const nuevoChat = () => {
    setMensajes([]);
    setError(null);
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
            Hola Stark, soy <strong>Auros</strong>. Te ayudo a leer tus datos financieros. ¿Qué querés saber hoy?
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
        <div className="ai-input-box" style={{ alignItems: 'flex-end', gap: 6 }}>
          <I.Sparkles size={14} style={{ color: 'var(--ink-3)', marginBottom: 6 }} />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Preguntá algo o describí una acción..."
            disabled={pendiente}
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
            disabled={pendiente || !input.trim()}
            title="Enviar (Enter)"
          >
            <I.Send size={12} />
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'right' }}>
          Sesión: ${costoTotal.toFixed(4)} USD
          {mensajes.length > 0 && <> · {mensajes.filter(m => m.rol === 'assistant').length} respuesta(s)</>}
        </div>
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

function MensajeAuros({ mensaje }: { mensaje: ChatMensaje }) {
  const [funcionesAbiertas, setFuncionesAbiertas] = useState(false);
  return (
    <div className="msg-ai">
      <div className="ai-label">Auros</div>
      <div className="ai-text" style={{ whiteSpace: 'pre-wrap' }}>{mensaje.contenido}</div>
      {mensaje.funcionesUsadas && mensaje.funcionesUsadas.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--ink-4)' }}>
          <button
            type="button"
            onClick={() => setFuncionesAbiertas(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)',
              padding: 0, fontSize: 10.5, fontFamily: 'inherit',
            }}
          >
            {funcionesAbiertas ? '▾' : '▸'} {mensaje.funcionesUsadas.length} función{mensaje.funcionesUsadas.length === 1 ? '' : 'es'}
            {mensaje.costoUSD !== undefined && <> · ${mensaje.costoUSD.toFixed(4)}</>}
            {mensaje.ms !== undefined && <> · {(mensaje.ms / 1000).toFixed(1)}s</>}
          </button>
          {funcionesAbiertas && (
            <pre style={{
              marginTop: 4, padding: '6px 8px', background: 'var(--paper)',
              border: '1px solid var(--line-3)', borderRadius: 4, fontSize: 10,
              color: 'var(--ink-3)', overflowX: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
{mensaje.funcionesUsadas.map((f, i) => `${i + 1}. ${f.nombre}(${JSON.stringify(f.argumentos)})`).join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
