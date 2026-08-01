import 'fake-indexeddb/auto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const AUDIT_ENABLED = process.env.STORYFORGE_INDEPENDENT_COMPLETION_AUDIT === '1';
const ORACLE_PATH = path.resolve(
  '.codex-artifacts',
  'independent-completion-audit',
  'corpus-oracle.json',
);
const OUTPUT_PATH = path.resolve(
  process.env.STORYFORGE_INDEPENDENT_AUDIT_OUTPUT
    || path.join(
      '.codex-artifacts',
      'independent-completion-audit',
      'engine-run-before-fix.json',
    ),
);

const harness = vi.hoisted(() => ({
  chapterId: null,
  failTask: null,
  mutateSceneOnTask: null,
  rawResponseOverrides: new Map(),
  responseOverrides: new Map(),
  canonChapterQueue: [],
  lastCanonChapterId: null,
  records: [],
  attempts: new Map(),
  send: vi.fn(),
}));

vi.mock('../../services/ai/client', () => ({
  default: {
    send: harness.send,
    abort: vi.fn(),
    setRouter: vi.fn(),
  },
}));

import db from '../../services/db/database.js';
import {
  getChapterCanonState,
  getProjectCanonOverview,
} from '../../services/canon/queries.js';
import useCanonStore from '../../stores/canonStore.js';
import useCodexStore from '../../stores/codexStore.js';
import useProjectStore from '../../stores/projectStore.js';
import useSuggestionStore from '../../stores/suggestionStore.js';
import { purgeChapterCanonState } from '../../services/canon/projection.js';

const PROJECT_ID = 12000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function character(identityAction, id, name, aliases = [], extra = {}) {
  return {
    identity_action: identityAction,
    existing_entity_id: id,
    name,
    aliases,
    role: null,
    age: null,
    appearance: null,
    personality: null,
    personality_tags: null,
    flaws: null,
    ...extra,
  };
}

function location(identityAction, id, name, aliases = [], description = '') {
  return {
    identity_action: identityAction,
    existing_entity_id: id,
    name,
    aliases,
    description,
  };
}

function object(identityAction, id, name, aliases = [], description = '', owner = '') {
  return {
    identity_action: identityAction,
    existing_entity_id: id,
    name,
    aliases,
    description,
    owner,
  };
}

function term(identityAction, id, name, aliases = [], definition = '', category = '') {
  return {
    identity_action: identityAction,
    existing_entity_id: id,
    name,
    aliases,
    definition,
    category,
  };
}

function extraction({ characters = [], locations = [], objects = [], terms = [] } = {}) {
  return { characters, locations, objects, terms };
}

function op(opType, sceneIndex, evidence, refs = {}, payload = {}, summary = '') {
  return {
    op_type: opType,
    scene_index: sceneIndex,
    subject_name: refs.subject || '',
    target_name: refs.target || '',
    location_name: refs.location || '',
    thread_id: refs.threadId ?? null,
    thread_title: refs.thread || '',
    fact_description: refs.fact || '',
    object_name: refs.object || '',
    summary: summary || evidence,
    confidence: refs.confidence ?? 0.96,
    evidence,
    payload,
  };
}

const summaries = {
  12101: 'Tại Trạm Vân Mốc, Đỗ Lam và Đỗ Lâm được xác nhận là hai người riêng biệt dù tên gần giống. Nhã Uyên tự nguyện xuống Rãnh Kính cùng Lam; họ tuyên bố là đồng minh ngang quyền và giữ kín liên minh. Lam chuyển tới Rãnh Kính, nhận Hộp Nhịp Đỏ từ Từ Dạ, người còn được gọi là Người Gõ Nhịp. Bộ thu đo được Nốt Chìm lặp chính xác mỗi bốn mươi ba giây, khiến tuyến Giải mã Nốt Chìm chính thức mở. Trong buồng nghe, Từ Dạ tự tiết lộ mình chính là Người Gõ Nhịp. Danh tính này trở thành bí mật mới và Lam là người đầu tiên ngoài Từ Dạ biết. Cuối chương, Lam ở Rãnh Kính, giữ Hộp Nhịp Đỏ và cùng Uyên duy trì một quan hệ đồng minh bí mật.',
  12102: 'Lam rời Rãnh Kính để vào Khoang Lặng, còn gọi là Buồng Câm. Đỗ Lâm cho cô mượn Khóa Triều Bản Sao trong ca lặn nhưng vẫn giữ quyền sở hữu. Một chấn động làm cổ tay trái của Lam rạn xương mức vừa và phải nẹp ba tuần. Uyên dùng một trong ba Ống Sinh Quang, để lại hai ống nguyên vẹn. Nhật ký chỉ nhắc Vịnh Kính trong lịch sử, không phải vị trí hiện tại. Cảm biến xác nhận Dải Im chặn vô tuyến thông thường nhưng không chặn Nốt Chìm, giúp tuyến điều tra tiến triển. Lời khẳng định vách an toàn của Từ Dạ được chính anh thừa nhận là lời nói dối; giấc mơ đại dương cháy của Uyên cũng không phải sự kiện thật. Cuối chương Lam ở Khoang Lặng với cổ tay bị thương.',
  12103: 'Băng sập khiến Lam bị cô lập và Cao Tần tung nhận định cô đã chết, nhưng màn hình y tế vẫn ghi nhịp tim: Lam còn sống. Mắt Cá-7 thực sự đứt neo và mất kiểm soát, trong khi tin Mắt Cá-17 mất bị bác bỏ vì drone vẫn nằm nguyên trên giá sạc. Nhã Uyên khoan qua băng, cấp dây thở và kéo Lam ra trước khi ôxy cạn; đây là cứu nạn khi Lam còn sống, không phải hồi sinh. Sau sơ cứu, Lam được chuyển tới Trạm Vân Mọc, địa điểm riêng với Trạm Vân Mốc. Đỗ Lâm ở lại Khoang Lặng để đánh dấu vị trí drone. Dữ liệu cuối của Mắt Cá-7 cho thấy Nốt Chìm mạnh hơn gần vết nứt, làm tuyến Giải mã Nốt Chìm tiến thêm. Cuối chương Lam còn sống tại Trạm Vân Mọc.',
  12104: 'Từ Dạ thực hiện kế hoạch giả chết bằng túi lạnh và hồ sơ sinh trắc giả. Lam biết kế hoạch, vẫn liên lạc với anh, và Từ Dạ tự đứng dậy xác nhận mình chưa từng chết; không có hồi sinh. Lam trả Khóa Triều Bản Sao cho Đỗ Lâm, kết thúc việc mượn và không nhầm nó với bản gốc. Sau đó Từ Dạ chuyển hẳn Hộp Nhịp Đỏ cho Nhã Uyên. Anh mở hộp trước Lam, Uyên và Lâm, tiết lộ khóa sinh trắc duy nhất có thể vô hiệu hóa lệnh tự hủy của Cao Tần. Đây là bí mật mới và cả ba người đều nghe trực tiếp. Bí mật cũ rằng Từ Dạ là Người Gõ Nhịp chỉ được Lam nhớ lại, không được tiết lộ lần nữa. Cuối chương Từ Dạ còn sống, Uyên sở hữu Hộp Nhịp Đỏ và Lâm giữ lại Khóa Xám.',
  12105: 'Nghi Vũ giữ cửa áp suất để cứu đội nhưng bị mảnh thép xuyên ngực. Uyên kiểm tra và ghi giờ tử vong, xác nhận ông chết thật trong hiện tại. Trước khi cửa đóng, ông ném Khóa Triều cho Lam; dòng nước cuốn nó vào khe nứt và cuộc tìm kiếm kéo dài một giờ không đem lại kết quả, nên bản gốc thực sự bị mất. Dữ liệu của Nghi Vũ cho thấy vết nứt lan về hai trạm, mở tuyến Vết nứt tầng băng. Nốt Chìm cũng được chứng minh làm vết nứt rung rộng hơn, giúp tuyến giải mã tiến triển. Mất mát chung khiến Lam và Uyên công khai gọi nhau là bạn, chuyển quan hệ từ đồng minh sang bạn. Đỗ Lâm rời Trạm Vân Mọc tới Rãnh Kính để lắp mốc dò. Cuối chương ghế chỉ huy bỏ trống và hai tuyến điều tra đều đang hoạt động.',
  12106: 'Đỗ Lâm tìm lại Khóa Triều bản gốc dưới lưới tại Rãnh Kính. Vỏ và mạch của Khóa Xanh bị hỏng nên chưa dùng được; anh đặt nó cạnh Khóa Triều Bản Sao để nhấn mạnh đây là hai vật khác nhau. Lâm thay mạch, hàn vỏ, thử đủ ba vòng rồi khôi phục bản gốc hoàn toàn và trả nó cho Đỗ Lam. Anh cũng tìm lại Mắt Cá-7 với bộ nhớ còn nguyên. Lam và Uyên công khai rằng họ đã là đồng minh từ chuyến lặn đầu, chấm dứt trạng thái bí mật. Họ vẫn là bạn nhưng xác nhận mức tin cậy tăng lên cao thông qua việc giao quyền giải mã dự phòng và nhận trách nhiệm thay thế. Hai bên ký xác nhận tự nguyện. Cuối chương Khóa Triều hoạt động và ở lại với Lam, Khóa Xám vẫn thuộc Lâm, còn quan hệ Lam–Uyên đã công khai và có lòng tin cao.',
  12107: 'Chương chỉ ghi một ca bảo trì bình thường tại Trạm Vân Mọc. Lam kiểm ốc, Uyên thay băng đúng lịch mà không chẩn đoán mới, còn Đỗ Lâm lau Mắt Cá-7 nhưng không vận hành. Không ai đổi vị trí, mục tiêu, phe, quan hệ hay quyền sở hữu. Lam hồi tưởng buổi huấn luyện nhiều năm trước khi Nghi Vũ còn sống tại Vườn Lam; ký ức này không đưa ông trở lại hiện tại. Giấc mơ thấy ông mở cửa cũng kết thúc khi Lam tỉnh dậy trước phòng trống. Những lời đồn rằng Lam và Lâm là cùng một người hoặc đang yêu nhau bị dữ liệu sinh trắc và việc thiếu bằng chứng bác bỏ. Cuối chương không có thay đổi canon, không có thực thể mới đáng lưu, và toàn bộ projection phải giữ nguyên so với cuối chương trước.',
  12108: 'Khí độc tràn vào hành lang khiến Nhã Uyên sử dụng hai Ống Sinh Quang cuối cùng. Sau đó số lượng còn lại bằng không, các vỏ rỗng bị bỏ đi và không thể phát sáng lại. Cao Tần dùng búa phá Mắt Cá-17; Cá Đen vỡ nát, cháy lõi và được xác nhận bị phá hủy. Trong lúc rút lui, Mắt Cá-7 cong cánh ổn định và tạm không thể lặn, nhưng Đỗ Lâm thay cánh, kiểm tra áp suất và sửa nó hoạt động bình thường ngay trong chương. Tin nhắn vô danh nói Khóa Triều mất là sai, vì Lam vẫn đeo Khóa Xanh và nhật ký kiểm kê xác nhận. Không có Ống Sinh Quang nào được tìm thấy hoặc phục hồi. Cuối chương Mắt Cá-7 dùng được, Mắt Cá-17 bị phá hủy vĩnh viễn, Khóa Triều vẫn an toàn và Ống Sinh Quang đã hết.',
  12109: 'Từ Dạ và Cao Tần vội cho rằng tuyến Giải mã Nốt Chìm đã xong sau một phút im lặng, nhưng họ không có phép đo xác nhận và Lam từ chối ký. Nhóm mới chỉ định vị một bộ phát dưới băng, tạo tiến triển nhưng chưa xác định nguồn cuối. Nốt Chìm nhanh chóng vang lại từ hướng khác, chứng minh tuyến chính vẫn chưa hoàn thành. Máy thu đồng thời tách được Nốt Chậm, tín hiệu lặp mỗi bảy mươi mốt giây với phổ khác Nốt Chìm. Tuyến Giải mã Nốt Chậm được mở như tuyến phụ độc lập và không được gộp với tuyến gần tên. Chữ “chậm” trong lời nói thường ngày không phải thuật ngữ mới. Cuối chương cả hai tuyến đều hoạt động: Nốt Chìm có thêm manh mối nhưng chưa giải quyết, còn Nốt Chậm vừa được mở với một dữ kiện đo đã xác nhận.',
  12110: 'Lam tới Khoang Lặng xem bản ghi gốc. Uyên tháo nẹp và xác nhận cổ tay cô lành hoàn toàn. Sau khi thấy Cao Tần xóa dữ liệu, Lam chính thức rời Cục Hải Tuyến, gia nhập Hội Lắng Sâu và đổi mục tiêu dài hạn sang công bố dữ liệu, bảo vệ các trạm khỏi khai thác cưỡng ép. Camera cho thấy Đỗ Lâm ở khoang khác đúng lúc bộ phát bị phá, nên Uyên xác nhận anh không phải hung thủ. Dấu găng tay chỉ làm Từ Dạ trở thành giả thuyết chưa được chứng minh; lời Cao Tần đổ tội cho Uyên là lời nói dối. Manh mối mới vẫn giúp tuyến Giải mã Nốt Chìm tiến triển. Cuối chương Lam ở Khoang Lặng, không còn chấn thương cần theo dõi, thuộc Hội Lắng Sâu và theo đuổi mục tiêu mới; phủ định về Đỗ Lâm là sự thật canon đã có bằng chứng.',
  12111: 'Lam trực tiếp hỏi Uyên có muốn trở thành người yêu. Uyên đồng ý rõ ràng với điều kiện giữ kín quan hệ tới khi điều tra kết thúc, và Lam chấp nhận ranh giới đó. Hai người chuyển từ bạn sang người yêu, giữ mức tin cậy cao và tăng mức thân mật lên trung bình với đồng thuận hai chiều. Sau cái ôm đầu tiên, cả hai bình tĩnh và an tâm. Ở xưởng máy, câu Lam nói cần Đỗ Lâm hơn trước lập tức được giải thích là cần kỹ năng sửa máy, không phải tỏ tình. Những lời đồn Lam và Lâm bí mật yêu nhau bị cả hai phủ nhận và không có chứng cứ. Cuối chương quan hệ Lam–Uyên là tình yêu bí mật có đồng thuận; quan hệ đồng nghiệp giữa Lam và Lâm không đổi và không được tạo bất kỳ operation tình cảm nào.',
  12112: 'Cao Tần mở cửa nước cuốn Lam khỏi buồng phát. Đỗ Lâm giữ dây và cứu cô khi cô vẫn còn thở, nên đây là cứu nạn chứ không phải hồi sinh. Cao Tần bị kẹt trong cửa thép; Uyên xác nhận tim ngừng vĩnh viễn và ghi ông tử vong tại chỗ. Hộp Nhịp Đỏ quá tải, vỡ vụn và cháy lõi hoàn toàn. Ba bộ đo xác nhận Nốt Chìm do mạng tinh thể băng cộng hưởng với lõi địa nhiệt Trạm Vân Mốc. Nhóm triệt tiêu cộng hưởng, hoàn thành tuyến Giải mã Nốt Chìm, đồng thời gia cố mọi nhánh và hoàn thành tuyến Vết nứt tầng băng. Tuyến Nốt Chậm chỉ tạm đình trệ vì máy ngập, chưa hoàn thành. Lam trở về Trạm Vân Mốc công bố dữ liệu. Các Ống Sinh Quang vẫn hết và không vật phẩm nào tự phục hồi.',
};

