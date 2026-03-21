/**
 * StoryForge — Prompt Builder v3 (Phase 4)
 * 
 * 8-layer prompt architecture:
 *   1. System Identity
 *   2. Task Instruction
 *   3. Genre / AI Guidelines (editable, pre-filled from genre)
 *   4. Canon Context (world profile, terms, locations, objects, canon facts)
 *   5. Character State (characters + pronouns + relationships + taboos)
 *   6. Scene Contract (goal, conflict, must/must-not, pacing)
 *   7. Style Pack (placeholder — Phase 5)
 *   8. Output Format
 */

import { TASK_TYPES } from './router';
import { PRONOUN_PRESETS, GENRE_PRONOUN_MAP } from '../../utils/constants';

// ═══════════════════════════════════════════
// Layer 1: System Identity
// ═══════════════════════════════════════════
const LAYER_1_IDENTITY = `Bạn là đồng biên tập viên truyện chữ chuyên nghiệp trong ứng dụng StoryForge.
Bạn luôn ưu tiên tính nhất quán (consistency), giọng văn riêng của tác phẩm, và tuân theo mọi quy tắc thế giới truyện.
Bạn viết bằng tiếng Việt trừ khi được yêu cầu khác.
Bạn KHÔNG tự ý thêm phần giải thích, ghi chú, hay meta-commentary — chỉ trả về kết quả yêu cầu.
Bạn PHẢI tuân thủ tuyệt đối mọi cấm kỵ (taboo) được liệt kê.`;

// ═══════════════════════════════════════════
// Layer 2: Task Instructions
// ═══════════════════════════════════════════
const TASK_INSTRUCTIONS = {
    [TASK_TYPES.CONTINUE]: 'Viết tiếp đoạn văn, giữ nguyên giọng văn và nhịp kể. Viết khoảng 200-400 từ.',
    [TASK_TYPES.REWRITE]: 'Viết lại đoạn văn, cải thiện văn phong nhưng giữ nguyên nội dung và ý nghĩa. Làm cho nó tự nhiên hơn, giàu cảm xúc hơn.',
    [TASK_TYPES.EXPAND]: 'Mở rộng đoạn văn, thêm chi tiết miêu tả, cảm xúc, và hành động. Giữ nguyên giọng văn.',
    [TASK_TYPES.BRAINSTORM]: 'Brainstorm ý tưởng sáng tạo, đưa ra nhiều hướng khác nhau.',
    [TASK_TYPES.OUTLINE]: 'Tạo outline cấu trúc rõ ràng, logic.',
    [TASK_TYPES.PLOT_SUGGEST]: 'Gợi ý 3 hướng plot có thể xảy ra tiếp theo. Mỗi hướng gồm: tóm tắt, xung đột, và điều gì sẽ thay đổi.',
    [TASK_TYPES.SUMMARIZE]: 'Tóm tắt nội dung trong khoảng 150-200 từ, giữ các sự kiện chính, thay đổi quan trọng, và trạng thái nhân vật.',
    [TASK_TYPES.EXTRACT_TERMS]: 'Trích xuất: 1) Tên nhân vật (và vai trò), 2) Địa danh, 3) Vật phẩm quan trọng, 4) Thuật ngữ thế giới truyện. Trả về dạng danh sách.',
    [TASK_TYPES.SCENE_DRAFT]: 'Viết bản nháp cảnh, khoảng 800-1200 từ.',
    [TASK_TYPES.FREE_PROMPT]: '',
    [TASK_TYPES.CHAPTER_SUMMARY]: 'Tóm tắt chương này trong khoảng 150-200 từ. Bao gồm: sự kiện chính, thay đổi quan trọng, nhân vật xuất hiện, và trạng thái kết thúc. Chỉ trả về tóm tắt, không thêm tiêu đề hay ghi chú.',
    [TASK_TYPES.FEEDBACK_EXTRACT]: `Phân tích đoạn văn và trích xuất thông tin mới dưới dạng JSON. Trả về CHÍNH XÁC format này:
{
  "characters": [{"name": "...", "role": "...", "appearance": "...", "personality": "..."}],
  "locations": [{"name": "...", "description": "..."}],
  "terms": [{"name": "...", "definition": "...", "category": "..."}],
  "objects": [{"name": "...", "description": "...", "owner": "..."}]
}
Chỉ liệt kê thông tin MỚI xuất hiện. Nếu không có gì mới, trả về mảng rỗng. Chỉ trả về JSON, không thêm gì khác.`,
    [TASK_TYPES.AI_GENERATE_ENTITY]: '', // Dynamic — built in buildPrompt based on entityType
    [TASK_TYPES.PROJECT_WIZARD]: `Dựa trên thể loại và ý tưởng, tạo blueprint cho dự án truyện. Trả về CHÍNH XÁC JSON format:
{
  "premise": "Tóm tắt premise 2-3 câu",
  "characters": [
    {"name": "...", "role": "protagonist|antagonist|supporting|mentor|minor", "appearance": "mô tả ngắn", "personality": "mô tả ngắn", "goals": "mục tiêu"}
  ],
  "locations": [
    {"name": "...", "description": "mô tả ngắn"}
  ],
  "terms": [
    {"name": "...", "definition": "...", "category": "magic|organization|race|technology|other"}
  ],
  "chapters": [
    {"title": "Chương 1: ...", "summary": "Tóm tắt nội dung chương"}
  ]
}
Tạo 3-5 nhân vật, 3-5 địa điểm, 3-5 thuật ngữ, và 8-12 chương. Chỉ trả về JSON.`,
};

