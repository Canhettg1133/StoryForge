export const REVIEW_VERSION = '1.2';
export const REVIEW_MODES = ['adherence', 'literary', 'signals'];
export const MODE_LABELS = { adherence: 'Bám yêu cầu', literary: 'Chấm văn', signals: 'Dấu hiệu máy móc' };
export const SIGNAL_LABELS = { none: 'Không thấy tín hiệu rõ', low: 'Ít', medium: 'Đáng chú ý', high: 'Dày đặc', insufficient_context: 'Thiếu ngữ cảnh' };
export const SIGNAL_CRITERIA = { repetition: 'Lặp ý', uniform_structure: 'Cấu trúc quá đều', overexplanation: 'Diễn giải thừa', generic_imagery: 'Hình ảnh chung chung', named_emotion: 'Cảm xúc bị gọi tên', uniform_dialogue: 'Giọng thoại đồng dạng', formulaic_transition: 'Chuyển/kết đoạn công thức' };
export const REQUIREMENT_LABELS = { met: 'Đạt', partial: 'Đạt một phần', violated: 'Vi phạm', not_observable: 'Không quan sát được', conflict: 'Mâu thuẫn yêu cầu' };
export const REVIEW_LIMITS = { sourceCharacters: 60_000, inputTokens: 16_000, outputCharacters: 64_000, timeoutMs: 180_000, requirements: 128 };
export const LITERARY_CRITERIA = [
  { id: 'voice', label: 'Giọng kể, cá tính ngôn ngữ', weight: 20, question: 'Giọng có nhất quán, riêng biệt và phù hợp ý đồ không?' },
  { id: 'craft', label: 'Kỹ thuật câu/đoạn', weight: 20, question: 'Độ rõ, lựa chọn từ, nhạc tính và nhịp câu có phục vụ cảnh không?' },
  { id: 'pacing', label: 'Cấu trúc cảnh, nhịp kể', weight: 15, question: 'Cảnh có chức năng hoặc chuyển động rõ, có kéo dài vô ích không?' },
  { id: 'character', label: 'Nhân vật, POV, tâm lý', weight: 15, question: 'Điểm nhìn, phản ứng và động cơ có thuyết phục trong dữ liệu được cung cấp không?' },
  { id: 'emotion', label: 'Cảm xúc, hình ảnh, subtext', weight: 15, question: 'Đoạn tạo trải nghiệm cụ thể và điều chưa nói, hay chỉ thông báo cảm xúc?' },
  { id: 'dialogue', label: 'Đối thoại', weight: 10, question: 'Lời thoại có giọng riêng, mục đích, subtext không? Không có thoại: null.' },
  { id: 'logic', label: 'Logic nội tại', weight: 5, question: 'Chi tiết, quan hệ nhân quả có nhất quán trong đoạn và ngữ cảnh đã cho không? Không kiểm canon toàn truyện.' },
];
