import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('phase10 WorldLore mobile UI contract', () => {
  it('keeps the world entity tabs in Vietnamese with diacritics', () => {
    const source = read('src/pages/WorldLore/WorldLore.jsx');

    expect(source).toContain("label: 'Địa điểm'");
    expect(source).toContain("label: 'Vật phẩm'");
    expect(source).toContain("label: 'Thuật ngữ'");
    expect(source).not.toContain("label: 'Dia diem'");
    expect(source).not.toContain("label: 'Vat pham'");
    expect(source).not.toContain("label: 'Thuat ngu'");
  });

  it('prioritizes the three world groups and action controls on mobile', () => {
    const source = read('src/pages/WorldLore/WorldLore.jsx');
    const css = read('src/pages/WorldLore/WorldLore.css');

    expect(source).toContain("window.matchMedia('(max-width: 900px)').matches");
    expect(css).toContain('.project-mobile-shell .world-lore > .codex-header .codex-tabs');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(css).toContain('.project-mobile-shell .world-lore .codex-header-actions');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('.project-mobile-shell .world-lore .codex-header-actions .btn-primary');
    expect(css).toContain('grid-column: 1 / -1;');
    expect(css).toContain('.project-mobile-shell .world-lore .ai-gen-wrapper');
    expect(css).toContain('.project-mobile-shell .world-lore .ai-gen-trigger');
  });

  it('matches the compact accessible character modal tabs for every world entity', () => {
    const source = read('src/pages/WorldLore/WorldLore.jsx');
    const css = read('src/pages/WorldLore/WorldLore.css');

    expect(source).toContain('className="codex-tabs world-modal-tabs"');
    expect(source).toContain('role="tablist"');
    expect(source).toContain('id="world-info-tab"');
    expect(source).toContain('id="world-timeline-tab"');
    expect(source).toContain('aria-controls="world-modal-panel"');
    expect(source).toContain('aria-selected={modalTab === \'info\'}');
    expect(source).toContain('aria-selected={modalTab === \'timeline\'}');
    expect(source).toContain('id="world-modal-panel"');
    expect(source).not.toContain("style={{ padding: '0 24px', borderBottom:");

    expect(css).toMatch(/\.world-modal-tabs\s*\{[^}]*align-self:\s*flex-start;[^}]*width:\s*fit-content;[^}]*margin:/su);
  });
});
