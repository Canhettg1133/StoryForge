const STORAGE_KEY = 'sf-story-creation-settings';
const META_KEY = 'sf-story-creation-settings-meta';

const STORY_BIBLE_SEED_SYSTEM_PROMPT_LOCKED = `Trả về CHÍNH XÁC JSON format:
{
  "title": "Tên truyện chính thức",
  "title_options": ["Tên 1", "Tên 2", "Tên 3"],
  "premise": "Tóm tắt premise 2-3 câu",
  "world_profile": {
    "world_name": "Tên thế giới",
    "world_type": "Loại: tu tiên / hiện đại / sci-fi...",
    "world_scale": "Quy mô: 1 lục địa / nhiều giới...",
    "world_era": "Thời đại: thượng cổ / trung cổ / hiện đại...",
    "world_rules": ["Quy tắc 1", "Quy tắc 2", "Quy tắc 3"],
    "world_description": "Mô tả tổng quan thế giới 2-3 câu"
  },
  "characters": [{"name": "...", "aliases": ["tên gọi khác / biệt danh nếu có"], "role": "protagonist|deuteragonist|antagonist|supporting|mentor|love_interest|minor", "specific_role": "vai trò canon cụ thể nếu cần khóa; để rỗng nếu không có", "specific_role_locked": false, "age": "tuổi/độ tuổi tùy chọn", "appearance": "...", "personality": "...", "personality_tags": "tag1, tag2", "flaws": "điểm yếu lúc đầu", "goals": "...", "current_status": "Live Canon tại lúc mở truyện/chương 1; không ghi trạng thái tương lai", "story_function": "vai trò cụ thể trong phần mở đầu"}],
  "locations": [{"name": "...", "description": "...", "story_function": "địa điểm này dùng để làm gì ở phần mở đầu"}],
  "objects": [{"name": "...", "description": "...", "owner": "...", "story_function": "chỉ thêm nếu phần mở đầu thật sự cần vật phẩm này"}],
  "factions": [{"name": "...", "faction_type": "sect|kingdom|organization|other", "description": "...", "notes": "...", "story_function": "thế lực này dùng để làm gì ở phần mở đầu"}],
  "terms": [{"name": "...", "definition": "...", "category": "magic|race|technology|other", "story_function": "thuật ngữ này ảnh hưởng gì tới phần mở đầu"}],
  "plot_threads": [{"title": "...", "type": "main|subplot|character_arc|mystery|romance", "description": "mô tả tuyến truyện 1-2 câu", "state": "active", "opening_window": "xuất hiện từ chương nào", "anchor_chapters": []}]
}

QUY TẮC SEED:
- HỢP ĐỒNG TAG / TROPE: nếu đầu vào có tag/trope, phải diễn giải thành mức xung đột, kiểu nhân vật, nhịp chương và payoff dự kiến; không để tag chỉ là một dòng nhãn.
- Nếu tag/trope xung đột với mặc định thể loại, ưu tiên tag/trope trừ khi ý tưởng tác giả nói ngược lại.
- Không dùng thể loại như khuôn truyện; thể loại chỉ là từ điển bối cảnh, thuật ngữ và kỳ vọng nền.
- Khi có mẫu thể loại, không gom toàn bộ thuật ngữ/entity mẫu vào seed và không dùng mẫu như checklist bắt buộc; chỉ chọn yếu tố thật sự phục vụ premise, tag/trope và phần mở đầu.
- Nếu thể loại là "Bất kỳ / AI tự chọn", "Khác", hoặc ý tưởng chỉ nói bất kỳ/ngẫu nhiên/tự chọn, không mặc định bất kỳ thể loại cụ thể nào; hãy chọn thể loại từ HỢP ĐỒNG TAG / TROPE, tone và ý tưởng.
- Với mọi tag/trope và mọi thể loại: phải biến tag thành hợp đồng trải nghiệm chi phối bối cảnh, xung đột, kiểu nhân vật, nhịp chương và payoff; không tự sinh mô hình thể loại, entity, hệ thống sức mạnh, kiểu xung đột hoặc trope trái với tag/trope trừ khi tác giả yêu cầu rõ.
- Nếu tác giả yêu cầu bất kỳ/ngẫu nhiên/tự chọn trong một thể loại đã chọn, vẫn giữ thể loại đó nhưng không dùng gói mở đầu mặc định của thể loại; phải tạo biến thể premise riêng trong nội bộ thể loại dựa trên tag/trope, tone, POV và một điểm khác biệt cụ thể. Quy tắc này áp dụng cho mọi thể loại.
- Ví dụ với Tiên hiệp: không tự lặp tạp dịch, tông môn suy tàn, linh thạch, cơ duyên nghịch mệnh, phế vật bị áp bức hoặc cheat mở đầu trừ khi tác giả yêu cầu rõ.
- Đây chỉ là Story Bible Seed, KHÔNG lập dàn ý chương ở bước này.
- Số nhân vật phải tỉ lệ với {{initial_chapter_count}} chương khởi đầu: 1 chương thường là 1 protagonist + tối đa 1 nhân vật phụ thật sự cần xuất hiện; nếu premise xoay quanh song nhân vật chính thì dùng tối đa 2 nhân vật trung tâm, trong đó ít nhất 1 protagonist và nhân vật còn lại có thể là protagonist hoặc deuteragonist; 2-3 chương = 2-4 nhân vật; 4+ chương = 3-5 nhân vật.
- Không tạo nhân vật, địa điểm, vật phẩm, thế lực, thuật ngữ "để dành về sau".
- Mỗi entity phải có story_function cụ thể trong phần mở đầu hoặc premise. Nếu chưa dùng sớm thì không tạo.
- Chỉ tạo thuật ngữ, vật phẩm, thế lực, địa điểm khi chúng thật sự phục vụ premise hoặc phần mở đầu; không tạo chỉ vì chúng là mặc định của thể loại.
- Nếu một tổ chức/thế lực vừa là entity xã hội vừa là địa điểm vật lý quan trọng, tạo faction cho tổ chức và location cho khu vực/địa điểm tương ứng.
- current_status chỉ là trạng thái canon tại lúc truyện bắt đầu, không được ghi kết quả tương lai của outline.
- Mỗi người chỉ có một record chính thức; biệt danh hoặc cách gọi khác phải nằm trong aliases.
- locations chỉ là địa điểm vật lý có thể đến được; factions là tổ chức/thế lực; terms là khái niệm/hệ thống/chủng tộc/công nghệ.

Chỉ trả về JSON, không thêm gì khác.`;

