import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

const searchKey = (text) => text.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

// Keep the popup in the panel's DOM so its width and font scale with the control.
export default function ReviewSelect({ id, label, value, options, disabled, onChange }) {
  const root = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  const search = useRef({ text: '', at: 0 });
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const expanded = open && !disabled;
  const listId = `${id}-options`;

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!expanded) return undefined;
    const dismiss = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [expanded]);

  useEffect(() => {
    const list = menu.current;
    const option = list?.children[activeIndex];
    if (!expanded || !option) return;
    // Scroll only the list, not the manuscript or the entire modal.
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [expanded, activeIndex]);

  const show = (index = selectedIndex) => {
    search.current = { text: '', at: 0 };
    setActiveIndex(index); setOpen(true);
  };
  const choose = (index) => {
    if (disabled) return;
    onChange(options[index].value); setOpen(false);
  };
  const onKeyDown = (event) => {
    if (disabled || event.isComposing || event.ctrlKey || event.metaKey) return;
    const { key } = event;
    if (key === 'Escape') {
      if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (key === 'Tab') { if (expanded) choose(activeIndex); return; }
    if (event.altKey && key !== 'ArrowDown' && key !== 'ArrowUp') return;
    if (expanded && event.altKey && key === 'ArrowUp') { event.preventDefault(); choose(activeIndex); return; }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (expanded) choose(activeIndex); else show();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const index = key === 'Home' ? 0 : key === 'End' ? options.length - 1
        : expanded ? Math.max(0, Math.min(options.length - 1, activeIndex + (key === 'ArrowDown' ? 1 : -1))) : selectedIndex;
      if (expanded) setActiveIndex(index); else show(index);
    } else if (key.length === 1 && !event.altKey) {
      event.preventDefault();
      const character = searchKey(key);
      const text = Date.now() - search.current.at < 600 ? search.current.text + character : character;
      const query = [...text].every((item) => item === character) ? character : text;
      search.current = { text, at: Date.now() };
      const start = query.length === 1 ? (expanded ? activeIndex : selectedIndex) + 1 : 0;
      const index = options.map((_, offset) => (start + offset) % options.length)
        .find((offset) => searchKey(options[offset].label).startsWith(query));
      if (index !== undefined) { setActiveIndex(index); setOpen(true); }
    }
  };

  return <div ref={root} className="manuscript-review-select" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} id={id} type="button" role="combobox" className="select manuscript-review-select-trigger"
      aria-label={label} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded ? `${listId}-${activeIndex}` : undefined} value={value} disabled={disabled}
      onKeyDown={onKeyDown} onClick={() => { trigger.current.focus(); if (expanded) setOpen(false); else show(); }}>
      {options[selectedIndex].label}
    </button>
    {expanded && <div ref={menu} id={listId} className="manuscript-review-select-menu" role="listbox" aria-label={label}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
        className="manuscript-review-select-option" aria-selected={option.value === value} data-active={index === activeIndex}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { choose(index); trigger.current.focus(); }}>
        <span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
      </div>)}
    </div>}
  </div>;
}
