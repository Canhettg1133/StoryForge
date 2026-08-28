import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const originalCss = readFileSync('src/tests/fixtures/chapterToolbar.github.css', 'utf8');
const editorCss = readFileSync('src/components/editor/StoryEditor.css', 'utf8');
const legacyToolbar = /\.chapter-(?:outline-(?:toggle(?:-row)?|panel)|history-toggle(?:--active)?)(?![\w-])/;

// Parse every rule in source order, including media rules and descendant/pseudo selectors.
// This is source parity, not a browser layout measurement; no media-query emulation is needed.
function rulesFor(css, matches) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const found = [];
  function visit(rules, conditions = []) {
    for (const rule of rules) {
      if (rule.selectorText) {
        for (const selector of rule.selectorText.split(',').map((value) => value.trim())) {
          if (matches(selector)) found.push({ conditions, selector, declarations: rule.style.cssText });
        }
      } else if (rule.cssRules) {
        visit(rule.cssRules, [...conditions, rule.conditionText]);
      }
    }
  }
  try {
    visit(style.sheet.cssRules);
    return found;
  } finally {
    style.remove();
  }
}

describe('chapter toolbar parity with the pinned GitHub design', () => {
  it('preserves every original toolbar declaration and breakpoint without extra shrinking rules', () => {
    const original = rulesFor(originalCss, (selector) => legacyToolbar.test(selector));
    expect(original).toHaveLength(17);
    expect(rulesFor(editorCss, (selector) => legacyToolbar.test(selector))).toEqual(original);
  });

  it('gives scoring exactly the original history typography, spacing and height on desktop and mobile', () => {
    const original = rulesFor(originalCss, (selector) => selector === '.chapter-history-toggle'
      || selector === '.story-editor--mobile .chapter-history-toggle');
    const scoring = rulesFor(editorCss, (selector) => selector === '.chapter-review-toggle'
      || selector === '.story-editor--mobile .chapter-review-toggle')
      .map((rule) => ({ ...rule, selector: rule.selector.replace('chapter-review-toggle', 'chapter-history-toggle') }));
    expect(original).toHaveLength(2);
    expect(scoring).toEqual(original);
  });

  it('renders actual labels instead of replacing them with tiny generated text', () => {
    const source = readFileSync('src/components/editor/StoryEditor.jsx', 'utf8');
    expect(source).not.toContain('data-compact-label');
  });
});