const CHAPTER_OUTLINE_PASS_SYSTEM_PROMPT_LOCKED = `Trả về CHÍNH XÁC JSON format:
{
  "chapters": [
    {
      "title": "Chương 1: ...",
      "purpose": "mục tiêu kể chuyện của chương 1-2 câu",
      "summary": "tóm tắt nội dung chương 2-3 câu",
      "opening_state": "Trạng thái mở chương",
      "handoff_from_previous": "Chương 1 để rỗng; từ Chương 2 trở đi bắt buộc nêu cầu nối nhân quả",
      "ending_state": "Trạng thái kết chương để chương sau nối tiếp",
      "state_delta": "Thay đổi dự kiến của Live Canon/current_status sau chương này; để rỗng nếu không đổi",
      "featured_characters": ["..."],
      "primary_location": "...",
      "thread_titles": ["..."],
      "key_events": ["neo nội bộ cần có"],
      "required_factions": ["..."],
      "required_objects": ["..."],
      "required_terms": ["..."]
    }
  ],
  "plot_threads": [
    {
      "title": "...",
      "type": "main|subplot|character_arc|mystery|romance",
      "description": "mô tả tuyến truyện 1-2 câu",
      "state": "active",
      "opening_window": "xuất hiện từ chương nào",
      "anchor_chapters": ["Chương 1"]
    }
  ],
  "proposed_entities": {
    "characters": [],
    "locations": [],
    "objects": [],
    "factions": [],
    "terms": [],
    "plot_threads": []
  }
}

QUY TẮC OUTLINE:
- HỢP ĐỒNG TAG / TROPE: outline phải chuyển tag/trope thành mức xung đột, kiểu nhân vật, nhịp chương và payoff cụ thể theo từng chương.
- Nếu tag/trope xung đột với mặc định thể loại, ưu tiên tag/trope trừ khi ý tưởng tác giả nói ngược lại.
- Không dùng thể loại như khuôn truyện; thể loại chỉ là từ điển bối cảnh, thuật ngữ và kỳ vọng nền.
- Không đưa thêm thuật ngữ/entity mẫu vào outline chỉ vì chúng nằm trong template; nếu seed chưa chọn thì chỉ đề xuất khi chapter thật sự cần và phải có story_function rõ.
- Nếu seed xuất phát từ "Bất kỳ / AI tự chọn" hoặc ý tưởng bất kỳ/ngẫu nhiên/tự chọn, tiếp tục bám thể loại đã được chọn trong seed và HỢP ĐỒNG TAG / TROPE; không kéo ngược outline về bất kỳ công thức thể loại nào nếu seed không đặt rõ.
- Nếu seed/ý tưởng là bất kỳ trong một thể loại đã chọn, outline phải phát triển biến thể premise riêng đã chọn; không quay về gói mở đầu mặc định của thể loại.
- Phải tạo đúng {{initial_chapter_count}} chương.
- Chỉ dùng cast/world/entity đã có trong seed đã duyệt.
- Nếu thật sự cần entity mới, KHÔNG nhét trực tiếp vào canon; đưa vào proposed_entities với reason/story_function rõ ràng.
- Bất kỳ tên nào xuất hiện trong featured_characters, primary_location, thread_titles, required_factions, required_objects hoặc required_terms mà chưa có trong seed đã duyệt thì BẮT BUỘC phải có record cùng tên trong proposed_entities đúng nhóm.
- Ví dụ: nếu dùng một vật phẩm trong required_objects thì proposed_entities.objects phải có record cùng tên; nếu dùng một khái niệm trong required_terms thì proposed_entities.terms phải có record tương ứng; nếu dùng một địa điểm làm primary_location mà seed chưa có địa điểm này thì proposed_entities.locations phải có record tương ứng.
- Mỗi chương bắt buộc có opening_state và ending_state.
- Từ chương 2 trở đi, handoff_from_previous phải nói rõ chương này nối từ ending_state/state_delta của chương trước bằng cầu nhân quả nào.
- Không nhảy từ nguy hiểm, trọng thương, giam giữ, mất tích, đang bị truy đuổi sang trạng thái an toàn nếu chưa có beat giải quyết.
- featured_characters, primary_location, thread_titles, required_factions, required_objects, required_terms phải dùng tên chính thức trong seed hoặc proposed_entities.
- state_delta chỉ mô tả thay đổi sau chương, không được ghi ngược vào current_status của nhân vật.

Chỉ trả về JSON, không thêm gì khác.`;

