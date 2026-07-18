export const CHARACTER_TRAIT_CATEGORIES = [
  { id: 'temperament', label: 'Khí chất', description: 'Nhịp năng lượng và cách nhân vật phản ứng với thế giới.' },
  { id: 'social', label: 'Giao tiếp', description: 'Cách nhân vật xuất hiện, nói chuyện và kết nối với người khác.' },
  { id: 'mind', label: 'Tư duy', description: 'Cách quan sát, học hỏi, quyết định và giải quyết vấn đề.' },
  { id: 'emotion', label: 'Nội tâm', description: 'Vết thương, sức bền và kiểu xử lý cảm xúc.' },
  { id: 'values', label: 'Giá trị', description: 'Điều nhân vật tin, bảo vệ hoặc sẵn sàng đánh đổi.' },
  { id: 'relationship', label: 'Gắn kết', description: 'Kiểu yêu thương, tin tưởng và phản ứng trong quan hệ.' },
  { id: 'shadow', label: 'Góc tối', description: 'Khuyết điểm, cơ chế phòng vệ và xu hướng gây xung đột.' },
  { id: 'archetype', label: 'Mẫu truyện', description: 'Archetype và trope quen thuộc trong tiểu thuyết, manga và web novel.' },
  { id: 'adult', label: 'Trưởng thành 18+', description: 'Sắc thái thân mật và động lực quan hệ dành cho hồ sơ 18+.', adult: true },
];

