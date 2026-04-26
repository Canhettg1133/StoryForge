export function buildDeepAnalysisPrompt({
  corpusTitle = '',
  target = {},
  chapters = [],
  allowAdultCanon = false,
}) {
  const chapterPayload = chapters.map((chapter) => ({
    chapterIndex: Number(chapter.index || 0),
    title: chapter.title || `Chương ${chapter.index || '?'}`,
    wordCount: Number(chapter.wordCount || 0),
    estimatedTokens: Number(chapter.estimatedTokens || 0),
    content: chapter.content || '',
  }));

  return [
    {
      role: 'system',
      content: [
        'Bạn là AI phân tích sâu của StoryForge Lab Lite.',
        'Chỉ trích xuất artifact canon từ các chương được cung cấp.',
        'Dùng tư duy Corpus Analysis chạy trên trình duyệt: cửa sổ phân tích, cụm biến cố và rủi ro liên tục canon.',
        'Khi nhận nhiều chương, không được hạ bài toán thành ghi chú rời rạc từng chương; phải suy luận thay đổi trạng thái xuyên chương trong phạm vi đã nhận.',
        'Không bịa sự kiện, luật thế giới, quan hệ hoặc trạng thái nếu không có căn cứ trong văn bản được cung cấp.',
        'Mỗi mục quan trọng nên có evidence từ chương nguồn khi có thể.',
        allowAdultCanon
          ? 'Có thể ghi adultCanonNotes khi nội dung trưởng thành, cảnh 18+ hoặc quan hệ nhạy cảm thật sự liên quan đến canon.'
          : 'Không tạo adultCanonNotes trực diện; dùng ngôn ngữ trung tính về quan hệ hoặc độ nhạy cảm nếu cần.',
        'Tất cả mô tả, tóm tắt, evidence, ghi chú và cảnh báo phải viết bằng tiếng Việt có dấu.',
        'Chỉ trả JSON hợp lệ. Không markdown, không giải thích ngoài JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        corpusTitle,
        target: {
          targetType: target.targetType || 'chapter',
          targetId: target.targetId || '',
          title: target.title || '',
          chapterIndexes: target.chapterIndexes || chapterPayload.map((chapter) => chapter.chapterIndex),
        },
        outputSchema: {
          chapterCanon: [{
            chapterIndex: 'số',
            title: 'chuỗi',
            summary: 'tóm tắt ngắn',
            mainEvents: ['chuỗi'],
            charactersAppearing: ['chuỗi'],
            stateChanges: ['chuỗi'],
            evidence: ['chuỗi'],
          }],
          characterUpdates: [{
            name: 'chuỗi',
            aliases: ['chuỗi'],
            role: 'chuỗi',
            status: 'chuỗi',
            personality: 'chuỗi',
            goals: 'chuỗi',
            secrets: 'chuỗi',
            voice: 'chuỗi',
            evidence: ['chuỗi'],
          }],
          relationshipUpdates: [{
            characterA: 'chuỗi',
            characterB: 'chuỗi',
            relation: 'chuỗi',
            change: 'chuỗi',
            evidence: ['chuỗi'],
          }],
          worldUpdates: [{
            type: 'location|object|term|faction|rule',
            name: 'chuỗi',
            description: 'chuỗi',
            evidence: ['chuỗi'],
          }],
          timelineEvents: [{
            chapterIndex: 'số',
            event: 'chuỗi',
            dateMarker: 'chuỗi',
            evidence: ['chuỗi'],
          }],
          styleObservations: ['chuỗi'],
          adultCanonNotes: ['chuỗi'],
          canonRestrictions: ['chuỗi'],
          creativeGaps: ['chuỗi'],
          uncertainties: ['chuỗi'],
          sourceEvidence: ['chuỗi'],
          analysisWindows: [{
            windowId: 'chuỗi',
            chapterStart: 'số',
            chapterEnd: 'số',
            summary: 'chuỗi',
            keyIncidents: ['chuỗi'],
            evidence: ['chuỗi'],
          }],
          incidentClusters: [{
            id: 'chuỗi',
            title: 'chuỗi',
            chapterIndexes: ['số'],
            summary: 'chuỗi',
            canonImpact: 'chuỗi',
            evidence: ['chuỗi'],
          }],
          continuityRisks: [{
            type: 'timeline|character_state|relationship|world_rule|style|restriction',
            severity: 'low|medium|high',
            chapterIndexes: ['số'],
            description: 'chuỗi',
            evidence: ['chuỗi'],
            suggestedReview: 'chuỗi',
          }],
        },
        chapters: chapterPayload,
      }, null, 2),
    },
  ];
}