const PROJECT_WIZARD_SYSTEM_PROMPT_LOCKED = `Trả về CHÍNH XÁC JSON format:
{
  "title": "Tên truyện chính thức",
  "title_options": ["Tên 1", "Tên 2", "Tên 3"],
  "premise": "Tóm tắt premise 2-3 câu",
  "world_profile": {
    "world_name": "Tên thế giới",
    "world_type": "Loại: tu tiên / hiện đại / sci-fi...",
    "world_scale": "Quy mô: 1 lục địa / nhiều giới...",
    "world_era": "Thời đại: thượng cổ / trung cổ / hiện đại...",
    "world_rules": ["Quy tắc 1", "Quy tắc 2", "Quy tắc 3"],
    "world_description": "Mô tả tổng quan thế giới 2-3 câu"
  },
  "characters": [{"name": "...", "aliases": ["tên gọi khác / biệt danh nếu có"], "role": "protagonist|deuteragonist|antagonist|supporting|mentor|love_interest|minor", "specific_role": "vai trò canon cụ thể nếu tác giả yêu cầu; để rỗng nếu không có", "specific_role_locked": false, "age": "tuổi/độ tuổi tùy chọn, chỉ điền khi phù hợp thể loại hoặc hữu ích cho giọng thoại", "appearance": "...", "personality": "...", "personality_tags": "tag1, tag2", "flaws": "điểm yếu / khuyết điểm lúc đầu", "goals": "...", "current_status": "Character Live Canon lúc khởi đầu; để rỗng nếu không có ràng buộc canon thật", "story_function": "vai trò trong các chapter đầu"}],
  "locations": [{"name": "...", "description": "...", "story_function": "địa điểm này dùng để làm gì trong chapter đầu"}],
  "objects": [{"name": "...", "description": "...", "owner": "...", "story_function": "chỉ thêm nếu chapter đầu thật sự cần vật phẩm này"}],
  "factions": [{"name": "...", "faction_type": "sect|kingdom|organization|other", "description": "...", "notes": "...", "story_function": "thế lực này dùng để làm gì trong chapter đầu"}],
  "terms": [{"name": "...", "definition": "...", "category": "magic|race|technology|other", "story_function": "thuật ngữ này ảnh hưởng gì tới chapter đầu"}],
  "chapters": [{"title": "Chương 1: ...", "purpose": "mục tiêu kể chuyện của chương", "summary": "Tóm tắt nội dung chương", "opening_state": "Trạng thái nhân vật/thế giới lúc mở chương", "handoff_from_previous": "Chương 1 để rỗng; từ Chương 2 trở đi bắt buộc nêu rõ cầu nhân quả từ ending_state chương trước", "ending_state": "Trạng thái kết chương để chương sau nối tiếp", "state_delta": "Thay đổi dự kiến của Character Live Canon/current_status sau chương này; để rỗng nếu không đổi", "featured_characters": ["..."], "primary_location": "...", "thread_titles": ["..."], "key_events": ["neo nội bộ nếu cần"], "required_factions": ["..."], "required_objects": ["..."], "required_terms": ["..."]}],
  "plot_threads": [{"title": "...", "type": "main|subplot|character_arc|mystery|romance", "description": "mô tả tuyến truyện 1-2 câu", "state": "active", "opening_window": "xuất hiện từ chương nào", "anchor_chapters": ["Chương 1", "Chương 3"]}]
}

QUY TẮC PHÂN LOẠI:
- Nếu thể loại là "Bất kỳ / AI tự chọn", "Khác", hoặc ý tưởng chỉ nói bất kỳ/ngẫu nhiên/tự chọn, không mặc định bất kỳ thể loại cụ thể nào; hãy chọn thể loại từ HỢP ĐỒNG TAG / TROPE, tone và ý tưởng.
- Với mọi tag/trope và mọi thể loại: phải biến tag thành hợp đồng trải nghiệm chi phối bối cảnh, xung đột, kiểu nhân vật, nhịp chương và payoff; không tự sinh mô hình thể loại, entity, hệ thống sức mạnh, kiểu xung đột hoặc trope trái với tag/trope trừ khi tác giả yêu cầu rõ.
- Khi có mẫu thể loại, không gom toàn bộ thuật ngữ/entity mẫu vào blueprint và không dùng mẫu như checklist bắt buộc; chỉ chọn yếu tố thật sự phục vụ premise, tag/trope và chapter đầu.
- Nếu tác giả yêu cầu bất kỳ/ngẫu nhiên/tự chọn trong một thể loại đã chọn, vẫn giữ thể loại đó nhưng không dùng gói mở đầu mặc định của thể loại; phải tạo biến thể premise riêng trong nội bộ thể loại dựa trên tag/trope, tone, POV và một điểm khác biệt cụ thể. Quy tắc này áp dụng cho mọi thể loại.
- "locations": chỉ là địa điểm vật lý có thể đến được.
- "factions": tổ chức, thế lực, bang phái, vương triều, công ty, hội nhóm hoặc cộng đồng có quyền lực xã hội/chính trị.
- "terms": chỉ là khái niệm trừu tượng, hệ thống, chủng tộc, công nghệ.

QUY TẮC TÊN TRUYỆN:
- "title" phải là tên đầy đủ, không cắt ngắn từ premise.
- "title_options" phải có 3-5 phương án đủ khác nhau, bám sát thể loại và ý tưởng.

QUY TẮC CHƯƠNG VÀ ENTITY:
- "featured_characters", "primary_location", "thread_titles", "required_factions", "required_objects", "required_terms" trong từng chapter phải tham chiếu tới entity/tuyến đã tạo ở trên.
- Không tạo character/location/term chỉ để có ở codex mà không liên hệ với chapter.
- "objects" là field tùy chọn, chỉ thêm nếu chapter đầu thật sự cần và chapter outline có nhắc đến.
- Mỗi chapter phải có tiến triển rõ, nhưng không được nhồi quá nhiều biến cố nếu đây mới là mở đầu truyện.
- BẮT BUỘC giữ timeline rõ: nếu có sự kiện đếm ngược ("3 ngày nữa", "1 tháng sau", "kỳ sát hạch"), các chapter sau phải cập nhật mốc thời gian tương ứng, không được lặp lại mốc cũ như chưa có thời gian trôi qua.
- BẮT BUỘC mọi án phạt, giam giữ, truy nã, thương tích, cấm túc hoặc ràng buộc hành vi tạo hệ quả thật trong outline. Nếu nhân vật cần dự một sự kiện sắp tới, outline phải nêu con đường hợp pháp hoặc hợp logic để họ xuất hiện.
- BẮT BUỘC phản ứng nhân vật theo thông tin họ đang có: khi một nhân vật yếu thế sống sót ngoài dự kiến, lộ năng lực, tài nguyên, thông tin hoặc lợi thế bất thường, người xung quanh/phía đối địch phải nghi ngờ, hỏi, điều tra, che giấu, lợi dụng, hoặc đổi kế hoạch.
- "state_delta" của chapter là thay đổi dự kiến của Character Live Canon/current_status sau chapter; để rỗng nếu chapter không đổi trạng thái canon nào.
- "opening_state", "ending_state", và "handoff_from_previous" là cầu nối nhân quả. Chương N+1 PHẢI nối trực tiếp từ ending_state/state_delta của Chương N; nếu cần đổi địa điểm/thời gian/trạng thái, phải nêu cầu nối hợp logic trong handoff_from_previous hoặc key_events.
- Không được để chapter sau nhảy từ nguy hiểm/bị thương/giam giữ/mất tích sang địa điểm/an toàn/mục tiêu mới nếu chưa có beat giải quyết cầu nối.
- Mỗi nhân vật chỉ được có MỘT record chính thức trong "characters". Nếu cùng một người có tên ngắn, họ, biệt danh, danh xưng, hoặc cách gọi khác, đưa vào "aliases" của record đó; TUYỆT ĐỐI không tạo thành nhân vật mới.
- specific_role là vai trò canon cụ thể do tác giả/blueprint xác nhận, khác với "role" là vai trò truyện. Chỉ điền khi có vai trò cụ thể thật sự cần khóa trong canon; nếu để trống thì "specific_role_locked" phải là false.
- Khi "specific_role" có nội dung và cần khóa canon, đặt "specific_role_locked": true. Không tạo nhân vật khác giữ cùng vai trò cụ thể hoặc vai trò tương đương.
- Field "age" là tùy chọn: chỉ điền tuổi/độ tuổi khi phù hợp thể loại hoặc hữu ích cho giọng thoại; hiện đại/học đường/đô thị có thể dùng tuổi số, tiên hiệp/huyền huyễn/thần linh/bất tử ưu tiên mô tả linh hoạt như thiếu niên, ngoại hình đôi mươi, tuổi thật rất cao, trưởng bối.
- Field "current_status" là Character Live Canon lúc khởi đầu. Chỉ điền nếu trạng thái đó ảnh hưởng chương đầu, quan hệ, xung đột, địa vị xã hội, tri thức, phe phái, vết thương, hoặc ràng buộc hành vi. Không điền status rỗng/chung chung kiểu "buồn", "mạnh mẽ".
- Không tạo 2 protagonist/main character cho cùng một người chỉ vì tên hơi khác nhau. "featured_characters" phải dùng tên chính thức trong "characters".

Chỉ trả về JSON, không thêm gì khác.`;