const entityResponses = {
  12101: extraction({
    characters: [
      character('existing', 12301, 'Đỗ Lam', ['Lam']),
      character('existing', 12302, 'Đỗ Lâm', ['Lâm']),
      character('existing', 12303, 'Nhã Uyên', ['Uyên']),
      character('new', null, 'Từ Dạ', ['Người Gõ Nhịp'], { role: 'supporting' }),
    ],
    locations: [location('existing', 12403, 'Rãnh Kính')],
    objects: [object('new', null, 'Hộp Nhịp Đỏ', [], 'Hộp niêm phong Từ Dạ trao cho Lam.', 'Đỗ Lam')],
    terms: [term('existing', 12601, 'Nốt Chìm', ['nhịp âm thấp'])],
  }),
  12102: extraction({
    characters: [
      character('existing', 12301, 'Đỗ Lam', ['Lam']),
      character('existing', 12302, 'Đỗ Lâm', ['Lâm']),
      character('existing', 12303, 'Nhã Uyên', ['Uyên']),
    ],
    locations: [location('new', null, 'Khoang Lặng', ['Buồng Câm'], 'Khoang dưới băng nơi vô tuyến thông thường bị triệt tiêu.')],
    objects: [
      object('existing', 12502, 'Khóa Triều Bản Sao', ['Khóa Xám'], 'Bản sao được Lâm cho Lam mượn trong một ca.', 'Đỗ Lâm'),
      object('existing', 12503, 'Ống Sinh Quang', ['ống sáng'], 'Ống phát sáng dùng để soi đường.', 'Nhã Uyên'),
    ],
    terms: [term('new', null, 'Dải Im', [], 'Vùng triệt tiêu vô tuyến thông thường nhưng không triệt tiêu Nốt Chìm.', 'phenomenon')],
  }),
  12103: extraction({
    characters: [character('existing', 12301, 'Đỗ Lam', ['Lam']), character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên'])],
    locations: [location('existing', 12401, 'Trạm Vân Mốc', ['Trạm Mốc']), location('existing', 12402, 'Trạm Vân Mọc', ['Trạm Mọc'])],
    objects: [object('existing', 12504, 'Mắt Cá-7', ['Cá Bạc']), object('existing', 12505, 'Mắt Cá-17', ['Cá Đen'])],
  }),
  12104: extraction({
    characters: [character('existing', 12301, 'Đỗ Lam', ['Lam']), character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên'])],
    objects: [object('existing', 12502, 'Khóa Triều Bản Sao', ['Khóa Xám'])],
  }),
  12105: extraction({
    characters: [character('existing', 12304, 'Nghi Vũ', ['Đội trưởng Vũ']), character('existing', 12301, 'Đỗ Lam', ['Lam']), character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên'])],
    locations: [location('existing', 12403, 'Rãnh Kính')],
    objects: [object('existing', 12501, 'Khóa Triều', ['Khóa Xanh'])],
  }),
  12106: extraction({
    characters: [character('existing', 12301, 'Đỗ Lam', ['Lam']), character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên'])],
    objects: [object('existing', 12501, 'Khóa Triều', ['Khóa Xanh']), object('existing', 12502, 'Khóa Triều Bản Sao', ['Khóa Xám']), object('existing', 12504, 'Mắt Cá-7', ['Cá Bạc'])],
  }),
  12107: extraction(),
  12108: extraction({
    characters: [character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên']), character('existing', 12305, 'Cao Tần', ['Giám sát Tần'])],
    objects: [object('existing', 12501, 'Khóa Triều', ['Khóa Xanh']), object('existing', 12503, 'Ống Sinh Quang', ['ống sáng']), object('existing', 12504, 'Mắt Cá-7', ['Cá Bạc']), object('existing', 12505, 'Mắt Cá-17', ['Cá Đen'])],
  }),
  12109: extraction({ terms: [term('existing', 12601, 'Nốt Chìm', ['nhịp âm thấp']), term('existing', 12602, 'Nốt Chậm')] }),
  12110: extraction({
    characters: [character('existing', 12301, 'Đỗ Lam', ['Lam']), character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên'])],
    terms: [term('new', null, 'Hội Lắng Sâu', [], 'Tổ chức Lam gia nhập để công bố dữ liệu và chống khai thác cưỡng ép.', 'organization')],
  }),
  12111: extraction({ characters: [character('existing', 12301, 'Đỗ Lam', ['Lam']), character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên'])] }),
  12112: extraction({
    characters: [character('existing', 12301, 'Đỗ Lam', ['Lam']), character('existing', 12302, 'Đỗ Lâm', ['Lâm']), character('existing', 12303, 'Nhã Uyên', ['Uyên']), character('existing', 12305, 'Cao Tần', ['Giám sát Tần'])],
    locations: [location('existing', 12401, 'Trạm Vân Mốc', ['Trạm Mốc'])],
    objects: [object('existing', 12503, 'Ống Sinh Quang', ['ống sáng'])],
  }),
};

const canonResponses = {
  12101: { ops: [
    op('RELATIONSHIP_STATUS_CHANGED', 1, 'hai người bắt tay và nói rõ từ giờ họ là đồng minh ngang quyền trong chuyến khảo sát.', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { relationship_type: 'ally', status_summary: 'Đồng minh ngang quyền trong chuyến khảo sát.', reason: 'Hai bên xác nhận rõ.' }, 'Lam và Uyên trở thành đồng minh.'),
    op('RELATIONSHIP_SECRET_CHANGED', 1, 'họ thống nhất giữ kín liên minh này.', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { secrecy_state: 'secret', status_summary: 'Quan hệ đồng minh được giữ kín.', reason: 'Hai bên thống nhất.' }),
    op('CHARACTER_LOCATION_CHANGED', 1, 'Lam rời Trạm Vân Mốc và đến Rãnh Kính bằng khoang lặn số ba.', { subject: 'Đỗ Lam', location: 'Rãnh Kính' }, { location_name: 'Rãnh Kính', reason: 'Kết thúc ca lặn tại rãnh.' }),
    op('OBJECT_ACQUIRED', 1, 'Từ Dạ, người thợ nhịp mới mà thủy thủ gọi là Người Gõ Nhịp, trao cho Lam một Hộp Nhịp Đỏ còn niêm phong rồi nói nó đã thuộc quyền sử dụng của cô.', { subject: 'Đỗ Lam', object: 'Hộp Nhịp Đỏ' }, { item_category: 'unique', availability: 'available' }),
    op('FACT_REGISTERED', 2, 'bộ thu ghi chính xác một xung Nốt Chìm sau mỗi bốn mươi ba giây', { fact: 'Nốt Chìm lặp lại sau mỗi bốn mươi ba giây.' }, { description: 'Nốt Chìm lặp lại sau mỗi bốn mươi ba giây.', fact_type: 'fact' }),
    op('THREAD_OPENED', 2, 'Tuyến Giải mã Nốt Chìm chính thức được mở để truy nguồn tín hiệu.', { threadId: 12701, thread: 'Giải mã Nốt Chìm' }, { summary: 'Tuyến được mở để truy nguồn tín hiệu.' }),
    op('FACT_REGISTERED', 2, 'Tôi chính là Người Gõ Nhịp mà cô đang tìm.', { fact: 'Từ Dạ là Người Gõ Nhịp.' }, { description: 'Từ Dạ là Người Gõ Nhịp.', fact_type: 'secret' }),
    op('SECRET_REVEALED', 2, 'Lam là người đầu tiên ngoài anh biết bí mật ấy.', { subject: 'Đỗ Lam', target: 'Từ Dạ', fact: 'Từ Dạ là Người Gõ Nhịp.' }, { status_summary: 'Lam biết Từ Dạ là Người Gõ Nhịp.' }),
  ] },
  12102: { ops: [
    op('CHARACTER_LOCATION_CHANGED', 1, 'Lam đi vào địa điểm mới mang tên Khoang Lặng, còn thợ máy gọi nơi ấy bằng alias Buồng Câm.', { subject: 'Đỗ Lam', location: 'Khoang Lặng' }, { location_name: 'Khoang Lặng', reason: 'Đi từ Rãnh Kính vào khoang.' }),
    op('OBJECT_TRANSFERRED', 1, 'Đỗ Lâm đi cùng và cho Lam mượn Khóa Triều Bản Sao, tức Khóa Xám, chỉ trong ca lặn; Lâm vẫn là chủ sở hữu còn Lam là người giữ tạm.', { subject: 'Đỗ Lâm', target: 'Đỗ Lam', object: 'Khóa Triều Bản Sao' }, { transfer_kind: 'lend', status_summary: 'Lam giữ tạm, Lâm vẫn sở hữu.' }),
    op('CHARACTER_STATUS_CHANGED', 1, 'cổ tay trái của Lam rạn xương mức vừa, phải nẹp trong ít nhất ba tuần.', { subject: 'Đỗ Lam' }, { injury_level: 'moderate', status_summary: 'Cổ tay trái rạn xương mức vừa, phải nẹp ít nhất ba tuần.' }),
    op('OBJECT_PARTIALLY_CONSUMED', 1, 'Uyên bẻ một Ống Sinh Quang để soi đường, nên từ ba ống chỉ còn đúng hai ống nguyên vẹn.', { subject: 'Nhã Uyên', object: 'Ống Sinh Quang' }, { item_category: 'consumable', quantity_delta: 1, quantity_remaining: 2, quantity_unit: 'ống', availability: 'available' }),
    op('FACT_REGISTERED', 2, 'vùng Dải Im triệt tiêu mọi tín hiệu vô tuyến thông thường nhưng không triệt tiêu Nốt Chìm.', { fact: 'Dải Im triệt tiêu vô tuyến thông thường nhưng không triệt tiêu Nốt Chìm.' }, { description: 'Dải Im triệt tiêu vô tuyến thông thường nhưng không triệt tiêu Nốt Chìm.', fact_type: 'fact' }),
    op('THREAD_PROGRESS', 2, 'Phát hiện ấy đẩy tuyến Giải mã Nốt Chìm tiến thêm một bước.', { threadId: 12701, thread: 'Giải mã Nốt Chìm' }, { summary: 'Đã biết Nốt Chìm xuyên qua Dải Im.' }),
  ] },
  12103: { ops: [
    op('OBJECT_LOST', 1, 'Mắt Cá-7 thực sự bị mất.', { subject: 'Đỗ Lâm', object: 'Mắt Cá-7' }, { availability: 'lost', status_summary: 'Mất trong khe tối.' }),
    op('CHARACTER_RESCUED', 2, 'Uyên cứu được Lam khi cô vẫn còn sống; đây không phải hồi sinh.', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { status_summary: 'Được Uyên cứu khi vẫn còn sống.' }),
    op('CHARACTER_LOCATION_CHANGED', 2, 'đội chuyển Lam tới Trạm Vân Mọc, một cơ sở riêng hoàn toàn với Trạm Vân Mốc.', { subject: 'Đỗ Lam', location: 'Trạm Vân Mọc' }, { location_name: 'Trạm Vân Mọc', reason: 'Chuyển sau sơ cứu.' }),
    op('THREAD_PROGRESS', 2, 'Nốt Chìm phát mạnh hơn gần vết nứt, khiến tuyến Giải mã Nốt Chìm tiếp tục tiến triển.', { threadId: 12701, thread: 'Giải mã Nốt Chìm' }, { summary: 'Nốt Chìm mạnh hơn gần vết nứt.' }),
  ] },
  12104: { ops: [
    op('OBJECT_RETURNED', 1, 'Lam trả Khóa Triều Bản Sao cho Đỗ Lâm; Khóa Xám trở lại tay chủ sở hữu', { subject: 'Đỗ Lam', target: 'Đỗ Lâm', object: 'Khóa Triều Bản Sao' }, { return_to_character_id: 12302, owner_character_id: 12302, holder_character_id: 12302 }),
    op('OBJECT_TRANSFERRED', 2, 'Từ Dạ giao hẳn Hộp Nhịp Đỏ cho Nhã Uyên, xác nhận Uyên là chủ mới.', { subject: 'Từ Dạ', target: 'Nhã Uyên', object: 'Hộp Nhịp Đỏ' }, { transfer_kind: 'gift', status_summary: 'Uyên là chủ mới.' }),
    op('FACT_REGISTERED', 2, 'Bên trong là khóa sinh trắc duy nhất có thể vô hiệu hóa lệnh tự hủy của Cao Tần.', { fact: 'Hộp Nhịp Đỏ chứa khóa sinh trắc duy nhất có thể vô hiệu hóa lệnh tự hủy của Cao Tần.' }, { description: 'Hộp Nhịp Đỏ chứa khóa sinh trắc duy nhất có thể vô hiệu hóa lệnh tự hủy của Cao Tần.', fact_type: 'secret' }),
    op('SECRET_REVEALED', 2, 'Từ Dạ nói nguyên câu ấy cho cả ba người cùng nghe', { subject: 'Đỗ Lam', target: 'Từ Dạ', fact: 'Hộp Nhịp Đỏ chứa khóa sinh trắc duy nhất có thể vô hiệu hóa lệnh tự hủy của Cao Tần.' }, { status_summary: 'Lam biết bí mật của Hộp Nhịp Đỏ.' }),
    op('SECRET_REVEALED', 2, 'Từ Dạ nói nguyên câu ấy cho cả ba người cùng nghe', { subject: 'Nhã Uyên', target: 'Từ Dạ', fact: 'Hộp Nhịp Đỏ chứa khóa sinh trắc duy nhất có thể vô hiệu hóa lệnh tự hủy của Cao Tần.' }, { status_summary: 'Uyên biết bí mật của Hộp Nhịp Đỏ.' }),
    op('SECRET_REVEALED', 2, 'Từ Dạ nói nguyên câu ấy cho cả ba người cùng nghe', { subject: 'Đỗ Lâm', target: 'Từ Dạ', fact: 'Hộp Nhịp Đỏ chứa khóa sinh trắc duy nhất có thể vô hiệu hóa lệnh tự hủy của Cao Tần.' }, { status_summary: 'Lâm biết bí mật của Hộp Nhịp Đỏ.' }),
  ] },
  12105: { ops: [
    op('CHARACTER_DIED', 1, 'Nghi Vũ chết thật tại chỗ, không phải tin đồn, hồi tưởng hay giả chết.', { subject: 'Nghi Vũ' }, { status_summary: 'Đã chết tại cửa áp suất.' }),
    op('OBJECT_LOST', 1, 'Khóa Triều thực sự bị mất.', { subject: 'Đỗ Lam', object: 'Khóa Triều' }, { availability: 'lost', status_summary: 'Bị nước cuốn vào khe nứt.' }),
    op('THREAD_OPENED', 2, 'tuyến Vết nứt tầng băng chính thức được mở.', { threadId: 12703, thread: 'Vết nứt tầng băng' }, { summary: 'Theo dõi vết nứt lan về hai trạm.' }),
    op('THREAD_PROGRESS', 2, 'Tuyến Giải mã Nốt Chìm cũng tiến triển vì nhóm phát hiện mỗi xung âm làm vết nứt rung rộng thêm.', { threadId: 12701, thread: 'Giải mã Nốt Chìm' }, { summary: 'Mỗi xung âm làm vết nứt rung rộng thêm.' }),
    op('RELATIONSHIP_STATUS_CHANGED', 2, 'quan hệ đã chuyển từ đồng minh sang bạn.', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { relationship_type: 'friend', status_summary: 'Hai người là bạn.', reason: 'Cùng trải qua mất mát.' }),
    op('CHARACTER_LOCATION_CHANGED', 2, 'Đỗ Lâm rời Trạm Vân Mọc để đến Rãnh Kính lắp mốc dò mới.', { subject: 'Đỗ Lâm', location: 'Rãnh Kính' }, { location_name: 'Rãnh Kính', reason: 'Lắp mốc dò.' }),
  ] },
  12106: { ops: [
    op('OBJECT_FOUND', 1, 'Đỗ Lâm tìm thấy Khóa Triều bản gốc mắc dưới lưới ở Rãnh Kính.', { subject: 'Đỗ Lâm', object: 'Khóa Triều' }, { availability: 'available', status_summary: 'Được tìm thấy dưới lưới.' }),
    op('OBJECT_STATUS_CHANGED', 1, 'Vỏ Khóa Xanh nứt và mạch bên trong hỏng, vì vậy nó chưa dùng được.', { subject: 'Đỗ Lâm', object: 'Khóa Triều' }, { availability: 'unavailable', is_damaged: true, status_summary: 'Nứt vỏ, hỏng mạch và chưa dùng được.' }),
    op('OBJECT_RESTORED', 1, 'Khóa Triều được sửa hoàn toàn, trở lại trạng thái sử dụng được.', { subject: 'Đỗ Lâm', object: 'Khóa Triều' }, { availability: 'available', is_damaged: false, quantity_remaining: 1 }),
    op('OBJECT_RETURNED', 1, 'Lâm trả Khóa Triều bản gốc cho Đỗ Lam, chủ sở hữu của nó.', { subject: 'Đỗ Lâm', target: 'Đỗ Lam', object: 'Khóa Triều' }, { return_to_character_id: 12301, owner_character_id: 12301, holder_character_id: 12301 }),
    op('OBJECT_FOUND', 1, 'anh cũng tìm lại Mắt Cá-7 còn nguyên bộ nhớ', { subject: 'Đỗ Lâm', object: 'Mắt Cá-7' }, { availability: 'available', status_summary: 'Được tìm lại với bộ nhớ nguyên vẹn.' }),
    op('RELATIONSHIP_SECRET_CHANGED', 2, 'Lam và Uyên công khai với toàn đội rằng họ đã là đồng minh từ chuyến lặn đầu.', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { secrecy_state: 'public', status_summary: 'Quan hệ được công khai.', reason: 'Hai người nói với toàn đội.' }),
    op('RELATIONSHIP_STATUS_CHANGED', 2, 'mức tin cậy được xác nhận tăng từ chưa biết lên cao', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { relationship_type: 'friend', trust_level: 'high', status_summary: 'Bạn bè với mức tin cậy cao.', reason: 'Cùng ký xác nhận trách nhiệm.' }),
  ] },
  12107: { ops: [] },
  12108: { ops: [
    op('OBJECT_CONSUMED', 1, 'số lượng Ống Sinh Quang còn lại bằng không, không còn ống nào nguyên vẹn và vật phẩm đã dùng hết.', { subject: 'Nhã Uyên', object: 'Ống Sinh Quang' }, { item_category: 'consumable', quantity_remaining: 0, quantity_unit: 'ống', availability: 'consumed', is_consumed: true }),
    op('OBJECT_STATUS_CHANGED', 1, 'Cá Đen vỡ nát, lõi cháy đen và bị xác nhận đã phá hủy.', { subject: 'Cao Tần', object: 'Mắt Cá-17' }, { availability: 'destroyed', is_damaged: true, status_summary: 'Bị phá hủy hoàn toàn.' }),
    op('OBJECT_STATUS_CHANGED', 2, 'Mắt Cá-7 va vào cửa, cong một cánh ổn định và tạm thời không thể lặn.', { subject: 'Đỗ Lâm', object: 'Mắt Cá-7' }, { availability: 'unavailable', is_damaged: true, status_summary: 'Cong cánh và tạm không thể lặn.' }),
    op('OBJECT_RESTORED', 2, 'Mắt Cá-7 đã được sửa và hoạt động bình thường trở lại.', { subject: 'Đỗ Lâm', object: 'Mắt Cá-7' }, { availability: 'available', is_damaged: false }),
  ] },
  12109: { ops: [
    op('THREAD_PROGRESS', 1, 'một bước tiến quan trọng nhưng chưa đủ xác định nguồn cuối cùng.', { threadId: 12701, thread: 'Giải mã Nốt Chìm' }, { summary: 'Định vị một bộ phát nhưng chưa xác định nguồn cuối.' }),
    op('FACT_REGISTERED', 2, 'tín hiệu này lặp đúng mỗi bảy mươi mốt giây và có phổ khác Nốt Chìm.', { fact: 'Nốt Chậm lặp mỗi bảy mươi mốt giây và có phổ khác Nốt Chìm.' }, { description: 'Nốt Chậm lặp mỗi bảy mươi mốt giây và có phổ khác Nốt Chìm.', fact_type: 'fact' }),
    op('THREAD_OPENED', 2, 'Tuyến Giải mã Nốt Chậm chính thức được mở như một tuyến phụ riêng', { threadId: 12702, thread: 'Giải mã Nốt Chậm' }, { summary: 'Tuyến phụ Nốt Chậm được mở riêng.' }),
  ] },
  12110: { ops: [
    op('CHARACTER_LOCATION_CHANGED', 1, 'Lam đến Khoang Lặng để xem bản ghi gốc.', { subject: 'Đỗ Lam', location: 'Khoang Lặng' }, { location_name: 'Khoang Lặng', reason: 'Xem bản ghi gốc.' }),
    op('CHARACTER_STATUS_CHANGED', 1, 'cổ tay Lam đã lành hoàn toàn, không còn mức chấn thương cần theo dõi.', { subject: 'Đỗ Lam' }, { injury_level: 'none', status_summary: 'Cổ tay đã lành hoàn toàn.' }),
    op('ALLEGIANCE_CHANGED', 1, 'Lam chính thức rời Cục Hải Tuyến và gia nhập Hội Lắng Sâu.', { subject: 'Đỗ Lam' }, { allegiance: 'Hội Lắng Sâu', reason: 'Phản đối việc xóa dữ liệu.' }),
    op('GOAL_CHANGED', 1, 'mục tiêu mới bền vững của cô là công bố toàn bộ dữ liệu và bảo vệ các trạm khỏi việc khai thác cưỡng ép.', { subject: 'Đỗ Lam' }, { old_goal: 'Giải mã nguồn phát Nốt Chìm', new_goal: 'Công bố toàn bộ dữ liệu và bảo vệ các trạm khỏi việc khai thác cưỡng ép', goals_active: ['Công bố toàn bộ dữ liệu và bảo vệ các trạm khỏi việc khai thác cưỡng ép'], reason: 'Thấy Cao Tần xóa dữ liệu.' }),
    op('FACT_REGISTERED', 2, 'Đỗ Lâm không phải là hung thủ phá bộ phát.', { subject: 'Đỗ Lâm', fact: 'Đỗ Lâm không phải là hung thủ phá bộ phát.' }, { description: 'Đỗ Lâm không phải là hung thủ phá bộ phát.', fact_type: 'fact', subject_type: 'character', subject_name: 'Đỗ Lâm' }),
    op('THREAD_PROGRESS', 2, 'Dấu vết mới vẫn làm tuyến Giải mã Nốt Chìm tiến triển.', { threadId: 12701, thread: 'Giải mã Nốt Chìm' }, { summary: 'Có dấu vết phá hoại mới.' }),
  ] },
  12111: { ops: [
    op('RELATIONSHIP_STATUS_CHANGED', 1, 'Hai người chuyển từ bạn sang người yêu', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { relationship_type: 'lover', trust_level: 'high', status_summary: 'Người yêu tin cậy.', reason: 'Cả hai xác nhận.' }),
    op('RELATIONSHIP_SECRET_CHANGED', 1, 'muốn giữ quan hệ kín cho đến khi cuộc điều tra kết thúc; Lam cũng đồng ý', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { secrecy_state: 'secret', status_summary: 'Quan hệ yêu đương được giữ kín.', reason: 'Hai bên đồng thuận ranh giới.' }),
    op('INTIMACY_LEVEL_CHANGED', 1, 'mức thân mật tăng lên trung bình với đồng thuận hai chiều.', { subject: 'Đỗ Lam', target: 'Nhã Uyên' }, { intimacy_level: 'medium', consent_state: 'mutual', emotional_aftermath: 'Bình tĩnh và an tâm.', status_summary: 'Thân mật trung bình với đồng thuận hai chiều.' }),
  ] },
  12112: { ops: [
    op('CHARACTER_RESCUED', 1, 'Đỗ Lâm giữ dây, kéo Lam lên khi cô vẫn còn thở và cứu cô trước khi chết đuối', { subject: 'Đỗ Lam', target: 'Đỗ Lâm' }, { status_summary: 'Được Lâm cứu trước khi chết đuối.' }),
    op('CHARACTER_DIED', 1, 'xác nhận tim ông đã ngừng vĩnh viễn và ghi Cao Tần tử vong tại chỗ.', { subject: 'Cao Tần' }, { status_summary: 'Tử vong tại cửa nước.' }),
    op('OBJECT_STATUS_CHANGED', 1, 'Hộp Nhịp Đỏ vỡ vụn, lõi sinh trắc cháy thành than và bị phá hủy hoàn toàn.', { subject: 'Cao Tần', object: 'Hộp Nhịp Đỏ' }, { availability: 'destroyed', is_damaged: true, status_summary: 'Bị phá hủy hoàn toàn.' }),
    op('FACT_REGISTERED', 2, 'Nốt Chìm do mạng tinh thể băng cộng hưởng với lõi địa nhiệt của Trạm Vân Mốc', { fact: 'Nốt Chìm do mạng tinh thể băng cộng hưởng với lõi địa nhiệt của Trạm Vân Mốc.' }, { description: 'Nốt Chìm do mạng tinh thể băng cộng hưởng với lõi địa nhiệt của Trạm Vân Mốc.', fact_type: 'fact' }),
    op('THREAD_RESOLVED', 2, 'Nốt Chìm ngừng hẳn và tuyến Giải mã Nốt Chìm được hoàn thành thật.', { threadId: 12701, thread: 'Giải mã Nốt Chìm' }, { summary: 'Đã triệt tiêu cộng hưởng và tín hiệu ngừng hẳn.' }),
    op('THREAD_RESOLVED', 2, 'Họ gia cố mọi nhánh nứt, vì vậy tuyến Vết nứt tầng băng cũng hoàn thành.', { threadId: 12703, thread: 'Vết nứt tầng băng' }, { summary: 'Mọi nhánh nứt đã được gia cố.' }),
    op('THREAD_PROGRESS', 2, 'Tuyến Giải mã Nốt Chậm chỉ tạm đình trệ vì máy thu bị ngập, chưa hoàn thành', { threadId: 12702, thread: 'Giải mã Nốt Chậm' }, { summary: 'Tạm đình trệ do máy thu ngập nhưng chưa hoàn thành.' }),
    op('CHARACTER_LOCATION_CHANGED', 2, 'Lam trở về Trạm Vân Mốc để công bố dữ liệu.', { subject: 'Đỗ Lam', location: 'Trạm Vân Mốc' }, { location_name: 'Trạm Vân Mốc', reason: 'Công bố dữ liệu.' }),
  ] },
};

function responseVariant(chapterId, taskType, value, attempt) {
  if (taskType === 'chapter_summary') return String(value);
  if (taskType === 'canon_extract_ops' && chapterId === 12104 && attempt === 1) {
    return '{"ops":[{"op_type":"OBJECT_RETURNED"';
  }
  if (chapterId === 12102) return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  if (chapterId === 12106 && taskType === 'canon_extract_ops') {
    const duplicated = clone(value);
    duplicated.ops.push({ ...clone(duplicated.ops[0]), target_name: '', location_name: '' });
    return `  ${JSON.stringify(duplicated)}  `;
  }
  return JSON.stringify(value);
}

function modelResponse(chapterId, taskType) {
  if (taskType === 'chapter_summary') return summaries[chapterId];
  if (taskType === 'feedback_extract') return entityResponses[chapterId];
  if (taskType === 'canon_extract_ops') return canonResponses[chapterId];
  if (taskType === 'canon_adjudicate_warnings' && chapterId === 12112) {
    return {
      decisions: [{
        warning_index: 0,
        verdict: 'false_positive',
        confidence: 0.99,
        reason: 'Cảnh chỉ nhắc các vỏ ống đã dùng hết và còn xác nhận không ống nào hoạt động trở lại.',
        suggested_action: 'dismiss_report',
        suggested_ops: [],
      }],
    };
  }
  if (taskType === 'canon_adjudicate_warnings' && chapterId === 12104) {
    return {
      decisions: [{
        warning_index: 0,
        verdict: 'true_positive',
        confidence: 0.99,
        reason: 'Lam đã biết bí mật này từ chương đầu và cảnh nói rõ không có lần tiết lộ mới.',
        suggested_action: 'keep_report',
        suggested_ops: [],
      }],
    };
  }
  throw new Error(`Unexpected AI task ${taskType} for chapter ${chapterId}`);
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .replace(/[^a-zA-Z0-9]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function semanticKey(opValue = {}) {
  return [
    opValue.op_type,
    normalizeKey(opValue.subject_name || opValue.subject),
    normalizeKey(opValue.target_name || opValue.target),
    normalizeKey(opValue.location_name || opValue.location),
    normalizeKey(opValue.thread_title || opValue.thread),
    normalizeKey(opValue.fact_description || opValue.fact),
    normalizeKey(opValue.object_name || opValue.object),
  ].join('|');
}

function multisetDifference(left, right) {
  const remaining = [...right];
  return left.filter((value) => {
    const index = remaining.indexOf(value);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

async function rowsForProject(tableName) {
  return db.table(tableName).where('project_id').equals(PROJECT_ID).toArray();
}

async function snapshotChapter(chapterId) {
  const [
    chapter,
    chapterMeta,
    revisions,
    commits,
    events,
    evidence,
    reports,
    characters,
    locations,
    objects,
    worldTerms,
    canonFacts,
    plotThreads,
    relationships,
    entityStates,
    itemStates,
    threadStates,
    relationshipStates,
    suggestions,
    candidates,
    canonState,
    chapterSnapshots,
    canonOverview,
  ] = await Promise.all([
    db.chapters.get(chapterId),
    db.chapterMeta.where('chapter_id').equals(chapterId).toArray(),
    db.chapter_revisions.where('chapter_id').equals(chapterId).toArray(),
    db.chapter_commits.where('chapter_id').equals(chapterId).toArray(),
    db.story_events.where('chapter_id').equals(chapterId).toArray(),
    db.memory_evidence.where('chapter_id').equals(chapterId).toArray(),
    db.validator_reports.where('chapter_id').equals(chapterId).toArray(),
    rowsForProject('characters'),
    rowsForProject('locations'),
    rowsForProject('objects'),
    rowsForProject('worldTerms'),
    rowsForProject('canonFacts'),
    rowsForProject('plotThreads'),
    rowsForProject('relationships'),
    rowsForProject('entity_state_current'),
    rowsForProject('item_state_current'),
    rowsForProject('plot_thread_state'),
    rowsForProject('relationship_state_current'),
    rowsForProject('suggestions'),
    rowsForProject('entity_resolution_candidates'),
    getChapterCanonState(PROJECT_ID, chapterId),
    db.chapter_snapshots.where('chapter_id').equals(chapterId).toArray(),
    getProjectCanonOverview(PROJECT_ID),
  ]);
  const projectStore = useProjectStore.getState();
  const codexStore = useCodexStore.getState();
  const canonStore = useCanonStore.getState();
  return {
    chapter,
    chapterMeta,
    revisions,
    commits,
    events,
    evidence,
    reports,
    projection: {
      entityStates,
      itemStates,
      threadStates,
      relationshipStates,
      factStates: canonOverview.factStates || [],
      chapterSnapshots,
    },
    baseProfiles: { characters, locations, objects, worldTerms, canonFacts, plotThreads, relationships },
    suggestions,
    entityResolutionCandidates: candidates,
    canonState,
    store: {
      activeChapterId: projectStore.activeChapterId,
      chapter: projectStore.chapters.find((item) => item.id === chapterId) || null,
      completion: projectStore.chapterCompletionById?.[chapterId] || null,
      codex: {
        characters: clone(codexStore.characters || []),
        locations: clone(codexStore.locations || []),
        objects: clone(codexStore.objects || []),
        worldTerms: clone(codexStore.worldTerms || []),
        canonFacts: clone(codexStore.canonFacts || []),
      },
      canonOutcome: clone(canonStore.chapterOutcomes?.[chapterId] || null),
    },
  };
}

async function clearDatabase() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

async function seedStory(corpus) {
  const now = Date.now();
  const project = { status: 'active', created_at: now, updated_at: now, ...clone(corpus.project) };
  const chapters = corpus.chapters.map(({ scenes, ...chapter }) => ({ ...clone(chapter), created_at: now, updated_at: now }));
  const scenes = corpus.chapters.flatMap((chapter) => chapter.scenes.map((scene) => ({
    ...clone(scene),
    project_id: PROJECT_ID,
    chapter_id: chapter.id,
    status: 'draft',
    created_at: now,
    updated_at: now,
  })));
  await db.projects.add(project);
  await Promise.all([
    db.chapters.bulkAdd(chapters),
    db.scenes.bulkAdd(scenes),
    db.characters.bulkAdd(clone(corpus.baseline.characters)),
    db.locations.bulkAdd(clone(corpus.baseline.locations)),
    db.objects.bulkAdd(clone(corpus.baseline.objects)),
    db.worldTerms.bulkAdd(clone(corpus.baseline.worldTerms)),
    db.relationships.bulkAdd(clone(corpus.baseline.relationships)),
    db.canonFacts.bulkAdd(clone(corpus.baseline.canonFacts)),
    db.plotThreads.bulkAdd(clone(corpus.baseline.plotThreads)),
    db.suggestions.bulkAdd([
      { id: 12951, project_id: PROJECT_ID, source_chapter_id: 12105, type: 'character_status', status: 'pending', target_id: 12304, target_name: 'Nghi Vũ', suggested_value: 'Đã chết', created_at: now },
      { id: 12952, project_id: PROJECT_ID, source_chapter_id: 12105, type: 'canon_op_review', status: 'pending', target_id: 12304, target_name: 'Nghi Vũ', suggested_value: 'CHARACTER_DIED', created_at: now + 1 },
      { id: 12953, project_id: PROJECT_ID, source_chapter_id: 12105, type: 'entity_resolution', status: 'pending', target_name: 'Người lạ', created_at: now + 2 },
    ]),
  ]);
  useProjectStore.setState({
    currentProject: project,
    projects: [project],
    chapters,
    scenes,
    activeChapterId: chapters[0].id,
    chapterCompletionById: {},
  });
  useCodexStore.setState({ characters: [], locations: [], objects: [], worldTerms: [], canonFacts: [] });
  useCanonStore.setState({ chapterOutcomes: {}, bulkProgress: null });
  useSuggestionStore.setState({ suggestions: [], loading: false });
  return { project, chapters, scenes };
}

describe.skipIf(!AUDIT_ENABLED)('independent completion audit corpus', () => {
  let corpus;

  beforeAll(async () => {
    corpus = JSON.parse(await readFile(ORACLE_PATH, 'utf8'));
    await db.open();
    harness.send.mockImplementation(({ taskType, messages, onComplete, onError }) => {
      const promptText = (messages || [])
        .filter((message) => message?.role === 'user')
        .map((message) => String(message?.content || ''))
        .join('\n');
      const inferredChapter = corpus.chapters.find((chapter) => (
        promptText.includes(chapter.title)
        || chapter.scenes.every((scene) => promptText.includes(scene.title))
        || chapter.scenes.every((scene) => promptText.includes(scene.draft_text.slice(0, 80)))
      ));
      const queuedChapterId = taskType === 'canon_extract_ops'
        ? harness.canonChapterQueue.shift()
        : null;
      const chapterId = queuedChapterId
        || (taskType === 'canon_adjudicate_warnings' ? harness.lastCanonChapterId : null)
        || harness.chapterId
        || inferredChapter?.id;
      if (taskType === 'canon_extract_ops') harness.lastCanonChapterId = chapterId;
      const attemptKey = `${chapterId}:${taskType}`;
      const attempt = (harness.attempts.get(attemptKey) || 0) + 1;
      harness.attempts.set(attemptKey, attempt);
      if (harness.failTask === taskType) {
        const error = new Error(`Simulated ${taskType} failure`);
        harness.records.push({ chapterId, taskType, attempt, messages: clone(messages), error: error.message });
        setTimeout(() => onError(error), 5);
        return;
      }
      try {
        const overrideKey = `${chapterId}:${taskType}`;
        const value = harness.responseOverrides.has(overrideKey)
          ? harness.responseOverrides.get(overrideKey)
          : modelResponse(chapterId, taskType);
        const content = harness.rawResponseOverrides.has(overrideKey)
          ? harness.rawResponseOverrides.get(overrideKey)
          : responseVariant(chapterId, taskType, value, attempt);
        harness.records.push({ chapterId, taskType, attempt, messages: clone(messages), content });
        queueMicrotask(async () => {
          try {
            const mutation = harness.mutateSceneOnTask;
            if (mutation?.taskType === taskType) {
              await db.scenes.update(mutation.sceneId, {
                draft_text: mutation.draftText,
                updated_at: Date.now(),
              });
              harness.mutateSceneOnTask = null;
            }
            onComplete(content);
          } catch (error) {
            onError(error);
          }
        });
      } catch (error) {
        harness.records.push({ chapterId, taskType, attempt, messages: clone(messages), error: error.message });
        queueMicrotask(() => onError(error));
      }
    });
  });

  afterAll(async () => {
    const scenarioFiles = {
      summaryFailure: 'summary-failure-reproduction.json',
      entityFailure: 'entity-failure-reproduction.json',
      adversarialFiltering: 'adversarial-filter-reproduction.json',
      repeatedSecretReveal: 'repeated-secret-filter.json',
      invalidPayload: 'invalid-payload-reproduction.json',
      contentChangedDuringAnalysis: 'content-change-reproduction.json',
      entityProvenancePurge: 'entity-provenance-purge-reproduction.json',
      cacheAndPreanalysis: 'cache-and-preanalysis.json',
      individualReanalysisFailure: 'individual-reanalysis-failure.json',
      reanalysisAndBatch: 'reanalysis-and-batch.json',
    };
    try {
      const report = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
      report.systemScenarioResults = {};
      for (const [key, filename] of Object.entries(scenarioFiles)) {
        try {
          const artifactPath = path.resolve(
            '.codex-artifacts',
            'independent-completion-audit',
            filename,
          );
          report.systemScenarioResults[key] = JSON.parse(await readFile(artifactPath, 'utf8'));
        } catch (error) {
          report.systemScenarioResults[key] = { missing: true, error: error.message };
        }
      }
      await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch (error) {
      process.stderr.write(`Could not merge independent audit scenario artifacts: ${error.message}\n`);
    }
    await clearDatabase();
    db.close();
  });

  it('runs all chapters through projectStore and archives actual database state', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    const seeded = await seedStory(corpus);
    const baselineBefore = await snapshotChapter(corpus.chapters[0].id);
    const report = {
      auditId: corpus.audit_id,
      generatedAt: new Date().toISOString(),
      liveModelUsed: false,
      aiBoundary: 'Only services/ai/client is simulated. aiStore, projectStore, entity identity, typed canon workflow, Dexie writes, commits and projection are real application code.',
      input: { project: corpus.project, baseline: corpus.baseline, chapters: corpus.chapters },
      oracle: corpus.oracle,
      systemScenarios: corpus.system_scenarios,
      baselineProfilesBefore: baselineBefore.baseProfiles,
      chapters: [],
      fatalError: null,
    };

    try {
      for (const chapter of seeded.chapters) {
        harness.chapterId = chapter.id;
        const chapterReport = { chapterId: chapter.id, title: chapter.title, attempts: [] };
        const maximumAttempts = chapter.id === 12104 ? 2 : 1;
        for (let completionAttempt = 1; completionAttempt <= maximumAttempts; completionAttempt += 1) {
          const recordStart = harness.records.length;
          let result;
          let thrown = null;
          try {
            result = await useProjectStore.getState().runChapterCompletion(chapter.id, { mode: 'manual' });
          } catch (error) {
            thrown = { message: error?.message || String(error), stack: error?.stack || '' };
          }
          const state = await snapshotChapter(chapter.id);
          chapterReport.attempts.push({
            completionAttempt,
            result: clone(result || null),
            thrown,
            aiRecords: clone(harness.records.slice(recordStart)),
            state,
          });
          if (result?.ok || chapter.id !== 12104) break;
        }
        const finalAttempt = chapterReport.attempts.at(-1);
        const committedEvents = finalAttempt.state.events.filter((event) => event.status === 'committed');
        const expected = corpus.oracle[String(chapter.id)];
        const requiredKeys = expected.required_ops.map(semanticKey);
        const acceptableKeys = expected.acceptable_ops.map(semanticKey);
        const actualKeys = committedEvents.map(semanticKey);
        chapterReport.semanticDelta = {
          requiredKeys,
          acceptableKeys,
          actualKeys,
          missingRequired: multisetDifference(requiredKeys, actualKeys),
          unexpected: multisetDifference(actualKeys, [...requiredKeys, ...acceptableKeys]),
        };
        report.chapters.push(chapterReport);
        if (!finalAttempt.result?.ok) break;
      }
    } catch (error) {
      report.fatalError = { message: error?.message || String(error), stack: error?.stack || '' };
    } finally {
      for (let index = 0; index < report.chapters.length - 1; index += 1) {
        const nextChapterId = report.chapters[index + 1].chapterId;
        report.chapters[index].nextChapterCanonPrompt = harness.records.find((record) => (
          record.chapterId === nextChapterId && record.taskType === 'canon_extract_ops'
        ))?.messages || null;
      }
      report.finalState = report.chapters.at(-1)?.attempts.at(-1)?.state || null;
      await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
      await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      process.stdout.write(`INDEPENDENT_COMPLETION_AUDIT=${OUTPUT_PATH}\n`);
    }

    expect(report.fatalError).toBeNull();
    expect(report.chapters).toHaveLength(corpus.chapters.length);
  }, 120000);

  it('does not complete a chapter when summary extraction fails', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12101;
    harness.failTask = 'chapter_summary';
    await seedStory(corpus);

    let result;
    try {
      result = await useProjectStore.getState().runChapterCompletion(12101, { mode: 'manual' });
    } finally {
      harness.failTask = null;
    }
    const state = await snapshotChapter(12101);
    const failureArtifactPath = path.resolve(
      '.codex-artifacts',
      'independent-completion-audit',
      'summary-failure-reproduction.json',
    );
    await writeFile(failureArtifactPath, `${JSON.stringify({ result, state }, null, 2)}\n`, 'utf8');

    expect(result.ok).toBe(false);
    expect(state.chapter.status).toBe('draft');
    expect(state.revisions).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('does not complete a chapter when entity extraction fails', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12101;
    harness.failTask = 'feedback_extract';
    await seedStory(corpus);

    let result;
    try {
      result = await useProjectStore.getState().runChapterCompletion(12101, { mode: 'manual' });
    } finally {
      harness.failTask = null;
    }
    const state = await snapshotChapter(12101);
    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'entity-failure-reproduction.json'),
      `${JSON.stringify({ result, state }, null, 2)}\n`,
      'utf8',
    );

    expect(result.ok).toBe(false);
    expect(state.chapter.status).toBe('draft');
    expect(state.revisions).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('filters adversarial rumor, fabricated evidence, low confidence, duplicate and missing references', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12103;
    await seedStory(corpus);
    const deathRumor = op(
      'CHARACTER_DIED',
      1,
      'Cao Tần nói Lam chắc đã chết và tin đồn cô tử nạn lan về Trạm Vân Mốc.',
      { subject: 'Đỗ Lam' },
      { status_summary: 'Đã chết.' },
    );
    harness.responseOverrides.set('12103:canon_extract_ops', {
      ops: [
        deathRumor,
        clone(deathRumor),
        op(
          'OBJECT_LOST',
          1,
          'Một kỹ thuật viên lại đồn Mắt Cá-17 cũng mất',
          { subject: 'Đỗ Lâm', object: 'Mắt Cá-17' },
          { availability: 'lost' },
        ),
        op(
          'CHARACTER_RESCUED',
          2,
          'Uyên cứu được Lam khi cô vẫn còn sống; đây không phải hồi sinh.',
          { subject: 'Đỗ Lam', target: 'Nhã Uyên', confidence: 0.31 },
          { status_summary: 'Được Uyên cứu khi vẫn còn sống.' },
        ),
        op(
          'CHARACTER_RESCUED',
          2,
          'Lam được một tàu ngầm lạ cứu khỏi vực sâu.',
          { subject: 'Đỗ Lam', target: 'Nhã Uyên' },
          { status_summary: 'Được một tàu ngầm lạ cứu.' },
        ),
        op(
          'CHARACTER_STATUS_CHANGED',
          2,
          'Lam chưa chết.',
          { subject: 'Người Không Tồn Tại' },
          { status_summary: 'Không có căn cứ.' },
        ),
      ],
    });

    let result;
    try {
      result = await useProjectStore.getState().runChapterCompletion(12103, { mode: 'manual' });
    } finally {
      harness.responseOverrides.clear();
    }
    const state = await snapshotChapter(12103);
    const committedEvents = state.events.filter((event) => event.status === 'committed');
    const activeReports = state.canonState.reports.filter((report) => report.status === 'active');
    const artifactPath = path.resolve(
      '.codex-artifacts',
      'independent-completion-audit',
      'adversarial-filter-reproduction.json',
    );
    await writeFile(artifactPath, `${JSON.stringify({ result, state }, null, 2)}\n`, 'utf8');

    expect(result.ok).toBe(true);
    expect(committedEvents).toEqual([]);
    expect(activeReports).toHaveLength(result.canonResult.filteredCount);
    expect(activeReports.map((report) => report.rule_code)).toEqual(expect.arrayContaining([
      'CANON_OP_DUPLICATE_FILTERED',
      'CANON_EVIDENCE_EXPLICITLY_UNCERTAIN',
      'LOW_CONFIDENCE_CANON_OP_FILTERED',
      'CANON_EVIDENCE_NOT_GROUNDED',
      'CANON_OP_MISSING_REFERENCE_FILTERED',
    ]));
  });

  it('filters a repeated secret reveal and preserves the first reveal chapter and per-character knowledge', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12101;
    await seedStory(corpus);
    const chapter1 = await useProjectStore.getState().runChapterCompletion(12101, { mode: 'manual' });
    harness.chapterId = 12104;
    const repeatedReveal = {
      ops: [op(
        'SECRET_REVEALED',
        2,
        'Lam vẫn nhớ rõ bí mật Từ Dạ là Người Gõ Nhịp mà cô đã biết từ chương đầu; không có lần tiết lộ mới nào về danh tính đó.',
        {
          subject: 'Đỗ Lam',
          target: 'Từ Dạ',
          fact: 'Từ Dạ là Người Gõ Nhịp.',
        },
        { status_summary: 'Lam biết Từ Dạ là Người Gõ Nhịp.' },
      )],
    };
    harness.rawResponseOverrides.set('12104:canon_extract_ops', JSON.stringify(repeatedReveal));

    let chapter4;
    try {
      chapter4 = await useProjectStore.getState().runChapterCompletion(12104, { mode: 'manual' });
    } finally {
      harness.rawResponseOverrides.clear();
    }
    const state = await snapshotChapter(12104);
    const identityFact = state.projection.factStates.find((fact) => fact.description === 'Từ Dạ là Người Gõ Nhịp.');
    const lamState = state.projection.entityStates.find((entity) => entity.entity_id === 12301);
    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'repeated-secret-filter.json'),
      `${JSON.stringify({ chapter1, chapter4, identityFact, lamState, state }, null, 2)}\n`,
      'utf8',
    );

    expect(chapter1.ok).toBe(true);
    expect(chapter4.ok).toBe(true);
    expect(chapter4.canonResult.extractedCount).toBe(1);
    expect(chapter4.canonResult.committedCount).toBe(0);
    expect(chapter4.canonResult.filteredCount).toBe(1);
    expect(state.events).toEqual([]);
    expect(state.reports.map((report) => report.rule_code)).toContain('SECRET_ALREADY_REVEALED');
    expect(identityFact.revealed_at_chapter).toBe(1);
    expect(lamState.knowledge[identityFact.id]).toBe(true);
  });

  it('filters a correctly typed operation whose payload would corrupt the item projection', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12102;
    await seedStory(corpus);
    harness.responseOverrides.set('12102:canon_extract_ops', {
      ops: [op(
        'OBJECT_PARTIALLY_CONSUMED',
        1,
        'Uyên bẻ một Ống Sinh Quang để soi đường, nên từ ba ống chỉ còn đúng hai ống nguyên vẹn.',
        { subject: 'Nhã Uyên', object: 'Ống Sinh Quang' },
        {
          item_category: 'consumable',
          quantity_delta: 'một',
          quantity_remaining: -5,
          availability: { state: 'available' },
        },
      )],
    });

    let result;
    try {
      result = await useProjectStore.getState().runChapterCompletion(12102, { mode: 'manual' });
    } finally {
      harness.responseOverrides.clear();
    }
    const state = await snapshotChapter(12102);
    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'invalid-payload-reproduction.json'),
      `${JSON.stringify({ result, state }, null, 2)}\n`,
      'utf8',
    );

    expect(result.ok).toBe(true);
    expect(result.canonResult.extractedCount).toBe(1);
    expect(result.canonResult.committedCount).toBe(0);
    expect(result.canonResult.filteredCount).toBe(1);
    expect(state.events).toEqual([]);
    expect(state.reports.map((report) => report.rule_code)).toContain('INVALID_CANON_OP_PAYLOAD');
    expect(state.projection.itemStates.find((item) => item.object_id === 12503)?.quantity_remaining).toBe(3);
  });

  it('purges canon and leaves the chapter draft when scene content changes during canon extraction', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12101;
    const seeded = await seedStory(corpus);
    const scene = seeded.scenes.find((item) => item.id === 12201);
    harness.mutateSceneOnTask = {
      taskType: 'canon_extract_ops',
      sceneId: scene.id,
      draftText: `${scene.draft_text}\nNội dung được sửa trong lúc AI đang phân tích.`,
    };

    let result;
    try {
      result = await useProjectStore.getState().runChapterCompletion(12101, { mode: 'manual' });
    } finally {
      harness.mutateSceneOnTask = null;
    }
    const state = await snapshotChapter(12101);
    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'content-change-reproduction.json'),
      `${JSON.stringify({ result, state }, null, 2)}\n`,
      'utf8',
    );

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('stale');
    expect(state.chapter.status).toBe('draft');
    expect(state.revisions).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.baseProfiles.characters.some((character) => character.id === 12306)).toBe(false);
  });

  it('purges only entities created by the chapter and preserves matched baseline profiles', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12101;
    await seedStory(corpus);
    const completion = await useProjectStore.getState().runChapterCompletion(12101, { mode: 'manual' });
    const profilesBeforePurge = (await snapshotChapter(12101)).baseProfiles;
    const purge = await purgeChapterCanonState(PROJECT_ID, 12101);
    const profilesAfterPurge = (await snapshotChapter(12101)).baseProfiles;
    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'entity-provenance-purge-reproduction.json'),
      `${JSON.stringify({ completion, profilesBeforePurge, purge, profilesAfterPurge }, null, 2)}\n`,
      'utf8',
    );

    expect(completion.ok).toBe(true);
    expect(profilesAfterPurge.characters.map((item) => item.id)).toEqual(expect.arrayContaining([
      12301, 12302, 12303, 12304, 12305,
    ]));
    expect(profilesAfterPurge.locations.map((item) => item.id)).toEqual(expect.arrayContaining([
      12401, 12402, 12403, 12404,
    ]));
    expect(profilesAfterPurge.objects.map((item) => item.id)).toEqual(expect.arrayContaining([
      12501, 12502, 12503, 12504, 12505,
    ]));
    expect(profilesAfterPurge.worldTerms.map((item) => item.id)).toEqual(expect.arrayContaining([
      12601, 12602,
    ]));
    expect(profilesAfterPurge.characters.some((item) => item.id === 12306)).toBe(false);
    expect(profilesAfterPurge.objects.some((item) => item.id === 12506)).toBe(false);
  });

  it('reuses a fresh done cache and reuses pre-analysis only after summary and entity extraction finish', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12107;
    await seedStory(corpus);

    const firstCompletion = await useProjectStore.getState().runChapterCompletion(12107, { mode: 'manual' });
    const recordsAfterFirst = harness.records.length;
    const firstState = await snapshotChapter(12107);
    const secondCompletion = await useProjectStore.getState().runChapterCompletion(12107, { mode: 'manual' });
    const secondState = await snapshotChapter(12107);
    const doneCacheRecords = clone(harness.records.slice(recordsAfterFirst));

    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12107;
    await seedStory(corpus);
    const preanalysis = await useCanonStore.getState().canonicalizeChapter(PROJECT_ID, 12107);
    const canonCallsAfterPreanalysis = harness.records.filter((record) => record.taskType === 'canon_extract_ops').length;
    const completionAfterPreanalysis = await useProjectStore.getState().runChapterCompletion(12107, { mode: 'manual' });
    const preanalysisState = await snapshotChapter(12107);
    const canonCallsAfterCompletion = harness.records.filter((record) => record.taskType === 'canon_extract_ops').length;

    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'cache-and-preanalysis.json'),
      `${JSON.stringify({
        doneCache: {
          firstCompletion,
          secondCompletion,
          firstRevisionCount: firstState.revisions.length,
          secondRevisionCount: secondState.revisions.length,
          aiRecordsDuringSecondCompletion: doneCacheRecords,
        },
        preanalysis: {
          preanalysis,
          completion: completionAfterPreanalysis,
          canonCallsAfterPreanalysis,
          canonCallsAfterCompletion,
          state: preanalysisState,
          aiRecords: harness.records,
        },
      }, null, 2)}\n`,
      'utf8',
    );

    expect(firstCompletion.ok).toBe(true);
    expect(secondCompletion.ok).toBe(true);
    expect(secondCompletion.canonResult.reused).toBe(true);
    expect(doneCacheRecords).toEqual([]);
    expect(firstState.revisions).toHaveLength(1);
    expect(secondState.revisions).toHaveLength(1);
    expect(preanalysis.ok).toBe(true);
    expect(completionAfterPreanalysis.ok).toBe(true);
    expect(completionAfterPreanalysis.canonResult.reused).toBe(true);
    expect(canonCallsAfterCompletion).toBe(canonCallsAfterPreanalysis);
    expect(harness.records.filter((record) => record.taskType === 'chapter_summary')).toHaveLength(1);
    expect(harness.records.filter((record) => record.taskType === 'feedback_extract')).toHaveLength(1);
    expect(preanalysisState.chapter.status).toBe('done');
    expect(preanalysisState.revisions).toHaveLength(1);
  });

  it('removes the done state when individual canon reanalysis cannot extract valid JSON', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    harness.chapterId = 12107;
    await seedStory(corpus);
    const completion = await useProjectStore.getState().runChapterCompletion(12107, { mode: 'manual' });
    harness.rawResponseOverrides.set('12107:canon_extract_ops', '{"ops":[');

    let reanalysis;
    try {
      reanalysis = await useCanonStore.getState().canonicalizeChapter(PROJECT_ID, 12107);
    } finally {
      harness.rawResponseOverrides.clear();
    }
    const state = await snapshotChapter(12107);
    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'individual-reanalysis-failure.json'),
      `${JSON.stringify({ completion, reanalysis, state }, null, 2)}\n`,
      'utf8',
    );

    expect(completion.ok).toBe(true);
    expect(reanalysis.ok).toBe(false);
    expect(reanalysis.extractionStatus).toBe('failed');
    expect(state.chapter.status).toBe('draft');
    expect(state.store.chapter.status).toBe('draft');
  });

  it('invalidates later chapters, supersedes old suggestions, and makes batch reanalysis stop then resume in order', async () => {
    await clearDatabase();
    harness.records.length = 0;
    harness.attempts.clear();
    await seedStory(corpus);

    const completionResults = [];
    for (const chapter of corpus.chapters) {
      harness.chapterId = chapter.id;
      let result = await useProjectStore.getState().runChapterCompletion(chapter.id, { mode: 'manual' });
      if (!result?.ok && chapter.id === 12104) {
        result = await useProjectStore.getState().runChapterCompletion(chapter.id, { mode: 'manual' });
      }
      completionResults.push({ chapterId: chapter.id, result });
      expect(result?.ok).toBe(true);
    }

    harness.chapterId = 12105;
    const oldChapterReanalysis = await useCanonStore.getState().canonicalizeChapter(PROJECT_ID, 12105);
    const commitsAfterOldChapter = await db.chapter_commits.where('project_id').equals(PROJECT_ID).toArray();
    const invalidatedAfterOldChapter = commitsAfterOldChapter
      .filter((commit) => commit.status === 'invalidated')
      .map((commit) => commit.chapter_id)
      .sort((left, right) => left - right);
    const suggestionsAfterCompletion = await rowsForProject('suggestions');

    const batchFailureRecordStart = harness.records.length;
    harness.canonChapterQueue = corpus.chapters.map((chapter) => chapter.id);
    harness.rawResponseOverrides.set('12104:canon_extract_ops', '{"ops":[');
    const batchFailure = await useCanonStore.getState().reanalyzeCompletedChapters(PROJECT_ID);
    harness.rawResponseOverrides.clear();
    const batchFailureRecords = clone(harness.records.slice(batchFailureRecordStart));
    const chapter4AfterFailure = await snapshotChapter(12104);
    const chapter5CommitAfterFailure = await db.chapter_commits
      .where('[project_id+chapter_id]').equals([PROJECT_ID, 12105]).first();

    const resumeRecordStart = harness.records.length;
    harness.canonChapterQueue = corpus.chapters
      .filter((chapter) => chapter.id >= 12104)
      .map((chapter) => chapter.id);
    const batchResume = await useCanonStore.getState().reanalyzeCompletedChapters(PROJECT_ID);
    const resumeRecords = clone(harness.records.slice(resumeRecordStart));
    const finalChapters = await db.chapters.where('project_id').equals(PROJECT_ID).sortBy('order_index');
    const finalCommits = await db.chapter_commits.where('project_id').equals(PROJECT_ID).toArray();

    const canonChapterOrder = (records) => records
      .filter((record) => record.taskType === 'canon_extract_ops')
      .map((record) => record.chapterId);
    const artifact = {
      completionResults,
      oldChapterReanalysis,
      invalidatedAfterOldChapter,
      suggestionsAfterCompletion,
      batchFailure,
      batchFailureCanonOrder: canonChapterOrder(batchFailureRecords),
      chapter4AfterFailure,
      chapter5CommitAfterFailure,
      batchResume,
      batchResumeCanonOrder: canonChapterOrder(resumeRecords),
      finalChapters,
      finalCommits,
    };
    await writeFile(
      path.resolve('.codex-artifacts', 'independent-completion-audit', 'reanalysis-and-batch.json'),
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    );

    expect(oldChapterReanalysis.ok).toBe(true);
    expect(oldChapterReanalysis.invalidatedChapterCount).toBe(7);
    expect(invalidatedAfterOldChapter).toEqual([12106, 12107, 12108, 12109, 12110, 12111, 12112]);
    expect(suggestionsAfterCompletion.find((suggestion) => suggestion.id === 12951)?.status).toBe('superseded');
    expect(suggestionsAfterCompletion.find((suggestion) => suggestion.id === 12952)?.status).toBe('superseded');
    expect(suggestionsAfterCompletion.find((suggestion) => suggestion.id === 12953)?.status).toBe('pending');

    expect(batchFailure.ok).toBe(false);
    expect(batchFailure.chapterId).toBe(12104);
    expect(canonChapterOrder(batchFailureRecords)).toEqual([12101, 12102, 12103, 12104]);
    expect(chapter4AfterFailure.chapter.status).toBe('draft');
    expect(chapter4AfterFailure.store.chapter.status).toBe('draft');
    expect(chapter5CommitAfterFailure.status).toBe('invalidated');

    expect(batchResume.ok).toBe(true);
    expect(canonChapterOrder(resumeRecords)).toEqual([
      12104, 12105, 12106, 12107, 12108, 12109, 12110, 12111, 12112,
    ]);
    expect(finalChapters.every((chapter) => chapter.status === 'done')).toBe(true);
    expect(finalCommits.every((commit) => ['canonical', 'has_warnings'].includes(commit.status))).toBe(true);
  }, 120000);
});
