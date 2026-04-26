import { describe, expect, it } from 'vitest';
import {
  buildChapterCoverageBadges,
  formatChapterDisplayTitle,
  getMaterializeActionLabel,
  getMaterializeDomainLabel,
  groupMaterializationActions,
  summarizeParserPreflight,
} from '../../pages/Lab/LabLite/labLiteUiHelpers.js';

describe('Lab Lite full UX helpers', () => {
  it('does not duplicate chapter number prefixes in chapter titles', () => {
    expect(formatChapterDisplayTitle({ index: 1, title: 'Chương 1: Mở đầu' })).toBe('Chương 1: Mở đầu');
    expect(formatChapterDisplayTitle({ index: 2, title: 'Mở rộng' })).toBe('Chương 2: Mở rộng');
    expect(formatChapterDisplayTitle({ index: 3, title: 'Chapter 3 - English title' })).toBe('Chương 3: English title');
  });

  it('builds Vietnamese coverage badges without raw enum labels', () => {
    const badges = buildChapterCoverageBadges({
      scoutSynthetic: true,
      digestDone: false,
      deepDone: false,
      status: 'error',
      failedReason: 'Bad JSON',
    });

    expect(badges.map((badge) => badge.label)).toEqual([
      'Fallback',
      'Thiếu digest',
      'Thiếu deep',
      'Lỗi',
    ]);
    expect(JSON.stringify(badges)).not.toContain('synthetic_fallback');
  });

  it('summarizes parser preflight with actionable Vietnamese warning text', () => {
    const summary = summarizeParserPreflight({
      chapterCount: 120,
      totalEstimatedTokens: 456789,
      parseDiagnostics: {
        headingCandidates: Array.from({ length: 122 }),
        acceptedBoundaries: Array.from({ length: 119 }),
        rejectedBoundaries: [{ lineNumber: 10, text: '1', rejectedReason: 'too short' }],
      },
    });

    expect(summary.stats).toContainEqual({ label: 'Chương', value: '120' });
    expect(summary.stats).toContainEqual({ label: 'Token ước tính', value: '456,789' });
    expect(summary.warnings.join(' ')).toContain('Có 1 ranh giới bị loại');
    expect(summary.suggestedMode).toBe('complete');
  });

  it('uses writer-friendly materialization labels and groups', () => {
    const actions = [
      { id: 'a', type: 'character', action: 'create', source: { name: 'Lan' } },
      { id: 'b', type: 'relationship', action: 'needs_review', source: { characterA: 'Lan', characterB: 'Kha' } },
      { id: 'c', type: 'canon_fact', action: 'skip', source: { description: 'Đã có.' } },
    ];
    const groups = groupMaterializationActions(actions);

    expect(getMaterializeActionLabel('create')).toBe('Thêm mới');
    expect(getMaterializeActionLabel('needs_review')).toBe('Cần xem lại');
    expect(getMaterializeDomainLabel('canon_fact')).toBe('Quy tắc canon');
    expect(groups.map((group) => group.label)).toEqual(['Nhân vật', 'Quan hệ', 'Quy tắc canon']);
    expect(JSON.stringify(groups)).not.toContain('needs_review');
  });
});