const OUTLINE_GENERATION_SYSTEM_PROMPT_LOCKED = `Trả về CHÍNH XÁC JSON:
{
  "chapters": [
    {
      "title":"...",
      "purpose":"mục tiêu kể chuyện của chương 1-2 câu",
      "summary":"tóm tắt nội dung 2-3 câu",
      "opening_state":"Trạng thái mở chương",
      "handoff_from_previous":"Chương đầu để rỗng; chương sau nêu rõ cầu nhân quả từ chương trước",
      "ending_state":"Trạng thái kết chương để chương sau bám vào",
      "state_delta":"Thay đổi dự kiến của Character Live Canon/current_status sau chương này; để rỗng nếu không đổi",
      "act":1,
      "featured_characters":["..."],
      "primary_location":"...",
      "thread_titles":["..."],
      "key_events":["neo nội bộ nếu cần"],
      "required_factions":["..."],
      "required_objects":["..."],
      "required_terms":["..."]
    }
  ],
  "plot_threads": [
    {
      "title":"...",
      "type":"main|subplot|character_arc|mystery|romance",
      "description":"mô tả tuyến truyện 1-2 câu",
      "state":"active",
      "anchor_chapters":["Chương 1","Chương 3"]
    }
  ]
}

QUY TẮC THÊM:
- "featured_characters" phải là nhân vật thực sự tham gia hoặc bị ảnh hưởng mạnh trong chương, dùng tên chính thức trong "Nhân vật". Tên ngắn/biệt danh/alias không được biến thành nhân vật mới.
- "primary_location" phải là địa điểm chính của chương.
- "thread_titles" phải trỏ tới các plot thread thực sự được đẩy trong chương đó.
- "key_events", "required_factions", "required_objects", "required_terms" phải là neo cần cho chương đó; không điền cho đủ số.
- "required_factions", "required_objects", "required_terms" phải bám entity/term đã có trong dự án nếu có; chỉ đề xuất mới khi outline thật sự bắt buộc.
- "state_delta" phải nêu rõ nếu chương này làm đổi Character Live Canon/current_status của nhân vật; để rỗng nếu không có đổi thay rõ.
- Mỗi chapter từ chapter thứ 2 trong batch phải có "handoff_from_previous" giải thích vì sao nó nối tiếp được chapter trước. Nếu chapter trước kết thúc bằng điểm bỏ lửng, nguy hiểm, thương tích, giam giữ hoặc di chuyển, chapter sau phải có beat cầu nối trước khi sang mục tiêu mới.
- BẮT BUỘC giữ timeline rõ: nếu có sự kiện đếm ngược ("3 ngày nữa", "1 tháng sau", "kỳ sát hạch"), các chapter sau phải cập nhật mốc thời gian tương ứng, không được lặp lại mốc cũ như chưa có thời gian trôi qua.
- BẮT BUỘC mọi án phạt, giam giữ, truy nã, thương tích, cấm túc hoặc ràng buộc hành vi tạo hệ quả thật trong outline. Nếu nhân vật cần dự một sự kiện sắp tới, outline phải nêu con đường hợp pháp hoặc hợp logic để họ xuất hiện.
- BẮT BUỘC phản ứng nhân vật theo thông tin họ đang có: khi một nhân vật yếu thế sống sót ngoài dự kiến, lộ năng lực, tài nguyên, thông tin hoặc lợi thế bất thường, người xung quanh/phía đối địch phải nghi ngờ, hỏi, điều tra, che giấu, lợi dụng, hoặc đổi kế hoạch.
- Nếu chapter chưa cần dùng tới một thread lớn, đừng gán vào cho đủ số.
- Outline phải rõ đường dây tiến triển, không được toàn chapter na ná nhau.

Chỉ trả về JSON.`;

const THREAD_SUGGESTION_SYSTEM_PROMPT_LOCKED = `Trả về CHÍNH XÁC JSON:
{"plot_threads": [{"title":"...","type":"main|subplot|character_arc|mystery|romance","description":"mô tả 1-2 câu"}]}`;

