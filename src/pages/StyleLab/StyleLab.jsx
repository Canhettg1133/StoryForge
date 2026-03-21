import React from 'react';
import { Palette } from 'lucide-react';

export default function StyleLab() {
  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <div className="empty-state">
        <Palette size={48} />
        <h3>Style Lab</h3>
        <p>Upload source, phân tích Style DNA, rewrite theo giọng — Sẽ có ở Phase 5</p>
      </div>
    </div>
  );
}
