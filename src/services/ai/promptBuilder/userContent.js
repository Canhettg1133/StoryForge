import { TASK_TYPES } from '../router';
import { formatMacroArcContract } from '../macroArcContract';
import {
  buildSingleChapterOutlineBudget,
  formatChapterBriefList,
  formatStoryProgressBudget,
  formatMacroMilestoneList,
} from './layers';

function formatChapterAnchorLines(chapterAnchors = [], options = {}) {
  const list = Array.isArray(chapterAnchors) ? chapterAnchors.filter(Boolean) : [];
  if (list.length === 0) return '';
  return list.map((anchor) => {
    const parts = [
      `${anchor.id || 'ANCHOR'} | Chương ${anchor.targetChapter || '?'}`,
      (anchor.strictness || 'hard').toUpperCase(),
      anchor.requirementText || anchor.requirement_text || '',
    ];
    if (anchor.forbidBefore !== false) parts.push('KHÔNG được đặt sớm');
    if (Array.isArray(anchor.focusCharacters || anchor.focus_characters) && (anchor.focusCharacters || anchor.focus_characters).length > 0) {
      parts.push('Focus: ' + (anchor.focusCharacters || anchor.focus_characters).join(', '));
    }
    if (Array.isArray(anchor.objectiveRefs || anchor.objective_refs) && (anchor.objectiveRefs || anchor.objective_refs).length > 0) {
      parts.push('Objectives: ' + (anchor.objectiveRefs || anchor.objective_refs).join(', '));
    }
    return (options.bullet || '- ') + parts.filter(Boolean).join(' | ');
  }).join('\n');
}

function revisionInstructionAllowsStructureChange(instruction = '') {
  const normalized = String(instruction || '').toLowerCase();
  if (!normalized) return false;
  if (/chuong dem|chapter break|split chapter|merge chapter|tach chuong|chia chuong/.test(normalized)) return true;
  return /(?:them|chen|bo sung|add|insert|remove|bo|bot|tach|chia|gop|merge).{0,24}(?:chuong|chapter)/.test(normalized);
}

