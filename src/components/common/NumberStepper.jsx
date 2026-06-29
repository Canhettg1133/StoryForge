import React from 'react';
import { Minus, Plus } from 'lucide-react';

export function clampNumberStepperValue(value, {
  min = 1,
  max = Number.POSITIVE_INFINITY,
  fallback = min,
} = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeNumericInput(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

export default function NumberStepper({
  value,
  onChange,
  onCommit,
  min = 1,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  fallback = min,
  ariaLabel,
  className = 'input',
  disabled = false,
  style,
  inputStyle,
}) {
  const valueText = value === null || value === undefined ? '' : String(value);

  const commitValue = (rawValue = valueText) => {
    const nextValue = clampNumberStepperValue(rawValue, { min, max, fallback });
    onChange?.(String(nextValue));
    onCommit?.(nextValue);
  };

  const stepValue = (direction) => {
    const base = Number.isFinite(Number(valueText)) ? Number(valueText) : fallback;
    const nextValue = clampNumberStepperValue(base + (direction * step), { min, max, fallback });
    onChange?.(String(nextValue));
    onCommit?.(nextValue);
  };

  const handleFocus = (event) => {
    const input = event.currentTarget;
    const selectInput = () => {
      if (document.activeElement === input) input.select();
    };
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(selectInput);
    } else {
      setTimeout(selectInput, 0);
    }
  };

  return (
    <div
      className="number-stepper"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        width: '100%',
        minWidth: 0,
        ...style,
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-label={ariaLabel ? `${ariaLabel} giảm` : 'Giảm'}
        disabled={disabled}
        onClick={() => stepValue(-1)}
      >
        <Minus size={14} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={ariaLabel}
        className={className}
        value={valueText}
        disabled={disabled}
        onFocus={handleFocus}
        onChange={(event) => onChange?.(normalizeNumericInput(event.target.value))}
        onBlur={() => commitValue()}
        style={{
          flex: '1 1 0',
          textAlign: 'center',
          minWidth: 0,
          ...inputStyle,
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-label={ariaLabel ? `${ariaLabel} tăng` : 'Tăng'}
        disabled={disabled}
        onClick={() => stepValue(1)}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
