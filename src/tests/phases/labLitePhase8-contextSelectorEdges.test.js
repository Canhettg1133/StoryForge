import { describe, expect, it, vi } from 'vitest';
import { selectCanonPackContext } from '../../services/labLite/canonPackContext.js';
import { buildPrompt } from '../../services/ai/promptBuilder.js';
import { TASK_TYPES } from '../../services/ai/router.js';

describe('Lab Lite Phase 8 - context selector edge cases', () => {
  it('returns null when no Canon Pack is linked', () => {
    expect(selectCanonPackContext({ canonPack: null })).toBeNull();
  });

  it('uses scene text, chapter outline, and selected characters to choose relevant Canon Pack slices', () => {
    const context = selectCanonPackContext({
      charCap: 5000,
      project: { project_mode: 'rewrite', canon_adherence_level: 'strict', divergence_point: 'Chương 12.' },
      sceneText: 'Lan bước vào Đền Cũ và chạm vào Ấn Ngọc.',
      characters: [{ name: 'Lan' }],
      currentChapterOutline: {
        chapterIndex: 12,
        featuredCharacters: ['Kha'],
        primaryLocation: 'Đền Cũ',
        requiredObjects: ['Ấn Ngọc'],
        requiredTerms: ['Linh lực'],
      },
      canonPack: {
        id: 'pack_ctx',
        title: 'Pack Context',
        globalCanon: { summary: 'Canon chính.' },
        arcCanon: [{ title: 'Arc giữa', chapterStart: 10, chapterEnd: 20, summary: 'Arc liên quan.', whyLoad: 'Có điểm rẽ.' }],
        characterCanon: [
          { name: 'Lan', status: 'alive' },
          { name: 'Kha', status: 'missing' },
          { name: 'Không liên quan', status: 'unknown' },
        ],
        relationshipCanon: [
          { characterA: 'Lan', characterB: 'Kha', change: 'Còn nợ nhau.' },
          { characterA: 'Người A', characterB: 'Người B', change: 'Không liên quan.' },
        ],
        chapterCanon: [
          { chapterIndex: 11, summary: 'Lan tới đền.' },
          { chapterIndex: 12, summary: 'Ấn Ngọc thức tỉnh.' },
          { chapterIndex: 90, summary: 'Không gần chương hiện tại.' },
        ],
        styleCanon: { tone: 'trầm', observations: ['Ít thoại.'] },
        canonRestrictions: ['Không hồi sinh mentor.'],
        creativeGaps: ['Quá khứ Đền Cũ còn trống.'],
      },
    });

    expect(context.projectMode).toBe('rewrite');
    expect(context.characterCanon.map((item) => item.name)).toEqual(expect.arrayContaining(['Lan', 'Kha']));
    expect(context.characterCanon.map((item) => item.name)).not.toContain('Không liên quan');
    expect(context.relationshipCanon).toHaveLength(1);
    expect(context.chapterCanon.map((item) => item.chapterIndex)).toEqual([11, 12]);
    expect(context.arcCanon[0].title).toBe('Arc giữa');
  });

  it('matches character aliases without broad substring false positives', () => {
    const context = selectCanonPackContext({
      charCap: 5000,
      sceneText: 'A Lan bước vào thư phòng.',
      characters: [{ name: 'A Lan', aliases: ['Lan'] }],
      canonPack: {
        id: 'pack_alias',
        title: 'Pack Alias',
        globalCanon: { summary: 'Canon.' },
        characterCanon: [
          { name: 'Lan Minh', aliases: ['A Lan'], status: 'alive' },
          { name: 'Lang Quân', status: 'unrelated' },
        ],
        relationshipCanon: [],
        chapterCanon: [],
        styleCanon: {},
        canonRestrictions: [],
        creativeGaps: [],
      },
    });

    expect(context.characterCanon.map((item) => item.name)).toContain('Lan Minh');
    expect(context.characterCanon.map((item) => item.name)).not.toContain('Lang Quân');
  });

  it('prioritizes related chapter canon near the current chapter without relying only on scene words', () => {
    const context = selectCanonPackContext({
      charCap: 5000,
      sceneText: 'Một cảnh rất ngắn.',
      currentChapterOutline: { chapterIndex: 50 },
      canonPack: {
        id: 'pack_chapter',
        title: 'Pack Chapter',
        globalCanon: { summary: 'Canon.' },
        characterCanon: [],
        relationshipCanon: [],
        chapterCanon: [
          { chapterIndex: 49, summary: 'Gần chương hiện tại.' },
          { chapterIndex: 80, summary: 'Xa chương hiện tại.' },
        ],
        styleCanon: {},
        canonRestrictions: [],
        creativeGaps: [],
      },
    });

    expect(context.chapterCanon.map((item) => item.chapterIndex)).toEqual([49]);
  });

  it('enforces the character cap by trimming lower-priority context instead of returning the full pack', () => {
    const context = selectCanonPackContext({
      charCap: 1400,
      sceneText: 'Lan',
      characters: [{ name: 'Lan' }],
      canonPack: {
        id: 'pack_huge',
        title: 'Pack Huge',
        globalCanon: { summary: 'G'.repeat(5000) },
        characterCanon: Array.from({ length: 40 }, (_item, index) => ({
          name: index === 0 ? 'Lan' : `Nhân vật ${index}`,
          status: 'S'.repeat(300),
        })),
        relationshipCanon: Array.from({ length: 30 }, (_item, index) => ({ characterA: 'Lan', characterB: `Kha ${index}`, change: 'C'.repeat(300) })),
        chapterCanon: Array.from({ length: 30 }, (_item, index) => ({ chapterIndex: index + 1, summary: 'H'.repeat(300) })),
        styleCanon: { observations: ['O'.repeat(3000)] },
        canonRestrictions: Array.from({ length: 30 }, (_item, index) => `Cấm ${index} ${'x'.repeat(100)}`),
        creativeGaps: Array.from({ length: 30 }, (_item, index) => `Khoảng trống ${index} ${'y'.repeat(100)}`),
        fullRawCorpusText: 'z'.repeat(50000),
      },
    });

    const serialized = JSON.stringify(context);
    expect(serialized.length).toBeLessThanOrEqual(1400);
    expect(context).not.toHaveProperty('fullRawCorpusText');
    expect(context.characterCanon.length).toBeLessThanOrEqual(6);
    expect(context.canonRestrictions.length).toBeLessThanOrEqual(8);
  });

  it('does not inject Canon Pack writer layer when fanfic context is absent', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      projectTitle: 'Dự án thường',
      sceneText: 'Lan chờ.',
      fanficCanonContext: null,
    });

    expect(messages[0].content).not.toContain('[CANON PACK CHO DONG NHAN / VIET LAI]');
  });

  it('loads linked Canon Pack context through the repository helper', async () => {
    vi.resetModules();
    vi.doMock('../../services/labLite/canonPackRepository.js', () => ({
      loadCanonPack: vi.fn(async (id) => ({
        id,
        title: 'Pack đã lưu',
        globalCanon: { summary: 'Canon đã lưu.' },
        characterCanon: [{ name: 'Lan', status: 'alive' }],
        relationshipCanon: [],
        chapterCanon: [],
        styleCanon: { observations: ['Ngắn gọn.'] },
        canonRestrictions: ['Không phá timeline.'],
        creativeGaps: ['Một khoảng trống.'],
      })),
    }));

    const { loadFanficCanonContext } = await import('../../services/labLite/canonPackContext.js');
    const context = await loadFanficCanonContext({
      project: {
        source_canon_pack_id: 'pack_saved',
        project_mode: 'fanfic',
        canon_adherence_level: 'strict',
      },
      sceneText: 'Lan xuất hiện.',
    });

    expect(context.packId).toBe('pack_saved');
    expect(context.packTitle).toBe('Pack đã lưu');
    expect(context.characterCanon[0].name).toBe('Lan');
  });
});