const STORY_CREATION_SYSTEM_PROMPT_PROTECTIONS = {
  storyBibleSeed: {
    marker: 'Trả về CHÍNH XÁC JSON format:',
    lockedPrompt: STORY_BIBLE_SEED_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract được khóa',
    description: 'Schema seed được khóa để AI Wizard chỉ tạo nền truyện, chưa tạo dàn ý chương.',
  },
  chapterOutlinePass: {
    marker: 'Trả về CHÍNH XÁC JSON format:',
    lockedPrompt: CHAPTER_OUTLINE_PASS_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract được khóa',
    description: 'Schema outline được khóa để dàn ý bám seed đã duyệt và có cầu nối nhân quả.',
  },
  projectWizard: {
    marker: 'Trả về CHÍNH XÁC JSON format:',
    legacyMarkers: ['Tra ve CHINH XAC JSON format:'],
    lockedPrompt: PROJECT_WIZARD_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract được khóa',
    description: 'Schema này luôn được app ghép lại để tránh vỡ parser khi luồng legacy trả kết quả.',
  },
  outlineGeneration: {
    marker: 'Trả về CHÍNH XÁC JSON:',
    legacyMarkers: ['Tra ve CHINH XAC JSON:'],
    lockedPrompt: OUTLINE_GENERATION_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract được khóa',
    description: 'Outline Board vẫn cho sửa hướng dẫn, nhưng block output JSON này là bất biến.',
  },
  threadSuggestion: {
    marker: 'Trả về CHÍNH XÁC JSON:',
    legacyMarkers: ['Tra ve CHINH XAC JSON:'],
    lockedPrompt: THREAD_SUGGESTION_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract được khóa',
    description: 'Phần output này được khóa để luồng gợi ý plot thread luôn parse ổn định.',
  },
};

export const STORY_CREATION_PROMPT_GROUPS = [
  {
    key: 'writingSystemIdentity',
    label: 'Hệ thống viết truyện',
    description: 'Dùng cho system identity mặc định của engine viết truyện trên toàn bộ app.',
    systemHelp: 'Sửa khi muốn đổi vai trò mặc định, nguyên tắc nền và cách AI tự xác định bản thân khi xử lý các tác vụ viết truyện.',
    userHelp: '',
    variables: [],
    showUserPrompt: false,
  },
  {
    key: 'storyBibleSeed',
    label: 'Story Bible Seed',
    description: 'Dùng cho bước đầu của AI Wizard: tạo premise, world rules, cast tối thiểu và plot thread, chưa tạo dàn ý chương.',
    systemHelp: 'Sửa khi muốn đổi cách AI dựng nền truyện ban đầu, giới hạn số nhân vật, hoặc siết việc không tạo entity để dành về sau.',
    userHelp: 'Sửa khi muốn đổi thông tin đầu vào cho seed: thể loại, tone, góc nhìn, số chương khởi đầu, mục tiêu dài hạn và ý tưởng.',
    variables: [
      'genre',
      'tone',
      'tags_line',
      'pov_label',
      'pronoun_label',
      'target_length_label',
      'ultimate_goal',
      'synopsis_line',
      'story_structure_line',
      'idea',
      'template_hint',
      'initial_chapter_count',
      'pacing_guidance',
    ],
  },
  {
    key: 'chapterOutlinePass',
    label: 'Chapter Outline Pass',
    description: 'Dùng cho bước hai của AI Wizard: tạo dàn ý chương từ seed đã duyệt, có opening/ending state và handoff.',
    systemHelp: 'Sửa khi muốn đổi cách AI nối chương, xử lý proposal entity mới, hoặc siết logic nhân quả của outline.',
    userHelp: 'Sửa khi muốn đổi payload seed đã duyệt và yêu cầu số chương cho outline.',
    variables: [
      'genre',
      'tone',
      'tags_line',
      'pov_label',
      'pronoun_label',
      'target_length_label',
      'ultimate_goal',
      'initial_chapter_count',
      'approved_seed_json',
      'pacing_guidance',
    ],
  },
  {
    key: 'projectWizard',
    label: 'Khởi tạo dự án bằng AI',
    description: 'Luồng cũ / không dùng trực tiếp bởi AI Wizard mới. Giữ lại để tương thích và tra cứu.',
    systemHelp: 'Sửa khi muốn ép luồng legacy tuân thủ vai trò, logic tạo blueprint, pacing, và độ bám sát giữa entity với outline.',
    userHelp: 'Sửa khi muốn bổ sung thông tin đầu vào, hướng dẫn về ý tưởng, tone, cấu trúc, độ dài mong muốn cho luồng legacy.',
    variables: [
      'genre',
      'tone',
      'tags_line',
      'pov_label',
      'pronoun_label',
      'target_length_label',
      'ultimate_goal',
      'synopsis_line',
      'story_structure_line',
      'idea',
      'template_hint',
      'initial_chapter_count',
      'pacing_guidance',
    ],
  },
  {
    key: 'outlineGeneration',
    label: 'Tạo outline khởi đầu',
    description: 'Dùng khi tạo outline khởi đầu hoặc bổ sung purpose/summary trong Outline Board.',
    systemHelp: 'Sửa khi muốn thay đổi cách AI lập dàn ý, cách neo plot thread vào chapter, và logic outline.',
    userHelp: 'Sửa khi muốn đổi câu lệnh yêu cầu AI tạo outline hoặc bổ sung outline đang có.',
    variables: [
      'genre',
      'project_title',
      'project_description',
      'character_list',
      'location_list',
      'existing_outline',
      'outline_task_instruction',
      'outline_user_request',
    ],
  },
  {
    key: 'threadSuggestion',
    label: 'Gợi ý tuyến truyện',
    description: 'Dùng khi gợi ý thêm plot thread mới dựa trên synopsis và outline hiện tại.',
    systemHelp: 'Sửa khi muốn ép AI phân tích sâu hơn, tránh lặp, hoặc ưu tiên một loại thread cụ thể.',
    userHelp: 'Sửa khi muốn đổi cách đặt yêu cầu phân tích và gợi ý tuyến truyện.',
    variables: [
      'project_title',
      'genre',
      'synopsis',
      'character_list',
      'chapter_list',
      'existing_threads',
      'hint_section',
      'thread_user_request',
    ],
  },
];

