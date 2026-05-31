'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/common/icons';

type Rol = 'user' | 'assistant';
interface Mensaje {
  rol: Rol;
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
  tokensInput?: number;
  tokensOutput?: number;
  funcionesUsadas?: Array<{ nombre: string; argumentos: unknown }>;
  pasos?: number;
  ms?: number;
}

const SUGERENCIAS = [
  '¿Cómo viene este mes?',
  '¿Quiénes son mis intocables?',
  '¿Qué clientes están en riesgo?',
];

export function ChatClient() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const costoTotal = mensajes.reduce((s, m) => s + (m.costoUSD ?? 0), 0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, pendiente]);

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
      textareaRef.current?.focus();
    }
  };

  const reintentar = () => {
    // El último mensaje fue del user (no recibió respuesta). Lo re-enviamos.
    const ult = mensajes[mensajes.length - 1];
    if (!ult || ult.rol !== 'user') return;
    setMensajes(prev => prev.slice(0, -1));
    void enviar(ult.contenido);
  };

  const nuevoChat = () => {
    setMensajes([]);
    setError(null);
    setInput('');
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', maxWidth: 880, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="page-title">Chat AI</h1>
          <div className="page-subtitle">Preguntas en lenguaje natural sobre tus datos — Gemini 2.5 Flash</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={nuevoChat} disabled={pendiente || mensajes.length === 0}>
            <I.Plus size={13} /> Nuevo chat
          </button>
        </div>
      </div>

      {/* Lista de mensajes */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px 4px',
          border: '1px solid var(--line-3)', borderRadius: 'var(--r-3, 10px)',
          background: 'var(--paper)',
        }}
      >
        {mensajes.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
            <I.Sparkles size={28} style={{ opacity: 0.5, marginBottom: 12 }} />
            <div style={{ fontSize: 14, marginBottom: 18 }}>Preguntá lo que quieras saber sobre tus datos.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGERENCIAS.map(s => (
                <button
                  key={s}
                  className="btn btn-ghost"
                  style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line-2)' }}
                  onClick={() => void enviar(s)}
                  disabled={pendiente}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
            {mensajes.map((m, i) => <Burbuja key={i} mensaje={m} />)}
            {pendiente && (
              <div style={{ alignSelf: 'flex-start', color: 'var(--ink-3)', fontSize: 13, padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="chat-dots"><span /><span /><span /></span>
                Escribiendo...
              </div>
            )}
            {error && (
              <div style={{
                alignSelf: 'stretch', padding: '10px 12px', borderRadius: 8,
                background: 'rgba(138, 42, 42, 0.06)', border: '1px solid var(--wine)', color: 'var(--wine)',
                fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
                <span><strong>Error:</strong> {error}</span>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={reintentar}>
                  Reintentar
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input + Send */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribí tu pregunta. Enter envía, Shift+Enter nueva línea."
          disabled={pendiente}
          rows={2}
          style={{
            flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--line-2)', background: 'var(--paper-2)',
            fontFamily: 'inherit', fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5,
            outline: 'none',
          }}
        />
        <button
          className="btn btn-primary"
          onClick={() => void enviar()}
          disabled={pendiente || !input.trim()}
          style={{ height: 64, padding: '0 16px' }}
        >
          <I.Send size={14} /> Enviar
        </button>
      </div>

      {/* Footer: costo total acumulado */}
      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-4)', textAlign: 'center' }}>
        Costo acumulado de la sesión: <strong style={{ color: 'var(--ink-3)' }}>${costoTotal.toFixed(4)} USD</strong>
        {mensajes.length > 0 && <> · {mensajes.filter(m => m.rol === 'assistant').length} respuesta(s)</>}
      </div>

      <style jsx>{`
        .chat-dots { display: inline-flex; gap: 3px; align-items: center; }
        .chat-dots span {
          width: 5px; height: 5px; border-radius: 50%; background: var(--ink-4);
          animation: chatBlink 1.2s infinite ease-in-out;
        }
        .chat-dots span:nth-child(2) { animation-delay: 0.2s; }
        .chat-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes chatBlink {
          0%, 80%, 100% { opacity: 0.3; }
          40%           { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function Burbuja({ mensaje }: { mensaje: Mensaje }) {
  const [funcionesVisible, setFuncionesVisible] = useState(false);
  const esUser = mensaje.rol === 'user';
  return (
    <div style={{ alignSelf: esUser ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
      <div style={{
        padding: '10px 14px', borderRadius: 12,
        background: esUser ? 'var(--ink)' : 'var(--paper-2)',
        color: esUser ? 'var(--paper)' : 'var(--ink)',
        border: esUser ? 'none' : '1px solid var(--line-3)',
        fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
      }}>
        {mensaje.contenido}
      </div>
      {!esUser && mensaje.funcionesUsadas && mensaje.funcionesUsadas.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
          <button
            type="button"
            onClick={() => setFuncionesVisible(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)',
              padding: '2px 4px', fontSize: 11, fontFamily: 'inherit',
            }}
            title="Ver qué funciones del sistema consultó la AI"
          >
            {funcionesVisible ? '▾' : '▸'} {mensaje.funcionesUsadas.length} función{mensaje.funcionesUsadas.length === 1 ? '' : 'es'} consultada{mensaje.funcionesUsadas.length === 1 ? '' : 's'}
            {mensaje.costoUSD !== undefined && <> · ${mensaje.costoUSD.toFixed(4)}</>}
            {mensaje.ms !== undefined && <> · {(mensaje.ms / 1000).toFixed(1)}s</>}
          </button>
          {funcionesVisible && (
            <pre style={{
              marginTop: 4, padding: '8px 10px', background: 'var(--paper)', border: '1px solid var(--line-3)',
              borderRadius: 6, fontSize: 10.5, color: 'var(--ink-3)', overflowX: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
{mensaje.funcionesUsadas.map((f, i) =>
  `${i + 1}. ${f.nombre}(${JSON.stringify(f.argumentos)})`,
).join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
