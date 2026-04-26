export function buildArcMapperPrompt({ scoutResults = [], chapterCount = 0, windowLabel = 'full' }) {
  return [
    {
      role: 'system',
      content: [
        'Bạn là AI lập bản đồ arc của StoryForge Lab Lite.',
        'Hãy gom các kết quả quét chương thành những arc/mạch truyện mạch lạc.',
        'Chỉ dùng metadata Scout được cung cấp. Không bịa nội dung full chương.',
        'Tiêu đề, summary và whyLoad phải viết bằng tiếng Việt có dấu.',
        'Chỉ trả JSON hợp lệ. Không markdown, không giải thích ngoài JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        windowLabel,
        chapterCount,
        outputSchema: {
          arcs: [
            {
              id: 'arc_001',
              title: 'Tên arc bằng tiếng Việt có dấu',
              chapterStart: 'số',
              chapterEnd: 'số',
              summary: 'Tóm tắt ngắn dựa trên lý do Scout',
              importance: 'low|medium|high|critical',
              whyLoad: 'Lý do arc này nên được nạp sâu',
              recommendedDeepChapters: ['số'],
            },
          ],
        },
        scoutResults,
      }, null, 2),
    },
  ];
}
