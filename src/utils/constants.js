export const GENRES = [
  { value: 'tien_hiep', label: 'Tiên hiệp', emoji: '🏔️' },
  { value: 'huyen_huyen', label: 'Huyền huyễn', emoji: '🌀' },
  { value: 'fantasy', label: 'Fantasy phương Tây', emoji: '🐉' },
  { value: 'vo_hiep', label: 'Võ hiệp', emoji: '⚔️' },
  { value: 'he_thong', label: 'Hệ thống / LitRPG', emoji: '🎮' },
  { value: 'co_dai', label: 'Cổ đại / Cung đấu', emoji: '🏯' },
  { value: 'ngon_tinh_cd', label: 'Ngôn tình cổ đại', emoji: '🌸' },
  { value: 'romance', label: 'Ngôn tình hiện đại', emoji: '💕' },
  { value: 'mystery', label: 'Trinh thám', emoji: '🔍' },
  { value: 'horror', label: 'Kinh dị', emoji: '👻' },
  { value: 'scifi', label: 'Sci-fi', emoji: '🚀' },
  { value: 'xuyen_khong', label: 'Xuyên không', emoji: '⏳' },
  { value: 'trong_sinh', label: 'Trọng sinh', emoji: '🔄' },
  { value: 'do_thi', label: 'Đô thị', emoji: '🏙️' },
  { value: 'mat_the', label: 'Mạt thế', emoji: '💀' },
  { value: 'slice_of_life', label: 'Slice of Life', emoji: '☕' },
  { value: 'drama', label: 'Drama', emoji: '🎭' },
  { value: 'other', label: 'Khác', emoji: '📝' },
];

export const TONES = [
  { value: 'dark', label: 'Tối / Nặng' },
  { value: 'light', label: 'Nhẹ nhàng / Sáng' },
  { value: 'humorous', label: 'Hài hước' },
  { value: 'serious', label: 'Nghiêm túc' },
  { value: 'poetic', label: 'Trữ tình / Thơ' },
  { value: 'cinematic', label: 'Điện ảnh' },
  { value: 'fast_paced', label: 'Nhịp nhanh' },
];

export const SCENE_STATUSES = [
  { value: 'idea', label: 'Ý tưởng', color: 'var(--color-text-muted)' },
  { value: 'outlined', label: 'Có outline', color: 'var(--color-info)' },
  { value: 'draft', label: 'Nháp', color: 'var(--color-warning)' },
  { value: 'revised', label: 'Đã sửa', color: 'var(--color-accent)' },
  { value: 'done', label: 'Hoàn thành', color: 'var(--color-success)' },
];

export const CHAPTER_STATUSES = SCENE_STATUSES;

export function getGenreLabel(value) {
  return GENRES.find(g => g.value === value)?.label || value;
}

