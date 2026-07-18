import React from 'react';
import { BookOpen, Check, Moon, Sun } from 'lucide-react';
import { THEMES } from '../../config/themes.js';
import useUIStore from '../../stores/uiStore.js';
import './ThemePicker.css';

const THEME_ICONS = {
  dark: Moon,
  light: Sun,
  cream: BookOpen,
};

export default function ThemePicker({ variant = 'settings', onSelect }) {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  const handleSelect = (themeId) => {
    setTheme(themeId);
    onSelect?.(themeId);
  };

  return (
    <div className={`theme-picker theme-picker--${variant}`} role="radiogroup" aria-label="Chọn giao diện">
      {THEMES.map((option) => {
        const Icon = THEME_ICONS[option.id];
        const selected = theme === option.id;

        return (
          <button
            key={option.id}
            type="button"
            className={`theme-picker__option ${selected ? 'is-selected' : ''}`}
            role="radio"
            aria-checked={selected}
            onClick={() => handleSelect(option.id)}
          >
            <span className="theme-picker__preview" aria-hidden="true">
              {option.swatches.map((swatch) => (
                <span key={swatch} style={{ backgroundColor: swatch }} />
              ))}
            </span>
            <span className="theme-picker__copy">
              <span className="theme-picker__name">
                <Icon size={15} aria-hidden="true" />
                {option.label}
              </span>
              <span className="theme-picker__description">{option.description}</span>
            </span>
            <span className="theme-picker__check" aria-hidden="true">
              {selected ? <Check size={16} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
