'use client';

/**
 * F-047 — Acciones de boleta para una línea de planilla pagada.
 *
 * Estados:
 *  - sin boleta → botón "📄 Generar"
 *  - con boleta → ícono ✓ + "Descargar" + "Re-generar" (pide motivo inline)
 *  - estado != Pagado → no renderiza nada
 *
 * Layout pensado para ir en un <td> de la tabla; usa fontSize 11 y padding
 * mínimo para no romper la altura de la fila.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { I } from '@/components/common/icons';
import { HelpButton } from '@/components/ayuda/help-button';
import { generarBoletaAction, descargarBoletaAction } from '@/app/(app)/planillas/boletas-actions';
import type { EstadoPagoLinea } from '@/lib/db/planillas';

interface Props {
  lineaId: string;
  empleadoNombre: string;
  estadoPago: EstadoPagoLinea;
  boletaUrl?: string;
}

function descargarBase64(base64: string, filename: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BoletaAcciones({ lineaId, empleadoNombre, estadoPago, boletaUrl }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [motivo, setMotivo] = useState('');

  if (estadoPago !== 'Pagado') return null;

  const generar = async (opts: { motivoRegeneracion?: string } = {}) => {
    setLoading(true);
    try {
      const res = await generarBoletaAction(lineaId, opts);
      if (res.ok) {
        toast.success(res.yaExistia
          ? `Boleta regenerada para ${res.empleadoNombre ?? empleadoNombre}.`
          : `Boleta generada para ${res.empleadoNombre ?? empleadoNombre}.`);
        setPidiendoMotivo(false);
        setMotivo('');
        router.refresh();
      } else {
        toast.error(res.error ?? 'No se pudo generar.');
      }
    } finally { setLoading(false); }
  };

  const descargar = async () => {
    if (boletaUrl) {
      // Ya está en Airtable — abrir directo, evita re-render.
      window.open(boletaUrl, '_blank', 'noreferrer');
      return;
    }
    setLoading(true);
    try {
      const res = await descargarBoletaAction(lineaId);
      if (res.ok && res.base64 && res.filename) {
        descargarBase64(res.base64, res.filename);
      } else {
        toast.error(res.error ?? 'No se pudo descargar.');
      }
    } finally { setLoading(false); }
  };

  if (pidiendoMotivo) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input
          type="text"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo…"
          autoFocus
          className="input"
          style={{ fontSize: 10, padding: '2px 6px', width: 120 }}
          disabled={loading}
        />
        <button
          className="btn btn-danger"
          style={{ fontSize: 10, padding: '2px 6px' }}
          onClick={() => generar({ motivoRegeneracion: motivo })}
          disabled={loading || !motivo.trim()}
        >OK</button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 10, padding: '2px 6px' }}
          onClick={() => { setPidiendoMotivo(false); setMotivo(''); }}
          disabled={loading}
        >✕</button>
      </div>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {boletaUrl ? (
        <>
          <span style={{ fontSize: 11, color: 'var(--olive)' }} title="Boleta disponible">📄✓</span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 10, padding: '2px 6px' }}
            onClick={descargar}
            disabled={loading}
          >
            Descargar
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 10, padding: '2px 6px', color: 'var(--ink-3)' }}
            onClick={() => setPidiendoMotivo(true)}
            disabled={loading}
            title="Sobreescribir la boleta actual (queda en notas el motivo)"
          >
            Re-generar
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 10, padding: '2px 8px' }}
          onClick={() => generar()}
          disabled={loading}
        >
          📄 {loading ? 'Generando…' : 'Generar boleta'}
        </button>
      )}
      <HelpButton tag="boleta-pago" />
    </span>
  );
}