export function getGenreEmoji(value) {
  return GENRES.find(g => g.value === value)?.emoji || '📝';
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Vừa xong';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ trước`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} ngày trước`;

  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function countWords(text) {
  if (!text) return 0;
  // Strip HTML tags if present
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  const words = clean.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length;
}

// --- Phase 3: Character & World constants ---

export const CHARACTER_ROLES = [
  { value: 'protagonist', label: 'Nhân vật chính' },
  { value: 'deuteragonist', label: 'Nhân vật phụ chính' },
  { value: 'antagonist', label: 'Phản diện' },
  { value: 'supporting', label: 'Phụ trợ' },
  { value: 'mentor', label: 'Sư phụ / Cố vấn' },
  { value: 'love_interest', label: 'Tình yêu' },
  { value: 'minor', label: 'Vai phụ' },
];

export const WORLD_TERM_CATEGORIES = [
  { value: 'magic', label: 'Phép thuật / Năng lực' },
  { value: 'organization', label: 'Tổ chức / Phe phái' },
  { value: 'race', label: 'Chủng tộc / Giống loài' },
  { value: 'concept', label: 'Khái niệm / Quy tắc' },
  { value: 'technology', label: 'Công nghệ' },
  { value: 'culture', label: 'Văn hóa / Phong tục' },
  { value: 'other', label: 'Khác' },
];

export const PRONOUN_PRESETS = {
  tien_hiep: {
    label: 'Tiên hiệp',
    options: ['tại hạ', 'ta', 'bản tọa', 'bản nhân', 'đạo hữu', 'tiền bối',
      'sư huynh', 'sư đệ', 'sư muội', 'lão phu', 'ngươi', 'các hạ',
      'sư tổ', 'chưởng môn', 'trưởng lão'],
    default_self: 'tại hạ',
    default_other: 'đạo hữu',
  },
  fantasy: {
    label: 'Fantasy phương Tây',
    options: ['ta', 'ngươi', 'tôi', 'anh', 'bệ hạ', 'ngài', 'đại nhân'],
    default_self: 'ta',
    default_other: 'ngươi',
  },
  co_dai: {
    label: 'Cổ đại / Cung đấu',
    options: ['thần', 'bệ hạ', 'trẫm', 'nương nương', 'bản cung', 'vi thần', 'ta', 'ngươi', 'thảo dân', 'công chúa', 'hoàng thượng'],
    default_self: 'ta',
    default_other: 'ngươi',
  },
  vo_hiep: {
    label: 'Võ hiệp',
    options: ['đại hiệp', 'cô nương', 'thiếu hiệp', 'tả', 'bổn nhân', 'ta', 'ngươi', 'bang chủ', 'chưởng môn'],
    default_self: 'ta',
    default_other: 'ngươi',
  },
  modern: {
    label: 'Hiện đại',
    options: ['tôi', 'anh', 'em', 'ông', 'bà', 'cậu', 'tớ', 'mày', 'tao', 'chị', 'chú', 'bác'],
    default_self: 'tôi',
    default_other: 'anh/chị',
  },
  xuyen_khong: {
    label: 'Xuyên không / Trọng sinh',
    options: ['tôi', 'ta', 'tại hạ', 'anh', 'em', 'ngươi', 'các hạ'],
    default_self: 'ta',
    default_other: 'ngươi',
    note: 'Nhân vật xuyên không có thể xưng khác nhân vật bản địa',
  },
};

export const GENRE_PRONOUN_MAP = {
  tien_hiep: 'tien_hiep',
  huyen_huyen: 'tien_hiep',
  fantasy: 'fantasy',
  co_dai: 'co_dai',
  ngon_tinh_cd: 'co_dai',
  vo_hiep: 'vo_hiep',
  xuyen_khong: 'xuyen_khong',
  trong_sinh: 'xuyen_khong',
  he_thong: 'modern',
  romance: 'modern',
  drama: 'modern',
  slice_of_life: 'modern',
  mystery: 'modern',
  horror: 'modern',
  scifi: 'modern',
  do_thi: 'modern',
  mat_the: 'modern',
  other: 'modern',
};

// AI strictness levels
export const AI_STRICTNESS_LEVELS = [
  { value: 'relaxed', label: 'Thoải mái', desc: 'AI tham khảo quy tắc, tác giả toàn quyền sáng tạo' },
  { value: 'balanced', label: 'Cân bằng', desc: 'AI tuân theo quy tắc, nhắc khi vi phạm' },
  { value: 'strict', label: 'Nghiêm ngặt', desc: 'AI tuân thủ tuyệt đối mọi quy tắc' },
];

// POV / Narrative perspective
export const POV_MODES = [
  { value: 'first', label: 'Ngôi 1', desc: 'Tôi/Ta kể — thấy qua mắt nhân vật chính' },
  { value: 'third_limited', label: 'Ngôi 3 hạn chế', desc: 'Anh ta/Cô ấy — theo sát 1 nhân vật mỗi cảnh' },
  { value: 'third_omni', label: 'Ngôi 3 toàn tri', desc: 'Người kể biết tất cả — vào tâm trí mọi nhân vật' },
  { value: 'multi_pov', label: 'Đa góc nhìn', desc: 'Luân phiên giữa nhiều nhân vật (mỗi chương/cảnh 1 POV)' },
];

// Story structure templates
export const STORY_STRUCTURES = [
  { value: '', label: 'Không chọn — tự do' },
  { value: 'three_act', label: '📐 Cấu trúc 3 Hồi', desc: 'Thiết lập → Xung đột → Giải quyết' },
  { value: 'hero_journey', label: '🦸 Hành trình Anh hùng', desc: 'Thế giới bình thường → Kêu gọi → Thử thách → Trở về' },
  { value: 'isekai_system', label: '🎮 Isekai / Hệ Thống', desc: 'Thức tỉnh → Khám phá hệ thống → Chinh phục → Đỉnh cao' },
  { value: 'slice_of_life', label: '☕ Lát cắt cuộc sống', desc: 'Không cốt truyện lớn — tập trung vào nhân vật và cảm xúc' },
  { value: 'mystery', label: '🔍 Trinh thám / Giải đố', desc: 'Vụ án → Điều tra → Twist → Khám phá sự thật' },
];

// Pronoun style presets (richer, independent of genre)
export const PRONOUN_STYLE_PRESETS = [
  {
    value: 'co_trang',
    label: 'Cổ Trang (Chung / Dã Sử)',
    self: ['ta', 'bản vương', 'thần', 'bệ hạ', 'trẫm', 'thảo dân', 'nô tài'],
    other: ['ngươi', 'ngài', 'bệ hạ', 'đại nhân', 'nương nương'],
    default_self: 'ta', default_other: 'ngươi',
  },
  {
    value: 'tien_hiep',
    label: 'Tiên Hiệp / Tu Chân (Hán Việt)',
    self: ['tại hạ', 'bản tọa', 'bản nhân', 'lão phu', 'ta'],
    other: ['đạo hữu', 'tiền bối', 'sư huynh', 'sư đệ', 'các hạ', 'ngươi'],
    default_self: 'tại hạ', default_other: 'đạo hữu',
  },
  {
    value: 'kiem_hiep',
    label: 'Kiếm Hiệp / Giang Hồ',
    self: ['ta', 'tại hạ', 'bổn nhân', 'đại hiệp'],
    other: ['ngươi', 'cô nương', 'thiếu hiệp', 'các hạ', 'bang chủ'],
    default_self: 'ta', default_other: 'ngươi',
  },
  {
    value: 'huyen_ao',
    label: 'Huyền Ảo Đông Á (Yêu Linh/Thần Thoại)',
    self: ['ta', 'bản tọa', 'tiểu yêu', 'lão tổ'],
    other: ['ngươi', 'tiền bối', 'đại nhân', 'thần quân'],
    default_self: 'ta', default_other: 'ngươi',
  },
  {
    value: 'anime',
    label: 'Anime / Light Novel (Nhật Bản)',
    self: ['tôi', 'ta', 'tớ', 'mình'],
    other: ['cậu', 'anh', 'chị', 'bạn', 'ngài'],
    default_self: 'tôi', default_other: 'cậu',
  },
  {
    value: 'cung_dau',
    label: 'Cung Đấu / Hoàng Gia',
    self: ['thần', 'bản cung', 'thần thiếp', 'trẫm', 'vi thần'],
    other: ['bệ hạ', 'hoàng thượng', 'nương nương', 'công chúa', 'điện hạ'],
    default_self: 'thần', default_other: 'bệ hạ',
  },
  {
    value: 'phuong_tay',
    label: 'Phương Tây / Fantasy (Văn học dịch)',
    self: ['ta', 'tôi', 'anh'],
    other: ['ngươi', 'ngài', 'bệ hạ', 'đại nhân'],
    default_self: 'ta', default_other: 'ngươi',
  },
  {
    value: 'hien_dai',
    label: 'Hiện Đại (Việt Nam)',
    self: ['tôi', 'anh', 'em', 'tao', 'tớ', 'mình'],
    other: ['anh', 'em', 'chị', 'mày', 'cậu', 'bạn', 'ông', 'bà'],
    default_self: 'tôi', default_other: 'anh/em',
  },
  {
    value: 'quan_su',
    label: 'Quân Sự / Nghiêm Túc',
    self: ['tôi', 'hạ quan', 'mạt tướng', 'thuộc hạ'],
    other: ['ngài', 'đại nhân', 'tướng quân', 'đồng chí', 'thủ trưởng'],
    default_self: 'tôi', default_other: 'ngài',
  },
  {
    value: 'custom',
    label: 'Tùy chỉnh (Thủ công)',
    self: [],
    other: [],
    default_self: '', default_other: '',
  },
];

// Auto-map genre → pronoun style preset
export const GENRE_TO_PRONOUN_STYLE = {
  tien_hiep: 'tien_hiep',
  huyen_huyen: 'huyen_ao',
  fantasy: 'phuong_tay',
  vo_hiep: 'kiem_hiep',
  he_thong: 'hien_dai',
  co_dai: 'co_trang',
  ngon_tinh_cd: 'cung_dau',
  romance: 'hien_dai',
  mystery: 'hien_dai',
  horror: 'hien_dai',
  scifi: 'hien_dai',
  xuyen_khong: 'co_trang',
  trong_sinh: 'co_trang',
  do_thi: 'hien_dai',
  mat_the: 'hien_dai',
  slice_of_life: 'hien_dai',
  drama: 'hien_dai',
  other: 'hien_dai',
};

// ============================================================
// Soul Injection Architecture — Writing Style Constants
// Dùng bởi promptBuilder.js cho Layer 0.5, 7, 7.5
// ============================================================

// Các genre dùng văn phong Hán Việt (tự động detect)
export const HAN_VIET_GENRES = new Set([
  'tien_hiep', 'huyen_huyen', 'vo_hiep', 'co_dai',
  'ngon_tinh_cd', 'xuyen_khong', 'trong_sinh',
]);

// Role động theo genre + giai đoạn chương
// Format: [role_opening (0-20%), role_mid (20-70%), role_climax (70-90%), role_ending (90-100%)]
export const AUTHOR_ROLE_TABLE = {
  han_viet: [
    'kien truc su the gioi va nhan vat — xay dung nen mong, tao an tuong dau tien manh me, TUYET DOI khong nhet thiet lap',
    '"Dai than" chuyen tao "sang diem" (diem nhan kich tinh) trong truyen Han Viet — day manh mau thuan, tao canh "va mat" dam da, doi thoai sac ben nhu dao',
    '"Dao dien hanh dong" chuyen viet canh cao trao va dot pha canh gioi — moi tu ngu phai gay can va bung no nhu phao hoa',
    '"Dai than" chuyen ket thuc truyen Han Viet — de lai cam giac man nhan nhung van them doc tiep, khong bao gio ket thuc phang',
  ],
  thuan_viet: [
    'tac gia Viet Nam chuyen xay dung nhan vat song dong — giong van tu nhien chan thuc, doc gia thay minh trong do',
    'bac thay tam ly nhan vat — cam xuc hien ra qua hanh dong va chi tiet nho, khong bao gio ke thang ra cam xuc',
    '"Dao dien cam xuc" chuyen day cao trao — su cang thang tang dan khong ngung, giu doc gia khong the roi mat',
    'nha van chuyen ket thuc lay dong — giai quyet bat ngo nhung hoan toan logic, de lai cam xuc am long',
  ],
};

// Mood board mặc định theo genre
// 2-3 câu mẫu thể hiện đúng giọng văn — AI học nhịp điệu, không copy từ ngữ
export const MOOD_BOARD_DEFAULTS = {
  tien_hiep: [
    'Linh khi bang bac, han ngoi ket gia, mat nham ho ma tam than lai sac ben nhu kiem. Ben ngoai, gio nui rit qua khe da — vo thanh.',
    'Lao gia khe cuoi, ngon tay go nhe len ban da — tieng dong tuy nho nhung khien khong khi trong dai dien ngung dac lai.',
    'Han xuat thu. Kiem quang loe len. Dich nhan chua kip phan ung. Tat ca xay ra trong khoanh khac ngan hon mot nhip tho.',
  ],
  huyen_huyen: [
    'Man dem nuot chung toan bo anh sang. Chi con han, va thu dang nhin lai han tu bong toi — khong co mat, nhung han biet no dang nhin.',
    'Linh vat cau mat nhin han, trong dong mat do ruc ay la ca mot bien cam xuc ma ngon ngu con nguoi khong du de dien dat.',
  ],
  vo_hiep: [
    'Kiem chua ra khoi vo. Nhung ba nguoi dung truoc han da lui lai nua buoc — ban nang sinh ton khong bao gio noi doi.',
    'Giang ho rong lon, nhung cho nao cung chi co ke manh va ke yeu. Han da qua lau o phia sau — gio la luc buoc ra phia truoc.',
  ],
  co_dai: [
    'Nang khong ngoai dau lai. Nhung got chan khe khung, chi trong mot nhip — du de han biet rang nang da nghe.',
    'Trong hau cung nay, moi nu cuoi deu an giau con dao. Nang da hoc duoc dieu do tu rat lau — truoc ca khi hieu y nghia cua no.',
  ],
  ngon_tinh_cd: [
    'Han nhin nang, nang nhin di cho khac. Nhung ca hai deu biet — khoang cach giua ho dang thu hep lai, khong phai vi ho buoc lai gan, ma vi the gioi dang thu nho.',
  ],
  do_thi: [
    'Cai tin nhan hien ra luc 2 gio sang. Ba chu thoi. Anh doc di doc lai bay lan ma van khong hieu tai sao minh lai run.',
    'Co ngoi xuong san. Khong khoc. Chi nhin vao buc tuong trang cho den khi mat mo di.',
  ],
  romance: [
    'Co khong nho khi nao minh bat dau de y den cach anh uong ca phe. Chi biet rang gio thi khong the khong de y nua.',
    'Anh khong noi gi. Nhung anh o lai — va doi khi, chi vay thoi cung du.',
  ],
  mat_the: [
    'Lon do hop cuoi cung. Anh lat di lat lai trong tay — nang hon tat ca nhung thu anh tung mang theo, nhe hon tat ca nhung gi da bo lai.',
    'Khong co anh hung trong the gioi nay. Chi co nguoi song sot va nguoi chua song sot.',
  ],
  he_thong: [
    'Con so kho can. Nhung con nguoi thi khong phai. Va day la dieu ma bat ky he thong nao cung khong the tinh toan duoc.',
  ],
  horror: [
    'Co gi do khong on trong can phong nay. Anh mat vai phut moi nhan ra — bong cua nguoi dung o goc tuong khong khop voi bat ky ai dang o day.',
    'Tieng dong dung lai. Im lang con kinh hon tieng dong.',
  ],
  mystery: [
    'Co gi do khong on. Anh mat vai phut moi dat ten duoc no — khong phai la canh, ma la su vang mat cua thu le ra phai o day.',
  ],
  scifi: [
    'Thiet bi bip mot tieng. Mot tieng thoi — nhung trong su im lang cua tram vu tru, no vang vong nhu tieng song.',
    'Con nguoi tao ra may moc de thay minh. Va may moc hoc duoc mot dieu con nguoi khong ngo: cam xuc.',
  ],
  fantasy: [
    'Phep thuat co gia. Moi nguoi hoc phep thuat deu biet dieu nay. Nhung chi den khi that su tra gia, nguoi ta moi hieu no co nghia la gi.',
  ],
  xuyen_khong: [
    'Han nho tat ca — ten nguoi, ngay thang, su kien. Nhung tro thanh biet truoc moi thu hoa ra khong mang lai binh yen, ma chi them su co don.',
  ],
  trong_sinh: [
    'Lan nay han se khac. Han tu noi voi minh nhu vay — nhung trong long biet rang cai gia phai tra van con o phia truoc.',
  ],
};

// Helper: detect writing style từ genre key
export function detectWritingStyle(genreKey) {
  return HAN_VIET_GENRES.has(genreKey) ? 'han_viet' : 'thuan_viet';
}

