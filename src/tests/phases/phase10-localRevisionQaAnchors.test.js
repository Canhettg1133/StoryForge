import { describe, expect, it } from 'vitest';
import {
  buildFindingAnchor,
  computeTextSignature,
  htmlToPlainText,
  resolveFindingAnchor,
} from '../../services/revisionQa/sourceSnapshot.js';
import { getLocalRevisionQaFixture } from '../fixtures/localRevisionQaCorpus.js';

describe('local Revision QA source snapshots and anchors', () => {
  it('preserves paragraph boundaries and meaningful spaces in source signatures', async () => {
    const base = await computeTextSignature('Một.\n\nHai.');
    const collapsed = await computeTextSignature('Một. Hai.');
    const extraSpace = await computeTextSignature('Một.\n\nHai  .');

    expect(base).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(base).not.toBe(collapsed);
    expect(base).not.toBe(extraSpace);
  });

  it('converts stored StoryEditor HTML into paragraph-preserving plain text', () => {
    expect(htmlToPlainText('<p>Một.</p><p>Hai <strong>đậm</strong>.</p>'))
      .toBe('Một.\n\nHai đậm.');
  });

  it('resolves a UTF-16 anchor after emoji without shifting the evidence', () => {
    const text = 'Vy đặt 💍 ở đây  rồi đi.';
    const start = text.indexOf('  ');
    const anchor = buildFindingAnchor(text, start, start + 2);
    const range = resolveFindingAnchor(text, anchor);

    expect(text.slice(range.from, range.to)).toBe('  ');
    expect(range.from).toBe(start);
  });

  it('keeps an unaffected duplicate anchor valid and stales only changed context', () => {
    const text = getLocalRevisionQaFixture('A20').text;
    const firstStart = text.indexOf('  ');
    const secondStart = text.indexOf('  ', firstStart + 2);
    const first = buildFindingAnchor(text, firstStart, firstStart + 2);
    const second = buildFindingAnchor(text, secondStart, secondStart + 2);
    const afterFirstFix = `${text.slice(0, firstStart)} ${text.slice(firstStart + 2)}`;

    expect(resolveFindingAnchor(afterFirstFix, first)).toBeNull();
    expect(resolveFindingAnchor(afterFirstFix, second)).not.toBeNull();

    const changedSecond = afterFirstFix.replace('cửa  khép lại sau lưng Bình', 'cửa đã khép lại sau lưng Bình');
    expect(resolveFindingAnchor(changedSecond, second)).toBeNull();
  });
});
