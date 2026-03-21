/**
 * StoryForge — Genre Templates
 * Pre-fill data when creating projects via AI Wizard or manual.
 */

export const GENRE_TEMPLATES = {
  tien_hiep: {
    label: 'Tiên hiệp',
    worldRules: [
      'Hệ thống cảnh giới tu tiên: Luyện Khí → Trúc Cơ → Kim Đan → Nguyên Anh → Hóa Thần → Luyện Hư → Hợp Thể → Đại Thừa → Độ Kiếp',
      'Tu tiên tuân theo Thiên Đạo — vi phạm sẽ gặp Thiên Kiếp',
      'Thọ mệnh tăng theo cảnh giới: Kim Đan ~500 năm, Nguyên Anh ~1000 năm',
      'Đột phá cần tích lũy đủ linh lực + ngộ đạo, không thể vội vàng',
      'Tài nguyên tu luyện khan hiếm — tranh đoạt là bản chất giang hồ tu tiên',
    ],
    terms: [
      { name: 'Linh khí', definition: 'Năng lượng tự nhiên, tu sĩ hấp thụ để tăng cảnh giới', category: 'magic' },
      { name: 'Thiên Kiếp', definition: 'Sấm sét Thiên Đạo, tu sĩ phải vượt qua để đột phá', category: 'magic' },
      { name: 'Linh thạch', definition: 'Đá chứa linh khí cô đọng, dùng làm tiền tệ và tài nguyên tu luyện', category: 'magic' },
      { name: 'Tông môn', definition: 'Tổ chức tu tiên, có chưởng môn, trưởng lão, và quy tắc riêng', category: 'organization' },
      { name: 'Pháp bảo', definition: 'Vũ khí luyện chế bằng linh lực, chia cấp: hạ/trung/thượng phẩm', category: 'magic' },
      { name: 'Đan dược', definition: 'Thuốc luyện từ linh thảo, có công dụng hồi phục/đột phá/giải độc', category: 'magic' },
      { name: 'Thần thức', definition: 'Ý thức tinh thần, dùng để thăm dò, giao tiếp, điều khiển pháp bảo', category: 'magic' },
    ],
    locations: [
      { name: 'Tông môn chính', description: 'Cứ điểm tu luyện, xây trên linh mạch, có cấm chế bảo hộ' },
      { name: 'Phường thị', description: 'Chợ giao dịch linh đan, pháp bảo, tài nguyên' },
      { name: 'Bí cảnh', description: 'Không gian ẩn giấu chứa cơ duyên và nguy hiểm' },
    ],
    characters: [
      { name: 'Nhân vật chính', role: 'protagonist', appearance: 'Thiếu niên/thiếu nữ, vẻ ngoài bình thường nhưng có tiềm năng ẩn giấu', personality: 'Kiên định tu đạo, không khuất phục áp bức' },
      { name: 'Sư phụ', role: 'mentor', appearance: 'Đạo nhân tu luyện lâu năm, phong thái thoát tục', personality: 'Nghiêm khắc nhưng che chở đệ tử' },
    ],
  },
  huyen_huyen: {
    label: 'Huyền huyễn',
    worldRules: [
      'Thế giới có nhiều hệ thống sức mạnh song song (đấu khí, ma pháp, linh hồn...)',
      'Đa chủng tộc: nhân, yêu, ma, thần, linh...',
      'Scale lớn: đại lục, vũ trụ, nhiều cõi/giới',
      'Sức mạnh có thể kết hợp nhiều hệ thống',
    ],
    terms: [
      { name: 'Đấu khí', definition: 'Năng lượng chiến đấu, khác hệ ma pháp', category: 'magic' },
      { name: 'Huyết mạch', definition: 'Dòng máu đặc biệt mang sức mạnh bẩm sinh', category: 'race' },
      { name: 'Vị diện', definition: 'Các tầng không gian khác nhau: nhân giới, ma giới, thần giới', category: 'concept' },
      { name: 'Gia tộc', definition: 'Dòng tộc lớn nắm giữ sức mạnh và tài nguyên', category: 'organization' },
    ],
    locations: [
      { name: 'Đại lục chính', description: 'Lục địa chính nơi câu chuyện diễn ra' },
      { name: 'Vùng cấm', description: 'Khu vực nguy hiểm chứa cơ duyên và hung thú mạnh' },
    ],
    characters: [
      { name: 'Nhân vật chính', role: 'protagonist', personality: 'Thiên tài ẩn giấu, quyết tâm vươn lên đỉnh cao' },
    ],
  },
  fantasy: {
    label: 'Fantasy phương Tây',
    worldRules: [
      'Hệ thống phép thuật có quy tắc rõ ràng và hậu quả',
      'Thế giới có nhiều chủng tộc (người, elf, dwarf, orc...)',
      'Mỗi phép thuật có cái giá — không miễn phí',
    ],
    terms: [
      { name: 'Mana', definition: 'Năng lượng phép thuật, có giới hạn và cần hồi phục', category: 'magic' },
      { name: 'Guild', definition: 'Tổ chức phiêu lưu gia, nhận nhiệm vụ và phần thưởng', category: 'organization' },
    ],
    locations: [
      { name: 'Vương quốc chính', description: 'Vương quốc trung tâm nơi câu chuyện bắt đầu' },
      { name: 'Rừng cổ thụ', description: 'Khu rừng cổ đại ẩn chứa sinh vật ma thuật' },
    ],
    characters: [
      { name: 'Nhân vật chính', role: 'protagonist', personality: 'Dũng cảm, có trái tim chính nghĩa' },
      { name: 'Phù thủy cố vấn', role: 'mentor', personality: 'Thông thái, bí ẩn, đôi khi khó đoán' },
    ],
  },
  he_thong: {
    label: 'Hệ thống / LitRPG',
    worldRules: [
      'Nhân vật có hệ thống (status window, quest, inventory)',
      'Level/Exp/Skill có quy tắc rõ ràng, không tùy tiện',
      'Hệ thống có giới hạn — không phải muốn gì được nấy',
      'Quest/nhiệm vụ có deadline, thưởng/phạt phân minh',
    ],
    terms: [
      { name: 'Status Window', definition: 'Bảng trạng thái hiện sức mạnh, kỹ năng, nhiệm vụ', category: 'magic' },
      { name: 'Skill', definition: 'Kỹ năng do hệ thống ban hoặc học được, có cấp bậc', category: 'magic' },
      { name: 'Quest', definition: 'Nhiệm vụ từ hệ thống, hoàn thành nhận thưởng', category: 'concept' },
      { name: 'Dungeon', definition: 'Không gian quái vật, nơi farm tài nguyên và kinh nghiệm', category: 'concept' },
    ],
    locations: [
      { name: 'Dungeon tân thủ', description: 'Khu vực đầu tiên để nhân vật chính thử sức' },
    ],
    characters: [
      { name: 'Nhân vật chính', role: 'protagonist', personality: 'Người được hệ thống chọn, tư duy logic, biết khai thác lợi thế' },
    ],
  },
  mat_the: {
    label: 'Mạt thế',
    worldRules: [
      'Tài nguyên khan hiếm — sinh tồn là ưu tiên số 1',
      'Xã hội sụp đổ/tái cấu trúc, luật rừng',
      'Mối đe dọa rõ ràng: zombie/quái vật/thiên tai/dịch bệnh',
      'Niềm tin và đạo đức bị thử thách liên tục',
    ],
    terms: [
      { name: 'Tinh thể năng lượng', definition: 'Vật phẩm rơi từ quái vật, dùng tăng sức mạnh hoặc đổi tài nguyên', category: 'magic' },
      { name: 'Vùng an toàn', definition: 'Khu vực được bảo vệ, nơi con người tập trung sinh sống', category: 'concept' },
      { name: 'Dị năng giả', definition: 'Người có năng lực đặc biệt sau thảm họa', category: 'race' },
    ],
    locations: [
      { name: 'Căn cứ chính', description: 'Nơi trú ẩn an toàn, trung tâm hoạt động' },
      { name: 'Vùng hoang tàn', description: 'Đô thị bị phá hủy, đầy nguy hiểm nhưng có tài nguyên' },
    ],
    characters: [
      { name: 'Nhân vật chính', role: 'protagonist', personality: 'Sinh tồn bản năng mạnh, thực dụng nhưng vẫn giữ nhân tính' },
    ],
  },
  ngon_tinh_cd: {
    label: 'Ngôn tình cổ đại',
    worldRules: [
      'Bối cảnh phong kiến, lễ nghi và giai cấp rõ ràng',
      'Hôn nhân là chính trị — tình yêu thường bị cản trở bởi gia tộc/xã hội',
      'Phụ nữ phải đấu tranh trong khuôn khổ thời đại',
      'Nhịp tình cảm chậm, tinh tế qua cử chỉ nhỏ',
    ],
    terms: [
      { name: 'Đích nữ / Thứ nữ', definition: 'Con gái chính thất/tì thiếp, ảnh hưởng địa vị lớn', category: 'culture' },
      { name: 'Sính lễ / Hồi môn', definition: 'Lễ vật cưới hỏi, thể hiện địa vị gia tộc', category: 'culture' },
      { name: 'Trạch đấu', definition: 'Đấu đá trong nội viện giữa các phu nhân/tiểu thư', category: 'concept' },
    ],
    locations: [
      { name: 'Phủ đệ', description: 'Dinh thự gia tộc, không gian chính của trạch đấu' },
      { name: 'Hoàng cung', description: 'Cung điện hoàng gia, trung tâm quyền lực' },
    ],
    characters: [
      { name: 'Nữ chính', role: 'protagonist', personality: 'Thông minh, nhẫn nại, biết cách sinh tồn trong hậu trạch' },
      { name: 'Nam chính', role: 'deuteragonist', personality: 'Quyền quý, lạnh lùng nhưng chỉ dịu dàng với nữ chính' },
    ],
  },
  mystery: {
    label: 'Trinh thám',
    worldRules: [
      'Mọi manh mối phải fair play — người đọc có thể tự suy luận',
      'Quản lý "ai biết gì" rất quan trọng',
      'Red herring phải tự nhiên, không gượng ép',
    ],
    terms: [
      { name: 'Manh mối', definition: 'Thông tin dẫn đến sự thật, có thể rõ ràng hoặc ẩn giấu', category: 'other' },
      { name: 'Red herring', definition: 'Manh mối giả để đánh lạc hướng nghi ngờ', category: 'other' },
      { name: 'Alibi', definition: 'Bằng chứng ngoại phạm — chứng minh một người không có mặt tại hiện trường', category: 'other' },
    ],
    locations: [
      { name: 'Hiện trường vụ án', description: 'Nơi xảy ra sự kiện chính, chứa nhiều manh mối ẩn' },
    ],
    characters: [
      { name: 'Thám tử', role: 'protagonist', personality: 'Quan sát tinh tế, logic sắc bén, đôi khi lập dị' },
      { name: 'Nghi phạm chính', role: 'antagonist', personality: 'Bề ngoài đáng tin, nhưng có động cơ ẩn' },
    ],
  },
  romance: {
    label: 'Ngôn tình',
    worldRules: [
      'Cảm xúc nhân vật phải chân thực, tự nhiên',
      'Nhịp tình cảm: gặp gỡ → xung đột → hiểu nhau → thử thách → HE/BE',
      'Tension tình cảm phải duy trì đủ lâu',
    ],
    terms: [
      { name: 'Chemistry', definition: 'Sự hấp dẫn tự nhiên giữa hai nhân vật, thể hiện qua cử chỉ nhỏ và ánh mắt', category: 'other' },
      { name: 'Slow burn', definition: 'Tình cảm phát triển chậm rãi, từ từ qua nhiều chương', category: 'other' },
    ],
    locations: [
      { name: 'Nơi gặp gỡ', description: 'Bối cảnh đầu tiên hai nhân vật chính gặp nhau, tạo ấn tượng ban đầu' },
    ],
    characters: [
      { name: 'Nữ chính', role: 'protagonist', personality: 'Mạnh mẽ, độc lập, có thế giới riêng' },
      { name: 'Nam chính', role: 'deuteragonist', personality: 'Lạnh lùng bên ngoài, ấm áp bên trong' },
    ],
  },
  horror: {
    label: 'Kinh dị',
    worldRules: [
      'Tension tăng dần, không "xì hơi" giữa chừng',
      'Phân biệt kinh dị tâm lý vs gore — chọn 1 làm chủ đạo',
      'Setup phải có payoff — mỗi chi tiết lạ đều dẫn đến gì đó',
      'Không giải thích quá nhiều — để trí tưởng tượng người đọc làm việc',
    ],
    terms: [
      { name: 'Dread', definition: 'Cảm giác lo sợ kéo dài trước khi sự kiện kinh hoàng xảy ra', category: 'other' },
      { name: 'Jump scare', definition: 'Khoảnh khắc bất ngờ gây sợ hãi, nên dùng hạn chế', category: 'other' },
    ],
    locations: [
      { name: 'Nơi bị nguyền', description: 'Bối cảnh chính nơi các sự kiện siêu nhiên xảy ra — tối tăm, cô lập' },
    ],
    characters: [
      { name: 'Nhân vật sống sót', role: 'protagonist', personality: 'Bình thường nhưng có bản năng sinh tồn mạnh' },
    ],
  },
  vo_hiep: {
    label: 'Võ hiệp',
    worldRules: [
      'Hệ thống võ công: nội công + ngoại công + khinh công',
      'Giang hồ có quy tắc: nghĩa khí, oán thù, bang phái',
      'Vũ khí có đẳng cấp, bí kíp có nguồn gốc',
    ],
    terms: [
      { name: 'Nội lực', definition: 'Sức mạnh bên trong cơ thể, do tu luyện nội công mà có', category: 'magic' },
      { name: 'Khinh công', definition: 'Kỹ thuật di chuyển nhanh, nhảy cao, bay lướt', category: 'magic' },
      { name: 'Giang hồ', definition: 'Thế giới của các võ lâm nhân sĩ, có quy tắc và tôn ti riêng', category: 'organization' },
    ],
    locations: [
      { name: 'Võ lâm tổng đàn', description: 'Trụ sở chính của bang hội lớn nhất giang hồ' },
    ],
    characters: [
      { name: 'Đại hiệp', role: 'protagonist', personality: 'Nghĩa khí, trọng lời hứa, giỏi võ công' },
    ],
  },
  co_dai: {
    label: 'Cổ đại / Cung đấu',
    worldRules: [
      'Cấu trúc xã hội phong kiến: vua, quan, thần, dân',
      'Cung đấu: mỗi phi tần là một thế lực, đấu đá ngầm',
      'Phong tục, lễ nghi, xưng hô phải đúng thời đại',
    ],
    terms: [
      { name: 'Hậu cung', definition: 'Nơi ở của hoàng đế và các phi tần, không gian chính của cung đấu', category: 'organization' },
      { name: 'Thánh chỉ', definition: 'Chiếu chỉ của hoàng đế, có hiệu lực tuyệt đối', category: 'other' },
    ],
    locations: [
      { name: 'Hoàng cung', description: 'Cung điện hoàng gia, trung tâm quyền lực' },
    ],
    characters: [
      { name: 'Nữ chính', role: 'protagonist', personality: 'Thông minh, nhẫn nhịn, giỏi tính toán' },
    ],
  },
  xuyen_khong: {
    label: 'Xuyên không / Trọng sinh',
    worldRules: [
      'Nhân vật có kiến thức từ tương lai/thế giới khác',
      'Phải cẩn thận khi dùng kiến thức hiện đại — không quá lộ liễu',
      'Thay đổi lịch sử/số phận có hệ quả butterfly effect',
    ],
    terms: [
      { name: 'Xuyên không', definition: 'Di chuyển qua thời gian hoặc đến thế giới khác, thường giữ ý thức và ký ức', category: 'other' },
      { name: 'Trọng sinh', definition: 'Sống lại từ đầu với ký ức kiếp trước, cơ hội sửa sai', category: 'other' },
      { name: 'Kim thủ chỉ', definition: 'Kiến thức "vàng" từ tương lai giúp nhân vật đi trước thời đại', category: 'other' },
    ],
    locations: [],
    characters: [
      { name: 'Người xuyên không', role: 'protagonist', personality: 'Linh hoạt, thích nghi nhanh, giỏi che giấu bản thân' },
    ],
  },
  do_thi: {
    label: 'Đô thị / Hiện đại',
    worldRules: [
      'Bối cảnh hiện đại, ngôn ngữ tự nhiên',
      'Xã hội có quy tắc thực tế: luật pháp, công nghệ, kinh tế',
    ],
    terms: [],
    locations: [
      { name: 'Thành phố', description: 'Bối cảnh đô thị chính nơi câu chuyện diễn ra' },
    ],
    characters: [
      { name: 'Nhân vật chính', role: 'protagonist', personality: 'Người trẻ với ước mơ và thử thách đời thường' },
    ],
  },
};

export default GENRE_TEMPLATES;
