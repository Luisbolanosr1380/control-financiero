'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMensaje } from './use-auros-chat';

export function MensajeAuros({ mensaje }: { mensaje: ChatMensaje }) {
  const [funcionesAbiertas, setFuncionesAbiertas] = useState(false);
  return (
    <div className="msg-ai">
      <div className="ai-label">Auros</div>
      {/* Auros responde en Markdown (negritas, listas): se renderiza en vez de mostrar los asteriscos. */}
      <div className="ai-text ai-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{mensaje.contenido}</ReactMarkdown>
      </div>
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