export function buildUserContent(taskType, context = {}, effectiveMacroArcContract = null) {
  const {
    selectedText,
    sceneText,
    chapterText = '',
    chapterSceneCount = 0,
    sceneTitle,
    projectTitle,
    genre,
    userPrompt,
    previousSummary,
    characters = [],
    relationships = [],
    relationshipStates = [],
    relationshipEvents = [],
    relationshipAnalysisChapters = [],
    canonFacts = [],
    canonRoleLocks = [],
    plotThreads = [],
    targetLength = 0,
    ultimateGoal = '',
    milestones = [],
    currentChapterIndex = 0,
    currentChapterOutline = null,
    upcomingChapters = [],
    startChapterNumber = 1,
    existingChapterBriefs = [],
    priorGeneratedChapterBriefs = [],
    generatedOutline = null,
    outlineRevisionInstruction = '',
    storyProgressBudget = null,
    currentArc = null,
    currentMacroArc = null,
    sceneList = [],
    validatorReports = [],
    entityType = '',
    batchCount = 0,
    aiInferCharacterList = false,
    knownMissingCharacterNames = [],
    selectedBatchCount = 0,
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
    macroChapterAnchorInputs = [],
    batchChapterAnchors = [],
    currentChapterAnchors = [],
    futureChapterAnchors = [],
    chapterAnchorValidationReports = [],
  } = context;

  // =============================================
  // Build user message
  // =============================================
  let userContent = '';

  switch (taskType) {
    case TASK_TYPES.CONTINUE:
      userContent = 'Viết tiếp:\n\n' + (sceneText || selectedText || '');
      if (userPrompt) userContent += '\n\n[HƯỚNG DẪN CỦA TÁC GIẢ]: ' + userPrompt;
      break;

    case TASK_TYPES.REWRITE:
      userContent = 'Viết lại đoạn sau:\n\n---\n' + (selectedText || sceneText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[HƯỚNG DẪN CỦA TÁC GIẢ]: ' + userPrompt;
      break;

    case TASK_TYPES.EXPAND:
      userContent = 'Mở rộng đoạn sau:\n\n---\n' + (selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[HƯỚNG DẪN CỦA TÁC GIẢ]: ' + userPrompt;
      break;

    case TASK_TYPES.BRAINSTORM:
      userContent = userPrompt
        ? 'Brainstorm: ' + userPrompt
        : 'Gợi ý 5 hướng phát triển tiếp theo cho cảnh/chương hiện tại.\n\nNội dung hiện tại:\n' + (sceneText || '(chưa có nội dung)');
      break;

    case TASK_TYPES.OUTLINE:
      {
        const chapterMaterial = chapterText || sceneText || '';
        const effectiveBudget = storyProgressBudget || buildSingleChapterOutlineBudget({
          targetLength,
          currentChapterIndex,
          currentMacroArc,
          milestones,
        });
        const budgetText = formatStoryProgressBudget(effectiveBudget);

        userContent = '[MỤC TIÊU]\nLập dàn ý/beat cho CHÍNH chương hiện tại. Ưu tiên đối chiếu nội dung đã viết với dàn ý hiện có để xác định beat đã xong và beat còn thiếu.';

        if (userPrompt) {
          userContent += '\n\n[ƯU TIÊN CỦA TÁC GIẢ]\n' + userPrompt;
        }

        if (currentChapterOutline) {
          const outlineParts = [];
          if (currentChapterOutline.title) outlineParts.push('Tiêu đề: ' + currentChapterOutline.title);
          if (currentChapterOutline.summary) outlineParts.push('Summary: ' + currentChapterOutline.summary);
          if (currentChapterOutline.purpose) outlineParts.push('Purpose: ' + currentChapterOutline.purpose);
          if (currentChapterOutline.threadTitles?.length > 0) {
            outlineParts.push('Thread cần đẩy: ' + currentChapterOutline.threadTitles.join(', '));
          }
          if (currentChapterOutline.keyEvents?.length > 0) {
            outlineParts.push('Key events:\n' + currentChapterOutline.keyEvents.map(function (item) {
              return '- ' + item;
            }).join('\n'));
          }
          if (outlineParts.length > 0) {
            userContent += '\n\n[DÀN Ý CHƯƠNG HIỆN TẠI]\n' + outlineParts.join('\n');
          }
        } else {
          userContent += '\n\n[DÀN Ý CHƯƠNG HIỆN TẠI]\n(chưa có dàn ý rõ ràng, nếu tạo mới thì chỉ được tạo cho chương này)';
        }

        userContent += '\n\n[NỘI DUNG ĐÃ CÓ CỦA CHƯƠNG HIỆN TẠI]\n';
        userContent += chapterMaterial || '(chưa có văn bản trong chương)';
        userContent += '\n\n[SỐ CẢNH HIỆN CÓ]\n' + (Number(chapterSceneCount) || 0);

        if (upcomingChapters?.length > 0) {
          userContent += '\n\n[CÁC CHƯƠNG KẾ TIẾP - KHÔNG ĐƯỢC PHÁ VỠ]\n' + upcomingChapters.map(function (chapter, index) {
            return '- Chương ' + (index + 1) + ': ' + (chapter.title || '(chưa đặt tên)') + (chapter.summary ? ' - ' + chapter.summary : '');
          }).join('\n');
        }

        if (budgetText) {
          userContent += '\n\n[GIỚI HẠN TIẾN ĐỘ CHƯƠNG NÀY]\n' + budgetText;
        }

        userContent += '\n\n[YÊU CẦU]\nNếu chương này đã có dàn ý, hãy phân loại beat đã hoàn thành, beat còn thiếu và beat tiếp theo TRONG CHÍNH chương này. Nếu chương này chưa có dàn ý, hãy tạo dàn ý cho CHÍNH chương này. Tuyệt đối không viết thay nội dung của chương sau đã có dàn ý. Nếu thấy chương này đã gần hoàn tất, chỉ ghi rõ điều đó trong [GỢI Ý CHUYỂN CHƯƠNG], không được lập beat cụ thể cho chương sau.';
      }
      break;

    case TASK_TYPES.PLOT_SUGGEST:
      userContent = '[NỘI DUNG HIỆN TẠI]\n' + (sceneText || '(chưa có nội dung cảnh)');
      if (currentChapterOutline) {
        const outlineParts = [];
        if (currentChapterOutline.title) outlineParts.push('Tiêu đề: ' + currentChapterOutline.title);
        if (currentChapterOutline.summary) outlineParts.push('Summary: ' + currentChapterOutline.summary);
        if (currentChapterOutline.purpose) outlineParts.push('Purpose: ' + currentChapterOutline.purpose);
        if (currentChapterOutline.threadTitles?.length > 0) {
          outlineParts.push('Thread cần đẩy: ' + currentChapterOutline.threadTitles.join(', '));
        }
        if (currentChapterOutline.keyEvents?.length > 0) {
          outlineParts.push('Key events:\n' + currentChapterOutline.keyEvents.map(function (item) {
            return '- ' + item;
          }).join('\n'));
        }
        if (outlineParts.length > 0) {
          userContent += '\n\n[DÀN Ý CHƯƠNG HIỆN TẠI]\n' + outlineParts.join('\n');
        }
      }
      if (upcomingChapters?.length > 0) {
        userContent += '\n\n[CÁC CHƯƠNG KẾ TIẾP - KHÔNG ĐƯỢC PHÁ VỠ]\n' + upcomingChapters.map(function (chapter, index) {
          return '- Chương ' + (index + 1) + ': ' + (chapter.title || '(chưa đặt tên)') + (chapter.summary ? ' - ' + chapter.summary : '');
        }).join('\n');
      }
      userContent += '\n\n[YÊU CẦU]\nNếu cảnh/chương hiện tại chưa xong, đề xuất 3 beat tiếp theo để người viết có thể bám vào Viết tiếp ngay. Nếu chapter hiện tại đã đến điểm chuyển chương, mới đề xuất hướng cho chương kế. Luôn nói rõ hướng nào đang đẩy plot thread nào và thay đổi điều gì trong canon/trạng thái nhân vật.';
      break;

    case TASK_TYPES.SUMMARIZE:
    case TASK_TYPES.CHAPTER_SUMMARY:
      userContent = sceneText || selectedText || '';
      break;

    case TASK_TYPES.EXTRACT_TERMS:
    case TASK_TYPES.FEEDBACK_EXTRACT:
      userContent = '---\n' + (sceneText || selectedText || '') + '\n---';
      break;

    case TASK_TYPES.CONTINUITY_CHECK:
    case TASK_TYPES.QA_CHECK:
      userContent = '[NỘI DUNG CẦN RÀ SOÁT]\n---\n' + (sceneText || selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[ƯU TIÊN CỦA TÁC GIẢ]\n' + userPrompt;
      break;

    case TASK_TYPES.STYLE_ANALYZE:
      userContent = '[VĂN BẢN MẪU CẦN PHÂN TÍCH]\n---\n' + (sceneText || selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[LƯU Ý CỦA TÁC GIẢ]\n' + userPrompt;
      break;

    case TASK_TYPES.STYLE_WRITE:
      userContent = '';
      if (selectedText || sceneText) {
        userContent += '[VĂN PHONG MẪU]\n---\n' + (selectedText || sceneText || '') + '\n---\n\n';
      }
      userContent += '[YÊU CẦU NỘI DUNG MỚI]\n' + (userPrompt || 'Hãy viết một đoạn mới theo văn phong mẫu.');
      break;

    case TASK_TYPES.AI_GENERATE_ENTITY: {
      const targetType = entityType || 'character';
      const isBatchMode = Number(batchCount) > 1;
      const count = Math.max(1, Number(batchCount) || 1);
      const shouldInferCharacterList = targetType === 'character' && Boolean(aiInferCharacterList);
      const labelMap = {
        character: 'nhân vật',
        location: 'địa điểm',
        object: 'vật phẩm',
        term: 'thuật ngữ',
      };
      const schemaMap = {
        character: '{"name":"Tên nhân vật","role":"protagonist|deuteragonist|antagonist|supporting|mentor|love_interest|minor","specific_role":"Vai trò canon cụ thể nếu tác giả yêu cầu; để rỗng nếu không có","specific_role_locked":false,"age":"tuổi/độ tuổi tùy chọn, chỉ điền khi phù hợp thể loại hoặc hữu ích cho giọng thoại","appearance":"Mô tả 2-3 câu","personality":"Mô tả 2-3 câu","personality_tags":"tag1, tag2","flaws":"Điểm yếu/khuyết điểm","goals":"Mục tiêu","current_status":"Character Live Canon lúc khởi đầu; để rỗng nếu không có ràng buộc canon thật","secrets":"Bí mật nếu có","notes":"Vai trò trong cốt truyện"}',
        location: '{"name":"Tên địa điểm","description":"Mô tả 2-3 câu","details":"Chi tiết bổ sung, kiến trúc, bí mật..."}',
        object: '{"name":"Tên vật phẩm","description":"Mô tả 2-3 câu","properties":"Công dụng, thuộc tính, hạn chế","owner":"Tên chủ sở hữu nếu có"}',
        term: '{"name":"Tên thuật ngữ","definition":"Định nghĩa 3-5 câu","category":"magic|organization|race|technology|concept|culture|other"}',
      };
      const singularSchema = schemaMap[targetType] || schemaMap.character;
      const outputSchema = isBatchMode
        ? '{ "items": [' + singularSchema + '] }'
        : singularSchema;

      userContent = '[LOẠI THỰC THỂ]\n' + (labelMap[targetType] || targetType);
      userContent += '\n\n[SỐ LƯỢNG]\n' + (shouldInferCharacterList
        ? `Tối đa ${count} mục. Nếu danh sách nhân vật rõ trong yêu cầu bổ sung có ít hơn, chỉ tạo số nhân vật còn thiếu thực tế.`
        : (isBatchMode ? count + ' mục' : '1 mục'));
      if (projectTitle) userContent += '\n\n[TÊN TRUYỆN]\n' + projectTitle;
      if (entityContextText) userContent += '\n\n[BỐI CẢNH HIỆN CÓ]\n' + entityContextText;
      if (shouldInferCharacterList) {
        const missingNames = Array.isArray(knownMissingCharacterNames)
          ? knownMissingCharacterNames.filter(Boolean)
          : [];
        userContent += '\n\n[CHẾ ĐỘ TỰ PHÂN TÍCH NHÂN VẬT CÒN THIẾU]';
        userContent += '\n- Hãy tự đọc [YÊU CẦU CỦA TÁC GIẢ] như một dàn ý/cast list, nhận diện tên người/nhân vật bằng cấu trúc danh sách, dấu :, dấu (), vai trò, name + aliases.';
        userContent += '\n- Hỗ trợ tên Việt Nam, tên Hán Việt/Trung Quốc dịch ra, tên tiếng Anh, tên viết thường, tên có dấu và alias ngắn.';
        userContent += '\n- Đối chiếu với [BỐI CẢNH HIỆN CÓ], đặc biệt là name + aliases của nhân vật đã có. Tên khác/biệt danh của cùng một người KHÔNG được tính là nhân vật mới.';
        userContent += '\n- Chỉ tạo nhân vật còn thiếu. Không lấy địa danh, tiêu đề phần/chương, vật phẩm, phe phái, thuật ngữ, hoặc câu prose làm tên nhân vật.';
        userContent += '\n- Nếu tác giả đang chọn số cao hơn số còn thiếu, bỏ qua số cao và trả về đúng số còn thiếu.';
        userContent += '\n- Nếu tác giả đang chọn số thấp hơn số còn thiếu, chỉ tạo tối đa số được chọn/số tối đa và ưu tiên các tên xuất hiện trong danh sách nhân vật.';
        if (Number(selectedBatchCount) > 0) {
          userContent += '\n- Số tác giả đang chọn trên UI: ' + Number(selectedBatchCount) + '.';
        }
        if (missingNames.length > 0) {
          userContent += '\n\n[DANH SÁCH CÒN THIẾU UI GỢI Ý - CẦN KIỂM TRA LẠI]\n' + missingNames.map((name) => '- ' + name).join('\n');
        }
      }
      if (targetType === 'character') {
        userContent += '\n\n[HƯỚNG DẪN TUỔI/ĐỘ TUỔI]\n';
        userContent += '- Field age là tùy chọn. Chỉ điền khi phù hợp thể loại hoặc khi hữu ích cho giọng thoại.\n';
        userContent += '- Hiện đại/học đường/đô thị: có thể dùng tuổi số cụ thể. Tiên hiệp/huyền huyễn/thần linh/bất tử: ưu tiên mô tả linh hoạt như thiếu niên, ngoại hình đôi mươi, tuổi thật rất cao, trưởng bối.\n';
        userContent += '- Không điền age nếu không cần; không biến age thành luật cứng về tính cách.';
        userContent += '\n\n[HƯỚNG DẪN CURRENT_STATUS / CHARACTER LIVE CANON]\n';
        userContent += '- current_status là trạng thái canon đang có hiệu lực lúc nhân vật bước vào truyện, không phải ghi chú phụ.\n';
        userContent += '- Chỉ điền khi trạng thái khởi đầu có lực ràng buộc thật với chương đầu/bối cảnh hiện tại: địa vị, quan hệ, bí mật biết/chưa biết, vết thương, bệnh, phe phái, đang bị giam/mất tích/lẩn trốn, hoặc giới hạn hành vi.\n';
        userContent += '- Không điền các status rỗng/chung chung như "buồn", "mạnh mẽ", "lạnh lùng", "tốt bụng" nếu nó không tạo ràng buộc canon cụ thể.\n';
        userContent += '- Nếu không có ràng buộc canon thật, để current_status rỗng.';
        userContent += '\n\n[HƯỚNG DẪN VAI TRÒ CỤ THỂ / CANON ROLE LOCK]\n';
        userContent += '- specific_role là vai trò canon cụ thể trong thế giới truyện, khác với role là vai trò truyện.\n';
        userContent += '- Chỉ điền specific_role khi tác giả yêu cầu rõ hoặc bối cảnh cần một vai trò cụ thể có giá trị canon.\n';
        userContent += '- Nếu specific_role có nội dung và cần khóa canon, đặt specific_role_locked = true; nếu không, đặt false.\n';
        userContent += '- Không tạo nhân vật mới có vai trò cụ thể trùng hoặc tương đương với danh sách vai trò đã khóa trong system prompt.\n';
        if (Array.isArray(canonRoleLocks) && canonRoleLocks.length > 0) {
          userContent += '- Nếu yêu cầu cần một vai trò đã khóa, dùng nhân vật đã có thay vì tạo nhân vật mới.';
        }
      }
      userContent += '\n\n[YÊU CẦU CỦA TÁC GIẢ]\n' + (userPrompt || 'Hãy tạo một mục phù hợp với dự án này.');
      userContent += '\n\n[OUTPUT JSON BẮT BUỘC]\n' + outputSchema;
      break;
    }

    case TASK_TYPES.SCENE_DRAFT:
      userContent = userPrompt
        ? userPrompt
        : 'Viết bản nháp cực kỳ chi tiết và dài cho cảnh "' + (sceneTitle || 'chưa đặt tên') + '", mục tiêu là 1500-2500 từ để hướng tới chuẩn mực 1 chương dài 7000 từ.';
      break;

    case TASK_TYPES.ARC_OUTLINE: {
      const arcParts = [];
      const allowsStructureChange = revisionInstructionAllowsStructureChange(outlineRevisionInstruction);
      const outlineReportLines = (validatorReports || []).map(function (report, index) {
        const scope = report?.chapterIndex == null
          ? 'Toàn bộ đợt'
          : 'Chương ' + (startChapterNumber + Number(report.chapterIndex));
        const severity = report?.severity || 'warning';
        const code = report?.code || 'issue';
        const sourceText = report?.inputLabel
          ? ' | Nguồn: ' + report.inputLabel
          : '';
        const fieldText = Array.isArray(report?.relevantFields) && report.relevantFields.length > 0
          ? ' | Fields: ' + report.relevantFields.join(', ')
          : '';
        return (index + 1) + '. [' + severity.toUpperCase() + ' | ' + code + ' | ' + scope + sourceText + fieldText + '] ' + (report?.message || '');
      }).join('\n');
      if (userPrompt) arcParts.push('Mục tiêu Arc: ' + userPrompt);
      arcParts.push('Chương mới phải bắt đầu từ: Chương ' + startChapterNumber);
      arcParts.push('Số lượng chương cần tạo: ' + (context.chapterCount || 10));
      arcParts.push('Mỗi chương phải có opening_state, continuity_in.response, conflict, key_events, decision_or_consequence, state_changes, ending_state, continuity_out.text và pacing. Từ chương thứ 2 trong batch, continuity_in.response phải nói rõ chương này phản ứng với hệ quả/câu hỏi/áp lực của chương trước; chương chưa phải cuối batch phải có continuity_out.text. Không sinh continuity id hoặc from_index.');
      if (context.arcPacing) {
        const pacingDesc = { slow: 'Chậm - xây dựng, khám phá', medium: 'Trung bình', fast: 'Nhanh - hành động, cao trào' };
        arcParts.push('Nhịp độ: ' + (pacingDesc[context.arcPacing] || context.arcPacing));
      }
      if (currentMacroArc?.title) {
        const macroParts = ['[MACRO ARC HIỆN TẠI]'];
        macroParts.push('Tiêu đề: ' + currentMacroArc.title);
        if (currentMacroArc.description) macroParts.push('Mô tả: ' + currentMacroArc.description);
        if (currentMacroArc.chapter_from && currentMacroArc.chapter_to) {
          macroParts.push('Phạm vi: Chương ' + currentMacroArc.chapter_from + ' đến Chương ' + currentMacroArc.chapter_to);
        }
        arcParts.push(macroParts.join('\n'));
      }
      if (effectiveMacroArcContract) {
        arcParts.push(formatMacroArcContract(effectiveMacroArcContract, {
          header: '[HỢP ĐỒNG ĐẠI CỤC BẮT BUỘC]',
        }));
      }
      const batchAnchorText = formatChapterAnchorLines(batchChapterAnchors);
      if (batchAnchorText) {
        arcParts.push('[CHAPTER ANCHORS BẮT BUỘC TRONG BATCH]\n' + batchAnchorText);
      }
      if (previousSummary) arcParts.push('\nTóm tắt chương trước:\n' + previousSummary);
      const budgetText = formatStoryProgressBudget(storyProgressBudget);
      if (budgetText) {
        arcParts.push('[STORY PROGRESS BUDGET]\n' + budgetText);
        arcParts.push([
          'Quy tắc bắt buộc:',
          '- Không giải quyết tuyến chính nếu budget hiện tại chưa cho phép.',
          '- Không lộ đại bí mật nếu chưa tới milestone/macro arc phù hợp.',
          '- Ít nhất 1 chương trong batch phải là buildup/setup/consequence.',
          '- Mỗi chương phải có purpose riêng và neo ít nhất 1 plot thread, sự kiện, hoặc ràng buộc canon.',
        ].join('\n'));
      }
      if (generatedOutline?.chapters?.length) {
        const currentOutlineText = generatedOutline.chapters.map(function (chapter, index) {
          const number = startChapterNumber + index;
          const beats = Array.isArray(chapter?.key_events) && chapter.key_events.length > 0
            ? '\n  Beats: ' + chapter.key_events.join(' | ')
            : '';
          const stateChanges = Array.isArray(chapter?.state_changes) && chapter.state_changes.length > 0
            ? '\n  State changes: ' + chapter.state_changes.map(function (item) {
              return [item?.subject, item?.change].filter(Boolean).join(': ');
            }).filter(Boolean).join(' | ')
            : '';
          const continuity = [
            chapter?.opening_state ? '  Opening: ' + chapter.opening_state : '',
            chapter?.continuity_in?.response ? '  Continuity in: ' + chapter.continuity_in.response : '',
            chapter?.handoff_from_previous && !chapter?.continuity_in?.response ? '  Handoff legacy: ' + chapter.handoff_from_previous : '',
            chapter?.conflict ? '  Conflict: ' + chapter.conflict : '',
            chapter?.decision_or_consequence ? '  Decision/consequence: ' + chapter.decision_or_consequence : '',
            chapter?.ending_state ? '  Ending: ' + chapter.ending_state : '',
            chapter?.continuity_out?.text ? '  Continuity out: ' + chapter.continuity_out.text : '',
            chapter?.pacing ? '  Pacing: ' + chapter.pacing : '',
          ].filter(Boolean).join('\n');
          return '- Chương ' + number + ': ' + (chapter?.title || '') + '\n  Purpose: ' + (chapter?.purpose || '') + '\n  Tóm tắt: ' + (chapter?.summary || '') + (continuity ? '\n' + continuity : '') + beats + stateChanges;
        }).join('\n');
        arcParts.push('[DÀN Ý HIỆN TẠI CẦN CHỈNH SỬA]\n' + currentOutlineText);
      }
      if (outlineReportLines) {
        arcParts.push('[LỖI VALIDATOR CẦN XỬ LÝ]\n' + outlineReportLines);
        arcParts.push([
          'Yêu cầu sửa lỗi validator:',
          '- Ưu tiên xử lý hết các lỗi severity=error trước.',
          '- Nếu có lỗi too-fast hoặc premature-resolution, hãy làm chậm nhịp, chèn buildup/setup/consequence, và đổi tiết lộ/kết quả lớn thành manh mối nhỏ hoặc hệ quả nhỏ.',
          '- Giữ nguyên batch, số chương, budget tiến độ, và các thread đang mở nếu không bắt buộc phải đổi.',
          '- Sau khi sửa, mục tiêu là dàn ý mới phải pass validator hiện tại.',
        ].join('\n'));
      }
      if (outlineRevisionInstruction) {
        arcParts.push('[YÊU CẦU CHỈNH SỬA DÀN Ý]\n' + outlineRevisionInstruction);
        arcParts.push(
          allowsStructureChange
            ? 'Hãy chỉnh sửa trên dàn ý hiện tại. Bạn được phép tăng/giảm/chia/gộp số chương BÊN TRONG chính batch này nếu cần để xử lý lỗi pacing/validator, nhưng không được vượt khỏi phạm vi batch hay budget tiến độ. Output vẫn phải là FULL JSON outline.'
            : 'Hãy chỉnh sửa IN-PLACE trên dàn ý hiện tại. Giữ nguyên phạm vi batch, số chương, và budget tiến độ. Output vẫn phải là FULL JSON outline.'
        );
      }
      const existingBriefText = formatChapterBriefList(existingChapterBriefs, {
        header: '[CÁC CHƯƠNG ĐÃ CÓ - KHÔNG ĐƯỢC LẶP LẠI]',
        limit: 12,
      });
      if (existingBriefText) arcParts.push(existingBriefText);
      userContent = arcParts.join('\n');
      break;
    }

    case TASK_TYPES.ARC_CHAPTER_DRAFT: {
      userContent = '[DÀN Ý CHƯƠNG]\n';
      userContent += 'Số chương thực tế: ' + startChapterNumber + '\n';
      userContent += 'Tiêu đề: ' + (context.chapterOutlineTitle || '') + '\n';
      if (context.chapterOutlinePurpose) {
        userContent += 'Purpose: ' + context.chapterOutlinePurpose + '\n';
      }
      userContent += 'Tóm tắt: ' + (context.chapterOutlineSummary || '') + '\n';
      if (context.chapterOutlineOpeningState) {
        userContent += 'Opening state: ' + context.chapterOutlineOpeningState + '\n';
      }
      if (context.chapterOutlineContinuityIn) {
        userContent += 'Nối mạch từ hệ quả trước: ' + context.chapterOutlineContinuityIn + '\n';
      }
      if (context.chapterOutlineHandoff) {
        userContent += 'Handoff legacy từ chương trước: ' + context.chapterOutlineHandoff + '\n';
      }
      if (context.chapterOutlineConflict) {
        userContent += 'Xung đột chính: ' + context.chapterOutlineConflict + '\n';
      }
      if (context.chapterOutlineEndingState) {
        userContent += 'Ending state dự kiến: ' + context.chapterOutlineEndingState + '\n';
      }
      if (context.chapterOutlineEvents) {
        userContent += 'Sự kiện chính:\n' + context.chapterOutlineEvents.map(e => '- ' + e).join('\n') + '\n';
      }
      if (context.chapterOutlineDecisionOrConsequence) {
        userContent += '\nQuyết định/hệ quả bắt buộc: ' + context.chapterOutlineDecisionOrConsequence + '\n';
      }
      if (Array.isArray(context.chapterOutlineStateChanges) && context.chapterOutlineStateChanges.length > 0) {
        const stateChangeText = context.chapterOutlineStateChanges.map(function (item) {
          const subject = String(item?.subject || '').trim();
          const change = String(item?.change || '').trim();
          return subject ? subject + ': ' + change : change;
        }).filter(Boolean).join(' | ');
        if (stateChangeText) userContent += 'Thay đổi trạng thái dự kiến: ' + stateChangeText + '\n';
      }
      if (context.chapterOutlineContinuityOut) {
        userContent += 'Móc kéo sang chương sau: ' + context.chapterOutlineContinuityOut + '\n';
      }
      if (context.chapterOutlinePacing) {
        userContent += 'Nhịp chương: ' + context.chapterOutlinePacing + '\n';
      }
      if (Array.isArray(context.chapterOutlineObjectiveRefs) && context.chapterOutlineObjectiveRefs.length > 0) {
        userContent += 'Objective refs: ' + context.chapterOutlineObjectiveRefs.join(', ') + '\n';
      }
      if (Array.isArray(context.chapterOutlineAnchorRefs) && context.chapterOutlineAnchorRefs.length > 0) {
        userContent += 'Anchor refs: ' + context.chapterOutlineAnchorRefs.join(', ') + '\n';
      }
      if (context.chapterOutlineStateDelta) {
        userContent += 'State delta được phép: ' + context.chapterOutlineStateDelta + '\n';
      }
      if (context.chapterOutlineGuardrail) {
        userContent += 'Arc guard: ' + context.chapterOutlineGuardrail + '\n';
      }
      const currentAnchorText = formatChapterAnchorLines(currentChapterAnchors);
      if (currentAnchorText) {
        userContent += '\n[ANCHOR BẮT BUỘC CHO CHƯƠNG NÀY]\n' + currentAnchorText + '\n';
      }
      const futureAnchorText = formatChapterAnchorLines(futureChapterAnchors);
      if (futureAnchorText) {
        userContent += '\n[ANCHOR CHƯA ĐẾN HẠN]\n' + futureAnchorText + '\n';
      }
      if (Array.isArray(chapterAnchorValidationReports) && chapterAnchorValidationReports.length > 0) {
        const reportLines = chapterAnchorValidationReports.map((report, index) => (
          (index + 1) + '. [' + (report?.severity || 'warning').toUpperCase() + ' | ' + (report?.code || 'anchor') + '] ' + (report?.message || '')
        )).join('\n');
        userContent += '\n[LỖI ANCHOR CẦN SỬA]\n' + reportLines + '\n';
      }
      if (effectiveMacroArcContract) {
        userContent += '\n' + formatMacroArcContract(effectiveMacroArcContract, {
          header: '[HỢP ĐỒNG ĐẠI CỤC BẮT BUỘC]',
        }) + '\n';
      }
      const existingBriefText = formatChapterBriefList(existingChapterBriefs, {
        header: '\n[CÁC CHƯƠNG ĐÃ CÓ - CHỈ NHẮC LẠI NGẮN GỌN, KHÔNG VIẾT LẠI]',
        limit: 10,
      });
      if (existingBriefText) userContent += '\n' + existingBriefText;
      const priorGeneratedText = formatChapterBriefList(priorGeneratedChapterBriefs, {
        header: '\n[CÁC CHƯƠNG MỚI ĐÃ ĐƯỢC LÊN DÀN Ý TRƯỚC CHƯƠNG NÀY]',
        limit: 6,
      });
      if (priorGeneratedText) userContent += '\n' + priorGeneratedText;
      const budgetText = formatStoryProgressBudget(storyProgressBudget);
      if (budgetText) {
        userContent += '\n\n[STORY PROGRESS BUDGET]\n' + budgetText;
        userContent += '\nQuy tắc: không resolve tuyến chính, không lộ đại bí mật, không nhảy cấp sức mạnh nếu budget không cho phép.';
      }
      break;
    }

    case TASK_TYPES.FREE_PROMPT:
      userContent = userPrompt || '';
      if (sceneText) {
        userContent += '\n\n[Nội dung cảnh hiện tại:]\n' + sceneText;
      }
      break;

    case TASK_TYPES.SUGGEST_UPDATES: {
      const charStatuses = characters.map(function (c) {
        return '- ' + c.name + ': ' + (c.current_status || '(chưa có trạng thái)');
      }).join('\n');
      const existingFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');

      userContent = '[CHARACTER LIVE CANON / CURRENT_STATUS CỦA NHÂN VẬT]\n' + (charStatuses || '(chưa có nhân vật)');
      userContent += '\nQuy tắc: đây là Character Live Canon đang có hiệu lực. Nếu trống thì không suy diễn; nếu có thì chỉ đề xuất đổi khi nội dung chương có bằng chứng rõ.';
      userContent += '\n\n[CANON FACTS HIỆN CÓ]\n' + (existingFacts || '(chưa có)');
      userContent += '\n\n[NỘI DUNG CHƯƠNG]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.RELATIONSHIP_ANALYZE_BATCH: {
      const knownCharacters = characters.map(function (c) {
        const aliases = Array.isArray(c.aliases) && c.aliases.length > 0 ? ` | bí danh: ${c.aliases.join(', ')}` : '';
        return `- #${c.id} ${c.name || '(không rõ)'}${c.role ? ` | vai trò: ${c.role}` : ''}${aliases}`;
      }).join('\n');
      const baselineRelationships = relationships.map(function (r) {
        return `- #${r.id || '?'} | ${r.character_a_id} ↔ ${r.character_b_id} | ${r.relation_type || 'other'}${r.description ? ` | ${r.description}` : ''}`;
      }).join('\n');
      const currentRelationshipStates = relationshipStates.map(function (state) {
        const bits = [
          `${state.character_a_id} ↔ ${state.character_b_id}`,
          state.relationship_type ? `quan hệ=${state.relationship_type}` : '',
          state.intimacy_level ? `thân mật=${state.intimacy_level}` : '',
          state.secrecy_state ? `bí mật=${state.secrecy_state}` : '',
          state.consent_state ? `đồng thuận=${state.consent_state}` : '',
          state.summary ? `tóm tắt=${state.summary}` : '',
          state.emotional_aftermath ? `dư âm=${state.emotional_aftermath}` : '',
        ].filter(Boolean);
        return `- ${bits.join(' | ')}`;
      }).join('\n');
      const recentRelationshipEvents = relationshipEvents.map(function (event) {
        return `- Chương ${event.chapter_id || '?'} | ${event.op_type} | ${event.subject_id || '?'} ↔ ${event.target_id || '?'} | ${event.summary || event.evidence || ''}`;
      }).join('\n');
      const chapterBlocks = relationshipAnalysisChapters.map(function (chapter) {
        const partLabel = chapter.partCount > 1 ? ` | phần ${chapter.partIndex}/${chapter.partCount}` : '';
        return [
          `[CHƯƠNG ${chapter.chapterId}${partLabel}: ${chapter.chapterTitle || ''}]`,
          `signature: ${chapter.signature || ''}`,
          '---',
          chapter.text || '',
          '---',
        ].join('\n');
      }).join('\n\n');

      userContent = '[NHÂN VẬT ĐÃ BIẾT]\n' + (knownCharacters || '(chưa có nhân vật)');
      userContent += '\n\n[QUAN HỆ NỀN DO TÁC GIẢ NHẬP]\n' + (baselineRelationships || '(chưa có)');
      userContent += '\n\n[TRẠNG THÁI QUAN HỆ HIỆN TẠI TRƯỚC BATCH]\n' + (currentRelationshipStates || '(chưa có)');
      userContent += '\n\n[SỰ KIỆN QUAN HỆ GẦN ĐÂY]\n' + (recentRelationshipEvents || '(chưa có)');
      userContent += '\n\n[CÁC CHƯƠNG CẦN PHÂN TÍCH]\n' + (chapterBlocks || '(không có chương)');
      userContent += '\n\nYêu cầu: trả đủ một object cho mỗi chapter_id trong batch. Nếu không có thay đổi quan hệ đủ rõ, để relationship_updates là mảng rỗng.';
      break;
    }

    case TASK_TYPES.CHECK_CONFLICT: {
      const charStatuses = characters.map(function (c) {
        return '- ' + c.name + ': ' + (c.current_status || '(chưa có trạng thái)');
      }).join('\n');
      const existingFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');

      userContent = '[CHARACTER LIVE CANON / CURRENT_STATUS ĐỂ KIỂM TRA]\n' + (charStatuses || '(chưa có nhân vật)');
      userContent += '\nQuy tắc: coi các dòng trên là Character Live Canon. Bắt lỗi nếu nội dung trái với ràng buộc tri thức, quan hệ, địa vị, thể chất/tâm lý, vị trí/phe, hoặc hành vi.';
      userContent += '\n\n[CANON FACTS ĐỂ KIỂM TRA]\n' + (existingFacts || '(chưa có)');
      userContent += '\n\n[NỘI DUNG CẢNH/CHƯƠNG CẦN KIỂM TRA MÂU THUẪN]\n---\n' + (sceneText || selectedText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CANON_EXTRACT_OPS: {
      const knownCharacters = characters.map(function (c) {
        const status = c.current_status ? ': ' + c.current_status : '';
        const knowledge = Array.isArray(c.known_canon_facts) && c.known_canon_facts.length > 0
          ? ' | Tri thức canon đã biết: ' + c.known_canon_facts.join('; ')
          : '';
        return '- ' + c.name + status + knowledge;
      }).join('\n');
      const knownThreads = plotThreads.map(function (pt) {
        return '- #' + pt.id + ' | ' + pt.title + ' [' + (pt.state || 'active') + ']';
      }).join('\n');
      const knownFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');
      const sceneTextList = (sceneList || []).map(function (scene) {
        return '[' + scene.index + '] ' + scene.title + '\n' + scene.text;
      }).join('\n\n');

      userContent = '[NHÂN VẬT ĐÃ BIẾT - CHARACTER LIVE CANON]\n' + (knownCharacters || '(không có)');
      userContent += '\nQuy tắc: chỉ trích xuất CHARACTER_STATUS_CHANGED khi có bằng chứng rõ làm đổi current_status sau chương.';
      userContent += '\n\n[THREAD ĐÃ BIẾT]\n' + (knownThreads || '(không có)');
      userContent += '\n\n[CANON FACTS ĐÃ BIẾT]\n' + (knownFacts || '(không có)');
      userContent += '\n\n[DANH SÁCH CẢNH]\n' + (sceneTextList || '(không có)');
      userContent += '\n\n[TOÀN BỘ CHƯƠNG]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CANON_REPAIR: {
      const reportLines = (validatorReports || []).map(function (report, index) {
        return (index + 1) + '. [' + (report.rule_code || report.severity || 'report') + '] ' + report.message;
      }).join('\n');
      userContent = '[LỖI CONTINUITY CẦN SỬA]\n' + (reportLines || '(không có)');
      userContent += '\n\n[NỘI DUNG CHƯƠNG HIỆN TẠI]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.GENERATE_MACRO_MILESTONES: {
      userContent = '[Ý TƯỞNG TÁC GIẢ]\n' + (authorIdea || userPrompt || '(Chưa có ý tưởng cụ thể)');
      if (projectTitle) userContent += '\n\n[TÊN TRUYỆN]\n' + projectTitle;
      if (genre) userContent += '\n\n[THỂ LOẠI]\n' + genre;
      if (targetLength > 0) userContent += '\n\n[TỔNG ĐỘ DÀI TRUYỆN DỰ KIẾN]\n' + targetLength + ' chương';
      if (Number(planningScopeStart) > 0 && Number(planningScopeEnd) >= Number(planningScopeStart)) {
        const planningScopeSpan = Number(planningScopeEnd) - Number(planningScopeStart) + 1;
        userContent += '\n\n[PHẠM VI LẬP ĐẠI CỤC LẦN NÀY]\n';
        userContent += 'Chương ' + planningScopeStart + ' -> ' + planningScopeEnd + ' (' + planningScopeSpan + ' chương)';
        userContent += '\nChỉ được tạo và phân bổ cột mốc trong đúng phạm vi này.';
        userContent += '\nKhông được tự ý kéo ngược về chương 1 nếu phạm vi không bắt đầu từ chương 1.';
        userContent += '\nKhông được ngầm coi phạm vi này là toàn bộ truyện nếu tổng độ dài truyện còn lớn hơn.';
      }
      if (ultimateGoal) userContent += '\n\n[MỤC TIÊU CUỐI CÙNG]\n' + ultimateGoal;
      if (macroMilestoneCount > 0) {
        userContent += '\n\n[SỐ LƯỢNG CỘT MỐC CẦN TẠO]\n' + macroMilestoneCount;
        userContent += '\nTrả về ĐÚNG ' + macroMilestoneCount + ' phần tử trong mảng milestones.';
      }
      if (Array.isArray(macroMilestoneChapterPlans) && macroMilestoneChapterPlans.length > 0) {
        const planLines = macroMilestoneChapterPlans.map(function (item, index) {
          const from = Number(item?.chapter_from) || 0;
          const to = Number(item?.chapter_to) || 0;
          if (from > 0 && to >= from) {
            return '- Cột mốc ' + (index + 1) + ': KHÓA trong Chương ' + from + ' -> ' + to;
          }
          return '- Cột mốc ' + (index + 1) + ': AUTO phân bổ';
        }).join('\n');
        userContent += '\n\n[PHẠM VI RIÊNG TỪNG CỘT MỐC]\n' + planLines;
        userContent += '\n\n[YÊU CẦU ÁP DỤNG CHO TỪNG CỘT MỐC]\n';
        userContent += 'Những cột mốc đã KHÓA phạm vi thì phải giữ đúng chapter range đó.';
        userContent += '\nNhững cột mốc AUTO thì tự phân bổ vào phần chapter còn lại một cách hợp lý.';
        userContent += '\nKhông được để hai cột mốc KHÓA đứng sai thứ tự hoặc lan ra ngoài planning scope chung.';
      }
      if (macroMilestoneRequirements) {
        userContent += '\n\n[YÊU CẦU RIÊNG]\n' + macroMilestoneRequirements;
      }
      if (Array.isArray(macroChapterAnchorInputs) && macroChapterAnchorInputs.length > 0) {
        userContent += '\n\n[YÊU CẦU BẮT BUỘC THEO CHƯƠNG]\n' + formatChapterAnchorLines(macroChapterAnchorInputs);
        userContent += '\nNguồn này là dữ liệu có cấu trúc, ưu tiên cao hơn prose tự do. Cột mốc nào chứa chapter đích phải mang chapter anchor tương ứng trong contract.';
      }
      const milestoneText = formatMacroMilestoneList(existingMacroMilestones);
      if (milestoneText) {
        userContent += '\n\n[ĐẠI CỤC HIỆN TẠI / BẢN NHÁP CẦN CHỈNH SỬA]\n' + milestoneText;
        userContent += '\n\n[YÊU CẦU]\nChỉnh sửa và tối ưu hóa batch cột mốc hiện tại. Giữ logic leo thang, chapter range hợp lý, và output lại FULL JSON.';
      }
      if (macroRevisionInstruction) {
        userContent += '\n\n[HƯỚNG DẪN CHỈNH SỬA]\n' + macroRevisionInstruction;
      }
      break;
    }

    case TASK_TYPES.ANALYZE_MACRO_CONTRACT: {
      userContent = '[CỘT MỐC ĐẠI CỤC CẦN PHÂN TÍCH]\n';
      if (projectTitle) userContent += 'Tên truyện: ' + projectTitle + '\n';
      if (genre) userContent += 'Thể loại: ' + genre + '\n';
      userContent += 'Tên cột mốc: ' + (currentMacroArc?.title || '');
      userContent += '\nChương: ' + (currentMacroArc?.chapter_from || '?') + ' -> ' + (currentMacroArc?.chapter_to || '?');
      if (currentMacroArc?.emotional_peak) {
        userContent += '\nCảm xúc đích: ' + currentMacroArc.emotional_peak;
      }
      userContent += '\n\n[NỘI DUNG CỘT MỐC]\n' + (currentMacroArc?.description || userPrompt || '(trống)');
      if (ultimateGoal) {
        userContent += '\n\n[MỤC TIÊU CUỐI CÙNG CỦA TRUYỆN]\n' + ultimateGoal;
      }
      if (currentMacroArc?.contract_json) {
        userContent += '\n\n[CONTRACT HIỆN CÓ NẾU CÓ]\n' + currentMacroArc.contract_json;
        userContent += '\n\n[YÊU CẦU]\nPhân tích lại contract cho đúng với nội dung cột mốc hiện tại, không bê nguyên contract cũ nếu nó đã lệch.';
      }
      const existingAnchorText = formatChapterAnchorLines(
        currentMacroArc?.chapter_anchors
          || effectiveMacroArcContract?.chapterAnchors
          || []
      );
      if (existingAnchorText) {
        userContent += '\n\n[CHAPTER ANCHORS HIỆN CÓ]\n' + existingAnchorText;
        userContent += '\nGiữ lại chapter anchors có cấu trúc nếu chúng vẫn hợp lệ; nếu cần chỉnh thì chỉnh cho đúng ý đồ hiện tại, không được làm mất.';
      }
      break;
    }

    case TASK_TYPES.AUDIT_ARC_ALIGNMENT: {
      const summaryText = Array.isArray(recentChapterSummaries) && recentChapterSummaries.length > 0
        ? recentChapterSummaries.map(function (item, index) {
          return (index + 1) + '. ' + (item.title || ('Chương ' + (index + 1))) + ': ' + (item.summary || '(chưa có tóm tắt)');
        }).join('\n')
        : '(Chưa có chương gần đây)';
      userContent = '[CÁC CHƯƠNG GẦN ĐÂY]\n' + summaryText;
      if (ultimateGoal) userContent += '\n\n[ĐẠI CỤC]\n' + ultimateGoal;
      if (currentMacroArc?.title) {
        userContent += '\n\n[CỘT MỐC ĐẠI CỤC HIỆN TẠI]\n' + currentMacroArc.title;
        if (currentMacroArc.description) userContent += '\n' + currentMacroArc.description;
      }
      if (currentArc?.title || currentArc?.goal) {
        userContent += '\n\n[ARC HIỆN TẠI]\n';
        if (currentArc.title) userContent += 'Tên arc: ' + currentArc.title;
        if (currentArc.goal) userContent += (currentArc.title ? '\n' : '') + 'Mục tiêu arc: ' + currentArc.goal;
      }
      if (Number.isFinite(Number(currentChapterIndex))) {
        userContent += '\n\n[VỊ TRÍ HIỆN TẠI]\nChương ' + (Number(currentChapterIndex) + 1);
      }
      break;
    }

    default:
      userContent = userPrompt || 'Hãy giúp tôi với tác phẩm này.';
  }


  return userContent;
}
