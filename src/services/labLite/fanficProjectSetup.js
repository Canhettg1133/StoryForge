import aiService from '../ai/client.js';
import modelRouter, { QUALITY_MODES, TASK_TYPES } from '../ai/router.js';
import { parseAIJsonValue } from '../../utils/aiJson.js';

export const PROJECT_MODES = {
  ORIGINAL: 'original',
  FANFIC: 'fanfic',
  REWRITE: 'rewrite',
  TRANSLATION_CONTEXT: 'translation_context',
};

export const FANFIC_TYPES = [
  { value: 'continue_after_ending', label: 'Viết tiếp sau ending' },
  { value: 'rewrite_from_start', label: 'Viết lại từ đầu' },
  { value: 'branch_from_event', label: 'Rẽ nhánh từ một sự kiện' },
  { value: 'pov_shift', label: 'Đổi POV' },
  { value: 'add_original_character', label: 'Thêm OC' },
  { value: 'side_character_focus', label: 'Khai thác nhân vật phụ' },
];

export const CANON_ADHERENCE_LEVELS = [
  { value: 'strict', label: 'Bám canon chặt' },
  { value: 'balanced', label: 'Lệch nhẹ' },
  { value: 'branch', label: 'Rẽ nhánh tự do' },
  { value: 'loose', label: 'Chỉ giữ nhân vật/thế giới' },
];

function compactCanonPackForSetup(canonPack = {}) {
  return {
    title: canonPack.title || canonPack.metadata?.sourceTitle || 'Canon Pack',
    globalCanon: {
      summary: canonPack.globalCanon?.summary || '',
      themes: (canonPack.globalCanon?.themes || []).slice(0, 8),
      mainCharacters: (canonPack.globalCanon?.mainCharacters || []).slice(0, 10),
      hardRestrictions: (canonPack.globalCanon?.hardRestrictions || canonPack.canonRestrictions || []).slice(0, 12),
    },
    arcs: (canonPack.arcCanon || []).slice(0, 8).map((arc) => ({
      title: arc.title,
      chapterStart: arc.chapterStart,
      chapterEnd: arc.chapterEnd,
      summary: arc.summary,
      importance: arc.importance,
    })),
    characters: (canonPack.characterCanon || []).slice(0, 12).map((character) => ({
      name: character.name,
      role: character.role,
      status: character.status,
      voice: character.voice,
    })),
    styleCanon: canonPack.styleCanon || {},
    canonRestrictions: (canonPack.canonRestrictions || []).slice(0, 14),
    creativeGaps: (canonPack.creativeGaps || []).slice(0, 14),
  };
}

function normalizeGeneratedSeed(raw, fallback) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const chapters = Array.isArray(parsed.chapters)
    ? parsed.chapters.slice(0, 8).map((chapter, index) => ({
      title: String(chapter?.title || `Chương ${index + 1}`).trim(),
      summary: String(chapter?.summary || chapter?.synopsis || '').trim(),
      purpose: String(chapter?.purpose || '').trim(),
      key_events: Array.isArray(chapter?.key_events)
        ? chapter.key_events.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [],
      featured_characters: Array.isArray(chapter?.featured_characters)
        ? chapter.featured_characters.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [],
    })).filter((chapter) => chapter.title || chapter.summary)
    : [];

  return {
    ...fallback,
    title: String(parsed.title || fallback.title || '').trim(),
    description: String(parsed.description || parsed.premise || fallback.description || '').trim(),
    synopsis: String(parsed.synopsis || parsed.description || parsed.premise || fallback.synopsis || '').trim(),
    chapters: chapters.length > 0 ? chapters : fallback.chapters,
  };
}

function buildFanficSetupMessages({ canonPack, setup = {}, fallback }) {
  const setupLabel = FANFIC_TYPES.find((item) => item.value === setup.fanficType)?.label || 'Đồng nhân / viết lại theo canon';
  const adherenceLabel = CANON_ADHERENCE_LEVELS.find((item) => item.value === setup.adherenceLevel)?.label || 'Lệch nhẹ';

  return [
    {
      role: 'system',
      content: [
        'Bạn là trợ lý lập dàn ý cho tác giả StoryForge.',
        'Chỉ dùng Canon Pack rút gọn được cung cấp. Không tự khẳng định canon nếu thiếu dữ liệu.',
        'Trả về JSON hợp lệ, không markdown.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Tạo premise và outline khởi đầu cho dự án đồng nhân / viết lại theo canon.',
        outputSchema: {
          title: 'Tên dự án',
          premise: 'Một đoạn premise ngắn',
          synopsis: 'Tóm tắt hướng truyện',
          chapters: [
            {
              title: 'Tên chương',
              summary: 'Tóm tắt chương',
              purpose: 'Vai trò chương trong tuyến mới',
              key_events: ['Sự kiện chính'],
              featured_characters: ['Nhân vật liên quan'],
            },
          ],
        },
        constraints: [
          'Không ghi là AI đảm bảo không phá canon.',
          'Không nhồi toàn bộ Canon Pack vào outline.',
          'Giữ tiếng Việt có dấu.',
          'Nếu có điểm rẽ nhánh, chương đầu phải neo vào điểm rẽ nhánh đó.',
          'Tạo 3 đến 5 chương khởi đầu, không tạo auto-generation dài.',
        ],
        setup: {
          fanficType: setupLabel,
          adherenceLevel: adherenceLabel,
          divergencePoint: setup.divergencePoint || '',
        },
        canonPack: compactCanonPackForSetup(canonPack),
        fallbackShape: fallback,
      }),
    },
  ];
}

