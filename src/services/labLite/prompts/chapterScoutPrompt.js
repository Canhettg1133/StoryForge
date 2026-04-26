export const LAB_LITE_SCOUT_GOALS = {
  FANFIC: 'fanfic',
  CONTINUE_AFTER_ENDING: 'continue_after_ending',
  ADULT_CONTEXT: 'adult_context',
  TRANSLATION: 'translation',
  STORY_BIBLE: 'story_bible',
};

export function buildChapterScoutPrompt({ chapterSample, goal = LAB_LITE_SCOUT_GOALS.STORY_BIBLE, allowAdultSignals = false }) {
  return [
    {
      role: 'system',
      content: [
        'Bạn là AI quét chương của StoryForge Lab Lite.',
        'Chỉ đọc mẫu chương được cung cấp và phân loại chương này có đáng nạp sâu cho công việc canon hay không.',
        'Không dựa vào keyword cứng. Hãy suy luận từ biến cố, thay đổi trạng thái, reveal, thay đổi quan hệ, worldbuilding và vị trí trong mạch truyện.',
        'Trường reason phải viết bằng tiếng Việt có dấu, ngắn nhưng đủ lý do.',
        'Chỉ trả JSON hợp lệ. Không markdown, không giải thích ngoài JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        goal,
        adultSignalPolicy: allowAdultSignals
          ? 'Được dùng adult_sensitive khi mẫu chương rõ ràng có bối cảnh trưởng thành, cảnh 18+ hoặc quan hệ nhạy cảm.'
          : 'Không dùng adult_sensitive. Nếu cần, dùng sensitive_or_relationship_heavy.',
        outputSchema: {
          chapterIndex: 'số',
          priority: 'low|medium|high|critical',
          recommendation: 'skip|light_load|deep_load',
          detectedSignals: [
            'new_character',
            'relationship_shift',
            'worldbuilding',
            'reveal',
            'state_change',
            'sensitive_or_relationship_heavy',
            allowAdultSignals ? 'adult_sensitive' : 'ending_hook',
            'ending_hook',
          ],
          reason: 'Lý do ngắn bằng tiếng Việt có dấu, bám vào mẫu chương đã đọc.',
          confidence: 'số từ 0 đến 1',
        },
        chapterSample,
      }, null, 2),
    },
  ];
}

export function buildChapterScoutBatchPrompt({ chapterSamples = [], goal = LAB_LITE_SCOUT_GOALS.STORY_BIBLE, allowAdultSignals = false }) {
  return [
    {
      role: 'system',
      content: [
        'Bạn là AI quét nhiều chương của StoryForge Lab Lite.',
        'Chỉ đọc các mẫu chương được cung cấp và phân loại chương nào đáng nạp sâu cho công việc canon.',
        'Không dựa vào keyword cứng. Hãy suy luận từ biến cố, thay đổi trạng thái, reveal, thay đổi quan hệ, worldbuilding và vị trí trong mạch truyện.',
        'Phải trả đúng một kết quả cho mỗi chapterIndex trong chapterSamples. Không bỏ sót chương.',
        'Trường reason phải viết bằng tiếng Việt có dấu, ngắn nhưng đủ lý do.',
        'Chỉ trả JSON hợp lệ. Không markdown, không giải thích ngoài JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        goal,
        adultSignalPolicy: allowAdultSignals
          ? 'Được dùng adult_sensitive khi mẫu chương rõ ràng có bối cảnh trưởng thành, cảnh 18+ hoặc quan hệ nhạy cảm.'
          : 'Không dùng adult_sensitive. Nếu cần, dùng sensitive_or_relationship_heavy.',
        outputSchema: {
          results: [{
            chapterIndex: 'số',
            priority: 'low|medium|high|critical',
            recommendation: 'skip|light_load|deep_load',
            detectedSignals: [
              'new_character',
              'relationship_shift',
              'worldbuilding',
              'reveal',
              'state_change',
              'sensitive_or_relationship_heavy',
              allowAdultSignals ? 'adult_sensitive' : 'ending_hook',
              'ending_hook',
            ],
            reason: 'Lý do ngắn bằng tiếng Việt có dấu, bám vào mẫu chương đã đọc.',
            confidence: 'số từ 0 đến 1',
          }],
        },
        chapterSamples,
      }, null, 2),
    },
  ];
}
