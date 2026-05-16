import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../services/ai/promptBuilder';
import {
  computeProjectStyleRuntimeSourceHash,
  getProjectStyleRuntimeState,
  normalizeProjectStyleRuntimeResult,
  PROJECT_STYLE_RUNTIME_HEADER,
} from '../../services/ai/projectStyleRuntime';
import { TASK_TYPES } from '../../services/ai/router';
import { isWritingOutputTaskType } from '../../stores/aiStore';

function makeRuntimeBlock() {
  return [
    PROJECT_STYLE_RUNTIME_HEADER,
    '1. Luật cốt lõi',
    '- Giữ luật riêng của truyện và không retcon.',
    '2. Giọng kể / POV',
    '- Giữ giọng kể đã khóa và không đổi camera.',
    '3. Nhịp chương',
    '- Mở nhanh, kết bằng hook rõ.',
    '4. Scene grammar',
    '- Cảnh hành động nhanh, cảnh cảm xúc có nhịp chậm hơn.',
    '5. Cần tránh',
    '- Tránh văn phong generic và giảng đạo.',
    '6. QA tự kiểm ngầm',
    '- Tự kiểm POV, style, canon và pacing trước khi trả lời.',
  ].join('\n');
}

function makeRuntimeMeta({ aiGuidelines = '', promptTemplates = {}, genre = 'fantasy' } = {}) {
  return {
    source_hash: computeProjectStyleRuntimeSourceHash({
      aiGuidelines,
      promptTemplates,
      genre,
    }),
    generated_at: 123,
  };
}