const TRAIT_GROUPS = {
  temperament: [
    ['Điềm tĩnh', ['calm', 'levelheaded'], true],
    ['Sôi nổi', ['lively', 'vibrant'], true],
    ['Hướng nội', ['introvert', 'introverted'], true],
    ['Hướng ngoại', ['extrovert', 'extroverted'], true],
    ['Trầm tính', ['quiet temperament', 'reserved'], true],
    ['Nhiệt huyết', ['passionate', 'ardent'], true],
    ['Lạc quan', ['optimistic'], true],
    ['Bi quan', ['pessimistic']],
    ['Kiên nhẫn', ['patient'], true],
    ['Nóng nảy', ['hot headed', 'short tempered']],
    ['Gan dạ', ['brave', 'dauntless'], true],
    ['Nhút nhát', ['timid', 'shy']],
    ['Cứng đầu', ['stubborn']],
    ['Linh hoạt', ['flexible']],
    ['Kỷ luật', ['disciplined'], true],
    ['Bốc đồng', ['impulsive']],
    ['Thực tế', ['grounded', 'realistic']],
    ['Mơ mộng', ['dreamy', 'dreamer']],
    ['Tự tin', ['confident'], true],
    ['Khiêm tốn', ['humble']],
  ],
  social: [
    ['Thân thiện', ['friendly'], true],
    ['Lịch thiệp', ['polite', 'courteous']],
    ['Duyên dáng', ['charming', 'charismatic'], true],
    ['Hài hước', ['funny', 'witty'], true],
    ['Hoạt ngôn', ['talkative', 'chatty']],
    ['Ít nói', ['laconic', 'quiet'], true],
    ['Thẳng thắn', ['blunt', 'direct'], true],
    ['Khéo léo', ['tactful', 'diplomatic']],
    ['Tinh tế', ['considerate', 'subtle']],
    ['Đồng cảm', ['empathetic', 'empathic'], true],
    ['Biết lắng nghe', ['good listener']],
    ['Hay chăm sóc', ['nurturing', 'caretaker']],
    ['Bảo vệ người khác', ['protective'], true],
    ['Dễ gần', ['approachable']],
    ['Xa cách', ['aloof', 'distant']],
    ['Lạnh lùng', ['cold', 'emotionally cold'], true],
    ['Bí ẩn', ['mysterious'], true],
    ['Lập dị', ['eccentric', 'quirky']],
    ['Cộc cằn', ['gruff', 'abrasive']],
    ['Mỉa mai', ['sarcastic', 'snarky'], true],
  ],
  mind: [
    ['Lý trí', ['rational', 'logical'], true],
    ['Sáng tạo', ['creative', 'inventive'], true],
    ['Phân tích', ['analytical'], true],
    ['Tư duy chiến lược', ['strategic', 'mastermind'], true],
    ['Quan sát tốt', ['observant', 'perceptive'], true],
    ['Tò mò', ['curious', 'inquisitive'], true],
    ['Học nhanh', ['quick learner']],
    ['Quyết đoán', ['decisive'], true],
    ['Thận trọng', ['cautious', 'careful'], true],
    ['Đa nghi', ['suspicious', 'distrustful']],
    ['Nhạy bén', ['sharp', 'astute']],
    ['Mưu trí', ['cunning', 'resourceful'], true],
    ['Khôn ngoan', ['wise', 'sagacious']],
    ['Ngây thơ', ['naive', 'innocent minded']],
    ['Cầu toàn', ['perfectionist'], true],
    ['Thích nghi nhanh', ['adaptable']],
    ['Tập trung cao', ['focused']],
    ['Hay phân tâm', ['distractible', 'absent minded']],
    ['Có tầm nhìn', ['visionary']],
    ['Thực dụng', ['pragmatic'], true],
  ],
  emotion: [
    ['Nhạy cảm', ['sensitive'], true],
    ['Dễ xúc động', ['emotional']],
    ['Kín cảm xúc', ['emotionally guarded', 'stoic'], true],
    ['Giàu tình cảm', ['affectionate', 'warm hearted'], true],
    ['Chung thủy cảm xúc', ['emotionally loyal']],
    ['Lo âu', ['anxious', 'anxiety']],
    ['Bất an', ['insecure']],
    ['Tự ti', ['low self esteem']],
    ['Tự trọng cao', ['proud', 'self respecting']],
    ['Dễ tổn thương', ['vulnerable'], true],
    ['Kiên cường', ['resilient'], true],
    ['Chịu đựng giỏi', ['enduring', 'long suffering']],
    ['Hay day dứt', ['remorseful', 'brooding']],
    ['Mang mặc cảm', ['guilt ridden', 'shame ridden']],
    ['Sợ bị bỏ rơi', ['abandonment issues'], true],
    ['Khó tin người', ['trust issues'], true],
    ['Dễ tha thứ', ['forgiving']],
    ['Hay hoài niệm', ['nostalgic']],
    ['Cô đơn', ['lonely']],
    ['Bình ổn cảm xúc', ['emotionally stable']],
  ],
  values: [
    ['Chính trực', ['integrity', 'upright'], true],
    ['Trung thành', ['loyal'], true],
    ['Trọng nghĩa', ['righteous', 'honor bonds'], true],
    ['Vị tha', ['selfless', 'altruistic']],
    ['Bao dung', ['tolerant', 'magnanimous']],
    ['Công bằng', ['fair', 'just'], true],
    ['Có trách nhiệm', ['responsible'], true],
    ['Giữ lời hứa', ['keeps promises']],
    ['Tôn trọng quy tắc', ['lawful', 'rule follower']],
    ['Phản kháng', ['defiant', 'rebellious'], true],
    ['Đề cao tự do', ['freedom loving']],
    ['Tham vọng', ['ambitious'], true],
    ['Trọng gia đình', ['family oriented'], true],
    ['Trọng danh dự', ['honorable']],
    ['Sẵn sàng hy sinh', ['self sacrificing']],
    ['Lý tưởng hóa', ['idealistic']],
    ['Đạo đức linh hoạt', ['morally flexible', 'grey morality'], true],
    ['Bất chấp thủ đoạn', ['ends justify means', 'ruthless methods']],
    ['Tôn trọng sự thật', ['truth seeking']],
    ['Tin vào định mệnh', ['fatalist', 'believes in fate']],
  ],
  relationship: [
    ['Ấm áp', ['warm'], true],
    ['Dịu dàng', ['gentle', 'tender'], true],
    ['Hay che chở', ['protective lover']],
    ['Hay chiều chuộng', ['indulgent', 'pampering']],
    ['Cần được công nhận', ['validation seeking']],
    ['Phụ thuộc cảm xúc', ['emotionally dependent', 'codependent']],
    ['Độc lập cảm xúc', ['emotionally independent']],
    ['Ghen tuông', ['jealous'], true],
    ['Chiếm hữu', ['possessive'], true],
    ['Sợ cam kết', ['commitment issues']],
    ['Khao khát thân mật', ['craves intimacy']],
    ['Né tránh thân mật', ['avoidant', 'intimacy avoidant']],
    ['Yêu chậm', ['slow burn', 'slow to love'], true],
    ['Yêu hết mình', ['all in love', 'devoted lover']],
    ['Hay trêu ghẹo', ['teasing', 'playful flirt'], true],
    ['Thích cạnh tranh', ['competitive chemistry']],
    ['Chung thủy', ['faithful', 'devoted'], true],
    ['Đa tình', ['flirtatious', 'romantic wanderer']],
    ['Khó mở lòng', ['slow to open up'], true],
    ['Bám người', ['clingy', 'needy']],
  ],
  shadow: [
    ['Thao túng', ['manipulative'], true],
    ['Thích kiểm soát', ['controlling'], true],
    ['Tàn nhẫn', ['ruthless', 'cruel'], true],
    ['Lạnh máu', ['cold blooded']],
    ['Ích kỷ', ['selfish']],
    ['Kiêu ngạo', ['arrogant', 'haughty'], true],
    ['Đố kỵ', ['envious']],
    ['Thù dai', ['vindictive', 'holds grudges']],
    ['Hiếu thắng', ['overcompetitive']],
    ['Ám ảnh', ['obsessive'], true],
    ['Hoang tưởng', ['paranoid']],
    ['Dối trá', ['deceitful', 'liar']],
    ['Hai mặt', ['two faced', 'duplicitous']],
    ['Cơ hội', ['opportunistic']],
    ['Vô cảm', ['callous', 'apathetic']],
    ['Hèn nhát', ['cowardly']],
    ['Tự hủy', ['self destructive'], true],
    ['Nghiện quyền lực', ['power hungry']],
    ['Bạo lực', ['violent', 'aggressive']],
    ['Cực đoan', ['extremist', 'fanatical']],
  ],
  archetype: [
    ['Tomboy', ['tom', 'tom boy', 'boyish girl', 'cô nàng tomboy'], true],
    ['Tsundere', ['tsun', 'ngoài lạnh trong nóng'], true],
    ['Yandere', ['yan', 'yêu ám ảnh'], true],
    ['Kuudere', ['kuu', 'lạnh lùng ít cảm xúc']],
    ['Dandere', ['dan', 'rụt rè ít nói']],
    ['Genki', ['genki girl', 'năng lượng tích cực']],
    ['Himbo', ['đẹp trai ngốc nghếch tốt bụng'], true],
    ['Femme fatale', ['fatal woman', 'mỹ nhân nguy hiểm'], true],
    ['Bad boy', ['trai hư'], true],
    ['Golden retriever', ['golden retriever energy', 'ấm áp bám người'], true],
    ['Black cat', ['black cat energy', 'lạnh lùng kín đáo'], true],
    ['Cinnamon roll', ['quá tốt cho thế giới này'], true],
    ['Ice queen', ['nữ vương băng giá']],
    ['Tiểu thư kiêu kỳ', ['ojou sama', 'ojousama']],
    ['Mentor thông thái', ['wise mentor', 'sage']],
    ['Kẻ lừa lọc vui tính', ['trickster', 'jester']],
    ['Phản anh hùng', ['antihero', 'anti hero'], true],
    ['Anh hùng bất đắc dĩ', ['reluctant hero']],
    ['Thiên tài lập dị', ['eccentric genius']],
    ['Kẻ sống sót', ['survivor'], true],
    ['Người chăm sóc', ['caregiver', 'caretaker archetype']],
    ['Kẻ nổi loạn', ['rebel archetype'], true],
    ['Kẻ lãng du', ['wanderer', 'drifter']],
    ['Quân sư', ['strategist', 'tactician']],
    ['Lãnh đạo bẩm sinh', ['born leader']],
    ['Sói cô độc', ['lone wolf'], true],
    ['Chú hề giấu nỗi buồn', ['sad clown', 'comic relief with trauma']],
    ['Kẻ chuộc tội', ['redeemer', 'redemption seeker']],
    ['Quái vật có trái tim', ['gentle monster', 'monster with a heart']],
    ['Người được chọn', ['chosen one']],
  ],
  adult: [
    ['Quyến rũ', ['seductive', 'alluring'], true],
    ['Gợi cảm', ['sensual', 'sexy'], true],
    ['Lả lơi', ['coquettish', 'flirty']],
    ['Trêu ghẹo thân mật', ['intimate teasing', 'provocative teasing'], true],
    ['Chủ động thân mật', ['sexually assertive', 'takes initiative'], true],
    ['Kín đáo chuyện thân mật', ['sexually reserved', 'private about intimacy']],
    ['Phóng khoáng', ['sex positive', 'uninhibited'], true],
    ['Táo bạo', ['bold in intimacy', 'daring'], true],
    ['Ham muốn cao', ['high libido', 'high desire']],
    ['Kiểm soát ham muốn tốt', ['controlled desire', 'restrained']],
    ['Thích âu yếm', ['cuddly', 'touch affectionate'], true],
    ['Dễ ghen khi yêu', ['romantically jealous']],
    ['Chiếm hữu trong tình yêu', ['possessive lover'], true],
    ['Thống trị (Dominant)', ['dominant', 'dom', 'thích dẫn dắt'], true],
    ['Phục tùng (Submissive)', ['submissive', 'sub', 'thích được dẫn dắt'], true],
    ['Linh hoạt vai trò (Switch)', ['switch', 'versatile dynamic'], true],
    ['Thích dẫn dắt', ['leading partner']],
    ['Thích được chiều chuộng', ['likes being pampered']],
    ['Thích chiều chuộng', ['service oriented lover', 'giver']],
    ['Giàu kinh nghiệm', ['experienced lover']],
    ['Ngây thơ chuyện tình cảm', ['romantically inexperienced', 'innocent in love']],
    ['Tò mò khám phá', ['sexually curious', 'exploratory']],
    ['Ranh giới rõ ràng', ['clear boundaries'], true],
    ['Ưu tiên đồng thuận', ['consent focused', 'consent conscious'], true],
    ['Dịu dàng sau thân mật', ['aftercare oriented', 'tender afterwards']],
    ['Dễ xấu hổ', ['easily flustered', 'shy about intimacy']],
    ['Yêu cuồng nhiệt', ['passionate lover'], true],
    ['Lạnh nhạt sau thân mật', ['emotionally distant afterwards']],
  ],
};