// ═══════════════════════════════════════════
// Layer 3: Genre Constraints
// ═══════════════════════════════════════════
export const GENRE_CONSTRAINTS = {
    tien_hiep: 'Thể loại: Tiên hiệp. Tuân thủ nghiêm ngặt hệ thống cảnh giới — không được vượt cấp vô lý. Đột phá phải có tích lũy. Chiến đấu theo sức mạnh cảnh giới. Ngôn từ cổ kính khi tương tác giữa tu sĩ. Mỗi cấp có giới hạn rõ ràng (thọ mệnh, sức mạnh, tốc độ).',
    huyen_huyen: 'Thể loại: Huyền huyễn. Thế giới tự do nhưng PHẢI nhất quán — hệ thống sức mạnh đã thiết lập không được thay đổi. Đa chủng tộc/hệ thống phải tương tác logic. Cấp bậc sức mạnh phải được tôn trọng.',
    fantasy: 'Thể loại: Fantasy phương Tây. Phép thuật có quy tắc và hậu quả. Không để nhân vật đột ngột mạnh vô lý. Mỗi phép thuật có cái giá.',
    he_thong: 'Thể loại: Hệ thống/LitRPG. Mọi số liệu (level, skill, stats) phải nhất quán xuyên suốt. Level up phải hợp lý. Skill mới phải được giải thích nguồn gốc. Hệ thống có rule — không phải deus ex machina.',
    mat_the: 'Thể loại: Mạt thế. Tài nguyên PHẢI khan hiếm — không có gì miễn phí. Sinh tồn là cốt lõi. Sức mạnh có cái giá. Bầu không khí luôn căng thẳng.',
    ngon_tinh_cd: 'Thể loại: Ngôn tình cổ đại. Xưng hô phải đúng thời đại và giai cấp. Cảm xúc thể hiện qua hành động nhỏ, ánh mắt, cử chỉ — không nói thẳng. Nhịp tình cảm chậm, tinh tế.',
    mystery: 'Thể loại: Trinh thám. Quản lý manh mối cẩn thận: ai biết gì, ai không biết gì. Không tiết lộ thông tin chưa đến lúc. Duy trì căng thẳng và nghi ngờ.',
    romance: 'Thể loại: Ngôn tình. Cảm xúc nhân vật phải chân thực, tự nhiên. Nhịp tình cảm không quá nhanh hay chậm. Duy trì tension tình cảm đủ lâu.',
    horror: 'Thể loại: Kinh dị. Tension tăng dần, không "xì hơi". Phân bi�    projectTitle,
    genre,
    userPrompt,
    previousSummary,
    // Phase 3 — Context Engine data
    characters =[],
    locations =[],
    worldTerms =[],
    objects =[],
    taboos =[],
    worldProfile = {},
    // Phase 4 — Canon & Genre
    aiGuidelines = '',
    aiStrictness = 'balanced',
    relationships =[],
    sceneContract = {},
    canonFacts =[],
    // Phase 4 — POV, Synopsis, Structure, Pronouns
    povMode = '',
    synopsis = '',
    storyStructure = '',
    pronounStyle = null,
} = context;

const systemParts = [];

// ── Layer 1: System Identity ──
systemParts.push(LAYER_1_IDENTITY);

