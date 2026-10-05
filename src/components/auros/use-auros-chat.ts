'use client';

/**
 * Lógica del chat de Auros compartida por el drawer de escritorio y la
 * pantalla completa del teléfono: el historial, el envío a /api/ai/chat y
 * el consumo mensual en vivo. El endpoint revalida permiso y límite.
 */
import { useEffect, useState } from 'react';
import type { Role } from '@/lib/auth/allowlist';
import { PERMISSIONS } from '@/lib/auth/permissions';

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
  consumoMensual?: number;
  limite?: number | null;
  mensaje?: string;
  consumoActual?: number;
}

export function useAurosChat(args: {
  rol: Role;
  mensajes: ChatMensaje[];
  setMensajes: React.Dispatch<React.SetStateAction<ChatMensaje[]>>;
  consumoMensual: number;
  limiteMensual: number;
  onDespuesDeEnviar?: () => void;
}) {
  const { rol, mensajes, setMensajes, consumoMensual, limiteMensual, onDespuesDeEnviar } = args;
  const tienePermiso = PERMISSIONS[rol].aurosChat;
  const [consumoVivo, setConsumoVivo] = useState<number>(consumoMensual);
  const [limiteVivo, setLimiteVivo] = useState<number>(limiteMensual);
  useEffect(() => { setConsumoVivo(consumoMensual); setLimiteVivo(limiteMensual); }, [consumoMensual, limiteMensual]);

  const sinLimite = !Number.isFinite(limiteVivo) || limiteVivo === Infinity;
  const limiteAlcanzado = !sinLimite && tienePermiso && consumoVivo >= limiteVivo;
  const cercaDelLimite = !sinLimite && tienePermiso && !limiteAlcanzado && consumoVivo >= limiteVivo * 0.8;

  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (texto: string) => {
    const msg = texto.trim();
    if (!msg || pendiente) return;
    setError(null);
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
      // El backend devuelve mensaje legible para LIMITE_ALCANZADO / SIN_PERMISO
      if (!data.ok || !data.respuesta) {
        setError(data.mensaje ?? data.error ?? 'Respuesta vacía del servidor');
        if (typeof data.consumoActual === 'number') setConsumoVivo(data.consumoActual);
        if (typeof data.limite === 'number') setLimiteVivo(data.limite);
        return;
      }
      setMensajes(prev => [...prev, {
        rol: 'assistant',
        contenido: data.respuesta!,
        funcionesUsadas: data.funcionesUsadas,
        costoUSD: data.costoUSD,
        ms: data.ms,
      }]);
      if (typeof data.consumoMensual === 'number') setConsumoVivo(data.consumoMensual);
      if (typeof data.limite === 'number') setLimiteVivo(data.limite);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendiente(false);
      onDespuesDeEnviar?.();
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
  };

  return {
    tienePermiso, consumoVivo, limiteVivo, sinLimite, limiteAlcanzado, cercaDelLimite,
    pendiente, error, enviar, reintentar, nuevoChat,
    costoTotal: mensajes.reduce((s, m) => s + (m.costoUSD ?? 0), 0),
  };
}
