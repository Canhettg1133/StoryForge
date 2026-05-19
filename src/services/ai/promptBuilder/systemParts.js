import { TASK_TYPES } from '../router';
import { compileMacroArcContract } from '../macroArcContract';
import {
  PRONOUN_PRESETS,
  GENRE_PRONOUN_MAP,
  detectWritingStyle,
} from '../../../utils/constants';
import { TASK_INSTRUCTIONS } from './taskInstructions';
import { composeTaskInstruction } from './taskInstructionProtection';
import {
  resolveNsfwRules,
  buildNsfwIntimateSystemLayer,
} from './nsfwLayers';
import { resolveSystemIdentityPrompt } from './systemIdentity';
import {
  WRITING_TASKS_FOR_BRIDGE,
  WRITING_DISCIPLINE_TASKS,
  DEFAULT_WRITING_DISCIPLINE_LAYER,
  isWritingIntent,
} from './taskSets';
import { GENRE_CONSTRAINTS } from './genreConstraints';
import {
  buildGrandStrategyLayer,
  buildChapterOutlineLayer,
  buildPreWriteValidationLayer,
  buildMacroArcContractLayer,
  buildOutlinePlannerLayer,
  buildBridgeMemoryLayer,
  buildAuthorDNALayer,
  buildStyleDNALayer,
  buildAntiAIBlock,
  buildMoodBoardLayer,
} from './layers';
import { getProjectStyleRuntimeState } from '../projectStyleRuntime';

