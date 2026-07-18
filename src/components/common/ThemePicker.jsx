import React from 'react';
import { BookOpen, Check, Cloud, Coffee, Leaf, Moon, Palette, Sun } from 'lucide-react';
import { THEMES } from '../../config/themes.js';
import useUIStore from '../../stores/uiStore.js';
import './ThemePicker.css';

const THEME_ICONS = {
  dark: Moon,
  light: Sun,
  cream: BookOpen,
  'soft-cream': Palette,
  sepia: Coffee,
  'sage-paper': Leaf,
  mist: Cloud,
};

const THEME_GROUPS = [
  { id: 'base', label: 'Cơ bản' },
  { id: 'reading', label: 'Màu đọc' },
];

export default function ThemePicker({ variant = 'settings', onSelect }) {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  const handleSelect = (themeId) => {
    setTheme(themeId);
    onSelect?.(themeId);
  };

  const renderOption = (option) => {
    const Icon = THEME_ICONS[option.id] || Palette;
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
  };

  if (variant === 'sheet') {
    return (
      <div className="theme-picker theme-picker--sheet" role="radiogroup" aria-label="Chọn giao diện">
        {THEME_GROUPS.map((group) => (
          <section key={group.id} className="theme-picker__group" aria-label={group.label}>
            <h3 className="theme-picker__group-title">{group.label}</h3>
            <div className="theme-picker__group-grid">
              {THEMES.filter((option) => option.group === group.id).map(renderOption)}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className={`theme-picker theme-picker--${variant}`} role="radiogroup" aria-label="Chọn giao diện">
      {THEMES.map(renderOption)}
    </div>
  );
}
