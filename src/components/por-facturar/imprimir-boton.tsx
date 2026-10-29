'use client';

/** Botón de imprimir / guardar como PDF del documento (window.print no es un diálogo de confirmación). */
export function ImprimirBoton() {
  return <button type="button" onClick={() => window.print()} style={{ fontSize: 13, padding: '6px 14px', border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 6, cursor: 'pointer' }} data-accion="imprimir-documento">Imprimir / guardar PDF</button>;
}
