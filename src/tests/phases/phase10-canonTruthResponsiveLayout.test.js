import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\r\n?/g, '\n');
}

function getCssRuleBody(source, selector) {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', start);
  const end = source.indexOf('\n}', braceStart);
  expect(end).toBeGreaterThan(braceStart);
  return source.slice(braceStart + 1, end);
}

function classSpecificity(selector) {
  return selector.match(/\.[A-Za-z0-9_-]+/gu)?.length || 0;
}

describe('Canon Truth responsive layout', () => {
  it('keeps report copy readable and moves repair actions out of the text column', () => {
    const jsx = read('src/pages/CanonTruth/CanonTruth.jsx');
    const css = read('src/pages/CanonTruth/CanonTruth.css');
    const reportItem = getCssRuleBody(css, '.su-that-page__report-item');
    const reportMessage = getCssRuleBody(css, '.su-that-page__report-message');
    const reportMeta = getCssRuleBody(css, '.su-that-page__report-heading .bible-canon-meta');

    expect(jsx.match(/su-that-page__report-item/g)).toHaveLength(2);
    expect(jsx.match(/su-that-page__report-heading/g)).toHaveLength(2);
    expect(jsx.match(/su-that-page__report-message/g)).toHaveLength(2);
    expect(jsx).not.toContain('className="su-that-page__report-row"');

    expect(reportItem).toContain('display: flex;');
    expect(reportItem).toContain('flex-direction: column;');
    expect(reportMessage).toContain('overflow-wrap: break-word;');
    expect(reportMessage).toContain('word-break: normal;');
    expect(reportMeta).toContain('text-overflow: ellipsis;');
    expect(reportMeta).toContain('white-space: nowrap;');
  });

  it('reflows the active-fact editor instead of squeezing its description input', () => {
    const jsx = read('src/pages/CanonTruth/CanonTruth.jsx');
    const css = read('src/pages/CanonTruth/CanonTruth.css');
    const editorRow = getCssRuleBody(css, '.su-that-page__fact-editor-row');

    expect(jsx).toContain('className="su-that-page__fact-editor-row"');
    expect(jsx).toContain('className="select su-that-page__fact-type"');
    expect(jsx).toContain('className="input su-that-page__fact-description"');
    expect(jsx).not.toContain("style={{ display: 'flex', gap: 'var(--space-2)' }}");
    expect(editorRow).toContain('display: grid;');
    expect(editorRow).toContain('grid-template-columns: 140px minmax(0, 1fr) 40px;');
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*\.su-that-page__fact-description[\s\S]*grid-column: 1 \/ -1;/u);
  });

  it('uses the full priority-card width instead of reserving a badge column beside every description', () => {
    const jsx = read('src/pages/CanonTruth/CanonTruth.jsx');
    const css = read('src/pages/CanonTruth/CanonTruth.css');
    const panelTitle = getCssRuleBody(css, '.su-that-page__panel-title');
    const compactList = getCssRuleBody(css, '.su-that-page__compact-list');
    const compactItem = getCssRuleBody(css, '.su-that-page__compact-item');
    const compactMessage = getCssRuleBody(css, '.su-that-page__compact-item p');
    const compactBadge = getCssRuleBody(css, '.su-that-page__compact-badge');

    expect(jsx).toContain('className="su-that-page__panel-title-main"');
    expect(jsx).toContain('su-that-page__panel-count--${panel.tone}');
    expect(jsx).toContain('className="su-that-page__compact-heading"');
    expect(jsx).toContain('className="bible-canon-meta su-that-page__compact-badge"');

    expect(panelTitle).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(compactList).toContain('border-top: 1px solid');
    expect(compactItem).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(compactItem).toContain('background: transparent;');
    expect(compactMessage).toContain('color: var(--color-text-secondary);');
    expect(compactMessage).toContain('overflow-wrap: break-word;');
    expect(compactBadge).toContain('text-overflow: ellipsis;');
    expect(compactBadge).toContain('white-space: nowrap;');
  });

  it('lets list copy use the full card width throughout the truth page', () => {
    const jsx = read('src/pages/CanonTruth/CanonTruth.jsx');
    const css = read('src/pages/CanonTruth/CanonTruth.css');
    const flowItem = getCssRuleBody(css, '.bible-canon-list-item.su-that-page__flow-item');
    const flowCopy = getCssRuleBody(css, '.su-that-page__flow-item > div > p');
    const flowBadge = getCssRuleBody(css, '.su-that-page__flow-item > .bible-canon-badge,\n.su-that-page__flow-item > .bible-canon-meta');
    const listCopy = getCssRuleBody(css, '.story-bible.su-that-page .bible-canon-list-item p');

    expect(jsx.match(/su-that-page__flow-item/g)?.length || 0).toBeGreaterThanOrEqual(13);
    expect(flowItem).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(flowCopy).toContain('grid-column: 1 / -1;');
    expect(flowCopy).toContain('max-width: 72ch;');
    expect(flowBadge).toContain('text-overflow: ellipsis;');
    expect(flowBadge).toContain('white-space: nowrap;');
    expect(listCopy).toContain('color: var(--color-text-secondary);');
    expect(listCopy).toContain('word-break: normal;');
  });

  it('keeps state names on the first row instead of squeezing them into vertical text', () => {
    const css = read('src/pages/CanonTruth/CanonTruth.css');
    const wideStatePanel = getCssRuleBody(css, '.su-that-page__state-panel--wide');
    const stateItem = getCssRuleBody(css, '.su-that-page__state-panel .su-that-page__flow-item');
    const stateTitle = getCssRuleBody(css, '.su-that-page__state-panel .su-that-page__flow-item > div > strong');
    const stateBadge = getCssRuleBody(css, '.su-that-page__state-panel .su-that-page__flow-item > .bible-canon-badge,\n.su-that-page__state-panel .su-that-page__flow-item > .bible-canon-meta');

    expect(css).toMatch(/\.su-that-page__state-panel\s*\{[^}]*grid-column:\s*span 4;/u);
    expect(wideStatePanel).toContain('grid-column: span 8;');
    expect(stateItem).toContain('grid-template-areas:');
    expect(stateItem).toContain('"title status"');
    expect(stateItem).toContain('"detail detail"');
    expect(stateTitle).toContain('grid-area: title;');
    expect(stateTitle).toContain('word-break: normal;');
    expect(stateBadge).toContain('grid-area: status;');
    expect(stateBadge).not.toContain('grid-column: auto;');
    expect(stateBadge).not.toContain('grid-row: auto;');
  });

  it('keeps the truth-page grid authoritative when Story Bible CSS loads later', () => {
    const truthCss = read('src/pages/CanonTruth/CanonTruth.css');
    const storyBibleCss = read('src/pages/StoryBible/StoryBible.css');
    const truthFlowSelector = '.bible-canon-list-item.su-that-page__flow-item';
    const storyBibleItemSelector = '.bible-canon-list-item';
    const truthFlowItem = getCssRuleBody(truthCss, truthFlowSelector);
    const storyBibleItem = getCssRuleBody(storyBibleCss, storyBibleItemSelector);

    expect(storyBibleItem).toContain('display: flex;');
    expect(truthFlowItem).toContain('display: grid;');
    expect(classSpecificity(truthFlowSelector))
      .toBeGreaterThan(classSpecificity(storyBibleItemSelector));
  });

  it('uses equal-height detail panels and collapses an empty evidence viewer to one useful pane', () => {
    const jsx = read('src/pages/CanonTruth/CanonTruth.jsx');
    const css = read('src/pages/CanonTruth/CanonTruth.css');
    const detailGrid = getCssRuleBody(css, '.story-bible.su-that-page .bible-canon-detail-grid');
    const evidencePanel = getCssRuleBody(css, '.su-that-page__detail-panel--evidence');
    const snapshotPanel = getCssRuleBody(css, '.su-that-page__detail-panel--snapshot');
    const evidenceLayout = getCssRuleBody(css, '.su-that-page__detail-panel--evidence .bible-canon-evidence-layout');
    const emptyEvidenceLayout = getCssRuleBody(css, '.su-that-page__detail-panel--evidence .bible-canon-evidence-layout.is-empty');

    expect(jsx).toContain('su-that-page__detail-panel--events');
    expect(jsx).toContain('su-that-page__detail-panel--evidence');
    expect(jsx).toContain('su-that-page__detail-panel--reports');
    expect(jsx).toContain('su-that-page__detail-panel--snapshot');
    expect(jsx).toContain("revisionDetail.evidence.length === 0 ? ' is-empty' : ''");
    expect(detailGrid).toContain('grid-template-columns: repeat(12, minmax(0, 1fr));');
    expect(detailGrid).toContain('align-items: stretch;');
    expect(evidencePanel).toContain('grid-column: span 6;');
    expect(snapshotPanel).toContain('grid-column: 1 / -1;');
    expect(evidenceLayout).toContain('minmax(220px, 0.8fr)');
    expect(evidenceLayout).toContain('minmax(320px, 1.2fr)');
    expect(emptyEvidenceLayout).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(emptyEvidenceLayout).toContain('min-height: 280px;');
    expect(css).toMatch(/@media \(max-width: 1400px\)[\s\S]*\.su-that-page__detail-panel--evidence[\s\S]*grid-column: span 8;/u);
    expect(css).toMatch(/@media \(max-width: 960px\)[\s\S]*\.su-that-page__detail-panel[\s\S]*grid-row: auto;/u);
    expect(css).toMatch(/@media \(max-width: 960px\)[\s\S]*\.bible-canon-evidence-layout\.is-empty[\s\S]*min-height: 0;/u);
  });

  it('keeps AI reanalysis separate from projection rebuild and renders derived facts read-only', () => {
    const truth = read('src/pages/CanonTruth/CanonTruth.jsx');
    const storyBibleCanon = read('src/pages/StoryBible/sections/StoryBibleCanonSection.jsx');

    expect(truth).toContain('Dựng lại canon');
    expect(truth).toContain('Rà lại toàn bộ chương bằng AI');
    expect(truth).toContain('reanalyzeCompletedChapters');
    expect(truth).toContain('Sự thật nền thủ công');
    expect(truth).toContain('Sự thật phát sinh từ chương');
    expect(truth).toContain('Chỉ đọc');
    expect(storyBibleCanon).toContain('Sự thật nền thủ công');
    expect(storyBibleCanon).toContain('Sự thật phát sinh từ chương');
  });
});
