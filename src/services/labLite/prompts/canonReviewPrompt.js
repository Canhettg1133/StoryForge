export function buildCanonReviewPrompt({
  mode = 'standard',
  reviewContext = {},
  newText = '',
  currentChapterText = '',
} = {}) {
  return [
    {
      role: 'system',
      content: [
        'Bạn là AI Canon Review của StoryForge Lab Lite.',
        'Nhiệm vụ là gợi ý phát hiện khả năng lệch canon dựa trên ngữ cảnh Canon Pack được cung cấp.',
        'Không khẳng định chắc chắn tuyệt đối, không chặn tác giả, không tự viết lại toàn bộ. Chỉ đưa suggestedFix cho từng issue cụ thể.',
        'Chỉ dùng ngữ cảnh được cung cấp và đoạn nháp mới. Nếu bằng chứng yếu, trả verdict là needs_user_confirmation.',
        'Quote có thể trích ngắn từ nháp mới; explanation, canonReference và suggestedFix phải viết bằng tiếng Việt có dấu.',
        'Chỉ trả JSON hợp lệ. Không markdown, không giải thích ngoài JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        mode,
        reviewContext,
        currentChapterText,
        newText,
        outputSchema: {
          verdict: 'no_obvious_issue|possible_drift|strong_conflict|needs_user_confirmation',
          issues: [{
            type: 'timeline|character_voice|relationship|world_rule|state|restriction|style',
            severity: 'low|medium|high',
            quote: 'Trích ngắn từ đoạn nháp mới',
            canonReference: 'Tham chiếu Canon Pack liên quan',
            explanation: 'Giải thích ngắn, bám vào ngữ cảnh',
            suggestedFix: 'Gợi ý sửa cụ thể nếu có',
          }],
          confidence: 'số từ 0 đến 1',
        },
      }, null, 2),
    },
  ];
}