export function normalizeCharacterTraitSearch(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createTrait(category, entry) {
  const [label, aliases = [], popular = false] = entry;
  return {
    id: `${category}:${normalizeCharacterTraitSearch(label).replace(/\s+/g, '-')}`,
    category,
    label,
    aliases,
    popular,
    adult: category === 'adult',
  };
}

export const ALL_CHARACTER_TRAITS = Object.entries(TRAIT_GROUPS)
  .flatMap(([category, entries]) => entries.map((entry) => createTrait(category, entry)));

const TRAIT_SEARCH_INDEX = ALL_CHARACTER_TRAITS.map((trait) => ({
  ...trait,
  normalizedLabel: normalizeCharacterTraitSearch(trait.label),
  normalizedAliases: trait.aliases.map(normalizeCharacterTraitSearch),
}));

export function parseCharacterTraits(value = '') {
  const rawItems = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const seen = new Set();
  const result = [];

  for (const rawItem of rawItems) {
    const label = String(rawItem || '')
      .trim()
      .replace(/^#+/, '')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const key = normalizeCharacterTraitSearch(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }

  return result;
}

export function serializeCharacterTraits(value = []) {
  return parseCharacterTraits(value).join(', ');
}

function matchScore(trait, query) {
  const values = [trait.normalizedLabel, ...trait.normalizedAliases].filter(Boolean);
  let best = 0;

  for (const value of values) {
    if (value === query) best = Math.max(best, 120);
    else if (value.startsWith(query)) best = Math.max(best, 100);
    else if (value.split(' ').some((word) => word.startsWith(query))) best = Math.max(best, 80);
    else if (value.includes(query)) best = Math.max(best, 60);
  }

  return best;
}

export function findCharacterTraitMatch(query = '') {
  const normalizedQuery = normalizeCharacterTraitSearch(query);
  if (!normalizedQuery) return null;

  return TRAIT_SEARCH_INDEX
    .map((trait) => ({ trait, score: matchScore(trait, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.trait.popular) - Number(a.trait.popular))[0]?.trait || null;
}

export function getCharacterTraitSuggestions({
  query = '',
  selected = [],
  categoryId = 'popular',
  limit = 36,
} = {}) {
  const normalizedQuery = normalizeCharacterTraitSearch(query);
  const selectedKeys = new Set(parseCharacterTraits(selected).map(normalizeCharacterTraitSearch));

  return TRAIT_SEARCH_INDEX
    .filter((trait) => !selectedKeys.has(trait.normalizedLabel))
    .filter((trait) => {
      if (normalizedQuery) return matchScore(trait, normalizedQuery) > 0;
      if (categoryId === 'popular') return trait.popular && !trait.adult;
      return trait.category === categoryId;
    })
    .map((trait) => ({
      ...trait,
      score: normalizedQuery ? matchScore(trait, normalizedQuery) : 0,
    }))
    .sort((a, b) => (
      b.score - a.score
      || Number(b.popular) - Number(a.popular)
      || a.label.localeCompare(b.label, 'vi')
    ))
    .slice(0, limit)
    .map(({ normalizedLabel, normalizedAliases, score, ...trait }) => trait);
}
