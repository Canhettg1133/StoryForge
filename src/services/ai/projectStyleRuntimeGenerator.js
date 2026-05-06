import aiService from './client';
import modelRouter, { QUALITY_MODES, TASK_TYPES } from './router';
import { parseAIJsonValue } from '../../utils/aiJson';
import {
  buildProjectStyleRuntimeSources,
  computeProjectStyleRuntimeSourceHash,
  normalizeProjectStyleRuntimeResult,
  PROJECT_STYLE_RUNTIME_SECTIONS,
} from './projectStyleRuntime';

function stringifyJson(value) {
  return JSON.stringify(value, null, 2);
}

export function buildProjectStyleRuntimeMessages({
  projectTitle = '',
  genre = '',
  aiGuidelines = '',
  promptTemplates = {},
  writingStyle = '',
} = {}) {
  const sources = buildProjectStyleRuntimeSources({
    aiGuidelines,
    promptTemplates,
    genre,
    writingStyle,
  });

  const schema = {
    project_style_runtime_block: '[PROJECT STYLE - BẮT BUỘC]\\n1. Luật cốt lõi\\n...\\n2. Giọng kể / POV\\n...\\n3. Nhịp chương\\n...\\n4. Scene grammar\\n...\\n5. Cần tránh\\n...\\n6. QA tự kiểm ngầm\\n...',
    how_it_combines_with_base_system: '',
    source_coverage: [],
    merged_rules: [],
    dropped_rules: [],
    risks: [],
  };

  const system = [
    'Bạn là Prompt Doctor của StoryForge.',
    'Nhiệm vụ: rút lõi các prompt hiện có thành một block system prompt riêng cho đúng project hiện tại.',
    'Không viết lại global system prompt. Không thay thế Core Defaults. Không sửa prompt gốc.',
    'Chỉ tạo một lớp bổ sung tên [PROJECT STYLE - BẮT BUỘC] để runtime chèn sau system identity và project POV.',
    '',
    'Quy tắc bắt buộc:',
    '- Giữ lại các luật quan trọng, không làm yếu luật cũ.',
    '- Gộp rule trùng nhau, bỏ câu lặp, bỏ chi tiết chỉ là JSON contract.',
    '- Không đưa schema/output JSON contract vào block viết truyện.',
    '- Không copy canon/tên riêng từ tác phẩm mẫu thành canon project nếu nguồn chỉ là style.',
    '- Không đổi biến template dạng {{...}}.',
    '- Không thêm context động của chương/cảnh như nội dung cảnh hiện tại, memory, canon retrieval, current_status cụ thể.',
    '- Chỉ trả JSON hợp lệ theo schema.',
    '',
    'Block phải có đúng 6 mục:',
    ...PROJECT_STYLE_RUNTIME_SECTIONS.map((section) => `${section.number}. ${section.label}`),
  ].join('\n');

  const user = [
    '# Project',
    stringifyJson({ projectTitle, genre }),
    '',
    '# Vai trò runtime hiện tại',
    [
      'Global writing identity vẫn là nền và KHÔNG được viết lại.',
      'Task prompt vẫn chạy riêng để định nghĩa nhiệm vụ free_prompt/continue/outline/QA.',
      'Canon, nhân vật, scene contract, memory và retrieval vẫn là context động gửi mỗi request.',
      'Block mới chỉ gom luật tĩnh về phong cách, POV, nhịp chương, scene grammar, cần tránh và QA tự kiểm ngầm.',
    ].join('\n'),
    '',
    '# Prompt sources',
    stringifyJson(sources),
    '',
    '# Output JSON schema',
    stringifyJson(schema),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function sendJsonRequest(messages) {
  aiService.setRouter(modelRouter);

  return new Promise((resolve, reject) => {
    aiService.send({
      taskType: TASK_TYPES.FREE_PROMPT,
      messages,
      stream: false,
      allowConcurrent: true,
      routeOptions: {
        qualityOverride: QUALITY_MODES.BEST,
      },
      onComplete: (text) => {
        try {
          resolve(parseAIJsonValue(text));
        } catch (error) {
          reject(error);
        }
      },
      onError: reject,
    });
  });
}

export async function generateProjectStyleRuntimeBlock({
  projectTitle = '',
  genre = '',
  aiGuidelines = '',
  promptTemplates = {},
  writingStyle = '',
} = {}) {
  const sourceHash = computeProjectStyleRuntimeSourceHash({
    aiGuidelines,
    promptTemplates,
    genre,
    writingStyle,
  });
  const messages = buildProjectStyleRuntimeMessages({
    projectTitle,
    genre,
    aiGuidelines,
    promptTemplates,
    writingStyle,
  });
  const raw = await sendJsonRequest(messages);
  return normalizeProjectStyleRuntimeResult(raw, { sourceHash });
}
