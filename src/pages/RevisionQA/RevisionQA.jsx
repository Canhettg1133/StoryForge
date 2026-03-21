import React from 'react';
import { FileSearch } from 'lucide-react';

export default function RevisionQA() {
  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <div className="empty-state">
        <FileSearch size={48} />
        <h3>Revision & QA</h3>
        <p>Diff compare, QA report, rewrite presets — Sẽ có ở Phase 5</p>
      </div>
    </div>
  );
}
