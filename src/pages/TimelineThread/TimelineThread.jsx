import React from 'react';
import { Clock } from 'lucide-react';

export default function TimelineThread() {
  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <div className="empty-state">
        <Clock size={48} />
        <h3>Timeline & Plot Threads</h3>
        <p>Timeline events, plot thread graph, relationship changes — Sẽ có ở Phase 6</p>
      </div>
    </div>
  );
}
