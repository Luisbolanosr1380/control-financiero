'use client';

/**
 * Auros a pantalla completa en el teléfono: burbujas, input fijo abajo y
 * preguntas sugeridas tocables. La lógica es la del drawer de escritorio
 * (useAurosChat → /api/ai/chat, READ-ONLY, con el límite del rol).
 */
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { Role } from '@/lib/auth/allowlist';
import { useAurosChat, type ChatMensaje } from '@/components/auros/use-auros-chat';
import { MensajeAuros } from '@/components/auros/mensaje-auros';
import { SUGERENCIAS_MOVIL } from '@/lib/movil/secciones';
import s from './movil.module.css';

const CLAVE_HISTORIAL = 'auros-movil-historial';

interface Props { rol: Role; consumoMensual: number; limiteMensual: number; dueno: string }

export function AurosMovil({ rol, consumoMensual, limiteMensual, dueno }: Props) {
  const [mensajes, setMensajes] = useState<ChatMensaje[]>([]);
  const [input, setInput] = useState('');
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // El historial sobrevive al cambiar de pestaña (Auros ↔ Capturar) mientras dure la sesión del navegador.
  useEffect(() => {
    try { const g = sessionStorage.getItem(CLAVE_HISTORIAL); if (g) setMensajes(JSON.parse(g)); } catch { /* sin storage */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(mensajes.slice(-30))); } catch { /* sin storage */ }
  }, [mensajes]);

  const chat = useAurosChat({ rol, mensajes, setMensajes, consumoMensual, limiteMensual });
  const { tienePermiso, consumoVivo, limiteVivo, sinLimite, limiteAlcanzado, pendiente, error, reintentar } = chat;

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, pendiente, error]);

  const enviar = (texto?: string) => {
    const msg = (texto ?? input).trim();
    if (!msg || pendiente || limiteAlcanzado) return;
    setInput('');
    inputRef.current?.blur();   // baja el teclado para que se vea la respuesta
    void chat.enviar(msg);
  };

  const tocarSugerencia = (texto: string) => {
    if (texto.endsWith('…')) {   // "Contame del cliente…" necesita el nombre: se completa a mano
      setInput(texto.replace('…', ' '));
      inputRef.current?.focus();
      return;
    }
    enviar(texto);
  };

  if (!tienePermiso) {
    return <div className={s.captura}><div className={s.resultadoMal}>Tu rol no incluye Auros.</div></div>;
  }

  return (
    <div className={s.chat}>
      <div className={s.mensajes} ref={msgsRef}>
        {mensajes.length === 0 && (
          <>
            <div className={s.bienvenida}>
              Hola {dueno}, soy <strong>Auros</strong>. Preguntame lo que quieras de los números de la empresa.
            </div>
            <div className={s.sugerencias}>
              {SUGERENCIAS_MOVIL.map(t => (
                <button key={t} type="button" className={s.sugerencia} onClick={() => tocarSugerencia(t)} disabled={pendiente || limiteAlcanzado}>{t}</button>
              ))}
            </div>
          </>
        )}
        {mensajes.map((m, i) => (
          m.rol === 'user'
            ? <div key={i} className={s.burbujaUser}>{m.contenido}</div>
            : <div key={i} className={s.burbujaAuros}><MensajeAuros mensaje={m} /></div>
        ))}
        {pendiente && <div className={s.escribiendo}>Auros está buscando los datos…</div>}
        {error && (
          <div className={s.error} role="alert" data-auros-error>
            <span>{error}</span>
            {mensajes[mensajes.length - 1]?.rol === 'user' && <button type="button" className={s.linkBtn} onClick={reintentar}>Reintentar</button>}
          </div>
        )}
      </div>
      <div className={s.barraInput}>
        <textarea
          ref={inputRef}
          className={s.campoChat}
          value={input}
          rows={1}
          placeholder={limiteAlcanzado ? 'Llegaste al límite del mes' : 'Preguntale a Auros…'}
          disabled={limiteAlcanzado}
          enterKeyHint="send"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
        />
        <button type="button" className={s.enviar} onClick={() => enviar()} disabled={pendiente || !input.trim() || limiteAlcanzado} aria-label="Enviar">
          <Send size={18} />
        </button>
      </div>
      <div className={s.pie}>
        {sinLimite ? 'Consultas ilimitadas' : `${consumoVivo} de ${limiteVivo} consultas este mes`}
        {mensajes.length > 0 && <> · <button type="button" className={s.linkBtn} style={{ fontSize: 11, padding: 0 }} onClick={() => { chat.nuevoChat(); setInput(''); }}>Nueva conversación</button></>}
      </div>
    </div>
  );
}
