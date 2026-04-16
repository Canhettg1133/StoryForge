import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import './MobileSheet.css';

export default function MobileSheet({
  open,
  title,
  kicker = '',
  size = 'sheet',
  onClose,
  children,
  footer = null,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobile-sheet-root">
      <button className="mobile-sheet-backdrop" type="button" onClick={onClose} aria-label="Đóng bảng điều khiển" />
      <section className={`mobile-sheet mobile-sheet--${size}`} role="dialog" aria-modal="true" aria-label={title || 'Bảng điều khiển'}>
        <div className="mobile-sheet-handle" />
        <header className="mobile-sheet-header">
          <div className="mobile-sheet-title-block">
            {kicker && <div className="mobile-sheet-kicker">{kicker}</div>}
            <h2>{title}</h2>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>
        <div className="mobile-sheet-body">
          {children}
        </div>
        {footer && <footer className="mobile-sheet-footer">{footer}</footer>}
      </section>
    </div>
  );
}
