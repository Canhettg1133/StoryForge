import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('Lab Lite Phase 9 - AI Sidebar Canon Review UI contract', () => {
  it('exposes Canon Review modes and user-controlled actions without guarantee wording', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src/components/AI/AISidebar.jsx'), 'utf8');

    expect(source).toContain('data-testid="ai-canon-review-panel"');
    expect(source).toContain('AI gợi ý phát hiện lệch canon');
    expect(source).toContain('value="quick"');
    expect(source).toContain('value="standard"');
    expect(source).toContain('value="deep"');
    expect(source).toContain('Bỏ qua');
    expect(source).toContain('Cần xem lại');
    expect(source).toContain('Dùng gợi ý');
    expect(source).toContain('Đánh dấu rẽ nhánh');
    expect(source.toLowerCase()).not.toContain('guarantee');
    expect(source.toLowerCase()).not.toContain('đảm bảo');
  });
});
