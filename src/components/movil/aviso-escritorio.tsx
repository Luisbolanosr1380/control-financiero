'use client';

/**
 * Aviso para pantallas de escritorio abiertas desde un teléfono: en el
 * teléfono se consulta y se captura; en la computadora se opera. En vez del
 * layout descuadrado, una salida clara a la app del teléfono. "Abrir igual"
 * existe para una urgencia (vale por la sesión del navegador).
 */
import { MonitorSmartphone } from 'lucide-react';
import s from './movil.module.css';

export function AvisoEscritorio({ onAbrirIgual }: { onAbrirIgual?: () => void }) {
  return (
    <div className={s.aviso} role="main">
      <div className={s.avisoCaja}>
        <MonitorSmartphone size={44} strokeWidth={1.5} style={{ margin: '0 auto', display: 'block' }} aria-hidden />
        <h1 className={s.avisoTitulo}>Esta pantalla se ve mejor en computadora</h1>
        <p className={s.avisoTexto}>Abrila desde tu compu para operar o editar. En el teléfono tenés Auros, la captura de documentos y el resumen.</p>
        <a className={s.avisoBtn} href="/m">Ir a la app del teléfono</a>
        {onAbrirIgual && <button type="button" className={s.avisoSecundario} onClick={onAbrirIgual}>Abrir igual (no está adaptada al teléfono)</button>}
      </div>
    </div>
  );
}