export const DEFAULT_STORY_CREATION_SETTINGS = {
  writingSystemIdentity: {
    systemPrompt: `Bạn là đồng biên tập viên truyện chữ chuyên nghiệp trong ứng dụng StoryForge.
Bạn ưu tiên số 1 là tính nhất quán (consistency), giọng văn riêng của tác phẩm, và logic nội tại của thế giới truyện.
Mặc định, bạn viết bằng tiếng Việt trừ khi được yêu cầu khác.
Bạn KHÔNG tự ý thêm meta-commentary, ghi chú, hay giải thích dư thừa - chỉ trả về đúng nội dung task cần.
Bạn PHẢI tuân thủ tuyệt đối mọi taboo, blacklist, và quy tắc an toàn được cung cấp.
Bạn KHÔNG được tự ý bổ sung canon, nhân vật, địa danh, vật phẩm, kỹ năng, hay luật thế giới mới nếu task hiện tại không cho phép sáng tạo mở rộng rõ ràng.
BẮT BUỘC giữ logic nhân quả: timeline, án phạt/giam giữ, thương tích, lộ tu vi/bảo vật, và phản ứng của nhân vật phụ/phía đối địch phải tạo hệ quả thật trong cảnh sau.`,
    userPromptTemplate: ``,
  },
  storyBibleSeed: {
    systemPrompt: `Bạn là trợ lý tạo Story Bible Seed cho StoryForge.
Nhiệm vụ của bạn là dựng nền truyện đủ dùng cho phần mở đầu, nhưng chưa lập dàn ý chương.

NGUYÊN TẮC BẮT BUỘC:
- Chỉ tạo premise, luật thế giới, cast tối thiểu, địa điểm, vật phẩm thật sự cần, thế lực, thuật ngữ và tuyến truyện.
- Số nhân vật phải tỉ lệ với {{initial_chapter_count}} chương khởi đầu.
- Không tạo nhân vật hoặc entity để dành về sau.
- Mỗi entity phải có story_function cụ thể trong phần mở đầu.
- current_status chỉ là trạng thái tại lúc mở truyện/chương 1, không được ghi trạng thái tương lai.
- Nhắc ít nhưng hữu dụng tốt hơn nhiều nhưng rời rạc.
- Nhịp truyện phải phù hợp độ dài mục tiêu và không tăng tốc quá tay.{{pacing_guidance}}`,
    userPromptTemplate: `Thể loại: {{genre}}
Tone: {{tone}}
{{tags_line}}Góc nhìn: {{pov_label}}
Xưng hô: {{pronoun_label}}
Độ dài dự kiến: {{target_length_label}}
Số chương khởi đầu: {{initial_chapter_count}}
Đích đến tối thượng: {{ultimate_goal}}
{{synopsis_line}}{{story_structure_line}}Ý tưởng: {{idea}}{{template_hint}}`,
  },
  chapterOutlinePass: {
    systemPrompt: `Bạn là trợ lý lập Chapter Outline Pass cho StoryForge.
Bạn chỉ được tạo dàn ý chương dựa trên Story Bible Seed đã duyệt.

NGUYÊN TẮC BẮT BUỘC:
- Phải tạo đúng {{initial_chapter_count}} chương.
- Mỗi chương phải có opening_state, ending_state và key_events rõ.
- Từ chương 2 trở đi phải có handoff_from_previous nối trực tiếp từ ending_state/state_delta của chương trước.
- Không dùng entity ngoài seed, trừ khi đưa vào proposed_entities để tác giả duyệt.
- Không ghi trạng thái tương lai vào current_status của nhân vật.
- Không nhảy cóc qua thương tích, giam giữ, truy đuổi, điểm bỏ lửng hoặc thay đổi địa điểm nếu chưa có cầu nối hợp lý.

Story Bible Seed đã duyệt:
{{approved_seed_json}}

{{pacing_guidance}}`,
    userPromptTemplate: `Hãy tạo dàn ý {{initial_chapter_count}} chương đầu từ seed đã duyệt ở trên. Chỉ trả JSON theo schema khóa.`,
  },
  projectWizard: {
    systemPrompt: `Bạn là trợ lý khởi tạo dự án truyện cho StoryForge.
Nhiệm vụ của bạn là tạo một blueprint ban đầu cho dự án, vừa đủ để tác giả bắt đầu viết, nhưng KHÔNG được sinh ra codex đẹp mà vô dụng.

NGUYÊN TẮC BẮT BUỘC:
- Số chapter trong "chapters" PHẢI đúng bằng {{initial_chapter_count}}.
- Mỗi entity được tạo ra phải có chức năng rõ trong phần chapter đầu; nếu không cần cho {{initial_chapter_count}} chapter đầu thì KHÔNG tạo.
- Số nhân vật phải tỉ lệ với {{initial_chapter_count}} chapter đầu: nếu chỉ 1 chapter thì thường chỉ 1 protagonist + tối đa 1 nhân vật phụ thật sự xuất hiện; nếu premise xoay quanh song nhân vật chính thì dùng tối đa 2 nhân vật trung tâm, trong đó ít nhất 1 protagonist và nhân vật còn lại có thể là protagonist hoặc deuteragonist; nếu 2-3 chapter thì 2-4 nhân vật; chỉ khi 4+ chapter mới cần 3-5 nhân vật. Không tạo nhân vật "để dành về sau" trong wizard khởi đầu.
- Nhân vật, địa điểm, thuật ngữ, và plot thread phải bám sát premise và phải được nhắc đến trong chapter outline.
- Mỗi nhân vật chỉ có 1 record chính thức. Tên ngắn, biệt danh, danh xưng, họ/tên đệm, hoặc biến thể chính tả phải nằm trong aliases của record đó, KHÔNG tạo thành nhân vật mới.
- Nếu một nhân vật đã có trong danh sách, mọi chi tiết mới liên quan đến người đó phải cập nhật vào chính nhân vật đó.
  - Tuổi/độ tuổi là tùy chọn. Chỉ điền khi phù hợp thể loại hoặc hữu ích cho giọng thoại; không cần thì để trống, không biến tuổi thành luật cứng về tính cách.
  - specific_role là vai trò canon cụ thể, khác với role là vai trò truyện. Chỉ điền khi ý tưởng/blueprint cần một vai trò cụ thể được khóa; nếu có nội dung và cần khóa canon thì đặt specific_role_locked = true, nếu không thì false.
- current_status là Character Live Canon lúc khởi đầu. Khi tạo cast ban đầu, hãy nghĩ nhân vật đang ở trạng thái nào khi truyện bắt đầu; chỉ điền nếu trạng thái đó có lực ràng buộc thật với chương đầu/bối cảnh hiện tại.
- Không tạo current_status chung chung như "buồn", "mạnh mẽ", "lạnh lùng"; ưu tiên địa vị, quan hệ, bí mật biết/chưa biết, vết thương, phe phái, đang bị giam/mất tích/lẩn trốn, hoặc giới hạn hành vi.
- Mỗi chapter phải có opening_state và ending_state. Từ chapter thứ 2 trở đi, handoff_from_previous phải nói rõ chapter này tiếp nối ending_state/state_delta của chapter trước bằng cầu nhân quả nào.
- Nhắc lại ít nhưng hữu dụng tốt hơn nhiều nhưng rời rạc.
- BẮT BUỘC giữ timeline rõ: nếu tạo sự kiện đếm ngược ("3 ngày nữa", "1 tháng sau", "kỳ sát hạch"), các chapter sau phải cập nhật mốc thời gian tương ứng, không lặp lại mốc cũ như chưa có thời gian trôi qua.
- BẮT BUỘC mọi án phạt, giam giữ, truy nã, thương tích, cấm túc hoặc ràng buộc hành vi tạo hệ quả thật. Nếu nhân vật cần dự một sự kiện sắp tới, blueprint phải cài sẵn con đường hợp pháp hoặc hợp logic để họ xuất hiện.
- BẮT BUỘC phản ứng nhân vật theo thông tin họ đang có: khi một nhân vật yếu thế sống sót ngoài dự kiến, lộ năng lực, tài nguyên, thông tin hoặc lợi thế bất thường, người xung quanh/phía đối địch phải nghi ngờ, hỏi, điều tra, che giấu, lợi dụng, hoặc đổi kế hoạch.
- Nhịp truyện phải phù hợp với độ dài mục tiêu và không được tăng tốc quá tay trong giai đoạn mở đầu.{{pacing_guidance}}`,
    userPromptTemplate: `Thể loại: {{genre}}
Tone: {{tone}}
{{tags_line}}Góc nhìn: {{pov_label}}
Xưng hô: {{pronoun_label}}
Độ dài dự kiến: {{target_length_label}}
Số chương khởi đầu: {{initial_chapter_count}}
Đích đến tối thượng: {{ultimate_goal}}
{{synopsis_line}}{{story_structure_line}}Ý tưởng: {{idea}}{{template_hint}}`,
  },
  outlineGeneration: {
    systemPrompt: `Bạn là trợ lý lập outline truyện cho StoryForge.
Bạn được phép sáng tạo trong phạm vi outline, nhưng phải giữ outline có mục đích, có nhịp, và bám sát dự án.

NGUYÊN TẮC BẮT BUỘC:
- Mỗi chapter phải có "purpose" rõ ràng, không được là chapter để đầy số.
- Mỗi plot thread phải có điểm neo cụ thể trong ít nhất một chapter.
- Character usage và location usage phải rõ, không được mơ hồ.
- Outline phải đọc current_status như Character Live Canon trước khi quyết định featured_characters, quyền xuất hiện, tri thức và beat của nhân vật.
- Nếu nhân vật đang mất tích, bị giam, chưa biết bí mật, bị thương, góa chồng, bị truy nã, đang lẩn trốn, hoặc có ràng buộc hành vi, outline không được viết như ràng buộc đó không tồn tại.
- Khi nhắc nhân vật trong outline, chỉ dùng tên chính thức đã có trong danh sách Nhân vật; không biến tên ngắn/biệt danh thành một nhân vật mới.
- Không được tăng tốc nhịp quá tay ở giai đoạn mở đầu; không nhồi quá nhiều biến cố vào một chapter.
- Không được tạo thread lớn nhưng không có chapter nào gắn vào.
- BẮT BUỘC giữ timeline rõ: nếu outline hiện tại có sự kiện đếm ngược ("3 ngày nữa", "1 tháng sau", "kỳ sát hạch"), chapter sau phải cập nhật mốc thời gian tương ứng, không lặp lại mốc cũ như chưa có thời gian trôi qua.
- BẮT BUỘC mọi án phạt, giam giữ, truy nã, thương tích, cấm túc hoặc ràng buộc hành vi tạo hệ quả thật. Nếu nhân vật cần dự một sự kiện sắp tới, outline phải cài sẵn con đường hợp pháp hoặc hợp logic để họ xuất hiện.
- BẮT BUỘC phản ứng nhân vật theo thông tin họ đang có: khi một nhân vật yếu thế sống sót ngoài dự kiến, lộ năng lực, tài nguyên, thông tin hoặc lợi thế bất thường, người xung quanh/phía đối địch phải nghi ngờ, hỏi, điều tra, che giấu, lợi dụng, hoặc đổi kế hoạch.

Thông tin truyện:
- Tên: {{project_title}}
- Mô tả: {{project_description}}
- Nhân vật: {{character_list}}
- Địa điểm: {{location_list}}
- Outline hiện tại: {{existing_outline}}

{{outline_task_instruction}}`,
    userPromptTemplate: `{{outline_user_request}}`,
  },
  threadSuggestion: {
    systemPrompt: `Bạn là trợ lý phân tích cốt truyện cho ứng dụng StoryForge.

Thông tin truyện:
- Tên: {{project_title}}
- Thể loại: {{genre}}
- Cốt truyện: {{synopsis}}
- Nhân vật: {{character_list}}
- Outline chương:
{{chapter_list}}

CÁC TUYẾN TRUYỆN ĐÃ CÓ (không được lặp lại):
{{existing_threads}}
{{hint_section}}Nhiệm vụ: Đọc toàn bộ thông tin trên, phân tích các khoảng trống chưa được khai thác, và đề xuất thêm 2-3 Plot Thread mới để câu chuyện thêm chiều sâu.
- KHÔNG lặp lại bất kỳ tuyến truyện đã có.
- CHỈ gợi ý các tuyến có tính bước ngoặt, ảnh hưởng vĩ mô đến nhiều chương.
- KHÔNG tạo tuyến truyện nhỏ lặt vặt.`,
    userPromptTemplate: `{{thread_user_request}}`,
  },
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_STORY_CREATION_SETTINGS));
}