export function buildPromptSystemParts(taskType, context = {}) {
  const {
    projectId = null,
    chapterId = null,
    selectedText,
    sceneText,
    chapterText = '',
    chapterSceneCount = 0,
    sceneTitle,
    chapterTitle,
    projectTitle,
    genre,
    tone = '',
    userPrompt,
    previousSummary,
    // Phase 3
    allCharacters = [],
    characters = [],
    locations = [],
    factions = [],
    worldTerms = [],
    objects = [],
    taboos = [],
    worldProfile = {},
    // Phase 4
    aiGuidelines = '',
    aiStrictness = 'balanced',
    relationships = [],
    sceneContract = {},
    canonFacts = [],
    canonRoleLocks = [],
    plotThreads = [],
    povMode = '',
    synopsis = '',
    storyStructure = '',
    pronounStyle = null,
    // Phase 5
    targetLength = 0,
    targetLengthType = 'unset',
    ultimateGoal = '',
    milestones = [],
    currentChapterIndex = 0,
    // Phase 7: Bridge Memory
    bridgeBuffer = '',
    previousEmotionalState = null,
    tensionLevel = null,
    // Phase 8: Chapter Outline Context
    currentChapterOutline = null,
    chapterBlueprintContext = null,
    preWriteValidation = null,
    upcomingChapters = [],
    startChapterNumber = 1,
    existingChapterBriefs = [],
    priorGeneratedChapterBriefs = [],
    generatedOutline = null,
    outlineRevisionInstruction = '',
    storyProgressBudget = null,
    // Phase 9: Grand Strategy
    currentArc = null,
    currentMacroArc = null,
    macroArcContract = null,
    // Soul Injection
    writingStyle = '',
    // Custom overrides 
    promptTemplates = {},
    projectStyleRuntimeBlock = '',
    projectStyleRuntimeEnabled = false,
    projectStyleRuntimeMeta = null,
    nsfwMode = false,
    superNsfwMode = false,
    sceneList = [],
    validatorReports = [],
    fanficCanonContext = null,
    characterContextGate = null,
    retrievalPacket = null,
    relationshipContextPacket = null,
    entityType = '',
    batchCount = 0,
    entityContextText = '',
    recentChapterSummaries = [],
    authorIdea = '',
    existingMacroMilestones = [],
    macroRevisionInstruction = '',
    macroMilestoneCount = 0,
    macroMilestoneRequirements = '',
    planningScopeStart = 0,
    planningScopeEnd = 0,
    macroMilestoneChapterPlans = [],
  } = context;

  // Resolve writing style: context > auto-detect t? genre
  const genreKey = genre ? genre.toLowerCase().replace(/\s+/g, '_') : '';
  const resolvedWritingStyle = writingStyle || detectWritingStyle(genreKey || '');
  const effectiveMacroArcContract = macroArcContract || compileMacroArcContract(currentMacroArc, { allCharacters });
  const systemParts = [];

  const listFromTemplate = (value) => {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    }
    return [];
  };

  const formatCharacterProfile = (character) => {
    const c = character || {};
    const parts = ['- ' + (c.name || 'Nhân vật') + ' (' + (c.role || 'nhân vật') + ')'];
    if (Array.isArray(c.aliases) && c.aliases.length > 0) parts.push('  Aliases/tên gọi khác: ' + c.aliases.join(', '));
    if (typeof c.aliases === 'string' && c.aliases.trim()) parts.push('  Aliases/tên gọi khác: ' + c.aliases);
    const selfPronoun = c.pronouns_self || c.pronouns?.self || '';
    const otherPronoun = c.pronouns_other || c.pronouns?.other || '';
    if (selfPronoun) parts.push('  Xưng: "' + selfPronoun + '"' + (otherPronoun ? ', gọi người: "' + otherPronoun + '"' : ''));
    if (c.age) parts.push('  Tuổi/độ tuổi: ' + c.age);
    if (c.appearance) parts.push('  Ngoại hình: ' + c.appearance);
    if (c.personality_tags) parts.push('  Tags: ' + c.personality_tags);
    if (c.personality) parts.push('  Tính cách: ' + c.personality);
    if (c.flaws) parts.push('  Điểm yếu: ' + c.flaws);
    if (c.goals) parts.push('  Mục tiêu: ' + c.goals);
    if (c.secrets) parts.push('  Bí mật canon (không tự tiết lộ nếu chưa đến lúc): ' + c.secrets);
    if (c.notes) parts.push('  Ghi chú: ' + c.notes);
    if (c.story_function) parts.push('  Vai trò truyện: ' + c.story_function);
    if (c.specific_role) {
      parts.push(
        '  Vai trò cụ thể: ' + c.specific_role
        + (c.specific_role_locked ? ' (đã khóa canon)' : '')
      );
    }
    if (c.speech_pattern) parts.push('  Giọng nói: ' + c.speech_pattern);
    if (c.current_status) parts.push('  Character Live Canon / ràng buộc canon đang hiệu lực: ' + c.current_status);
    return parts.join('\n');
  };

  const CURRENT_STATUS_LIVE_CANON_RULES = [
    '\n[RÀNG BUỘC CURRENT_STATUS - CHARACTER LIVE CANON]',
    '- current_status là ràng buộc canon hiện hành của nhân vật, không phải ghi chú phụ.',
    '- Nếu current_status trống: không suy diễn ràng buộc, vết thương, bí mật, quan hệ, địa vị, tri thức, phe phái hay giới hạn hành vi.',
    '- Nếu current_status có dữ liệu: phải ưu tiên hơn personality khi quyết định hành động, thoại, phản ứng, tri thức, quan hệ, địa vị xã hội, thể chất/tâm lý, vị trí/phe và quyền xuất hiện.',
    '- Không được viết nội dung trái với current_status: nhân vật bị thương không hành động như lành lặn; chưa biết bí mật không nói như đã biết; đang bị giam/mất tích/chết/phong ấn/lẩn trốn không tự xuất hiện trực tiếp nếu scene/outline không cho phép.',
    '- Mọi thay đổi current_status sau chương phải dựa trên bằng chứng rõ trong văn bản, không đoán.',
  ].join('\n');

  const buildPermissionedCharacterBlock = (header, rule, items, cap = 15) => {
    const normalizedItems = (items || [])
      .map((item) => item?.character || item)
      .filter(Boolean)
      .slice(0, cap);
    if (normalizedItems.length === 0) return '';
    return '\n[' + header + ']\n'
      + rule
      + '\n'
      + normalizedItems.map(formatCharacterProfile).join('\n');
  };

  const buildOutlineCharacterRosterLayer = () => {
    if (taskType !== TASK_TYPES.OUTLINE) return '';
    const source = (Array.isArray(allCharacters) && allCharacters.length > 0)
      ? allCharacters
      : characters;
    const seen = new Set();
    const roster = (Array.isArray(source) ? source : [])
      .filter(Boolean)
      .filter((character) => {
        const key = character.id || character.name;
        if (!key) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (roster.length === 0) return '';

    const cappedRoster = roster.slice(0, 40);
    const overflowNote = roster.length > cappedRoster.length
      ? '\n- Danh sách bị cắt bớt vì quá dài; nếu cần dùng nhân vật ngoài phần hiển thị, phải có bằng chứng rõ từ yêu cầu tác giả hoặc canon hiện có.'
      : '';

    return '\n[DANH SÁCH NHÂN VẬT TRONG TRANG NHÂN VẬT - NGUỒN CANON ĐỂ LẬP DÀN Ý]\n'
      + cappedRoster.map(formatCharacterProfile).join('\n')
      + '\n\nQUY TẮC LẬP DÀN Ý THEO NHÂN VẬT:'
      + '\n- Khi điền "featured_characters", ưu tiên chọn từ danh sách trên và dùng tên chính thức.'
      + '\n- Tên ngắn, biệt danh, danh xưng, họ/tên đệm chỉ là alias của nhân vật đã có; không biến alias thành nhân vật mới.'
      + '\n- Không tạo nhân vật mới nếu tác giả không yêu cầu rõ hoặc outline hiện có không bắt buộc; nếu bắt buộc đề xuất nhân vật mới, phải ghi như đề xuất mới, không ghi như canon đã có.'
      + '\n- Mỗi beat nhân vật phải tôn trọng current_status/Character Live Canon nếu hồ sơ có ghi.'
      + overflowNote;
  };

  const CANON_FABRICATION_GUARDRAIL = [
    '\n[CẤM BỊA CANON NHÂN VẬT]',
    '- Không tự bịa thân thế, cha mẹ, con nuôi/con ruột, huyết thống, quá khứ, vết thương cũ, lời hứa cũ, năng lực ẩn, quan hệ gia đình hoặc yêu đương nếu hồ sơ/canon không ghi.',
    '- Không tự bịa tuổi/độ tuổi nếu hồ sơ/canon không ghi; nếu không có dữ liệu tuổi thì không nhắc tuổi trong văn bản.',
    '- Age/tuổi chỉ là tín hiệu mềm cho xưng hô, độ trưởng thành, nhịp thoại, vốn sống và phản ứng tâm lý; không dùng như luật cứng ép nhân vật nói theo khuôn.',
    '- Với hiện đại/học đường/đô thị có thể dùng tuổi số cụ thể khi đã có dữ liệu; với tiên hiệp/huyền huyễn/thần linh/bất tử ưu tiên mô tả linh hoạt như thiếu niên, ngoại hình đôi mươi, tuổi thật rất cao, trưởng bối.',
    '- Nếu canon chưa nói thì viết trung tính hoặc bỏ qua; nếu hồ sơ nói rõ thì không viết ngược lại.',
    '- Bí mật trong hồ sơ chỉ dùng để tránh mâu thuẫn, không tự tiết lộ trong văn bản nếu chưa đến lúc.',
  ].join('\n');

  const buildCanonRoleLocksLayer = (locks = []) => {
    const locked = (Array.isArray(locks) ? locks : [])
      .map((item) => ({
        characterName: String(item?.characterName || item?.character_name || '').trim(),
        specificRole: String(item?.specificRole || item?.specific_role || '').trim(),
        locked: item?.locked !== false,
      }))
      .filter((item) => item.locked && item.characterName && item.specificRole);
    if (locked.length === 0) return '';

    return [
      '\n[CANON VAI TRÒ ĐÃ KHÓA - BẮT BUỘC]',
      'Các mục dưới đây là vai trò canon đã được tác giả xác nhận. Mỗi dòng gắn một nhân vật với một vai trò cụ thể trong truyện.',
      '',
      locked.map((item) => '- ' + item.characterName + ': ' + item.specificRole).join('\n'),
      '',
      'Quy tắc bắt buộc:',
      '1. Nếu nội dung cần dùng, nhắc đến, hoặc phát triển một vai trò đã khóa, phải dùng đúng nhân vật đang giữ vai trò đó.',
      '2. Không tạo, thay thế, gán lại, hoặc ám chỉ nhân vật khác giữ cùng vai trò hoặc vai trò tương đương nếu tác giả không yêu cầu đổi canon.',
      '3. Không tự biến một vai trò đã khóa thành biến thể khác để lách canon. Chỉ phân biệt biến thể khi dữ liệu đã nói rõ.',
      '4. Nếu vai trò đã khóa không thuộc cảnh hiện tại, không tự ép nhân vật đó xuất hiện; chỉ dùng như ràng buộc canon nền.',
      '5. Nếu yêu cầu của tác giả mâu thuẫn với vai trò đã khóa, ưu tiên hỏi lại hoặc nêu rõ cần đổi canon, không tự sửa ngầm.',
      '6. Khi chưa chắc một vai trò mới có trùng với vai trò đã khóa hay không, viết trung tính và không tạo thêm canon mới.',
    ].join('\n');
  };

  const hasRelationshipContextPacket = Boolean(
    relationshipContextPacket
    && (
      relationshipContextPacket.mustIncludeEdges?.length > 0
      || relationshipContextPacket.supportingEdges?.length > 0
      || relationshipContextPacket.warnings?.length > 0
      || relationshipContextPacket.omittedSummary?.count > 0
    )
  );

  const formatRelationshipContextEdge = (edge) => {
    const bits = [];
    bits.push((edge.characterAName || ('#' + edge.characterAId)) + ' ↔ ' + (edge.characterBName || ('#' + edge.characterBId)));
    bits.push(edge.label || edge.relationshipType || 'Quan hệ');
    if (edge.intimacyLevel && edge.intimacyLevel !== 'none') bits.push('thân mật: ' + edge.intimacyLevel);
    if (edge.secrecyState && edge.secrecyState !== 'public') bits.push('bí mật: ' + edge.secrecyState);
    if (edge.consentState && edge.consentState !== 'unknown') bits.push('đồng thuận: ' + edge.consentState);
    if (edge.emotionalAftermath) bits.push('dư âm: ' + edge.emotionalAftermath);
    if (edge.summary) bits.push(edge.summary);
    return '- ' + bits.join(' | ');
  };

  const buildRelationshipContextLayer = () => {
    if (!hasRelationshipContextPacket) return '';
    const parts = [];
    if (relationshipContextPacket.mustIncludeEdges?.length > 0) {
      parts.push('Quan hệ bắt buộc giữ đúng:\n' + relationshipContextPacket.mustIncludeEdges.map(formatRelationshipContextEdge).join('\n'));
    }
    if (relationshipContextPacket.supportingEdges?.length > 0) {
      parts.push('Quan hệ hỗ trợ liên quan:\n' + relationshipContextPacket.supportingEdges.map(formatRelationshipContextEdge).join('\n'));
    }
    if (relationshipContextPacket.warnings?.length > 0) {
      parts.push('Cảnh báo bộ nhớ quan hệ:\n' + relationshipContextPacket.warnings.map(function (item) { return '- ' + item; }).join('\n'));
    }
    if (relationshipContextPacket.omittedSummary?.count > 0) {
      const reasons = relationshipContextPacket.omittedSummary.topReasons?.length > 0
        ? ' Lý do chính: ' + relationshipContextPacket.omittedSummary.topReasons.join('; ')
        : '';
      parts.push('Đã cắt ' + relationshipContextPacket.omittedSummary.count + ' quan hệ ngoài trọng tâm để giữ ngân sách context.' + reasons);
    }
    return '\n[BỘ NHỚ QUAN HỆ LIÊN QUAN]\n' + parts.join('\n\n');
  };

  const PROSE_DIALOGUE_DISCIPLINE_LAYER = [
    '\n[KỶ LUẬT VĂN XUÔI VÀ THOẠI - BỔ SUNG BẮT BUỘC]',
    '- Viết thành văn xuôi hoàn chỉnh, không dàn ý, không tóm tắt, không bullet, không markdown, không heading meta trong prose.',
    '- Tách rõ hành động, nội tâm, câu dẫn và thoại; đổi người nói thì xuống dòng.',
    '- Không nhồi nhiều lượt thoại của nhiều người vào cùng một đoạn.',
    '- Mỗi đoạn chỉ nên có một trọng tâm: hành động, cảm giác, quan sát, nội tâm, hoặc một lượt thoại.',
    '- Thoại phải tự nhiên theo speech_pattern, quan hệ, tuổi/tầng lớp và cảm xúc hiện tại của từng nhân vật.',
    '- Nếu age/tuổi được cung cấp, chỉ dùng như ngữ cảnh tham khảo cho xưng hô, độ trưởng thành, nhịp thoại, vốn sống và phản ứng tâm lý; không biến nó thành khuôn nói cứng nhắc.',
    '- Không ngắt câu máy móc; câu ngắn chỉ dùng khi cần tạo nhịp, không lặp liên tiếp vô nghĩa.',
    '- Không để nhân vật nói như đang liệt kê ý.',
    '- Không để nhân vật tự giải thích hồ sơ, thân thế, tính cách, quá khứ nếu không có động cơ trong cảnh.',
    '- Không tóm tắt thay cho viết cảnh.',
  ].join('\n');

  // FREE_PROMPT: skip heavy writing layers for questions/chat
  const freePromptInProject = taskType === TASK_TYPES.FREE_PROMPT && !!(projectId || chapterId);
  const skipWritingLayers = taskType === TASK_TYPES.FREE_PROMPT && !freePromptInProject && !isWritingIntent(userPrompt);
  const projectStyleRuntime = getProjectStyleRuntimeState({
    taskType,
    skipWritingLayers,
    aiGuidelines,
    promptTemplates,
    genre,
    writingStyle: resolvedWritingStyle,
    projectStyleRuntimeBlock,
    projectStyleRuntimeEnabled,
    projectStyleRuntimeMeta,
  });

  // -- Layer 0: Grand Strategy & Pacing (merged) --
  // Keep this before Layer 1 so arc constraints stay highly visible.
  const grandStrategyLayer = buildGrandStrategyLayer(
    taskType,
    currentMacroArc,
    currentArc,
    ultimateGoal,
    targetLength,
    currentChapterIndex,
    milestones
  );
  if (grandStrategyLayer && !skipWritingLayers) {
    systemParts.push(grandStrategyLayer);
  }

  const macroArcContractLayer = buildMacroArcContractLayer(taskType, effectiveMacroArcContract);
  if (macroArcContractLayer) {
    systemParts.push(macroArcContractLayer);
  }

  // -- Layer 0.5: Author DNA --
  // Inject before Layer 1 so the AI internalizes role and writing philosophy first.
  const authorDNALayer = buildAuthorDNALayer(
    taskType,
    resolvedWritingStyle,
    currentChapterIndex,
    targetLength,
    currentChapterOutline,
    currentMacroArc
  );
  if (authorDNALayer && !skipWritingLayers) {
    systemParts.push(authorDNALayer);
  }

  // Inject NSFW rules at high priority when mature mode is enabled.
  if (nsfwMode || superNsfwMode) {
    systemParts.push(resolveNsfwRules(promptTemplates));
    const nsfwIntimateLayer = buildNsfwIntimateSystemLayer(taskType, {
      userPrompt,
      sceneText,
      selectedText,
      retrievalPacket,
      relationshipContextPacket,
      promptTemplates,
    });
    if (nsfwIntimateLayer) {
      systemParts.push(nsfwIntimateLayer);
    }
  }

  // -- Layer 1: System Identity --
  systemParts.push(resolveSystemIdentityPrompt());

  if (WRITING_DISCIPLINE_TASKS.has(taskType) && !skipWritingLayers) {
    systemParts.push(DEFAULT_WRITING_DISCIPLINE_LAYER);
  }

  // Project info with POV
  const povLabel = { first: 'Ngôi 1', third_limited: 'Ngôi 3 hạn chế', third_omni: 'Ngôi 3 toàn tri', multi_pov: 'Đa góc nhìn' };
  const projectInfo = ['Truyện: ' + (projectTitle || 'Chưa đặt tên')];
  if (genre) projectInfo.push('Thể loại: ' + genre);
  if (tone) projectInfo.push('Tone: ' + tone);
  if (povMode) projectInfo.push('Góc nhìn: ' + (povLabel[povMode] || povMode));
  systemParts.push('\n[' + projectInfo.join(' - ') + ']');

  if (chapterTitle) systemParts.push('[Chương hiện tại: ' + chapterTitle + ']');
  if (sceneTitle) systemParts.push('[Cảnh hiện tại: ' + sceneTitle + ']');

  // POV instruction
  if (povMode === 'first') {
    systemParts.push('[GÓC NHÌN]: Viết ngôi thứ nhất (tôi/ta). Chỉ mô tả những gì nhân vật POV thấy, nghe, cảm nhận. KHÔNG viết suy nghĩ nhân vật khác.');
  } else if (povMode === 'third_limited') {
    systemParts.push('[GÓC NHÌN]: Viết ngôi thứ ba hạn chế. Theo sát 1 nhân vật mỗi cảnh - chỉ biết suy nghĩ/cảm xúc của nhân vật đó.');
  } else if (povMode === 'third_omni') {
    systemParts.push('[GÓC NHÌN]: Viết ngôi thứ ba toàn tri. Có thể vào tâm trí mọi nhân vật.');
  } else if (povMode === 'multi_pov') {
    systemParts.push('[GÓC NHÌN]: Đa góc nhìn - mỗi cảnh/chương theo 1 nhân vật. Giữ nhất quán trong cùng 1 cảnh.');
  }

  if (projectStyleRuntime.active) {
    systemParts.push(projectStyleRuntime.systemBlock);
  }

  // -- Layer 1.5: Writing Constitution (nguyen tac sang tac) --
  // Moved upward because the model pays more attention near the top of the prompt.
  // Dung strictness de frame: strict = khong the vi pham, relaxed = goi y.
  if (aiGuidelines && !projectStyleRuntime.active) {
    const principleHeader = aiStrictness === 'strict'
      ? 'NGUYÊN TẮC SÁNG TÁC - TUYỆT ĐỐI TUÂN THỦ'
      : aiStrictness === 'relaxed'
        ? 'GỢI Ý SÁNG TÁC'
        : 'NGUYÊN TẮC SÁNG TÁC';
    systemParts.push('\n[' + principleHeader + ']\n' + aiGuidelines);
  }

  const constitutionRules = listFromTemplate(promptTemplates.constitution);
  if (constitutionRules.length > 0 && !skipWritingLayers && !projectStyleRuntime.active) {
    systemParts.push('\n[LUẬT CỐT LÕI CỦA TRUYỆN - BẮT BUỘC TUÂN THỦ]\n' + constitutionRules.map(function(rule, index) {
      return (index + 1) + '. ' + rule;
    }).join('\n'));
  }

  // -- Layer 2: Task Instruction --
  const rawTaskInstruction = promptTemplates[taskType] || TASK_INSTRUCTIONS[taskType];
  const taskInstruction = composeTaskInstruction(taskType, rawTaskInstruction);
  if (taskInstruction) {
    systemParts.push('\n[NHIỆM VỤ]\n' + taskInstruction);
  }

  const canonRoleLocksLayer = buildCanonRoleLocksLayer(canonRoleLocks);
  if (canonRoleLocksLayer && !skipWritingLayers) {
    systemParts.push(canonRoleLocksLayer);
  }

  // -- Layer 3: Genre Constraints --
  // Always inject genre constraints when available; do not gate them behind aiGuidelines.
  // aiGuidelines (Constitution) la nguyen tac CUA TAC GIA.
  // Genre constraint la quy tac CUA THE LOAI. Hai thu khac nhau, can ca hai.
  {
    const genreConstraint = GENRE_CONSTRAINTS[genreKey];
    if (genreConstraint) {
      systemParts.push('\n[THỂ LOẠI]\n' + genreConstraint);
    }
  }

  // Synopsis
  if (synopsis) {
    systemParts.push('\n[CỐT TRUYỆN CHÍNH]\n' + synopsis);
  }

  // Story structure
  const structureHints = {
    three_act: 'Cấu trúc 3 Hồi: Hồi 1 thiết lập, Hồi 2 xung đột leo thang, Hồi 3 giải quyết.',
    hero_journey: 'Hành trình Anh hùng: Thế giới bình thường > Lời kêu gọi > Thử thách > Mất mát > Chiến thắng > Trở về.',
    isekai_system: 'Isekai/Hệ Thống: Thức tỉnh hệ thống > Khám phá > Farm/grind > Build thế lực > Đỉnh cao.',
    slice_of_life: 'Lát cắt cuộc sống: Tập trung nhân vật và cảm xúc.',
    mystery: 'Trinh thám: Vụ án > Manh mối > Tình nghi > Twist > Sự thật.',
  };
  if (storyStructure && structureHints[storyStructure]) {
    systemParts.push('[CẤU TRÚC TRUYỆN]: ' + structureHints[storyStructure]);
  }

  // Pronoun style
  if (pronounStyle && pronounStyle.default_self) {
    systemParts.push('[XƯNG HÔ MẶC ĐỊNH - ' + pronounStyle.label + ']: Tự xưng "' + pronounStyle.default_self + '", gọi người "' + pronounStyle.default_other + '". Tuân theo xưng hô riêng của từng nhân vật nếu có.');
  } else {
    const pronounPresetKey = GENRE_PRONOUN_MAP[genreKey];
    const pronounPreset = pronounPresetKey ? PRONOUN_PRESETS[pronounPresetKey] : null;
    if (pronounPreset) {
      systemParts.push('[XƯNG HÔ MẶC ĐỊNH - ' + pronounPreset.label + ']: Tự xưng "' + pronounPreset.default_self + '", gọi người "' + pronounPreset.default_other + '". Tuân theo xưng hô riêng của từng nhân vật nếu có.');
    }
  }

  // -- Layer 4: Canon Context --
  const canonContextParts = [];

  // World Profile
  if (worldProfile.name || worldProfile.description || (worldProfile.rules && worldProfile.rules.length > 0)) {
    let wpText = 'Thế giới: ' + (worldProfile.name || 'Chưa đặt tên');
    if (worldProfile.type) wpText += ' - Loại: ' + worldProfile.type;
    if (worldProfile.scale) wpText += ' - Quy mô: ' + worldProfile.scale;
    if (worldProfile.era) wpText += ' - Thời đại: ' + worldProfile.era;
    if (worldProfile.rules && worldProfile.rules.length > 0) {
      wpText += '\nQuy tắc cốt lõi:\n' + worldProfile.rules.map(function (r) { return '* ' + r; }).join('\n');
    }
    if (worldProfile.description) {
      wpText += '\nMô tả: ' + worldProfile.description;
    }
    canonContextParts.push(wpText);
  }

  if (previousSummary) {
    canonContextParts.push('Tóm tắt chương trước:\n' + previousSummary);
  }

  if (locations.length > 0) {
    const locInfo = locations.map(function (l) {
      const extras = [];
      if (l.description) extras.push(l.description);
      if (l.story_function) extras.push('vai trò: ' + l.story_function);
      return '- ' + l.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('Địa danh xuất hiện:\n' + locInfo);
  }

  if (objects.length > 0) {
    const objInfo = objects.map(function (o) {
      const extras = [];
      if (o.description) extras.push(o.description);
      if (o.story_function) extras.push('vai trò: ' + o.story_function);
      return '- ' + o.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('Vật phẩm:\n' + objInfo);
  }

  if (factions.length > 0) {
    const factionInfo = factions.map(function (f) {
      const extras = [];
      if (f.description) extras.push(f.description);
      if (f.story_function) extras.push('vai trò: ' + f.story_function);
      return '- ' + f.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('Thế lực liên quan:\n' + factionInfo);
  }

  if (worldTerms.length > 0) {
    const termInfo = worldTerms.map(function (t) {
      const extras = [];
      if (t.definition) extras.push(t.definition);
      if (t.story_function) extras.push('vai trò: ' + t.story_function);
      return '- ' + t.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('Thuật ngữ thế giới:\n' + termInfo);
  }

  if (canonContextParts.length > 0) {
    systemParts.push('\n[BỐI CẢNH TRUYỆN]\n' + canonContextParts.join('\n\n'));
  }

  if (fanficCanonContext && !skipWritingLayers) {
    const fanficParts = [];
    fanficParts.push('Canon Pack: ' + (fanficCanonContext.packTitle || 'Canon Pack'));
    fanficParts.push('Chế độ: ' + (fanficCanonContext.projectMode || 'fanfic'));
    fanficParts.push('Mức bám canon: ' + (fanficCanonContext.adherenceLevel || 'balanced'));
    if (fanficCanonContext.divergencePoint) {
      fanficParts.push('Điểm rẽ nhánh có chủ đích: ' + fanficCanonContext.divergencePoint);
    }
    if (fanficCanonContext.globalCanon) {
      fanficParts.push('Global Canon:\n' + fanficCanonContext.globalCanon);
    }
    if (fanficCanonContext.characterCanon?.length > 0) {
      fanficParts.push('Nhân vật liên quan:\n' + fanficCanonContext.characterCanon.map(function (character) {
        return '- ' + character.name + (character.status ? ': ' + character.status : '') + (character.voice ? ' | Giọng: ' + character.voice : '');
      }).join('\n'));
    }
    if (fanficCanonContext.relationshipCanon?.length > 0) {
      fanficParts.push('Quan hệ liên quan:\n' + fanficCanonContext.relationshipCanon.map(function (relationship) {
        return '- ' + (relationship.characterA || relationship.charA || '?') + ' / ' + (relationship.characterB || relationship.charB || '?') + ': ' + (relationship.change || relationship.relation || '');
      }).join('\n'));
    }
    if (fanficCanonContext.styleCanon) {
      fanficParts.push('Style Canon:\n' + fanficCanonContext.styleCanon);
    }
    if (fanficCanonContext.canonRestrictions?.length > 0) {
      fanficParts.push('Điều cấm phá canon:\n' + fanficCanonContext.canonRestrictions.map(function (item) { return '- ' + item; }).join('\n'));
    }
    if (fanficCanonContext.creativeGaps?.length > 0) {
      fanficParts.push('Khoảng trống có thể sáng tạo:\n' + fanficCanonContext.creativeGaps.map(function (item) { return '- ' + item; }).join('\n'));
    }
    systemParts.push('\n[CANON PACK CHO ĐỒNG NHÂN / VIẾT LẠI]\n' + fanficParts.join('\n\n'));
  }

  // -- Layer 4.2: Chapter Outline Context (Phase 8) --
  const chapterOutlineLayer = buildChapterOutlineLayer(
    taskType,
    currentChapterOutline,
    chapterBlueprintContext,
    upcomingChapters
  );
  if (chapterOutlineLayer && !skipWritingLayers) {
    systemParts.push(chapterOutlineLayer);
  }

  const outlinePlannerLayer = buildOutlinePlannerLayer(
    taskType,
    currentChapterOutline,
    chapterText,
    chapterSceneCount,
    storyProgressBudget,
    targetLength,
    currentChapterIndex,
    currentMacroArc,
    milestones
  );
  if (outlinePlannerLayer && !skipWritingLayers) {
    systemParts.push(outlinePlannerLayer);
  }

  const preWriteValidationLayer = buildPreWriteValidationLayer(taskType, preWriteValidation);
  if (preWriteValidationLayer && !skipWritingLayers) {
    systemParts.push(preWriteValidationLayer);
  }

  // [Layer 4.5 removed - merged into Grand Strategy (Layer 0)]

  const outlineCharacterRosterLayer = buildOutlineCharacterRosterLayer();
  if (outlineCharacterRosterLayer && !skipWritingLayers) {
    systemParts.push(outlineCharacterRosterLayer);
    systemParts.push(CURRENT_STATUS_LIVE_CANON_RULES);
    systemParts.push(CANON_FABRICATION_GUARDRAIL);
  }

  // -- Layer 5: Character State (token budget: max 15) --
  if (characterContextGate) {
    const characterBlocks = [
      buildPermissionedCharacterBlock(
        'NHÂN VẬT ĐƯỢC XUẤT HIỆN TRỰC TIẾP TRONG CẢNH',
        'QUYỀN: Nhóm này được nói thoại, hành động và xuất hiện trực tiếp trong cảnh, NHƯNG vẫn phải chịu ràng buộc current_status/Character Live Canon.',
        characterContextGate.sceneCast,
        15
      ),
      buildPermissionedCharacterBlock(
        'NHÂN VẬT QUAN TRỌNG CỦA CHƯƠNG - KHÔNG TỰ ĐỘNG XUẤT HIỆN TRONG CẢNH',
        'QUYỀN: Chỉ dùng để giữ hướng chương; không tự đưa vào cảnh, không cho nói thoại/hành động nếu scene cast không có.',
        characterContextGate.chapterFocusCast,
        10
      ),
      buildPermissionedCharacterBlock(
        'CANON NHÂN VẬT LIÊN QUAN / ĐƯỢC NHẮC TỚI',
        'QUYỀN: Chỉ làm nền canon hoặc được nhắc tới; không tự cho xuất hiện trực tiếp, nói thoại, hay hành động.',
        characterContextGate.referencedCanonCast,
        8
      ),
    ].filter(Boolean);
    if (characterBlocks.length > 0) {
      systemParts.push(characterBlocks.join('\n\n') + '\n\nQUY TẮC NHÂN VẬT: Dùng tên chính thức ở đầu dòng khi tham chiếu nhân vật. Tên ngắn, biệt danh, danh xưng, họ/tên đệm chỉ là alias của nhân vật đã có; không biến chúng thành nhân vật mới.');
      systemParts.push(CURRENT_STATUS_LIVE_CANON_RULES);
      systemParts.push(CANON_FABRICATION_GUARDRAIL);
    }
  } else {
    var cappedCharacters = characters.slice(0, 15);
    if (cappedCharacters.length > 0) {
      const charInfo = cappedCharacters.map(formatCharacterProfile).join('\n');
      systemParts.push('\n[NHÂN VẬT XUẤT HIỆN]\n' + charInfo + '\n\nQUY TẮC NHÂN VẬT: Dùng tên chính thức ở đầu dòng khi tham chiếu nhân vật. Tên ngắn, biệt danh, danh xưng, họ/tên đệm chỉ là alias của nhân vật đã có; không biến chúng thành nhân vật mới.');
      systemParts.push(CURRENT_STATUS_LIVE_CANON_RULES);
      systemParts.push(CANON_FABRICATION_GUARDRAIL);
    }
  }

  const relationshipContextLayer = buildRelationshipContextLayer();
  if (relationshipContextLayer) {
    systemParts.push(relationshipContextLayer);
  }

  // Legacy relationships: keep only as fallback while relationshipContextPacket is unavailable.
  if (!hasRelationshipContextPacket && relationships.length > 0) {
    const relInfo = relationships.map(function (r) {
      return '- ' + r.charA + ' <-> ' + r.charB + ': ' + r.label + (r.description ? ' (' + r.description + ')' : '');
    }).join('\n');
    systemParts.push('\n[QUAN HỆ NHÂN VẬT]\n' + relInfo);
  }

  // Taboos - tone adjusted by ai_strictness
  if (taboos.length > 0) {
    const tabooPrefix = aiStrictness === 'strict' ? 'TUYỆT ĐỐI KHÔNG' :
      aiStrictness === 'relaxed' ? 'Nên tránh' : 'Không nên';
    const tabooLines = taboos.map(function (t) {
      const who = t.characterName || 'Tất cả nhân vật';
      return tabooPrefix + ': ' + who + ' - ' + t.description;
    }).join('\n');
    const tabooHeader = aiStrictness === 'strict' ? 'CẤM KỴ - VI PHẠM LÀ LỖI NGHIÊM TRỌNG' :
      aiStrictness === 'relaxed' ? 'LƯU Ý - NÊN TRÁNH' : 'CẤM KỴ';
    systemParts.push('\n[' + tabooHeader + ']\n' + tabooLines);
  }

  // -- Layer 5.5: Bridge Memory (Phase 7) --
  const bridgeLayer = buildBridgeMemoryLayer(taskType, bridgeBuffer, previousEmotionalState, tensionLevel);
  if (bridgeLayer && !skipWritingLayers) {
    systemParts.push(bridgeLayer);
  }

  // -- Layer 6: Scene Contract (Phase 4) --
  const contractParts = [];
  if (sceneContract.goal) contractParts.push('Mục tiêu: ' + sceneContract.goal);
  if (sceneContract.conflict) contractParts.push('Xung đột: ' + sceneContract.conflict);
  if (sceneContract.emotional_start || sceneContract.emotional_end) {
    contractParts.push('Cảm xúc: ' + (sceneContract.emotional_start || '?') + ' -> ' + (sceneContract.emotional_end || '?'));
  }
  if (sceneContract.must_happen && sceneContract.must_happen.length > 0) {
    contractParts.push('BẮT BUỘC xảy ra:\n' + sceneContract.must_happen.map(function (m) { return '[v] ' + m; }).join('\n'));
  }
  if (sceneContract.must_not_happen && sceneContract.must_not_happen.length > 0) {
    contractParts.push('CẤM xảy ra:\n' + sceneContract.must_not_happen.map(function (m) { return '[x] ' + m; }).join('\n'));
  }
  if (sceneContract.pacing) {
    const pacingMap = { slow: 'Chậm - miêu tả chi tiết', medium: 'Trung bình', fast: 'Nhanh - hành động liên tục' };
    contractParts.push('Nhịp: ' + (pacingMap[sceneContract.pacing] || sceneContract.pacing));
  }
  if (contractParts.length > 0) {
    const contractHeader = aiStrictness === 'strict' ? 'HỢP ĐỒNG CẢNH - BẮT BUỘC TUÂN THỦ' :
      aiStrictness === 'relaxed' ? 'GỢI Ý CHO CẢNH' : 'HỢP ĐỒNG CẢNH';
    systemParts.push('\n[' + contractHeader + ']\n' + contractParts.join('\n'));
  }

  // Canon Facts (Phase 4)
  if (canonFacts.length > 0) {
    const facts = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'fact'; });
    const secrets = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'secret'; });
    const rules = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'rule'; });
    const cParts = [];
    if (facts.length > 0) cParts.push('Sự thật:\n' + facts.map(function (f) { return '- ' + f.description; }).join('\n'));
    if (rules.length > 0) cParts.push('Quy tắc:\n' + rules.map(function (f) { return '- ' + f.description; }).join('\n'));
    if (secrets.length > 0) cParts.push('BÍ MẬT - CHƯA TIẾT LỘ:\n' + secrets.map(function (f) { return '[x] ' + f.description; }).join('\n'));
    if (cParts.length > 0) systemParts.push('\n[CANON TRUYEN]\n' + cParts.join('\n\n'));
  }

  if (retrievalPacket && (retrievalPacket.relevantEntityStates?.length > 0 || retrievalPacket.activeThreadStates?.length > 0)) {
    const canonBits = [];
    if (retrievalPacket.relevantEntityStates?.length > 0) {
      canonBits.push('Trạng thái canon hiện tại:\n' + retrievalPacket.relevantEntityStates.map(function (state) {
        const summaryParts = [];
        if (state.alive_status === 'dead') summaryParts.push('đã chết');
        else if (state.alive_status === 'alive') summaryParts.push('còn sống');
        if (state.rescued) summaryParts.push('đã được cứu');
        if (state.current_location_name) summaryParts.push('o ' + state.current_location_name);
        if (state.allegiance) summaryParts.push('phe ' + state.allegiance);
        if (Array.isArray(state.goals_active) && state.goals_active.length > 0) summaryParts.push('mục tiêu: ' + state.goals_active.join(', '));
        return '- Entity #' + state.entity_id + ': ' + summaryParts.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.activeThreadStates?.length > 0) {
      canonBits.push('Thread đang mở:\n' + retrievalPacket.activeThreadStates.map(function (threadState) {
        return '- Thread #' + threadState.thread_id + ' [' + (threadState.state || 'active') + ']: ' + (threadState.summary || '');
      }).join('\n'));
    }
    if (retrievalPacket.relevantItemStates?.length > 0) {
      canonBits.push('Vật phẩm / tài nguyên liên quan:\n' + retrievalPacket.relevantItemStates.map(function (state) {
        const itemBits = [];
        itemBits.push('trạng thái: ' + (state.availability || 'available'));
        if (state.owner_character_id) itemBits.push('chủ sở hữu #' + state.owner_character_id);
        if (state.current_location_name) itemBits.push('o ' + state.current_location_name);
        if (state.is_consumed) itemBits.push('đã dùng hết');
        if (state.is_damaged) itemBits.push('đã hư hỏng');
        if (state.summary) itemBits.push(state.summary);
        return '- Vật phẩm #' + state.object_id + ': ' + itemBits.join(' | ');
      }).join('\n'));
    }
    if (!hasRelationshipContextPacket && retrievalPacket.relevantRelationshipStates?.length > 0) {
      canonBits.push('Quan hệ / độ thân mật liên quan:\n' + retrievalPacket.relevantRelationshipStates.map(function (state) {
        const relBits = [];
        if (state.relationship_type) relBits.push('quan hệ: ' + state.relationship_type);
        if (state.intimacy_level && state.intimacy_level !== 'none') relBits.push('thân mật: ' + state.intimacy_level);
        if (state.secrecy_state) relBits.push('bí mật: ' + state.secrecy_state);
        if (state.consent_state && state.consent_state !== 'unknown') relBits.push('đồng thuận: ' + state.consent_state);
        if (state.emotional_aftermath) relBits.push('dư âm cảm xúc: ' + state.emotional_aftermath);
        if (state.summary) relBits.push(state.summary);
        return '- Cap #' + state.character_a_id + ' & #' + state.character_b_id + ': ' + relBits.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.criticalConstraints) {
      const constraints = [];
      if (retrievalPacket.criticalConstraints.deadCharacters?.length > 0) {
        constraints.push('Nhân vật đã chết: ' + retrievalPacket.criticalConstraints.deadCharacters.map(function (id) { return '#' + id; }).join(', '));
      }
      if (retrievalPacket.criticalConstraints.unavailableItems?.length > 0) {
        constraints.push('Vật phẩm không còn dùng được: ' + retrievalPacket.criticalConstraints.unavailableItems.map(function (item) {
          return (item.object_name || ('#' + item.object_id)) + ' (' + item.availability + ')';
        }).join(', '));
      }
      if (!hasRelationshipContextPacket && retrievalPacket.criticalConstraints.relationshipConstraints?.length > 0) {
        constraints.push('Ràng buộc quan hệ gần đây:\n' + retrievalPacket.criticalConstraints.relationshipConstraints.map(function (item) {
          const bits = [];
          if (item.intimacy_level && item.intimacy_level !== 'none') bits.push('thân mật=' + item.intimacy_level);
          if (item.secrecy_state) bits.push('bí mật=' + item.secrecy_state);
          if (item.consent_state && item.consent_state !== 'unknown') bits.push('đồng thuận=' + item.consent_state);
          if (item.emotional_aftermath) bits.push('dư âm=' + item.emotional_aftermath);
          return '- ' + item.pair_key + ': ' + bits.join(' | ');
        }).join('\n'));
      }
      if (constraints.length > 0) {
        canonBits.push('Ràng buộc cứng:\n' + constraints.join('\n'));
      }
    }
    if (retrievalPacket.relevantEvidence?.length > 0) {
      canonBits.push('Bằng chứng liên quan:\n' + retrievalPacket.relevantEvidence.map(function (item) {
        return '- ' + (item.summary || item.evidence_text || item.target_type || 'Bằng chứng');
      }).join('\n'));
    }
    if (canonBits.length > 0) {
      systemParts.push('\n[CANON ENGINE]\n' + canonBits.join('\n\n'));
    }
  }

  if (retrievalPacket?.recentChapterMemory?.length > 0 && WRITING_TASKS_FOR_BRIDGE.has(taskType) && !skipWritingLayers) {
    const memoryBlock = retrievalPacket.recentChapterMemory
      .map(function (item) {
        const parts = [];
        parts.push('[' + (item.chapter_title || ('Chương ' + (item.chapter_order + 1))) + ']');
        if (item.summary) parts.push('Tóm tắt: ' + item.summary);
        if (item.bridge_buffer) parts.push('Nhịp văn nối tiếp: ' + item.bridge_buffer);
        if (item.emotional_state?.mood || item.emotional_state?.activeConflict || item.emotional_state?.lastAction) {
          parts.push('Dư âm cảm xúc: ' + JSON.stringify(item.emotional_state));
        }
        if (item.events?.length > 0) {
          parts.push('Sự kiện then chốt:\n' + item.events.map(function (event) {
            return '- ' + (event.summary || event.op_type || 'Sự kiện');
          }).join('\n'));
        }
        if (item.prose) parts.push('Văn bản chương:\n' + item.prose);
        return parts.join('\n');
      })
      .join('\n\n-----\n\n');
    systemParts.push(`\n[BỘ NHỚ ${retrievalPacket.recentChapterMemory.length} CHƯƠNG GẦN NHẤT]\n${memoryBlock}`);
  }

  // -- Layer 6.5: Plot Threads --
  if (plotThreads.length > 0) {
    var cappedThreads = plotThreads.slice(0, 10);
    const threadInfo = cappedThreads.map(function (pt) {
      const typeMap = { main: 'Tuyến Chính', subplot: 'Tuyến Phụ', character_arc: 'Phát Triển Nhân Vật', mystery: 'Bí Ẩn', romance: 'Tình Cảm' };
      const ptType = typeMap[pt.type] || 'Tuyến Truyện';
      const mark = pt.is_focus_in_scene ? '[TIÊU ĐIỂM CẢNH] ' : '';
      return '- ' + mark + '[' + ptType + '] ' + pt.title + (pt.description ? ': ' + pt.description : '');
    }).join('\n');
    systemParts.push('\n[CÁC TUYẾN TRUYỆN ĐANG MỞ]\n' + threadInfo);
  }

  // -- Layer 7: Style DNA --
  const styleDNALayer = buildStyleDNALayer(taskType, resolvedWritingStyle);
  if (styleDNALayer && !skipWritingLayers) {
    if (!projectStyleRuntime.active) {
      systemParts.push(styleDNALayer);
      const projectStyleDNA = listFromTemplate(promptTemplates.style_dna);
      if (projectStyleDNA.length > 0) {
        systemParts.push('\n[DNA VĂN PHONG CỦA TRUYỆN - PROJECT OVERRIDE]\n' + projectStyleDNA.map(function(rule, index) {
          return (index + 1) + '. ' + rule;
        }).join('\n'));
      }
      // Append the Anti-AI Blacklist right after Style DNA.
      const antiAIBlock = buildAntiAIBlock(resolvedWritingStyle);
      if (antiAIBlock) systemParts.push(antiAIBlock);
      const projectBlacklist = listFromTemplate(promptTemplates.anti_ai_blacklist);
      if (projectBlacklist.length > 0) {
        systemParts.push('\n[TỪ/CỤM CẦN TRÁNH CỦA TRUYỆN - PROJECT BLACKLIST]\n' + [
          'KHÔNG ĐƯỢC dùng các từ/cụm sau trong văn bản đầu ra:',
          ...projectBlacklist.map(function(item) { return '- ' + item; }),
        ].join('\n'));
      }
    }
    systemParts.push(PROSE_DIALOGUE_DISCIPLINE_LAYER);
  }

  // -- Layer 7.5: Mood Board --
  const moodBoardLayer = buildMoodBoardLayer(
    taskType,
    genreKey,
    bridgeBuffer,
    selectedText || ''
  );
  if (moodBoardLayer && !skipWritingLayers) {
    systemParts.push(moodBoardLayer);
  }

  // -- Layer 10: Length & Rhythm Anchor (reframed: positive > negative) --
  if (WRITING_TASKS_FOR_BRIDGE.has(taskType) && !skipWritingLayers) {
    systemParts.push('\n[ĐỘ DÀI VÀ NHỊP ĐỘ]\n' + [
      '1. Phát triển đầy đủ mỗi cảnh trước khi chuyển tiếp - mỗi hành động nhỏ được miêu tả 3-5 câu, tạo hình ảnh sống động.',
      '2. Suy nghĩ nội tâm được đào sâu ít nhất 1 đoạn văn đầy đủ.',
      '3. Tôn trọng mục tiêu độ dài trong [NHIỆM VỤ]. Nếu nhiệm vụ không nêu mục tiêu riêng, hướng tới 2000-4000 từ mỗi lần sinh để đóng góp vào mục tiêu 7000 từ cho CẢ CHƯƠNG.',
      '4. Duy trì nhịp kể liên tục - mỗi câu đẩy chuyển tiếp sang câu sau tự nhiên.',
      '5. Nếu gần hết độ dài output: dừng lại ở điểm kịch tính, để ngỏ cho phần tiếp. Tốt hơn là để độc giả thêm muốn đọc tiếp hơn là cưỡng kết thúc.',
      '6. CẤU TRÚC ĐOẠN VĂN: 30-50% đoạn nên là đoạn 1-2 câu. Thông tin quan trọng tách riêng thành đoạn ngắn. KHÔNG viết khối văn dài 5-6 câu liên tục.',
      '7. MỖI ĐOẠN tối đa 80-100 từ. Đoạn dài hơn thì tách thành 2. Độc giả Việt đọc nhanh, đoạn ngắn dễ theo dõi.',
      '8. NHỊP THỞ: Xen kẽ đoạn ngắn (1-2 câu) và đoạn dài (3-4 câu) - như nhịp thở văn xuôi. Tránh viết đều đều cùng nhịp.',
    ].join('\n'));
  }


  return {
    systemParts,
    effectiveMacroArcContract,
    userPrompt,
    skipWritingLayers,
    nsfwMode,
    superNsfwMode,
  };
}
