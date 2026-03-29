/**
 * StoryForge — Genre Templates
 * Pre-fill data when creating projects via AI Wizard or manual.
 *
 * [UPDATE] Bổ sung 3 trường DNA văn phong cho Editor Prompt:
 *   - constitution:        Luật thế giới ngầm bất phá, AI phải tôn trọng tuyệt đối
 *   - style_dna:           Giọng văn, nhịp điệu, ngôn ngữ đặc trưng thể loại
 *   - anti_ai_blacklist:   Cụm từ sáo rỗng cần tẩy chay, đặc thù từng thể loại
 */

export const GENRE_TEMPLATES = {
  tien_hiep: {
    label: 'Tiên hiệp',

    constitution: [
      'Hệ thống cảnh giới bất di bất dịch — đột phá PHẢI có tích lũy linh lực + cơ duyên + ngộ đạo, CẤMT đột phá vì "cảm xúc dâng trào" hay "ý chí kiên định"',
      'Thiên Đạo tồn tại và trừng phạt — vi phạm thiên lý phải chịu Thiên Kiếp hoặc hậu quả tương ứng, không thể né vô lý',
      'Tài nguyên (linh thạch, đan dược, bí kíp) có giá trị thực và khan hiếm — nhân vật không nhận "món quà trời rơi" không có lý do',
      'Tông môn có phân cấp quyền lực thực chất: chưởng môn > trưởng lão > nội môn đệ tử > ngoại môn — mỗi tầng đều có quyền lợi và giới hạn riêng',
      'Thọ mệnh gắn cảnh giới: Luyện Khí ~100 năm, Kim Đan ~500 năm, Nguyên Anh ~1000 năm — nhân vật thấp không thể sống vô hạn',
      'Giang hồ tu tiên có mặt tối thực sự — giết người cướp tài nguyên là chuyện bình thường, không phải hành vi "ác nhân mới làm"',
      'CẤMT dùng từ ngữ hiện đại trong bối cảnh tu tiên: điện thoại, internet, "serotonin", "trauma", tâm lý học hiện đại',
      'Pháp bảo và kỹ năng phải được tích lũy hoặc tìm kiếm — không tự dưng nhớ ra chiêu mới không có nguồn gốc',
    ],

    style_dna: [
      'Hán-Việt chiếm 30–40% từ ngữ liên quan tu luyện, cảnh giới, pháp bảo, đan dược — tạo cảm giác cổ kính trang nghiêm',
      'Câu dài-ngắn xen kẽ có chủ đích: cảnh tu luyện và âm mưu dùng câu dài trầm mặc, cảnh giao phong dùng câu ngắn dứt khoát như kiếm chém',
      'Tả cảnh thiên nhiên và linh khí bằng ngôn ngữ thơ ca — núi non, mây trời, linh thác phải có hồn, không tả khô khan',
      'Đối thoại giữ phong thái tu tiên: hàm súc, dùng ẩn dụ, nói ít hiểu nhiều — chỉ nói thẳng 100% khi đối địch hoặc lúc cần uy hiếp',
      'Nội tâm tiết chế — cảm xúc thể hiện qua ánh mắt, hành động, hơi thở, nhịp đập linh lực, KHÔNG phải độc thoại nội tâm dài dòng sướt mướt',
      'Pacing có kiến trúc: chậm rãi uy nghiêm khi tả tu luyện và mưu lược, bùng nổ tốc độ khi giao chiến',
      'Tên nhân vật và địa danh theo phong cách Hán-Việt — không đặt tên kiểu hiện đại hay phiên âm tiếng Anh',
    ],

    anti_ai_blacklist: [
      'tim đập loạn', 'má đỏ hồng', 'toàn thân run rẩy', 'nước mắt tuôn rơi không ngừng',
      'bỗng nhiên cảm thấy mạnh hơn', 'thực lực tăng vọt bất ngờ', 'hào quang chói lòa bao phủ',
      'ngươi dám?!', 'không ai dám tin vào mắt mình', 'mọi người đều há hốc mồm kinh ngạc',
      'thiên tài bách năm có một', 'đây chính là kiếp số của ta', 'cảm ơn sư phụ chỉ điểm',
      'toàn trường im lặng như tờ', 'không khí đặc quánh lại', 'thần sắc biến đổi liên tục',
      'khoảnh khắc đó ta hiểu ra tất cả', 'trong lòng dậy lên một cảm giác kỳ lạ khó tả',
      'đôi mắt sáng rực như sao', 'thân thể phát ra ánh sáng rực rỡ',
      'ta sẽ không tha cho ngươi', 'ngươi sẽ phải hối hận',
    ],

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

    constitution: [
      'Nhiều hệ thống sức mạnh song song (đấu khí, ma pháp, linh hồn...) — mỗi hệ có quy tắc riêng, không thể "hack" sang hệ khác vô lý',
      'Scale power phải nhất quán: nhân vật cấp thấp không thể giết nhân vật cấp cao trừ khi có lý do thực sự (bí kíp đặc biệt, điểm yếu chí mạng)',
      'Đa chủng tộc có đặc điểm riêng biệt thực sự — không chỉ là "người nhưng có tai nhọn"',
      'Huyết mạch đặc biệt có giá trị và chi phí — quyền năng bẩm sinh phải có giới hạn và cái giá',
      'Thế giới nhiều tầng (nhân giới, ma giới, thần giới) có rào cản thực sự — không thể tự do qua lại',
      'Gia tộc lớn là thế lực chính trị thực sự — quyết định ảnh hưởng đến nhân vật không chỉ là "rào cản tình yêu"',
    ],

    style_dna: [
      'Câu văn hùng hồn, epic — tả trận chiến phải có quy mô, cảm giác "sơn hà rung chuyển"',
      'Hán-Việt pha trộn tự nhiên — không thuần Hán-Việt như tiên hiệp, nhưng cũng không hiện đại hoàn toàn',
      'Miêu tả power level và kỹ năng phải cụ thể, có chiều sâu — không chỉ "mạnh không thể đo đếm"',
      'Đối thoại phản ánh sự khác biệt chủng tộc và cấp bậc — yêu tộc nói khác nhân tộc',
      'Xây dựng thế giới (world-building) chi tiết nhưng tự nhiên — thông tin cài vào hành động, không phải "lecture"',
      'Nhịp điệu tăng dần theo quy mô — từ đấu tranh cá nhân đến sinh tử đại lục',
    ],

    anti_ai_blacklist: [
      'thực lực không thể đo lường', 'mạnh đến mức vô đối', 'thiên hạ đệ nhất',
      'không có đối thủ trong cùng cấp', 'huyết mạch giác thức đột ngột', 'toàn bộ tiềm năng bùng phát',
      'mọi người đều run sợ', 'ngay cả lão quái vật cũng không dám động',
      'khoảnh khắc đó cả thế giới im lặng', 'đây là sức mạnh vượt ngoài lý giải',
      'cơ thể tự động phản ứng', 'bản năng chiến đấu trỗi dậy',
      'đôi mắt đỏ rực như máu', 'khí tức hắc ám bao trùm',
    ],

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

    constitution: [
      'Mỗi phép thuật có cái giá thực sự (mana cạn kiệt, kiệt sức thể chất, hiệu ứng phụ) — không có phép thuật miễn phí',
      'Các chủng tộc có văn hóa, ngôn ngữ, định kiến riêng biệt — không phải "người với tai nhọn hơn"',
      'Hệ thống chính trị vương quốc có logic thực — vua không toàn năng,귀족 귀족 quý tộc có lợi ích riêng',
      'Vật phẩm ma thuật mạnh phải có nguồn gốc, giá trị, và hậu quả khi sử dụng',
      'Nhân vật chết là chết thật — resurrection phải có chi phí cực lớn và hiếm gặp',
      'Thế giới có lịch sử thực — chiến tranh cũ, đế quốc sụp đổ, thần thoại có thể là thật',
    ],

    style_dna: [
      'Văn phong epic nhưng không cầu kỳ — rõ ràng, mạnh mẽ, từng câu đều có mục đích',
      'Mô tả chi tiết cảm giác vật lý: trọng lượng giáp, mùi máu, sức nóng lửa — immersion cao',
      'Đối thoại tự nhiên theo văn hóa từng chủng tộc — elves có thể nói khác dwarf',
      'World-building cài vào hành động và đối thoại tự nhiên, không "info-dump"',
      'Tone có thể tối, bi kịch — anh hùng không luôn thắng, và chiến thắng luôn có cái giá',
      'Câu văn tiếng Việt thuần sáng, không lai Hán-Việt quá nhiều — gần với dịch thuật fantasy phương Tây',
    ],

    anti_ai_blacklist: [
      'ánh sáng thánh khiết bao phủ', 'sức mạnh của tình yêu chiến thắng tất cả',
      'nhân vật chính luôn có trực giác đúng', 'phép thuật bùng nổ không rõ lý do',
      'kẻ thù đột ngột trở nên ngu ngốc', 'dân làng nhìn chằm chằm kinh ngạc',
      'đây là vận mệnh của ta', 'ta được chọn để cứu thế giới',
      'toàn đội im lặng', 'không ai biết phải nói gì',
      'mắt long lanh như sao', 'vẻ đẹp kinh thiên động địa',
    ],

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

    constitution: [
      'Hệ thống (Status Window, Quest, Skill) có quy tắc nhất quán tuyệt đối — không thể tự dưng thay đổi cơ chế',
      'Level/EXP/Skill có giới hạn rõ ràng — mỗi cấp độ mạnh hơn cấp dưới theo tỷ lệ cụ thể, không tùy tiện',
      'Quest có deadline, điều kiện, thưởng/phạt minh bạch — hệ thống không "thiên vị" nhân vật',
      'Skill phải được học hoặc unlocked — không tự dưng có skill mới không có lý do',
      'Hệ thống có thể thưởng nhưng cũng có thể phạt thực sự — penalty có hậu quả',
      'Dungeon và monster có logic spawn và behavior riêng, không chỉ để "farm"',
      'Thế giới thực có phản ứng với sự tồn tại của hệ thống — NPC và xã hội thích nghi theo',
    ],

    style_dna: [
      'Mô tả Status Window, Skill notification, System message theo format rõ ràng, nhất quán trong suốt truyện',
      'Tư duy nhân vật mang tính "gamer" và logic: phân tích điểm mạnh-yếu, tối ưu build, tính toán rủi ro',
      'Câu văn nhanh, crisp — đặc biệt trong combat phải có nhịp như game action',
      'Cân bằng giữa "game-like" và cảm xúc người thật — nhân vật cũng có sợ hãi, tình cảm, mệt mỏi',
      'System notification nên có format riêng biệt (in đậm, ngoặc vuông, hoặc dòng riêng) để dễ nhận biết',
      'World-building giải thích logic tại sao hệ thống tồn tại — đừng để nó là "hộp đen" không giải thích',
    ],

    anti_ai_blacklist: [
      'đột ngột nhận được skill vô lý', 'hệ thống đặc biệt ưu ái ta', 'level up liên tục không nghỉ',
      'mọi người đều ghen tị với hệ thống của ta', 'skill này không ai có ngoài ta',
      'boss tự dưng đứng yên cho ta đánh', 'inventory vô hạn không giải thích',
      'ta cảm thấy mình sẽ thắng', 'bản năng mách bảo ta', 'lần này chắc chắn thành công',
      '[SYSTEM: Bạn đã vô địch thiên hạ]', 'toàn bộ người chơi kinh ngạc',
      'chưa ai đạt được thành tích này', 'kỷ lục server bị phá vỡ',
    ],

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

    constitution: [
      'Sinh tồn là ưu tiên số 1 — quyết định của nhân vật phải phản ánh thực tế này, không thể "anh hùng rởm"',
      'Tài nguyên khan hiếm thực sự: thức ăn, nước, thuốc, đạn đều có giá trị sống còn',
      'Luật rừng: xã hội sụp đổ nghĩa là không còn pháp luật bảo vệ kẻ yếu',
      'Mối đe dọa chính (zombie/quái vật/dịch bệnh) có quy luật riêng và nhất quán — không tùy tiện thay đổi',
      'Niềm tin và đạo đức bị thử thách thực sự — nhân vật phải chọn giữa sống và đạo đức',
      'Người tốt có thể chết, kẻ xấu có thể sống sót — không có kịch bản "công bằng tuyệt đối"',
      'Nhóm sinh tồn có mâu thuẫn nội bộ thực sự — không phải chỉ đoàn kết và hạnh phúc',
    ],

    style_dna: [
      'Văn phong căng thẳng, ngắt quãng — câu ngắn trong cảnh nguy hiểm, câu dài khi nhân vật đang an toàn và suy nghĩ',
      'Mô tả chi tiết cảm giác thể chất: đói, khát, mệt mỏi, mùi hôi, vết thương — không thể "quên" những thứ này',
      'Tâm lý nhân vật phải phản ánh áp lực sinh tồn thực — PTSD, paranoia, callousness là hệ quả tự nhiên',
      'Đối thoại ngắn gọn, thực dụng — người đang chạy trốn không nói dài',
      'Xen kẽ khoảnh khắc con người giữa căng thẳng — nhớ về quá khứ, liên kết nhỏ — để độc giả không gãy về mặt cảm xúc',
      'Tả thế giới tàn phá với chi tiết cụ thể: thành phố hoang, siêu thị trống, xe hơi hoen rỉ',
    ],

    anti_ai_blacklist: [
      'ta chắc chắn sẽ sống sót', 'tình yêu cho ta sức mạnh', 'đồng đội không bao giờ bỏ nhau',
      'kẻ xấu nhận quả báo ngay lập tức', 'nhân vật chính không bao giờ thực sự bị thương nặng',
      'tài nguyên tự dưng xuất hiện kịp thời', 'quái vật tự dưng chậm lại',
      'mọi người đều tin tưởng nhau ngay từ đầu', 'không ai phản bội vì lợi ích',
      'cứu người mà không có hậu quả gì', 'đánh quái như đang chơi game',
      'toàn đội đồng lòng chiến đấu', 'khoảnh khắc đó mọi nguy hiểm biến mất',
    ],

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

    constitution: [
      'Bối cảnh phong kiến: lễ nghi, xưng hô, phân cấp giai tầng đều phải đúng thời đại — CẤMT dùng tư duy và ngôn ngữ hiện đại',
      'Hôn nhân là chính trị và giao dịch — tình yêu tự do bị cản trở bởi gia tộc, địa vị, môn đăng hộ đối',
      'Nữ nhân trong hậu trạch có giới hạn quyền lực thực tế — đấu đá qua mưu mô, không phải đối đầu trực tiếp',
      'Nam chính có địa vị và quyền lực thực sự — hành vi của anh ta có hệ quả chính trị, không chỉ là "drama tình cảm"',
      'Trạch đấu có quy tắc ngầm: không thể "out" địch thủ quá lộ liễu, phải có bằng chứng hoặc mưu lược khéo léo',
      'Phong tục, lễ nghi cổ đại phải nhất quán: cách bái kiến, xưng hô tước vị, đồ trang phục đúng thời đại',
    ],

    style_dna: [
      'Văn phong cổ điển, uyển chuyển — câu dài nhiều tầng ý nghĩa, dùng điển tích tự nhiên',
      'Hán-Việt chiếm đa số — xưng hô "thiếp/chàng/nàng/huynh/muội" nhất quán theo địa vị',
      'Nhịp tình cảm chậm rãi, tinh tế — cảm xúc thể hiện qua ánh mắt né tránh, cử chỉ nhỏ, màu sắc trang phục',
      'Miêu tả không gian cổ đại: hoa viên, tẩm điện, đình đài, hương khói — phải có hồn và thời đại',
      'Đối thoại nhiều tầng: mặt ngoài nói một chuyện, thực chất ngầm truyền đạt ý khác',
      'Xây dựng tension tình cảm qua những va chạm nhỏ, không phải tuyên bố tình yêu trực tiếp',
    ],

    anti_ai_blacklist: [
      'anh yêu em', 'em cũng thích anh', 'tim tôi đập loạn', 'tôi không nhịn được nữa',
      'cô ấy cảm thấy bướm trong bụng', 'moment họ nhìn nhau và hiểu',
      'thiếp không thể không yêu chàng', 'chàng mỉm cười và thiếp tan chảy',
      'mọi người đều ghen tị', 'cô ta đẹp nhất hậu cung',
      'hoàng thượng chưa bao giờ yêu ai như vậy', 'ta sẽ bảo vệ nàng bằng mọi giá',
      'khoảnh khắc ánh mắt chạm nhau', 'cả thế giới dường như dừng lại',
      'bỗng nhiên hiểu ra rằng mình đã yêu từ lâu',
    ],

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

    constitution: [
      'Fair play tuyệt đối — mọi manh mối để giải đáp vụ án PHẢI được tiết lộ cho người đọc trước khi giải thích',
      'Sự thật phải logic hoàn toàn — kết quả không được phụ thuộc vào coincidence hay thông tin "mới" cuối truyện',
      'Quản lý "ai biết gì" nghiêm ngặt — nhân vật chỉ hành động dựa trên thông tin họ thực sự có',
      'Red herring phải tự nhiên và có lý do tồn tại — không được tạo ra chỉ để gây nhầm lẫn vô lý',
      'Alibi và timeline phải nhất quán — tác giả phải tracking chặt chẽ ai ở đâu lúc mấy giờ',
      'Động cơ của hung thủ phải đủ mạnh và logic khi nhìn lại — độc giả phải gật đầu "đúng rồi" khi biết sự thật',
    ],

    style_dna: [
      'Văn phong quan sát sắc bén, tỉ mỉ — mỗi chi tiết đều có thể quan trọng, tả chính xác',
      'Nhịp điệu tension tăng dần: bình thường → nghi ngờ → phát hiện → nguy hiểm → giải đáp',
      'Điểm nhìn nhân vật điều tra: tả những gì nhân vật nhìn thấy và suy luận, không tả những gì chỉ hung thủ biết',
      'Đối thoại thẩm vấn: câu hỏi và câu trả lời đều chứa thông tin, ngầm ý, hoặc che giấu',
      'Miêu tả hiện trường chi tiết có chọn lọc — không phải mọi thứ đều quan trọng, nhưng cái quan trọng phải được tả kỹ',
      'Khoảnh khắc "aha" của thám tử phải được chuẩn bị từ trước, không rơi từ trên trời xuống',
    ],

    anti_ai_blacklist: [
      'thám tử đột ngột "cảm thấy" kẻ phạm tội là ai', 'trực giác mách bảo',
      'manh mối quan trọng tự dưng xuất hiện kịp thời', 'nhân chứng đột ngột nhớ ra',
      'hung thủ tự thú vì quá tội lỗi', 'kế hoạch hoàn hảo không lỗ hổng',
      'tất cả chỉ là sự trùng hợp ngẫu nhiên', 'không ai nghi ngờ gì cả',
      'cảnh sát hoàn toàn vô dụng', 'chỉ có thám tử mới thông minh',
      'bí ẩn được giải đáp bằng công nghệ không được nhắc trước',
      'người bất ngờ nhất là hung thủ', 'đây là vụ án không thể giải được',
    ],

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

    constitution: [
      'Cảm xúc nhân vật phải chân thực và có lý do — yêu vì lý do cụ thể, không phải "đẹp quá nên yêu"',
      'Tension tình cảm phải được duy trì đủ lâu — giải quyết sớm = mất động lực đọc',
      'Xung đột phải có nguồn gốc thực sự — hiểu lầm phải có lý do tồn tại, không phải chỉ vì "không chịu nói chuyện"',
      'Nhân vật phải có cuộc sống riêng ngoài romance — công việc, bạn bè, ước mơ, mâu thuẫn nội tâm',
      'Mối quan hệ phát triển qua hành động cụ thể, không phải "tự dưng yêu nhau sâu sắc hơn"',
      'HE/BE phải xứng đáng — kết thúc happy hay sad đều phải earned, không phải gift',
    ],

    style_dna: [
      'Viết từ góc nhìn cảm xúc — tả những gì nhân vật cảm nhận, không chỉ những gì họ thấy',
      'Câu văn linh hoạt: căng thẳng khi có conflict, mềm mại khi có khoảnh khắc ngọt ngào',
      'Chi tiết nhỏ mang giá trị lớn: cách anh ta nhớ cô thích cà phê sữa đá, cách cô ta vô tình dùng lại câu anh nói',
      'Đối thoại romance phải subtext — những gì không nói ra đôi khi quan trọng hơn lời nói',
      'Nhịp slow burn: cảm xúc tích lũy dần, mỗi chương thêm một lớp hiểu biết về nhau',
      'Mô tả ngôn ngữ cơ thể kỹ — nhìn nhau, né tránh ánh mắt, khoảng cách, chạm tình cờ',
    ],

    anti_ai_blacklist: [
      'tim tôi đập loạn', 'bướm trong bụng', 'không thể thở được khi ở cạnh anh/cô ấy',
      'đây là cảm giác tôi chưa từng có', 'anh/cô ấy đặc biệt hơn tất cả',
      'khoảnh khắc ánh mắt chạm nhau cả thế giới dừng lại',
      'tôi đã yêu từ lần đầu gặp mặt', 'số phận sắp đặt chúng ta gặp nhau',
      'không ai hiểu tôi như anh/cô ấy', 'tôi không thể sống thiếu anh/cô ấy',
      'đôi mắt anh/cô ấy như biển sâu', 'nụ cười anh/cô ấy như ánh nắng',
      'anh/cô ấy hoàn hảo đến mức tôi không xứng',
      'mọi người đều nhìn chúng tôi ghen tị',
    ],

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

    constitution: [
      'Tension phải xây dựng dần — không "xì hơi" giữa chừng bằng giải thích không cần thiết',
      'Mỗi chi tiết kỳ lạ đều phải có payoff sau — setup phải dẫn đến gì đó',
      'Không giải thích quá nhiều về nguồn gốc kinh dị — để trí tưởng tượng độc giả hoàn thiện phần còn lại',
      'Chọn 1 loại kinh dị làm chủ đạo: tâm lý vs gore vs supernatural — không trộn lẫn bừa bãi',
      'Nhân vật hành xử logic trong ngữ cảnh của họ — không "ngu ngốc vì cần thiết cho plot"',
      'Cái ác hoặc mối nguy hiểm phải nhất quán trong quy tắc của nó — không thay đổi tùy tiện',
      'Không có cứu rỗi dễ dàng — escape phải được đánh đổi bằng cái gì đó',
    ],

    style_dna: [
      'Văn phong tối, dày đặc, không gian chật hẹp — đọc phải cảm thấy ngột ngạt',
      'Câu ngắn trong cảnh sợ hãi, câu dài khi nhân vật quan sát và dread tích tụ',
      'Mô tả giác quan đầy đủ: âm thanh kỳ lạ, mùi tanh, nhiệt độ thay đổi — không chỉ thị giác',
      'Dread > jump scare — cảm giác "cái gì đó sắp xảy ra" đáng sợ hơn bản thân sự kiện',
      'Thế giới bình thường trước khi kinh dị xuất hiện — contrast càng rõ, horror càng hiệu quả',
      'Nội tâm nhân vật dưới áp lực kinh dị: lý trí vs bản năng chạy trốn, không tin vào mắt mình',
    ],

    anti_ai_blacklist: [
      'bỗng nhiên mọi thứ ổn trở lại', 'ánh sáng chiều tà ấm áp an ủi',
      'ta không sợ gì cả', 'chỉ cần dũng cảm thì sẽ thoát',
      'mọi người tụ tập và tình huống được giải quyết', 'thứ kinh dị đó thực ra vô hại',
      'đây chỉ là ác mộng', 'tất cả chỉ là trong đầu',
      'tiếng ồn kỳ lạ thực ra là mèo', 'bóng tối thực ra là cái ghế',
      'nhân vật dũng cảm bước vào mà không sợ', 'không ai kiểm tra điện thoại hay la lên',
      'bỗng nhiên nhớ ra giải pháp hoàn hảo', 'kẻ ác giải thích toàn bộ kế hoạch',
    ],

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

    constitution: [
      'Giang hồ có quy tắc và trật tự riêng — có người tuân thủ, có kẻ phá vỡ, nhưng quy tắc tồn tại thực sự',
      'Võ công phải được học, rèn giũa, và có nguồn gốc — không tự dưng biết chiêu mới',
      'Nội lực là hữu hạn và cần thời gian hồi phục — không thể chiến liên tục không mệt',
      'Oán thù và ân nghĩa có trọng lượng thực sự — không thể quên hay tha thứ một cách dễ dàng',
      'Kiếm pháp/đao pháp có phong cách riêng — mỗi môn phái có chiêu thức đặc trưng, không thể lẫn lộn',
      'Giang hồ không phải thế giới đơn giản — chính tà đều có anh hùng và tiểu nhân',
    ],

    style_dna: [
      'Văn phong giang hồ phóng khoáng, hào sảng — câu văn có khí phách',
      'Miêu tả chiêu thức võ công bằng hình ảnh thơ ca: "Kiếm xé gió như long lâm hải" thay vì "chém rất mạnh"',
      'Đối thoại anh hùng: trực tiếp, nghĩa khí, trọng lời hứa, khinh thường tiểu nhân',
      'Tả cảnh thiên nhiên võ hiệp: gió núi, trăng sáng, rừng trúc, sông dài — có hồn thơ cổ điển',
      'Nhịp điệu: chậm khi kể mưu lược và cảm xúc, nhanh và sắc bén khi giao phong',
      'Hán-Việt ở mức vừa phải — không thuần Hán-Việt như tiên hiệp, giữ chất giang hồ thuần Việt',
    ],

    anti_ai_blacklist: [
      'chiêu thức không ai phá được', 'nội lực vô hạn', 'ta là đệ nhất thiên hạ',
      'không ai dám đối kháng', 'toàn giang hồ kinh hãi trước danh ta',
      'chiêu mới tự dưng nhớ ra', 'nội lực đột phá không giải thích',
      'kẻ thù tự dưng bỏ chạy', 'hảo hán không sợ chết',
      'đây là nghĩa khí của giang hồ', 'ta chưa gặp ai mạnh hơn',
      'mọi người vỗ tay ca ngợi', 'đám đông đứng nhìn kinh ngạc',
    ],

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

    constitution: [
      'Cấu trúc xã hội phong kiến: vua > quan > thần > dân — quyền lực vua là tuyệt đối, nhưng các quan và gia tộc có ảnh hưởng thực sự',
      'Cung đấu có quy tắc: không thể tấn công trực tiếp kẻ có địa vị cao hơn, phải thông qua mưu lược',
      'Thánh chỉ của hoàng đế là luật — không ai có thể phản kháng trực tiếp, chỉ có thể vận động ngầm',
      'Phi tần trong hậu cung là thế lực chính trị — đứng sau mỗi người là gia tộc và phe phái',
      'Phong tục, lễ nghi cổ đại phải đúng: cách bái kiến, trang phục, xưng hô theo cấp bậc',
      'Độc và ám toán là vũ khí cung đấu — nhưng phải tinh vi, không để lộ',
    ],

    style_dna: [
      'Văn phong cổ điển, trang trọng — Hán-Việt chiếm phần lớn, xưng hô theo đúng cấp bậc',
      'Miêu tả trang phục, trang sức, không gian cung đình với chi tiết cụ thể và đúng thời đại',
      'Đối thoại nhiều tầng: bề mặt lịch sự, ngầm đe dọa hoặc thăm dò — cung đình không nói thẳng',
      'Nhịp chậm, trang nghiêm — mỗi chuyển động trong cung đình đều có ý nghĩa',
      'Nội tâm nhân vật phức tạp: phải tính toán từng bước, biết khi nào nhường khi nào tấn công',
      'Cảnh thiên nhiên cung đình: hoa mơ, tuyết rơi, đèn lồng đêm hội — mang vẻ đẹp buồn bã của người mất tự do',
    ],

    anti_ai_blacklist: [
      'hoàng hậu tức giận như đứa trẻ', 'hoàng đế ngớ ngẩn không nhìn ra âm mưu',
      'tất cả mọi người đều biết sự thật nhưng không nói',
      'phi tần đánh nhau trực tiếp trước mặt hoàng đế', 'nữ chính dùng từ ngữ hiện đại',
      'bỗng nhiên được hoàng đế sủng ái vô lý', 'tất cả ghen tị với nữ chính',
      'kế hoạch hoàn hảo không lỗ hổng', 'không ai nghi ngờ nữ chính',
      'hoàng đế chỉ yêu mình nữ chính', 'quyền lực tự dưng về tay nữ chính',
      'ánh mắt hoàng đế sáng rực khi nhìn nàng',
    ],

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

    constitution: [
      'Nhân vật giữ kiến thức từ thế giới/thời đại trước — đây là lợi thế, nhưng cũng là gánh nặng và nguy hiểm',
      'Kiến thức hiện đại phải được áp dụng khéo léo — không thể lộ liễu "ta biết tương lai"',
      'Butterfly effect thực sự: thay đổi sự kiện nhỏ có thể kéo theo hậu quả lớn không lường trước',
      'Cơ thể nhân vật mới có giới hạn riêng — ký ức kiếp trước không tự dưng tăng thể lực',
      'Người xuyên không phải thích nghi với xã hội, không thể hành xử hoàn toàn theo kiểu thế giới cũ',
      'Kiến thức "vàng" từ tương lai có hạn dùng — khi đã sử dụng, lợi thế đó mất dần',
    ],

    style_dna: [
      'Hai tầng tư duy: con người mới bên ngoài, ký ức cũ bên trong — thể hiện rõ sự khác biệt này',
      'Nội tâm phong phú: nhân vật liên tục so sánh thế giới cũ và mới, nhận ra điểm giống và khác',
      'Phong cách phù hợp với bối cảnh đích đến — nếu xuyên vào thế giới cổ đại thì dùng văn phong cổ đại',
      'Moments "không thể không làm gì" khi nhân vật biết trước bi kịch sắp xảy ra — tension nội tâm',
      'Giải thích kiến thức hiện đại qua lăng kính thế giới cũ: không nói "máy tính" mà ẩn dụ theo thế giới đó',
      'Pace linh hoạt: thích nghi = chậm, thay đổi lịch sử = căng thẳng nhanh',
    ],

    anti_ai_blacklist: [
      'ta biết tất cả vì ta đến từ tương lai', 'mọi người đều ngưỡng mộ kiến thức của ta',
      'kiến thức tương lai không bao giờ sai', 'mọi kế hoạch đều theo đúng dự tính',
      'không ai nghi ngờ ta', 'việc thích nghi quá dễ dàng',
      'ta nhớ chính xác từng chi tiết', 'không gì có thể làm ta bất ngờ',
      'bỗng nhiên nhớ ra kiến thức cần thiết đúng lúc', 'cơ thể mới hoàn hảo không cần rèn luyện',
      'tất cả người trong truyện đều ngu hơn ta', 'không có hậu quả khi thay đổi lịch sử',
    ],

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

    constitution: [
      'Bối cảnh đô thị hiện đại Việt Nam — tuyệt đối không dùng ngôn ngữ tu tiên, cổ đại, hay cung đình',
      'Xã hội có luật pháp và hệ quả thực tế — nhân vật không thể hành động vô pháp mà không bị ảnh hưởng',
      'Tiền bạc, quan hệ xã hội, học vấn là tài nguyên thực sự của xã hội hiện đại',
      'Công nghệ hiện đại (điện thoại, mạng xã hội, camera an ninh) ảnh hưởng đến plot thực sự',
      'Tâm lý nhân vật phải nhất quán với nền tảng gia đình và môi trường sống của họ',
      'Hệ quả của hành động phải thực tế — không có "may mắn vô lý" hay "thoát hiểm thần kỳ"',
    ],

    style_dna: [
      'Tiếng Việt hiện đại thuần Việt — đối thoại tự nhiên như người thực nói, tránh cứng nhắc',
      'Chi tiết đô thị cụ thể: quán cà phê Hà Nội, kẹt xe Sài Gòn, chung cư, văn phòng — đặt độc giả vào thực tế',
      'Nội tâm nhân vật phản ánh tâm lý học hiện đại: lo âu, áp lực xã hội, kỳ vọng gia đình',
      'Đối thoại đa dạng theo độ tuổi và tầng lớp xã hội — gen Z nói khác gen X, người Hà Nội nói khác Sài Gòn',
      'Nhịp điệu phản ánh cuộc sống đô thị: vội vàng, đan xen công việc và cảm xúc',
      'Mô tả không gian và thời gian cụ thể — giờ cao điểm sáng sớm, cơn mưa chiều Sài Gòn, hội nghị cuối năm',
    ],

    anti_ai_blacklist: [
      'chàng', 'nàng', 'thiếp', 'phu quân', 'ngươi', 'ta', 'bổn tọa', 'huynh', 'muội',
      'linh lực', 'tu vi', 'cảnh giới', 'đan điền', 'thần thức', 'pháp bảo',
      'CEO lạnh lùng đẹp trai bước vào', 'anh ta không nhìn ai ngoài cô',
      'toàn bộ công ty kinh ngạc', 'không ai dám nhìn thẳng vào mắt anh ta',
      'bỗng nhiên ý thức được tình cảm của mình', 'trái tim tôi chưa từng rung động như vậy',
      'tôi không xứng với anh/cô ấy', 'đây là lần đầu tôi biết thế nào là yêu',
      'toàn bộ phòng họp im lặng khi anh/cô ấy bước vào',
    ],

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