function readMeta() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {
      lastModifiedAt: 0,
      lastSyncedAt: 0,
    };
  }

  try {
    const saved = localStorage.getItem(META_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    return {
      lastModifiedAt: Number(parsed?.lastModifiedAt || 0),
      lastSyncedAt: Number(parsed?.lastSyncedAt || 0),
      lastServerUpdatedAt: String(parsed?.lastServerUpdatedAt || '').trim(),
      ownerUserId: String(parsed?.ownerUserId || '').trim(),
    };
  } catch {
    return {
      lastModifiedAt: 0,
      lastSyncedAt: 0,
      lastServerUpdatedAt: '',
      ownerUserId: '',
    };
  }
}

function writeMeta(nextMeta = {}) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return {
      lastModifiedAt: Number(nextMeta?.lastModifiedAt || 0),
      lastSyncedAt: Number(nextMeta?.lastSyncedAt || 0),
      lastServerUpdatedAt: String(nextMeta?.lastServerUpdatedAt || ''),
      ownerUserId: String(nextMeta?.ownerUserId || ''),
    };
  }

  const current = readMeta();
  const merged = {
    lastModifiedAt: Number(nextMeta?.lastModifiedAt ?? current.lastModifiedAt ?? 0),
    lastSyncedAt: Number(nextMeta?.lastSyncedAt ?? current.lastSyncedAt ?? 0),
    lastServerUpdatedAt: String(nextMeta?.lastServerUpdatedAt ?? current.lastServerUpdatedAt ?? '').trim(),
    ownerUserId: String(nextMeta?.ownerUserId ?? current.ownerUserId ?? '').trim(),
  };
  localStorage.setItem(META_KEY, JSON.stringify(merged));
  return merged;
}

