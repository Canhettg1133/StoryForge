import React from 'react';
import {
  BookOpen,
  Map,
  PenTool,
  Sparkles,
} from 'lucide-react';

export const MOBILE_BOTTOM_ITEMS = [
  { id: 'write', label: 'Viet', icon: PenTool, path: (id) => `/project/${id}/editor` },
  { id: 'outline', label: 'Dan y', icon: Map, path: (id) => `/project/${id}/outline` },
  { id: 'bible', label: 'Bible', icon: BookOpen, path: (id) => `/project/${id}/story-bible` },
  { id: 'ai', label: 'Chat AI', icon: Sparkles, path: (id) => `/project/${id}/chat` },
];

export default function MobileBottomNav({ activeId, onItemClick }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Dieu huong du an tren mobile">
      {MOBILE_BOTTOM_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`mobile-bottom-nav__item ${active ? 'mobile-bottom-nav__item--active' : ''}`}
            onClick={() => onItemClick(item)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
