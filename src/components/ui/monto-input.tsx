'use client';

/**
 * F-051.4 — Inputs numéricos sin los 3 defectos de UX de <input type="number">:
 *
 *  1. Spinners (frisos) diminutos que suben de 1 en 1 → inútiles para montos.
 *  2. El "0" inicial controlado no se deja borrar/sobreescribir bien.
 *  3. El scroll del mouse sobre el campo CAMBIA EL VALOR accidentalmente.
 *
 * Solución: text + inputMode + estado interno string.
 *
 * MontoInput  — dinero (decimales).
 * EnteroInput — cantidades enteras (día de pago, plazo, etc.).
 *
 * Ambos:
 *  - Estado interno controlado por texto. Si el `value` prop cambia desde
 *    fuera (form reset, prefill, etc.) Y el campo no está enfocado, se
 *    sincroniza. Mientras está enfocado, NO sobrescribimos lo que el
 *    usuario está tecleando.
 *  - selectAll al focus → tocar el campo "0" y teclear lo reemplaza.
 *  - onWheel.preventDefault para que el scroll del mouse no cambie nada
 *    aunque alguien fuerce type=number en el futuro.
 *  - Rechazan silenciosamente caracteres no válidos (no se ven en pantalla).
 */

import { useEffect, useRef, useState } from 'react';

type Common = {
  /** Valor canónico. null = vacío. */
  value: number | null;
  onChange: (n: number | null) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Texto a mostrar a la izquierda dentro del campo (ej: "Q"). */
  prefix?: string;
  ariaLabel?: string;
  /** Callback adicional ejecutado después del format-on-blur interno. */
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

/* =========================================================================
 * MontoInput — dinero, 2 decimales, acepta `,` o `.` como decimal.
 * ========================================================================= */

export interface MontoInputProps extends Common {
  /** Cuántos decimales mostrar en formato al blur. Default 2. */
  decimales?: number;
}

const REGEX_MONTO = /^[0-9]*([.,][0-9]{0,8})?$/;

function parseMonto(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '' || t === '.' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formatMonto(n: number, decimales: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
    useGrouping: false,
  });
}

export function MontoInput({
  value, onChange, placeholder, className, style, id, name,
  required, disabled, autoFocus, prefix, ariaLabel, onBlur: onBlurExtra, onKeyDown,
  decimales = 2,
}: MontoInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [enfocado, setEnfocado] = useState(false);
  const [texto, setTexto] = useState<string>(() => value == null ? '' : String(value));

  // Sincronizar texto con value PROP solo si NO estamos enfocados — así no
  // pisamos lo que el usuario está tecleando.
  useEffect(() => {
    if (enfocado) return;
    setTexto(value == null ? '' : String(value));
  }, [value, enfocado]);

  const onTextChange = (raw: string) => {
    if (raw !== '' && !REGEX_MONTO.test(raw)) return;  // rechaza sin actualizar
    setTexto(raw);
    onChange(parseMonto(raw));
  };

  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setEnfocado(true);
    // selectAll diferido para que funcione consistente en Safari.
    const el = e.currentTarget;
    requestAnimationFrame(() => el.select());
  };

  const onBlur = () => {
    setEnfocado(false);
    const n = parseMonto(texto);
    if (n == null) {
      setTexto('');
      onChange(null);
    } else {
      setTexto(formatMonto(n, decimales));
      onChange(n);
    }
    onBlurExtra?.();
  };

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', width: '100%' }}>
      {prefix && (
        <span
          aria-hidden
          style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            fontSize: 13, color: 'var(--ink-4)', fontWeight: 500,
            pointerEvents: 'none', userSelect: 'none',
            fontFamily: 'var(--mono, ui-monospace)',
          }}
        >
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={texto}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onWheel={(e) => e.currentTarget.blur()}
        placeholder={placeholder}
        className={className ?? 'input'}
        style={{
          // F-051.5: el spread va PRIMERO y el paddingLeft después para que
          // siempre se respete el espacio reservado al prefix, sin importar
          // qué padding traiga el `style` del caller.
          width: '100%',
          ...style,
          paddingLeft: prefix ? 28 : (style?.paddingLeft as string | number | undefined),
        }}
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        autoComplete="off"
      />
    </div>
  );
}

/* =========================================================================
 * EnteroInput — sólo dígitos, clamp min/max al blur.
 * ========================================================================= */

const REGEX_ENTERO = /^[0-9]*$/;

export interface EnteroInputProps extends Common {
  min?: number;
  max?: number;
}

export function EnteroInput({
  value, onChange, placeholder, className, style, id, name,
  required, disabled, autoFocus, prefix, ariaLabel, onBlur: onBlurExtra, onKeyDown,
  min, max,
}: EnteroInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [enfocado, setEnfocado] = useState(false);
  const [texto, setTexto] = useState<string>(() => value == null ? '' : String(Math.trunc(value)));

  useEffect(() => {
    if (enfocado) return;
    setTexto(value == null ? '' : String(Math.trunc(value)));
  }, [value, enfocado]);

  const onTextChange = (raw: string) => {
    if (raw !== '' && !REGEX_ENTERO.test(raw)) return;
    setTexto(raw);
    if (raw === '') onChange(null);
    else            onChange(Number(raw));
  };

  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setEnfocado(true);
    const el = e.currentTarget;
    requestAnimationFrame(() => el.select());
  };

  const onBlur = () => {
    setEnfocado(false);
    if (texto === '') { onChange(null); onBlurExtra?.(); return; }
    let n = Number(texto);
    if (!Number.isFinite(n)) { setTexto(''); onChange(null); onBlurExtra?.(); return; }
    if (typeof min === 'number' && n < min) n = min;
    if (typeof max === 'number' && n > max) n = max;
    setTexto(String(n));
    onChange(n);
    onBlurExtra?.();
  };

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', width: '100%' }}>
      {prefix && (
        <span
          aria-hidden
          style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            fontSize: 13, color: 'var(--ink-4)', fontWeight: 500,
            pointerEvents: 'none', userSelect: 'none',
            fontFamily: 'var(--mono, ui-monospace)',
          }}
        >
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={texto}
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onWheel={(e) => e.currentTarget.blur()}
        placeholder={placeholder}
        className={className ?? 'input'}
        style={{
          width: '100%',
          ...style,
          paddingLeft: prefix ? 28 : (style?.paddingLeft as string | number | undefined),
        }}
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        autoComplete="off"
      />
    </div>
  );
}