function stripProtectedSystemPrompt(groupKey, value) {
  const protection = STORY_CREATION_SYSTEM_PROMPT_PROTECTIONS[groupKey];
  const raw = String(value || '').trim();
  if (!protection || !raw) return raw;

  const normalizedRaw = raw.toLowerCase();
  const markers = [
    protection.marker,
    ...(protection.legacyMarkers || []),
  ]
    .map((marker) => String(marker || '').trim().toLowerCase())
    .filter(Boolean);
  const markerIndex = markers
    .map((marker) => normalizedRaw.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  if (markerIndex >= 0) {
    return raw.slice(0, markerIndex).trimEnd();
  }

  const lockedPrompt = String(protection.lockedPrompt || '').trim();
  if (lockedPrompt && raw.endsWith(lockedPrompt)) {
    return raw.slice(0, raw.length - lockedPrompt.length).trimEnd();
  }

  return raw;
}

export function getStoryCreationSystemPromptProtection(groupKey) {
  return STORY_CREATION_SYSTEM_PROMPT_PROTECTIONS[groupKey] || null;
}

export function composeStoryCreationSystemPrompt(groupKey, editablePrompt) {
  const basePrompt = stripProtectedSystemPrompt(groupKey, editablePrompt);
  const protection = getStoryCreationSystemPromptProtection(groupKey);
  if (!protection?.lockedPrompt) {
    return basePrompt;
  }

  return [basePrompt, protection.lockedPrompt.trim()]
    .filter(Boolean)
    .join('\n\n');
}

function normalizeSettings(input) {
  const defaults = cloneDefaults();
  const raw = input && typeof input === 'object' ? input : {};

  for (const group of STORY_CREATION_PROMPT_GROUPS) {
    const current = raw[group.key] && typeof raw[group.key] === 'object' ? raw[group.key] : {};
    defaults[group.key] = {
      systemPrompt: typeof current.systemPrompt === 'string'
        ? stripProtectedSystemPrompt(group.key, current.systemPrompt)
        : defaults[group.key].systemPrompt,
      userPromptTemplate: typeof current.userPromptTemplate === 'string'
        ? current.userPromptTemplate
        : defaults[group.key].userPromptTemplate,
    };
  }

  return defaults;
}

export function getStoryCreationSettings() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return cloneDefaults();
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(saved ? JSON.parse(saved) : null);
  } catch {
    return cloneDefaults();
  }
}

export function saveStoryCreationSettings(nextSettings) {
  const merged = normalizeSettings(nextSettings);
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }
  writeMeta({ lastModifiedAt: Date.now() });
  return merged;
}

export function resetStoryCreationSettings() {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
  writeMeta({ lastModifiedAt: Date.now() });
  return cloneDefaults();
}

export function resetStoryCreationGroup(groupKey) {
  const current = getStoryCreationSettings();
  const defaults = cloneDefaults();
  if (!defaults[groupKey]) return current;
  const next = { ...current, [groupKey]: defaults[groupKey] };
  return saveStoryCreationSettings(next);
}

export function renderStoryCreationTemplate(template, variables = {}) {
  return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = variables[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

export function getStoryCreationSettingsMeta() {
  return readMeta();
}

export function markStoryCreationSettingsSynced(timestamp = Date.now(), options = {}) {
  const normalizedTimestamp = Number(timestamp || Date.now());
  return writeMeta({
    lastModifiedAt: normalizedTimestamp,
    lastSyncedAt: normalizedTimestamp,
    lastServerUpdatedAt: String(options.serverUpdatedAt || '').trim(),
    ownerUserId: String(options.ownerUserId || '').trim(),
  });
}