describe('phase10 project style runtime block', () => {
  it('changes source hash when project prompts, task prompts, or base system identity change', () => {
    const base = {
      aiGuidelines: 'Giữ giọng lạnh.',
      promptTemplates: {
        constitution: ['Không retcon.'],
        style_dna: ['Câu ngắn, sắc.'],
        [TASK_TYPES.FREE_PROMPT]: 'Viết theo yêu cầu tự do.',
      },
      genre: 'fantasy',
      systemIdentityPrompt: 'Identity A',
    };

    const original = computeProjectStyleRuntimeSourceHash(base);

    expect(computeProjectStyleRuntimeSourceHash({ ...base, aiGuidelines: 'Giữ giọng nóng.' })).not.toBe(original);
    expect(computeProjectStyleRuntimeSourceHash({
      ...base,
      promptTemplates: { ...base.promptTemplates, constitution: ['Không retcon.', 'Không đổi POV.'] },
    })).not.toBe(original);
    expect(computeProjectStyleRuntimeSourceHash({
      ...base,
      promptTemplates: { ...base.promptTemplates, style_dna: ['Câu dài, mềm.'] },
    })).not.toBe(original);
    expect(computeProjectStyleRuntimeSourceHash({
      ...base,
      promptTemplates: { ...base.promptTemplates, [TASK_TYPES.FREE_PROMPT]: 'Bridge tự do mới.' },
    })).not.toBe(original);
    expect(computeProjectStyleRuntimeSourceHash({ ...base, systemIdentityPrompt: 'Identity B' })).not.toBe(original);
  });

  it('normalizes valid AI JSON and rejects runtime blocks missing the required six sections', () => {
    const valid = normalizeProjectStyleRuntimeResult({
      project_style_runtime_block: makeRuntimeBlock(),
      source_hash: 'ai-should-not-win',
    }, { sourceHash: 'trusted-hash' });

    expect(valid.project_style_runtime_block).toContain(PROJECT_STYLE_RUNTIME_HEADER);
    expect(valid.meta.source_hash).toBe('trusted-hash');

    expect(() => normalizeProjectStyleRuntimeResult({
      project_style_runtime_block: [
        PROJECT_STYLE_RUNTIME_HEADER,
        '1. Luật cốt lõi',
        '2. Giọng kể / POV',
      ].join('\n'),
    }, { sourceHash: 'hash' })).toThrow(/chưa đủ 6 mục/i);
  });

  it('injects an active runtime block early and suppresses duplicated project style layers', () => {
    const promptTemplates = {
      constitution: ['UNIQUE_CONSTITUTION_RULE'],
      style_dna: ['UNIQUE_STYLE_DNA_RULE'],
      anti_ai_blacklist: ['UNIQUE_BLACKLIST_PHRASE'],
      [TASK_TYPES.FREE_PROMPT]: 'UNIQUE_FREE_PROMPT_TASK_BRIDGE',
    };
    const aiGuidelines = 'UNIQUE_AI_GUIDELINES';

    const messages = buildPrompt(TASK_TYPES.FREE_PROMPT, {
      projectId: 1,
      chapterId: 2,
      projectTitle: 'Runtime Test',
      genre: 'fantasy',
      userPrompt: 'Viết tiếp cảnh này.',
      aiGuidelines,
      promptTemplates,
      projectStyleRuntimeBlock: makeRuntimeBlock(),
      projectStyleRuntimeEnabled: true,
      projectStyleRuntimeMeta: makeRuntimeMeta({ aiGuidelines, promptTemplates }),
    });

    const system = messages[0].content;
    const projectIndex = system.indexOf('[Truyện: Runtime Test');
    const runtimeIndex = system.indexOf(PROJECT_STYLE_RUNTIME_HEADER);
    const taskIndex = system.indexOf('[NHIỆM VỤ]');

    expect(runtimeIndex).toBeGreaterThan(projectIndex);
    expect(runtimeIndex).toBeLessThan(taskIndex);
    expect(system).toContain('UNIQUE_FREE_PROMPT_TASK_BRIDGE');
    expect(system).not.toContain('UNIQUE_AI_GUIDELINES');
    expect(system).not.toContain('UNIQUE_CONSTITUTION_RULE');
    expect(system).not.toContain('UNIQUE_STYLE_DNA_RULE');
    expect(system).not.toContain('UNIQUE_BLACKLIST_PHRASE');
    expect(system).not.toContain('[VĂN PHONG DNA -');
    expect(system).toContain('[KỶ LUẬT VĂN XUÔI VÀ THOẠI - BỔ SUNG BẮT BUỘC]');
    expect(system).toContain('[ĐỘ DÀI VÀ NHỊP ĐỘ]');
  });

  it('falls back to the old prompt layers when the saved block is stale', () => {
    const originalTemplates = {
      constitution: ['OLD_RULE'],
      style_dna: ['OLD_STYLE'],
      anti_ai_blacklist: ['OLD_BLACKLIST'],
    };
    const nextTemplates = {
      constitution: ['NEW_CONSTITUTION_RULE'],
      style_dna: ['NEW_STYLE_DNA_RULE'],
      anti_ai_blacklist: ['NEW_BLACKLIST_PHRASE'],
    };
    const oldMeta = makeRuntimeMeta({
      aiGuidelines: 'OLD_AI_GUIDELINES',
      promptTemplates: originalTemplates,
    });

    const state = getProjectStyleRuntimeState({
      taskType: TASK_TYPES.FREE_PROMPT,
      aiGuidelines: 'NEW_AI_GUIDELINES',
      promptTemplates: nextTemplates,
      genre: 'fantasy',
      projectStyleRuntimeBlock: makeRuntimeBlock(),
      projectStyleRuntimeEnabled: true,
      projectStyleRuntimeMeta: oldMeta,
    });

    expect(state.active).toBe(false);
    expect(state.stale).toBe(true);

    const messages = buildPrompt(TASK_TYPES.FREE_PROMPT, {
      projectId: 1,
      chapterId: 2,
      projectTitle: 'Runtime Test',
      genre: 'fantasy',
      userPrompt: 'Viết tiếp cảnh này.',
      aiGuidelines: 'NEW_AI_GUIDELINES',
      promptTemplates: nextTemplates,
      projectStyleRuntimeBlock: makeRuntimeBlock(),
      projectStyleRuntimeEnabled: true,
      projectStyleRuntimeMeta: oldMeta,
    });

    const system = messages[0].content;

    expect(system).not.toContain(PROJECT_STYLE_RUNTIME_HEADER);
    expect(system).toContain('NEW_AI_GUIDELINES');
    expect(system).toContain('NEW_CONSTITUTION_RULE');
    expect(system).toContain('NEW_STYLE_DNA_RULE');
    expect(system).toContain('NEW_BLACKLIST_PHRASE');
  });

  it('keeps locked JSON contracts intact while runtime style block is active', () => {
    const promptTemplates = {
      [TASK_TYPES.QA_CHECK]: 'Thêm tiêu chí kiểm tra văn phong project.',
      [TASK_TYPES.CONTINUITY_CHECK]: 'Thêm tiêu chí kiểm tra timeline project.',
    };
    const aiGuidelines = 'Giữ luật project.';
    const meta = makeRuntimeMeta({ aiGuidelines, promptTemplates });

    const qaMessages = buildPrompt(TASK_TYPES.QA_CHECK, {
      projectId: 1,
      projectTitle: 'Runtime Test',
      genre: 'fantasy',
      aiGuidelines,
      promptTemplates,
      projectStyleRuntimeBlock: makeRuntimeBlock(),
      projectStyleRuntimeEnabled: true,
      projectStyleRuntimeMeta: meta,
    });

    const continuityMessages = buildPrompt(TASK_TYPES.CONTINUITY_CHECK, {
      projectId: 1,
      projectTitle: 'Runtime Test',
      genre: 'fantasy',
      aiGuidelines,
      promptTemplates,
      projectStyleRuntimeBlock: makeRuntimeBlock(),
      projectStyleRuntimeEnabled: true,
      projectStyleRuntimeMeta: meta,
    });

    expect(qaMessages[0].content).toContain(PROJECT_STYLE_RUNTIME_HEADER);
    expect(qaMessages[0].content).toContain('"issues"');
    expect(qaMessages[0].content).toContain('Chỉ trả về JSON');
    expect(continuityMessages[0].content).toContain(PROJECT_STYLE_RUNTIME_HEADER);
    expect(continuityMessages[0].content).toContain('"issues"');
    expect(continuityMessages[0].content).toContain('Chỉ trả về JSON');
  });

  it('treats FREE_PROMPT as writing output for bridge save and validation flow', () => {
    expect(isWritingOutputTaskType(TASK_TYPES.FREE_PROMPT)).toBe(true);
    expect(isWritingOutputTaskType(TASK_TYPES.CONTINUE)).toBe(true);
    expect(isWritingOutputTaskType(TASK_TYPES.BRAINSTORM)).toBe(false);
  });
});