// Project info
const povLabel = { first: 'Ngôi 1', third_limited: 'Ngôi 3 hạn chế', third_omni: 'Ngôi 3 toàn tri', multi_pov: 'Đa góc nhìn' };
const projectInfo = [`Truyện: ${projectTitle || 'Chưa đặt tên'}`];
if (genre) projectInfo.push(`Thể loại: ${genre}`);
if (povMode) projectInfo.push(`Góc nhìn: ${povLabel[povMode] || povMode}`);
systemParts.push(`\n[${projectInfo.join(' — ')}]`);

if (chapterTitle) systemParts.push(`[Chương hiện tại: ${chapterTitle}]`);
if (sceneTitle) systemParts.push(`[Cảnh hiện tại: ${sceneTitle}]`);

// POV instruction
if (povMode === 'first') {
    systemParts.push('[GÓC NHÌN]: Viết ngôi thứ nhất (tôi/ta). Chỉ mô tả những gì nhân vật POV thấy, nghe, cảm nhận. KHÔNG viết suy nghĩ nhân vật khác.');
} else if (povMode === 'third_limited') {
    systemParts.push('[GÓC NHÌN]: Viết ngôi thứ ba hạn chế. Theo sát 1 nhân vật mỗi cảnh — chỉ biết suy nghĩ/cảm xúc của nhân vật đó.');
} else if (povMode === 'third_omni') {
    systemParts.push('[GÓC NHÌN]: Viết ngôi thứ ba toàn tri. Có thể vào tâm trí mọi nhân vật, mô tả cả những gì nhân vật không biết.');
} else if (povMode === 'multi_pov') {
    systemParts.push('[GÓC NHÌN]: Đa góc nhìn — mỗi cảnh/chương theo 1 nhân vật. Giữ nhất quán trong cùng 1 cảnh.');
}

// ── Layer 2: Task Instruction ──
const taskInstruction = TASK_INSTRUCTIONS[taskType];
if (taskInstruction) {
    systemParts.push(`\n[NHIỆM VỤ]\n${taskInstruction}`);
}

// ── Layer 3: Genre / AI Guidelines ──
const genreKey = genre?.toLowerCase().replace(/\\s+/g, '_');
// Prioritize ai_guidelines (editable) over hardcoded genre constraint
if (aiGuidelines) {
    systemParts.push(`\n[CHỈ DẪN TÁC GIẢ]\n${aiGuidelines}`);
} else {
    const genreConstraint = GENRE_CONSTRAINTS[genreKey];
    if (genreConstraint) {
        systemParts.push(`\n[THỂ LOẠI]\n${genreConstraint}`);
    }
}

// Synopsis injection
if (synopsis) {
    systemParts.push(`\n[CỐT TRUYỆN CHÍNH]\n${synopsis}`);
}

// Story structure hint
const structureHints = {
    three_act: 'Cấu trúc 3 Hồi: Hồi 1 thiết lập, Hồi 2 xung đột leo thang, Hồi 3 giải quyết.',
    hero_journey: 'Hành trình Anh hùng: Thế giới bình thường → Lời kêu gọi → Thử thách → Mất mát → Chiến thắng → Trở về.',
    isekai_system: 'Isekai/Hệ Thống: Thức tỉnh hệ thống → Khám phá → Farm/grind → Build thế lực → Đỉnh cao.',
    slice_of_life: 'Lát cắt cuộc sống: Tập trung nhân vật và cảm xúc, không cần cốt truyện lớn.',
    mystery: 'Trinh thám: Vụ án → Manh mối → Tình nghi → Twist → Sự thật.',
};
if (storyStructure && structureHints[storyStructure]) {
    systemParts.push(`[CẤU TRÚC TRUYỆN]: ${structureHints[storyStructure]}`);
}

