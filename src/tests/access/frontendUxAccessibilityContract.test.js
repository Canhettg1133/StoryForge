import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    return statSync(fullPath).isDirectory()
      ? listSourceFiles(fullPath)
      : [fullPath];
  });
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
}

describe('frontend UX and accessibility contract', () => {
  it('keeps blocking browser confirmation APIs out of production React code', () => {
    const source = listSourceFiles(resolve(process.cwd(), 'src'))
      .filter((path) => ['.js', '.jsx'].includes(extname(path)))
      .filter((path) => !path.includes(`${join('src', 'tests')}`))
      .map((path) => stripComments(readFileSync(path, 'utf8')))
      .join('\n');

    expect(source).not.toMatch(/\bwindow\.confirm\s*\(/u);
    expect(source).not.toMatch(/(^|[^\w.])alert\s*\(/u);
  });

  it('provides reduced motion, touch targets, search labels, and semantic project cards', () => {
    const animations = read('src/styles/animations.css');
    const styles = read('src/styles/index.css');
    const dashboard = read('src/pages/Dashboard/Dashboard.jsx');

    expect(animations).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('@media (pointer: coarse)');
    expect(styles).toContain('min-height: 44px');
    expect(dashboard).toContain('htmlFor="dashboard-project-search"');
    expect(dashboard).toContain('<article');
    expect(dashboard).toContain('className="project-card-open"');
  });

  it('uses the shared modal accessibility behavior on high-traffic dialogs', () => {
    const files = [
      'src/pages/Dashboard/NewProjectModal.jsx',
      'src/pages/Dashboard/ProjectWizard.jsx',
      'src/pages/OutlineBoard/ChapterDetailModal.jsx',
      'src/pages/OutlineBoard/PlotThreadModal.jsx',
      'src/components/canon/CanonRepairDialog.jsx',
      'src/components/common/RelationshipMap.jsx',
      'src/pages/CharacterHub/CharacterHub.jsx',
      'src/pages/WorldLore/WorldLore.jsx',
      'src/pages/Settings/Settings.jsx',
    ];

    files.forEach((file) => {
      const source = read(file);
      expect(source, file).toContain('useModalAccessibility');
      expect(source, file).toContain('aria-modal="true"');
    });
  });
});
