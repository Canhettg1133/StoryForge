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
    nsfwMode = false,
    superNsfwMode = false,
    sceneList = [],
    validatorReports = [],
    retrievalPacket = null,
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

  // FREE_PROMPT: skip heavy writing layers for questions/chat
  const freePromptInProject = taskType === TASK_TYPES.FREE_PROMPT && !!(projectId || chapterId);
  const skipWritingLayers = taskType === TASK_TYPES.FREE_PROMPT && !freePromptInProject && !isWritingIntent(userPrompt);

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
  const povLabel = { first: 'Ngoi 1', third_limited: 'Ngoi 3 han che', third_omni: 'Ngoi 3 toan tri', multi_pov: 'Da goc nhin' };
  const projectInfo = ['Truyen: ' + (projectTitle || 'Chua dat ten')];
  if (genre) projectInfo.push('The loai: ' + genre);
  if (tone) projectInfo.push('Tone: ' + tone);
  if (povMode) projectInfo.push('Goc nhin: ' + (povLabel[povMode] || povMode));
  systemParts.push('\n[' + projectInfo.join(' - ') + ']');

  if (chapterTitle) systemParts.push('[Chuong hien tai: ' + chapterTitle + ']');
  if (sceneTitle) systemParts.push('[Canh hien tai: ' + sceneTitle + ']');

  // POV instruction
  if (povMode === 'first') {
    systemParts.push('[GOC NHIN]: Viet ngoi thu nhat (toi/ta). Chi mo ta nhung gi nhan vat POV thay, nghe, cam nhan. KHONG viet suy nghi nhan vat khac.');
  } else if (povMode === 'third_limited') {
    systemParts.push('[GOC NHIN]: Viet ngoi thu ba han che. Theo sat 1 nhan vat moi canh - chi biet suy nghi/cam xuc cua nhan vat do.');
  } else if (povMode === 'third_omni') {
    systemParts.push('[GOC NHIN]: Viet ngoi thu ba toan tri. Co the vao tam tri moi nhan vat.');
  } else if (povMode === 'multi_pov') {
    systemParts.push('[GOC NHIN]: Da goc nhin - moi canh/chuong theo 1 nhan vat. Giu nhat quan trong cung 1 canh.');
  }

  // -- Layer 1.5: Writing Constitution (nguyen tac sang tac) --
  // Moved upward because the model pays more attention near the top of the prompt.
  // Dung strictness de frame: strict = khong the vi pham, relaxed = goi y.
  if (aiGuidelines) {
    const principleHeader = aiStrictness === 'strict'
      ? 'NGUYEN TAC SANG TAC - TUYET DOI TUAN THU'
      : aiStrictness === 'relaxed'
        ? 'GOI Y SANG TAC'
        : 'NGUYEN TAC SANG TAC';
    systemParts.push('\n[' + principleHeader + ']\n' + aiGuidelines);
  }

  const constitutionRules = listFromTemplate(promptTemplates.constitution);
  if (constitutionRules.length > 0 && !skipWritingLayers) {
    systemParts.push('\n[LUAT COT LOI CUA TRUYEN - BAT BUOC TUAN THU]\n' + constitutionRules.map(function(rule, index) {
      return (index + 1) + '. ' + rule;
    }).join('\n'));
  }

  // -- Layer 2: Task Instruction --
  const rawTaskInstruction = promptTemplates[taskType] || TASK_INSTRUCTIONS[taskType];
  const taskInstruction = composeTaskInstruction(taskType, rawTaskInstruction);
  if (taskInstruction) {
    systemParts.push('\n[NHIEM VU]\n' + taskInstruction);
  }

  // -- Layer 3: Genre Constraints --
  // Always inject genre constraints when available; do not gate them behind aiGuidelines.
  // aiGuidelines (Constitution) la nguyen tac CUA TAC GIA.
  // Genre constraint la quy tac CUA THE LOAI. Hai thu khac nhau, can ca hai.
  {
    const genreConstraint = GENRE_CONSTRAINTS[genreKey];
    if (genreConstraint) {
      systemParts.push('\n[THE LOAI]\n' + genreConstraint);
    }
  }

  // Synopsis
  if (synopsis) {
    systemParts.push('\n[COT TRUYEN CHINH]\n' + synopsis);
  }

  // Story structure
  const structureHints = {
    three_act: 'Cau truc 3 Hoi: Hoi 1 thiet lap, Hoi 2 xung dot leo thang, Hoi 3 giai quyet.',
    hero_journey: 'Hanh trinh Anh hung: The gioi binh thuong > Loi keu goi > Thu thach > Mat mat > Chien thang > Tro ve.',
    isekai_system: 'Isekai/He Thong: Thuc tinh he thong > Kham pha > Farm/grind > Build the luc > Dinh cao.',
    slice_of_life: 'Lat cat cuoc song: Tap trung nhan vat va cam xuc.',
    mystery: 'Trinh tham: Vu an > Manh moi > Tinh nghi > Twist > Su that.',
  };
  if (storyStructure && structureHints[storyStructure]) {
    systemParts.push('[CAU TRUC TRUYEN]: ' + structureHints[storyStructure]);
  }

  // Pronoun style
  if (pronounStyle && pronounStyle.default_self) {
    systemParts.push('[XUNG HO MAC DINH - ' + pronounStyle.label + ']: Tu xung "' + pronounStyle.default_self + '", goi nguoi "' + pronounStyle.default_other + '". Tuan theo xung ho rieng cua tung nhan vat neu co.');
  } else {
    const pronounPresetKey = GENRE_PRONOUN_MAP[genreKey];
    const pronounPreset = pronounPresetKey ? PRONOUN_PRESETS[pronounPresetKey] : null;
    if (pronounPreset) {
      systemParts.push('[XUNG HO MAC DINH - ' + pronounPreset.label + ']: Tu xung "' + pronounPreset.default_self + '", goi nguoi "' + pronounPreset.default_other + '". Tuan theo xung ho rieng cua tung nhan vat neu co.');
    }
  }

  // -- Layer 4: Canon Context --
  const canonContextParts = [];

  // World Profile
  if (worldProfile.name || worldProfile.description || (worldProfile.rules && worldProfile.rules.length > 0)) {
    let wpText = 'The gioi: ' + (worldProfile.name || 'Chua dat ten');
    if (worldProfile.type) wpText += ' - Loai: ' + worldProfile.type;
    if (worldProfile.scale) wpText += ' - Quy mo: ' + worldProfile.scale;
    if (worldProfile.era) wpText += ' - Thoi dai: ' + worldProfile.era;
    if (worldProfile.rules && worldProfile.rules.length > 0) {
      wpText += '\nQuy tac cot loi:\n' + worldProfile.rules.map(function (r) { return '* ' + r; }).join('\n');
    }
    if (worldProfile.description) {
      wpText += '\nMo ta: ' + worldProfile.description;
    }
    canonContextParts.push(wpText);
  }

  if (previousSummary) {
    canonContextParts.push('Tom tat chuong truoc:\n' + previousSummary);
  }

  if (locations.length > 0) {
    const locInfo = locations.map(function (l) {
      const extras = [];
      if (l.description) extras.push(l.description);
      if (l.story_function) extras.push('vai tro: ' + l.story_function);
      return '- ' + l.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('Dia danh xuat hien:\n' + locInfo);
  }

  if (objects.length > 0) {
    const objInfo = objects.map(function (o) {
      const extras = [];
      if (o.description) extras.push(o.description);
      if (o.story_function) extras.push('vai tro: ' + o.story_function);
      return '- ' + o.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('Vat pham:\n' + objInfo);
  }

  if (factions.length > 0) {
    const factionInfo = factions.map(function (f) {
      const extras = [];
      if (f.description) extras.push(f.description);
      if (f.story_function) extras.push('vai tro: ' + f.story_function);
      return '- ' + f.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('The luc lien quan:\n' + factionInfo);
  }

  if (worldTerms.length > 0) {
    const termInfo = worldTerms.map(function (t) {
      const extras = [];
      if (t.definition) extras.push(t.definition);
      if (t.story_function) extras.push('vai tro: ' + t.story_function);
      return '- ' + t.name + (extras.length > 0 ? ': ' + extras.join(' | ') : '');
    }).join('\n');
    canonContextParts.push('Thuat ngu the gioi:\n' + termInfo);
  }

  if (canonContextParts.length > 0) {
    systemParts.push('\n[BOI CANH TRUYEN]\n' + canonContextParts.join('\n\n'));
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

  // -- Layer 5: Character State (token budget: max 15) --
  var cappedCharacters = characters.slice(0, 15);
  if (cappedCharacters.length > 0) {
    const charInfo = cappedCharacters.map(function (c) {
      const parts = ['- ' + c.name + ' (' + (c.role || 'nhan vat') + ')'];
      if (Array.isArray(c.aliases) && c.aliases.length > 0) parts.push('  Aliases/ten goi khac: ' + c.aliases.join(', '));
      if (c.pronouns_self) parts.push('  Xung: "' + c.pronouns_self + '"' + (c.pronouns_other ? ', goi nguoi: "' + c.pronouns_other + '"' : ''));
      if (c.appearance) parts.push('  Ngoai hinh: ' + c.appearance);
      if (c.personality_tags) parts.push('  Tags: ' + c.personality_tags);
      if (c.personality) parts.push('  Tinh cach: ' + c.personality);
      if (c.flaws) parts.push('  Diem yeu: ' + c.flaws);
      if (c.speech_pattern) parts.push('  Giong noi: ' + c.speech_pattern);
      if (c.current_status) parts.push('  Trang thai hien tai: ' + c.current_status);
      return parts.join('\n');
    }).join('\n');
    systemParts.push('\n[NHAN VAT XUAT HIEN]\n' + charInfo + '\n\nQUY TAC NHAN VAT: Dung ten chinh thuc o dau dong khi tham chieu nhan vat. Ten ngan, biet danh, danh xung, ho/ten dem chi la alias cua nhan vat da co; khong bien chung thanh nhan vat moi.');
  }

  // Relationships (Phase 4)
  if (relationships.length > 0) {
    const relInfo = relationships.map(function (r) {
      return '- ' + r.charA + ' <-> ' + r.charB + ': ' + r.label + (r.description ? ' (' + r.description + ')' : '');
    }).join('\n');
    systemParts.push('\n[QUAN HE NHAN VAT]\n' + relInfo);
  }

  // Taboos - tone adjusted by ai_strictness
  if (taboos.length > 0) {
    const tabooPrefix = aiStrictness === 'strict' ? 'TUYET DOI KHONG' :
      aiStrictness === 'relaxed' ? 'Nen tranh' : 'Khong nen';
    const tabooLines = taboos.map(function (t) {
      const who = t.characterName || 'Tat ca nhan vat';
      return tabooPrefix + ': ' + who + ' - ' + t.description;
    }).join('\n');
    const tabooHeader = aiStrictness === 'strict' ? 'CAM KY - VI PHAM LA LOI NGHIEM TRONG' :
      aiStrictness === 'relaxed' ? 'LUU Y - NEN TRANH' : 'CAM KY';
    systemParts.push('\n[' + tabooHeader + ']\n' + tabooLines);
  }

  // -- Layer 5.5: Bridge Memory (Phase 7) --
  const bridgeLayer = buildBridgeMemoryLayer(taskType, bridgeBuffer, previousEmotionalState, tensionLevel);
  if (bridgeLayer && !skipWritingLayers) {
    systemParts.push(bridgeLayer);
  }

  // -- Layer 6: Scene Contract (Phase 4) --
  const contractParts = [];
  if (sceneContract.goal) contractParts.push('Muc tieu: ' + sceneContract.goal);
  if (sceneContract.conflict) contractParts.push('Xung dot: ' + sceneContract.conflict);
  if (sceneContract.emotional_start || sceneContract.emotional_end) {
    contractParts.push('Cam xuc: ' + (sceneContract.emotional_start || '?') + ' -> ' + (sceneContract.emotional_end || '?'));
  }
  if (sceneContract.must_happen && sceneContract.must_happen.length > 0) {
    contractParts.push('BAT BUOC xay ra:\n' + sceneContract.must_happen.map(function (m) { return '[v] ' + m; }).join('\n'));
  }
  if (sceneContract.must_not_happen && sceneContract.must_not_happen.length > 0) {
    contractParts.push('CAM xay ra:\n' + sceneContract.must_not_happen.map(function (m) { return '[x] ' + m; }).join('\n'));
  }
  if (sceneContract.pacing) {
    const pacingMap = { slow: 'Cham - mieu ta chi tiet', medium: 'Trung binh', fast: 'Nhanh - hanh dong lien tuc' };
    contractParts.push('Nhip: ' + (pacingMap[sceneContract.pacing] || sceneContract.pacing));
  }
  if (contractParts.length > 0) {
    const contractHeader = aiStrictness === 'strict' ? 'HOP DONG CANH - BAT BUOC TUAN THU' :
      aiStrictness === 'relaxed' ? 'GOI Y CHO CANH' : 'HOP DONG CANH';
    systemParts.push('\n[' + contractHeader + ']\n' + contractParts.join('\n'));
  }

  // Canon Facts (Phase 4)
  if (canonFacts.length > 0) {
    const facts = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'fact'; });
    const secrets = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'secret'; });
    const rules = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'rule'; });
    const cParts = [];
    if (facts.length > 0) cParts.push('Su that:\n' + facts.map(function (f) { return '- ' + f.description; }).join('\n'));
    if (rules.length > 0) cParts.push('Quy tac:\n' + rules.map(function (f) { return '- ' + f.description; }).join('\n'));
    if (secrets.length > 0) cParts.push('BI MAT - CHUA TIET LO:\n' + secrets.map(function (f) { return '[x] ' + f.description; }).join('\n'));
    if (cParts.length > 0) systemParts.push('\n[CANON TRUYEN]\n' + cParts.join('\n\n'));
  }

  if (retrievalPacket && (retrievalPacket.relevantEntityStates?.length > 0 || retrievalPacket.activeThreadStates?.length > 0)) {
    const canonBits = [];
    if (retrievalPacket.relevantEntityStates?.length > 0) {
      canonBits.push('Trang thai canon hien tai:\n' + retrievalPacket.relevantEntityStates.map(function (state) {
        const summaryParts = [];
        if (state.alive_status === 'dead') summaryParts.push('da chet');
        else if (state.alive_status === 'alive') summaryParts.push('con song');
        if (state.rescued) summaryParts.push('da duoc cuu');
        if (state.current_location_name) summaryParts.push('o ' + state.current_location_name);
        if (state.allegiance) summaryParts.push('phe ' + state.allegiance);
        if (Array.isArray(state.goals_active) && state.goals_active.length > 0) summaryParts.push('muc tieu: ' + state.goals_active.join(', '));
        return '- Entity #' + state.entity_id + ': ' + summaryParts.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.activeThreadStates?.length > 0) {
      canonBits.push('Thread dang mo:\n' + retrievalPacket.activeThreadStates.map(function (threadState) {
        return '- Thread #' + threadState.thread_id + ' [' + (threadState.state || 'active') + ']: ' + (threadState.summary || '');
      }).join('\n'));
    }
    if (retrievalPacket.relevantItemStates?.length > 0) {
      canonBits.push('Vat pham / tai nguyen lien quan:\n' + retrievalPacket.relevantItemStates.map(function (state) {
        const itemBits = [];
        itemBits.push('trang thai: ' + (state.availability || 'available'));
        if (state.owner_character_id) itemBits.push('chu so huu #' + state.owner_character_id);
        if (state.current_location_name) itemBits.push('o ' + state.current_location_name);
        if (state.is_consumed) itemBits.push('da dung het');
        if (state.is_damaged) itemBits.push('da hu hong');
        if (state.summary) itemBits.push(state.summary);
        return '- Vat pham #' + state.object_id + ': ' + itemBits.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.relevantRelationshipStates?.length > 0) {
      canonBits.push('Quan he / do than mat lien quan:\n' + retrievalPacket.relevantRelationshipStates.map(function (state) {
        const relBits = [];
        if (state.relationship_type) relBits.push('quan he: ' + state.relationship_type);
        if (state.intimacy_level && state.intimacy_level !== 'none') relBits.push('than mat: ' + state.intimacy_level);
        if (state.secrecy_state) relBits.push('bi mat: ' + state.secrecy_state);
        if (state.consent_state && state.consent_state !== 'unknown') relBits.push('dong thuan: ' + state.consent_state);
        if (state.emotional_aftermath) relBits.push('du am cam xuc: ' + state.emotional_aftermath);
        if (state.summary) relBits.push(state.summary);
        return '- Cap #' + state.character_a_id + ' & #' + state.character_b_id + ': ' + relBits.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.criticalConstraints) {
      const constraints = [];
      if (retrievalPacket.criticalConstraints.deadCharacters?.length > 0) {
        constraints.push('Nhan vat da chet: ' + retrievalPacket.criticalConstraints.deadCharacters.map(function (id) { return '#' + id; }).join(', '));
      }
      if (retrievalPacket.criticalConstraints.unavailableItems?.length > 0) {
        constraints.push('Vat pham khong con dung duoc: ' + retrievalPacket.criticalConstraints.unavailableItems.map(function (item) {
          return (item.object_name || ('#' + item.object_id)) + ' (' + item.availability + ')';
        }).join(', '));
      }
      if (retrievalPacket.criticalConstraints.relationshipConstraints?.length > 0) {
        constraints.push('Rang buoc quan he gan day:\n' + retrievalPacket.criticalConstraints.relationshipConstraints.map(function (item) {
          const bits = [];
          if (item.intimacy_level && item.intimacy_level !== 'none') bits.push('than mat=' + item.intimacy_level);
          if (item.secrecy_state) bits.push('bi mat=' + item.secrecy_state);
          if (item.consent_state && item.consent_state !== 'unknown') bits.push('dong thuan=' + item.consent_state);
          if (item.emotional_aftermath) bits.push('du am=' + item.emotional_aftermath);
          return '- ' + item.pair_key + ': ' + bits.join(' | ');
        }).join('\n'));
      }
      if (constraints.length > 0) {
        canonBits.push('Rang buoc cung:\n' + constraints.join('\n'));
      }
    }
    if (retrievalPacket.relevantEvidence?.length > 0) {
      canonBits.push('Bang chung lien quan:\n' + retrievalPacket.relevantEvidence.map(function (item) {
        return '- ' + (item.summary || item.evidence_text || item.target_type || 'Bang chung');
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
        parts.push('[' + (item.chapter_title || ('Chuong ' + (item.chapter_order + 1))) + ']');
        if (item.summary) parts.push('Tom tat: ' + item.summary);
        if (item.bridge_buffer) parts.push('Nhip van noi tiep: ' + item.bridge_buffer);
        if (item.emotional_state?.mood || item.emotional_state?.activeConflict || item.emotional_state?.lastAction) {
          parts.push('Du am cam xuc: ' + JSON.stringify(item.emotional_state));
        }
        if (item.events?.length > 0) {
          parts.push('Su kien then chot:\n' + item.events.map(function (event) {
            return '- ' + (event.summary || event.op_type || 'Su kien');
          }).join('\n'));
        }
        if (item.prose) parts.push('Van ban chuong:\n' + item.prose);
        return parts.join('\n');
      })
      .join('\n\n-----\n\n');
    systemParts.push(`\n[BO NHO ${retrievalPacket.recentChapterMemory.length} CHUONG GAN NHAT]\n${memoryBlock}`);
  }

  // -- Layer 6.5: Plot Threads --
  if (plotThreads.length > 0) {
    var cappedThreads = plotThreads.slice(0, 10);
    const threadInfo = cappedThreads.map(function (pt) {
      const typeMap = { main: 'Tuyen Chinh', subplot: 'Tuyen Phu', character_arc: 'Phat Trien Nhan Vat', mystery: 'Bi An', romance: 'Tinh Cam' };
      const ptType = typeMap[pt.type] || 'Tuyen Truyen';
      const mark = pt.is_focus_in_scene ? '[TIEU DIEM CANH] ' : '';
      return '- ' + mark + '[' + ptType + '] ' + pt.title + (pt.description ? ': ' + pt.description : '');
    }).join('\n');
    systemParts.push('\n[CAC TUYEN TRUYEN DANG MO]\n' + threadInfo);
  }

  // -- Layer 7: Style DNA --
  const styleDNALayer = buildStyleDNALayer(taskType, resolvedWritingStyle);
  if (styleDNALayer && !skipWritingLayers) {
    systemParts.push(styleDNALayer);
    const projectStyleDNA = listFromTemplate(promptTemplates.style_dna);
    if (projectStyleDNA.length > 0) {
      systemParts.push('\n[DNA VAN PHONG CUA TRUYEN - PROJECT OVERRIDE]\n' + projectStyleDNA.map(function(rule, index) {
        return (index + 1) + '. ' + rule;
      }).join('\n'));
    }
    // Append the Anti-AI Blacklist right after Style DNA.
    const antiAIBlock = buildAntiAIBlock(resolvedWritingStyle);
    if (antiAIBlock) systemParts.push(antiAIBlock);
    const projectBlacklist = listFromTemplate(promptTemplates.anti_ai_blacklist);
    if (projectBlacklist.length > 0) {
      systemParts.push('\n[TU/CUM CAN TRANH CUA TRUYEN - PROJECT BLACKLIST]\n' + [
        'KHONG DUOC dung cac tu/cum sau trong van ban dau ra:',
        ...projectBlacklist.map(function(item) { return '- ' + item; }),
      ].join('\n'));
    }
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
    systemParts.push('\n[DO DAI VA NHIP DO]\n' + [
      '1. Phat trien day du moi canh truoc khi chuyen tiep - moi hanh dong nho duoc mieu ta 3-5 cau, tao hinh anh song dong.',
      '2. Suy nghi noi tam duoc dao sau it nhat 1 doan van day du.',
      '3. Huong toi 2000-4000 tu moi lan sinh, dong gop vao muc tieu 7000 tu cho CA CHUONG (khong phai 1 lan).',
      '4. Duy tri nhip ke lien tuc - moi cau day chuyen tiep sang cau sau tu nhien.',
      '5. Neu gan het do dai output: dung lai o diem kich tinh, de ngo cho phan tiep. Tot hon la de doc gia them muon doc tiep hon la cuong ket thuc.',
      '6. CAU TRUC DOAN VAN: 30-50% doan nen la doan 1-2 cau. Thong tin quan trong tach rieng thanh doan ngan. KHONG viet khoi van dai 5-6 cau lien tuc.',
      '7. MOI DOAN toi da 80-100 tu. Doan dai hon thi tach thanh 2. Doc gia Viet doc nhanh, doan ngan de theo doi.',
      '8. NHIP THO: Xen ke doan ngan (1-2 cau) va doan dai (3-4 cau) - nhu nhip tho van xuoi. Tranh viet deu deu cung nhip.',
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