export function buildFanficProjectSeed({ canonPack, setup = {}, title = '' } = {}) {
  const sourceTitle = canonPack?.metadata?.sourceTitle || canonPack?.title || 'Canon Pack';
  const projectTitle = title || `${sourceTitle} - Đồng nhân`;
  const mainCharacters = (canonPack?.globalCanon?.mainCharacters || canonPack?.characterCanon?.map((item) => item.name) || []).slice(0, 6);
  const restrictions = (canonPack?.canonRestrictions || canonPack?.globalCanon?.hardRestrictions || []).slice(0, 8);
  const creativeGaps = (canonPack?.creativeGaps || []).slice(0, 8);
  const setupLabel = FANFIC_TYPES.find((item) => item.value === setup.fanficType)?.label || 'Đồng nhân / viết lại theo canon';
  const adherenceLabel = CANON_ADHERENCE_LEVELS.find((item) => item.value === setup.adherenceLevel)?.label || 'Lệch nhẹ';

  const premise = [
    `${setupLabel} dựa trên ${sourceTitle}.`,
    mainCharacters.length > 0 ? `Nhân vật neo canon: ${mainCharacters.join(', ')}.` : '',
    setup.divergencePoint ? `Điểm rẽ nhánh: ${setup.divergencePoint}.` : '',
    creativeGaps.length > 0 ? `Khoảng trống có thể khai thác: ${creativeGaps.slice(0, 3).join('; ')}.` : '',
  ].filter(Boolean).join(' ');

  const chapters = [
    {
      title: 'Chương 1: Điểm rẽ nhánh',
      summary: setup.divergencePoint || 'Thiết lập lại điểm bắt đầu của tuyến đồng nhân.',
      purpose: `Mở dự án ở mức bám canon: ${adherenceLabel}.`,
      key_events: [
        setup.divergencePoint || 'Xác định biến cố làm tuyến truyện tách khỏi bản gốc.',
        'Nhắc lại trạng thái nhân vật và thế giới cần giữ.',
      ],
      featured_characters: mainCharacters.slice(0, 3),
    },
    {
      title: 'Chương 2: Hệ quả đầu tiên',
      summary: 'Cho thấy hệ quả trực tiếp của lựa chọn/rẽ nhánh mới.',
      purpose: 'Chứng minh tuyến mới vẫn hiểu canon cũ.',
      key_events: restrictions.slice(0, 2).map((item) => `Không phá canon: ${item}`),
      featured_characters: mainCharacters.slice(0, 4),
    },
    {
      title: 'Chương 3: Khoảng trống sáng tạo',
      summary: creativeGaps[0] || 'Khai thác vùng chưa kể mà Canon Pack cho phép.',
      purpose: 'Mở hướng phát triển riêng cho dự án mới.',
      key_events: creativeGaps.slice(0, 3),
      featured_characters: mainCharacters.slice(0, 4),
    },
  ];

  return {
    title: projectTitle,
    description: premise,
    synopsis: premise,
    chapters,
    fanfic_setup: {
      fanficType: setup.fanficType || 'continue_after_ending',
      adherenceLevel: setup.adherenceLevel || 'balanced',
      divergencePoint: setup.divergencePoint || '',
      sourceCanonPackTitle: canonPack?.title || '',
    },
  };
}

export async function generateFanficProjectSeed({ canonPack, setup = {}, title = '' } = {}) {
  const fallback = buildFanficProjectSeed({ canonPack, setup, title });
  if (!canonPack) return fallback;

  try {
    aiService.setRouter(modelRouter);
    const messages = buildFanficSetupMessages({ canonPack, setup, fallback });
    const text = await new Promise((resolve, reject) => {
      aiService.send({
        taskType: TASK_TYPES.FREE_PROMPT,
        messages,
        stream: false,
        allowConcurrent: true,
        routeOptions: {
          qualityOverride: QUALITY_MODES.BALANCED,
          useProxyQualityRouting: true,
        },
        onComplete: resolve,
        onError: reject,
      });
    });

    return normalizeGeneratedSeed(parseAIJsonValue(text), fallback);
  } catch (error) {
    console.warn('Fanfic setup AI failed, using deterministic Canon Pack seed:', error);
    return fallback;
  }
}