// Pronoun style hint (new system, replaces old GENRE_PRONOUN_MAP)
if (pronounStyle && pronounStyle.default_self) {
    systemParts.push(`[XƯNG HÔ MẶC ĐỊNH — ${pronounStyle.label}]: Tự xưng "${pronounStyle.default_self}", gọi người "${pronounStyle.default_other}". Tuân theo xưng hô riêng của từng nhân vật nếu có.`);
} else {
    // Fallback to old genre pronoun map
    const pronounPresetKey = GENRE_PRONOUN_MAP[genreKey];
    const pronounPreset = pronounPresetKey ? PRONOUN_PRESETS[pronounPresetKey] : null;
    if (pronounPreset) {
        systemParts.push(`[XƯNG HÔ MẶC ĐỊNH — ${pronounPreset.label}]: Tự xưng "${pronounPreset.default_self}", gọi người "${pronounPreset.default_other}". Tuân theo xưng hô riêng của từng nhân vật nếu có.`);
    }
}
e, context = {}) {
    const {
        selectedText,
        sceneText,
        sceneTitle,
        chapterTitle,
        projectTitle,
        genre,
        userPrompt,
        previousSummary,
        // Phase 3 — Context Engine data
        characters = [],
        locations = [],
        worldTerms = [],
        objects = [],
        taboos = [],
        worldProfile = {},
        // Phase 4 — Canon & Genre
        aiGuidelines = '',
        aiStrictness = 'balanced',
        relationships = [],
        sceneContract = {},
        canonFacts = [],
    } = context;

    const systemParts = [];

    // ── Layer 1: System Identity ──
    systemParts.push(LAYER_1_IDENTITY);

    // Project info
    if (projectTitle || genre) {
        systemParts.push(`\n[Truyện: ${projectTitle || 'Chưa đặt tên'}${genre ? ` — Thể loại: ${genre}` : ''}]`);
    }
    if (chapterTitle) systemParts.push(`[Chương hiện tại: ${chapterTitle}]`);
    if (sceneTitle) systemParts.push(`[Cảnh hiện tại: ${sceneTitle}]`);

    // ── Layer 2: Task Instruction ──
    const taskInstruction = TASK_INSTRUCTIONS[taskType];
    if (taskInstruction) {
        systemParts.push(`\n[NHIỆM VỤ]\n${taskInstruction}`);
    }

    // ── Layer 3: Genre / AI Guidelines ──
    const genreKey = genre?.toLowerCase().replace(/\s+/g, '_');
    // Prioritize ai_guidelines (editable) over hardcoded genre constraint
    if (aiGuidelines) {
        systemParts.push(`\n[CHỈ DẪN TÁC GIẢ]\n${aiGuidelines}`);
    } else {
        const genreConstraint = GENRE_CONSTRAINTS[genreKey];
        if (genreConstraint) {
            systemParts.push(`\n[THỂ LOẠI]\n${genreConstraint}`);
        }
    }

    // Genre pronoun hint
    const pronounPresetKey = GENRE_PRONOUN_MAP[genreKey];
    const pronounPreset = pronounPresetKey ? PRONOUN_PRESETS[pronounPresetKey] : null;
    if (pronounPreset) {
        systemParts.push(`[XƯNG HÔ MẶC ĐỊNH — ${pronounPreset.label}]: Tự xưng "${pronounPreset.default_self}", gọi người "${pronounPreset.default_other}". Tuân theo xưng hô riêng của từng nhân vật nếu có.`);
    }

    // ── Layer 4: Canon Context (world profile, terms, locations, objects) ──
    const canonParts = [];

    // World Profile — always inject if available
    if (worldProfile.name || worldProfile.description || worldProfile.rules?.length > 0) {
        let wpText = `Thế giới: ${worldProfile.name || 'Chưa đặt tên'}`;
        if (worldProfile.type) wpText += ` — Loại: ${worldProfile.type}`;
        if (worldProfile.scale) wpText += ` — Quy mô: ${worldProfile.scale}`;
        if (worldProfile.era) wpText += ` — Thời đại: ${worldProfile.era}`;
        if (worldProfile.rules?.length > 0) {
            wpText += `\nQuy tắc cốt lõi:\n${worldProfile.rules.map(r => `• ${r}`).join('\n')}`;
        }
        if (worldProfile.description) {
            wpText += `\nMô tả: ${worldProfile.description}`;
        }
        canonParts.push(wpText);
    }

    if (previousSummary) {
        canonParts.push(`Tóm tắt chương trước:\n${previousSummary}`);
    }

    if (locations.length > 0) {
        const locInfo = locations.map(l => {
            let info = `- ${l.name}`;
            if (l.description) info += `: ${l.description}`;
            return info;
        }).join('\n');
        canonParts.push(`Địa danh xuất hiện:\n${locInfo}`);
    }

    if (objects.length > 0) {
        const objInfo = objects.map(o => {
            let info = `- ${o.name}`;
            if (o.description) info += `: ${o.description}`;
            return info;
        }).join('\n');
        canonParts.push(`Vật phẩm:\n${objInfo}`);
    }

    if (worldTerms.length > 0) {
        const termInfo = worldTerms.map(t => {
            let info = `- ${t.name}`;
            if (t.definition) info += `: ${t.definition}`;
            return info;
        }).join('\n');
        canonParts.push(`Thuật ngữ thế giới:\n${termInfo}`);
    }

    if (canonParts.length > 0) {
        systemParts.push(`\n[BỐI CẢNH TRUYỆN]\n${canonParts.join('\n\n')}`);
    }

    // ── Layer 5: Character State ──
    if (characters.length > 0) {
        const charInfo = characters.map(c => {
            const parts = [`- ${c.name} (${c.role || 'nhân vật'})`];
            if (c.pronouns_self) parts.push(`  Xưng: "${c.pronouns_self}"${c.pronouns_other ? `, gọi người: "${c.pronouns_other}"` : ''}`);
            if (c.appearance) parts.push(`  Ngoại hình: ${c.appearance}`);
            if (c.personality) parts.push(`  Tính cách: ${c.personality}`);
            return parts.join('\n');
        }).join('\n');
        systemParts.push(`\n[NHÂN VẬT XUẤT HIỆN]\n${charInfo}`);
    }

    // Relationships injection (Phase 4)
    if (relationships.length > 0) {
        const relInfo = relationships.map(r =>
            `- ${r.charA} ⟷ ${r.charB}: ${r.label}${r.description ? ` (${r.description})` : ''}`
        ).join('\n');
        systemParts.push(`\n[QUAN HỆ NHÂN VẬT]\n${relInfo}`);
    }

    // Taboos injection — tone adjusted by ai_strictness
    if (taboos.length > 0) {
        const tabooPrefix = aiStrictness === 'strict' ? '⛔ TUYỆT ĐỐI KHÔNG' :
            aiStrictness === 'relaxed' ? '⚠️ Nên tránh' : '❌ Không nên';
        const tabooLines = taboos.map(t => {
            const who = t.characterName || 'Tất cả nhân vật';
            return `${tabooPrefix}: ${who} — ${t.description}`;
        }).join('\n');
        const tabooHeader = aiStrictness === 'strict' ? 'CẤM KỴ — VI PHẠM LÀ LỖI NGHIÊM TRỌNG' :
            aiStrictness === 'relaxed' ? 'LƯU Ý — NÊN TRÁNH' : 'CẤM KỴ';
        systemParts.push(`\n[${tabooHeader}]\n${tabooLines}`);
    }

    // ── Layer 6: Scene Contract (Phase 4) ──
    const contractParts = [];
    if (sceneContract.goal) contractParts.push(`Mục tiêu: ${sceneContract.goal}`);
    if (sceneContract.conflict) contractParts.push(`Xung đột: ${sceneContract.conflict}`);
    if (sceneContract.emotional_start || sceneContract.emotional_end) {
        contractParts.push(`Cảm xúc: ${sceneContract.emotional_start || '?'} → ${sceneContract.emotional_end || '?'}`);
    }
    if (sceneContract.must_happen?.length > 0) {
        contractParts.push(`BẮT BUỘC xảy ra:\n${sceneContract.must_happen.map(m => `✅ ${m}`).join('\n')}`);
    }
    if (sceneContract.must_not_happen?.length > 0) {
        contractParts.push(`CẤM xảy ra:\n${sceneContract.must_not_happen.map(m => `⛔ ${m}`).join('\n')}`);
    }
    if (sceneContract.pacing) {
        const pacingMap = { slow: 'Chậm — miêu tả chi tiết', medium: 'Trung bình', fast: 'Nhanh — hành động liên tục' };
        contractParts.push(`Nhịp: ${pacingMap[sceneContract.pacing] || sceneContract.pacing}`);
    }
    if (contractParts.length > 0) {
        const contractHeader = aiStrictness === 'strict' ? 'HỢP ĐỒNG CẢNH — BẮT BUỘC TUÂN THỦ' :
            aiStrictness === 'relaxed' ? 'GỢI Ý CHO CẢNH' : 'HỢP ĐỒNG CẢNH';
        systemParts.push(`\n[${contractHeader}]\n${contractParts.join('\n')}`);
    }

    // Canon Facts injection (Phase 4)
    if (canonFacts.length > 0) {
        const facts = canonFacts.filter(f => f.status === 'active' && f.fact_type === 'fact');
        const secrets = canonFacts.filter(f => f.status === 'active' && f.fact_type === 'secret');
        const rules = canonFacts.filter(f => f.status === 'active' && f.fact_type === 'rule');
        const canonParts = [];
        if (facts.length > 0) {
            canonParts.push(`Sự thật:\n${facts.map(f => `- ${f.description}`).join('\n')}`);
        }
        if (rules.length > 0) {
            canonParts.push(`Quy tắc:\n${rules.map(f => `- ${f.description}`).join('\n')}`);
        }
        if (secrets.length > 0) {
            canonParts.push(`BÍ MẬT — CHƯA TIẾT LỘ:\n${secrets.map(f => `⛔ ${f.description}`).join('\n')}`);
        }
        if (canonParts.length > 0) {
            systemParts.push(`\n[CANON TRUYỆN]\n${canonParts.join('\n\n')}`);
        }
    }

    // ── Layer 7: Style Pack (Phase 5 placeholder) ──
    // Will be populated when Style Lab feature is implemented

    // ── Layer 8: Output Format ──
    if (taskType === TASK_TYPES.EXTRACT_TERMS || taskType === TASK_TYPES.FEEDBACK_EXTRACT) {
        systemParts.push('\n[OUTPUT FORMAT]\nTrả về dạng danh sách hoặc JSON như yêu cầu. Không thêm markdown formatting.');
    } else if (taskType === TASK_TYPES.SUMMARIZE || taskType === TASK_TYPES.CHAPTER_SUMMARY) {
        systemParts.push('\n[OUTPUT FORMAT]\nTrả về tóm tắt dạng đoạn văn. Không thêm tiêu đề hay bullet points.');
    } else {
        systemParts.push('\n[OUTPUT FORMAT]\nTrả về prose tiếng Việt. Không thêm tiêu đề, ghi chú, hay giải thích.');
    }

    // ═══════════════════════════════════════════
    // Build user message
    // ═══════════════════════════════════════════
    let userContent = '';

    switch (taskType) {
        case TASK_TYPES.CONTINUE:
            userContent = `Viết tiếp:\n\n${sceneText || selectedText || ''}`;
            break;

        case TASK_TYPES.REWRITE:
            userContent = `Viết lại đoạn sau:\n\n---\n${selectedText || sceneText || ''}\n---`;
            break;

        case TASK_TYPES.EXPAND:
            userContent = `Mở rộng đoạn sau:\n\n---\n${selectedText || ''}\n---`;
            break;

        case TASK_TYPES.BRAINSTORM:
            userContent = userPrompt
                ? `Brainstorm: ${userPrompt}`
                : `Gợi ý 5 hướng phát triển tiếp theo cho cảnh/chương hiện tại.\n\nNội dung hiện tại:\n${sceneText || '(chưa có nội dung)'}`;
            break;

        case TASK_TYPES.OUTLINE:
            userContent = userPrompt
                ? `Tạo outline: ${userPrompt}`
                : `Tạo outline 5-8 điểm cho chương tiếp theo.\n\n${sceneText || ''}`;
            break;

        case TASK_TYPES.PLOT_SUGGEST:
            userContent = `Nội dung hiện tại:\n${sceneText || ''}`;
            break;

        case TASK_TYPES.SUMMARIZE:
        case TASK_TYPES.CHAPTER_SUMMARY:
            userContent = `${sceneText || selectedText || ''}`;
            break;

        case TASK_TYPES.EXTRACT_TERMS:
        case TASK_TYPES.FEEDBACK_EXTRACT:
            userContent = `---\n${sceneText || selectedText || ''}\n---`;
            break;

        case TASK_TYPES.SCENE_DRAFT:
            userContent = userPrompt
                ? userPrompt
                : `Viết bản nháp cho cảnh "${sceneTitle || 'chưa đặt tên'}", khoảng 800-1200 từ.`;
            break;

        case TASK_TYPES.FREE_PROMPT:
            userContent = userPrompt || '';
            if (sceneText) {
                userContent += `\n\n[Nội dung cảnh hiện tại:]\n${sceneText}`;
            }
            break;

        default:
            userContent = userPrompt || 'Hãy giúp tôi với tác phẩm này.';
    }

    return [
        { role: 'system', content: systemParts.join('\n') },
        { role: 'user', content: userContent },
    ];
}

export default { buildPrompt };
