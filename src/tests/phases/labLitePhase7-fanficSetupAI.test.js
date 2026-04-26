import { describe, expect, it, vi } from 'vitest';

async function loadFanficSetupWithAiMock({ responseText = '', error = null } = {}) {
  vi.resetModules();
  const send = vi.fn((options) => {
    if (error) {
      options.onError(error);
      return;
    }
    options.onComplete(responseText);
  });

  vi.doMock('../../services/ai/client.js', () => ({
    default: {
      setRouter: vi.fn(),
      send,
    },
  }));
  vi.doMock('../../services/ai/router.js', () => ({
    default: {},
    TASK_TYPES: { FREE_PROMPT: 'free_prompt' },
    QUALITY_MODES: { BALANCED: 'balanced' },
  }));

  return {
    send,
    module: await import('../../services/labLite/fanficProjectSetup.js'),
  };
}

const canonPack = {
  id: 'pack_fanfic',
  title: 'Canon Gốc',
  metadata: { sourceTitle: 'Truyện Gốc' },
  globalCanon: {
    summary: 'Lan thắng trận cuối.',
    mainCharacters: ['Lan', 'Kha'],
    hardRestrictions: ['Mentor đã chết không được hồi sinh.'],
  },
  arcCanon: [{ title: 'Kết thúc', chapterStart: 80, chapterEnd: 90, summary: 'Kết thúc chính truyện.' }],
  characterCanon: [{ name: 'Lan', status: 'alive', voice: 'điềm tĩnh' }],
  canonRestrictions: ['Lan chưa biết bí mật hoàng tộc trước chương 20.'],
  creativeGaps: ['Khoảng trống sau ending chưa kể.'],
  styleCanon: { observations: ['Nhịp kể nhanh.'] },
};

describe('Lab Lite Phase 7 - fanfic setup AI generation', () => {
  it('uses AI output for premise and outline when the provider returns valid JSON', async () => {
    const { send, module } = await loadFanficSetupWithAiMock({
      responseText: JSON.stringify({
        title: 'Nhánh mới của Lan',
        premise: 'Lan rẽ nhánh sau ending.',
        synopsis: 'Một tuyến mới giữ giới hạn canon chính.',
        chapters: [
          {
            title: 'Chương 1: Sau ending',
            summary: 'Lan nhận ra hệ quả đầu tiên.',
            purpose: 'Neo điểm rẽ nhánh.',
            key_events: ['Lan chọn ở lại'],
            featured_characters: ['Lan'],
          },
          { title: 'Chương 2: Lời cảnh báo', summary: 'Kha quay lại.' },
        ],
      }),
    });

    const seed = await module.generateFanficProjectSeed({
      canonPack,
      setup: {
        fanficType: 'continue_after_ending',
        adherenceLevel: 'strict',
        divergencePoint: 'Sau ending.',
      },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(seed.title).toBe('Nhánh mới của Lan');
    expect(seed.description).toBe('Lan rẽ nhánh sau ending.');
    expect(seed.synopsis).toBe('Một tuyến mới giữ giới hạn canon chính.');
    expect(seed.chapters).toHaveLength(2);
    expect(seed.chapters[0].featured_characters).toEqual(['Lan']);
    expect(seed.fanfic_setup).toEqual(expect.objectContaining({
      fanficType: 'continue_after_ending',
      adherenceLevel: 'strict',
      divergencePoint: 'Sau ending.',
    }));
  });

  it('falls back to deterministic Canon Pack seed when AI fails or returns unusable output', async () => {
    const { module } = await loadFanficSetupWithAiMock({
      error: new Error('missing key'),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const seed = await module.generateFanficProjectSeed({
      canonPack,
      setup: {
        fanficType: 'branch_from_event',
        adherenceLevel: 'balanced',
        divergencePoint: 'Kha cảnh báo Lan sớm hơn.',
      },
    });

    expect(seed.title).toContain('Truyện Gốc');
    expect(seed.description).toContain('Kha cảnh báo Lan sớm hơn.');
    expect(seed.chapters).toHaveLength(3);
    expect(seed).not.toHaveProperty('characters');
    expect(seed).not.toHaveProperty('canonFacts');
    warnSpy.mockRestore();
  });

  it('compacts Canon Pack before sending setup context to AI', async () => {
    const { send, module } = await loadFanficSetupWithAiMock({
      responseText: JSON.stringify({ title: 'AI Seed', premise: 'Premise', chapters: [] }),
    });

    await module.generateFanficProjectSeed({
      canonPack: {
        ...canonPack,
        hugeLayer: 'x'.repeat(20000),
        chapterCanon: Array.from({ length: 100 }, (_item, index) => ({ chapterIndex: index + 1, content: 'full text should not be sent' })),
      },
      setup: { fanficType: 'pov_shift', adherenceLevel: 'loose' },
    });

    const payload = send.mock.calls[0][0].messages[1].content;
    expect(payload).toContain('"canonPack"');
    expect(payload).not.toContain('hugeLayer');
    expect(payload).not.toContain('full text should not be sent');
    expect(payload.length).toBeLessThan(9000);
  });
});
