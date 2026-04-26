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
      `${anchor.id || 'ANCHOR'} | Chuong ${anchor.targetChapter || '?'}`,
      (anchor.strictness || 'hard').toUpperCase(),
      anchor.requirementText || anchor.requirement_text || '',
    ];
    if (anchor.forbidBefore !== false) parts.push('KHONG duoc dat som');
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
    canonFacts = [],
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
      userContent = 'Viet tiep:\n\n' + (sceneText || selectedText || '');
      if (userPrompt) userContent += '\n\n[HUONG DAN CUA TAC GIA]: ' + userPrompt;
      break;

    case TASK_TYPES.REWRITE:
      userContent = 'Viet lai doan sau:\n\n---\n' + (selectedText || sceneText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[HUONG DAN CUA TAC GIA]: ' + userPrompt;
      break;

    case TASK_TYPES.EXPAND:
      userContent = 'Mo rong doan sau:\n\n---\n' + (selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[HUONG DAN CUA TAC GIA]: ' + userPrompt;
      break;

    case TASK_TYPES.BRAINSTORM:
      userContent = userPrompt
        ? 'Brainstorm: ' + userPrompt
        : 'Goi y 5 huong phat trien tiep theo cho canh/chuong hien tai.\n\nNoi dung hien tai:\n' + (sceneText || '(chua co noi dung)');
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

        userContent = '[MUC TIEU]\nLap dan y/beat cho CHINH chuong hien tai. Uu tien doi chieu noi dung da viet voi dan y hien co de xac dinh beat da xong va beat con thieu.';

        if (userPrompt) {
          userContent += '\n\n[UU TIEN CUA TAC GIA]\n' + userPrompt;
        }

        if (currentChapterOutline) {
          const outlineParts = [];
          if (currentChapterOutline.title) outlineParts.push('Tieu de: ' + currentChapterOutline.title);
          if (currentChapterOutline.summary) outlineParts.push('Summary: ' + currentChapterOutline.summary);
          if (currentChapterOutline.purpose) outlineParts.push('Purpose: ' + currentChapterOutline.purpose);
          if (currentChapterOutline.threadTitles?.length > 0) {
            outlineParts.push('Thread can day: ' + currentChapterOutline.threadTitles.join(', '));
          }
          if (currentChapterOutline.keyEvents?.length > 0) {
            outlineParts.push('Key events:\n' + currentChapterOutline.keyEvents.map(function (item) {
              return '- ' + item;
            }).join('\n'));
          }
          if (outlineParts.length > 0) {
            userContent += '\n\n[DAN Y CHUONG HIEN TAI]\n' + outlineParts.join('\n');
          }
        } else {
          userContent += '\n\n[DAN Y CHUONG HIEN TAI]\n(chua co dan y ro rang, neu tao moi thi chi duoc tao cho chuong nay)';
        }

        userContent += '\n\n[NOI DUNG DA CO CUA CHUONG HIEN TAI]\n';
        userContent += chapterMaterial || '(chua co van ban trong chuong)';
        userContent += '\n\n[SO CANH HIEN CO]\n' + (Number(chapterSceneCount) || 0);

        if (upcomingChapters?.length > 0) {
          userContent += '\n\n[CAC CHUONG KE TIEP - KHONG DUOC PHA VO]\n' + upcomingChapters.map(function (chapter, index) {
            return '- Chuong ' + (index + 1) + ': ' + (chapter.title || '(chua dat ten)') + (chapter.summary ? ' - ' + chapter.summary : '');
          }).join('\n');
        }

        if (budgetText) {
          userContent += '\n\n[GIOI HAN TIEN DO CHUONG NAY]\n' + budgetText;
        }

        userContent += '\n\n[YEU CAU]\nNeu chuong nay da co dan y, hay phan loai beat da hoan thanh, beat con thieu va beat tiep theo TRONG CHINH chuong nay. Neu chuong nay chua co dan y, hay tao dan y cho CHINH chuong nay. Tuyet doi khong viet thay noi dung cua chuong sau da co dan y. Neu thay chuong nay da gan hoan tat, chi ghi ro dieu do trong [GOI Y CHUYEN CHUONG], khong duoc lap beat cu the cho chuong sau.';
      }
      break;

    case TASK_TYPES.PLOT_SUGGEST:
      userContent = '[NOI DUNG HIEN TAI]\n' + (sceneText || '(chua co noi dung canh)');
      if (currentChapterOutline) {
        const outlineParts = [];
        if (currentChapterOutline.title) outlineParts.push('Tieu de: ' + currentChapterOutline.title);
        if (currentChapterOutline.summary) outlineParts.push('Summary: ' + currentChapterOutline.summary);
        if (currentChapterOutline.purpose) outlineParts.push('Purpose: ' + currentChapterOutline.purpose);
        if (currentChapterOutline.threadTitles?.length > 0) {
          outlineParts.push('Thread can day: ' + currentChapterOutline.threadTitles.join(', '));
        }
        if (currentChapterOutline.keyEvents?.length > 0) {
          outlineParts.push('Key events:\n' + currentChapterOutline.keyEvents.map(function (item) {
            return '- ' + item;
          }).join('\n'));
        }
        if (outlineParts.length > 0) {
          userContent += '\n\n[DAN Y CHUONG HIEN TAI]\n' + outlineParts.join('\n');
        }
      }
      if (upcomingChapters?.length > 0) {
        userContent += '\n\n[CAC CHUONG KE TIEP - KHONG DUOC PHA VO]\n' + upcomingChapters.map(function (chapter, index) {
          return '- Chuong ' + (index + 1) + ': ' + (chapter.title || '(chua dat ten)') + (chapter.summary ? ' - ' + chapter.summary : '');
        }).join('\n');
      }
      userContent += '\n\n[YEU CAU]\nNeu canh/chuong hien tai chua xong, de xuat 3 beat tiep theo de nguoi viet co the bam vao Viet tiep ngay. Neu chapter hien tai da den diem chuyen chuong, moi de xuat huong cho chuong ke. Luon noi ro huong nao dang day plot thread nao va thay doi dieu gi trong canon/trang thai nhan vat.';
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
      userContent = '[NOI DUNG CAN RA SOAT]\n---\n' + (sceneText || selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[UU TIEN CUA TAC GIA]\n' + userPrompt;
      break;

    case TASK_TYPES.STYLE_ANALYZE:
      userContent = '[VAN BAN MAU CAN PHAN TICH]\n---\n' + (sceneText || selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[LUU Y CUA TAC GIA]\n' + userPrompt;
      break;

    case TASK_TYPES.STYLE_WRITE:
      userContent = '';
      if (selectedText || sceneText) {
        userContent += '[VAN PHONG MAU]\n---\n' + (selectedText || sceneText || '') + '\n---\n\n';
      }
      userContent += '[YEU CAU NOI DUNG MOI]\n' + (userPrompt || 'Hay viet mot doan moi theo van phong mau.');
      break;

    case TASK_TYPES.AI_GENERATE_ENTITY: {
      const targetType = entityType || 'character';
      const isBatchMode = Number(batchCount) > 1;
      const count = Math.max(1, Number(batchCount) || 1);
      const shouldInferCharacterList = targetType === 'character' && Boolean(aiInferCharacterList);
      const labelMap = {
        character: 'nhan vat',
        location: 'dia diem',
        object: 'vat pham',
        term: 'thuat ngu',
      };
      const schemaMap = {
        character: '{"name":"Ten nhan vat","role":"protagonist|antagonist|supporting|mentor|minor","appearance":"Mo ta 2-3 cau","personality":"Mo ta 2-3 cau","personality_tags":"tag1, tag2","flaws":"Diem yeu/khuyet diem","goals":"Muc tieu","secrets":"Bi mat neu co","notes":"Vai tro trong cot truyen"}',
        location: '{"name":"Ten dia diem","description":"Mo ta 2-3 cau","details":"Chi tiet bo sung, kien truc, bi mat..."}',
        object: '{"name":"Ten vat pham","description":"Mo ta 2-3 cau","properties":"Cong dung, thuoc tinh, han che","owner":"Ten chu so huu neu co"}',
        term: '{"name":"Ten thuat ngu","definition":"Dinh nghia 3-5 cau","category":"magic|organization|race|technology|concept|culture|other"}',
      };
      const singularSchema = schemaMap[targetType] || schemaMap.character;
      const outputSchema = isBatchMode
        ? '{ "items": [' + singularSchema + '] }'
        : singularSchema;

      userContent = '[LOAI THUC THE]\n' + (labelMap[targetType] || targetType);
      userContent += '\n\n[SO LUONG]\n' + (shouldInferCharacterList
        ? `Toi da ${count} muc. Neu danh sach nhan vat ro trong yeu cau bo sung co it hon, chi tao so nhan vat con thieu thuc te.`
        : (isBatchMode ? count + ' muc' : '1 muc'));
      if (projectTitle) userContent += '\n\n[TEN TRUYEN]\n' + projectTitle;
      if (entityContextText) userContent += '\n\n[BOI CANH HIEN CO]\n' + entityContextText;
      if (shouldInferCharacterList) {
        const missingNames = Array.isArray(knownMissingCharacterNames)
          ? knownMissingCharacterNames.filter(Boolean)
          : [];
        userContent += '\n\n[CHE DO TU PHAN TICH NHAN VAT CON THIEU]';
        userContent += '\n- Hay tu doc [YEU CAU CUA TAC GIA] nhu mot dan y/cast list, nhan dien ten nguoi/nhan vat bang cau truc danh sach, dau :, dau (), vai tro, name + aliases.';
        userContent += '\n- Ho tro ten Viet Nam, ten Han Viet/Trung Quoc dich ra, ten tieng Anh, ten viet thuong, ten co dau va alias ngan.';
        userContent += '\n- Doi chieu voi [BOI CANH HIEN CO], dac biet la name + aliases cua nhan vat da co. Ten khac/biet danh cua cung mot nguoi KHONG duoc tinh la nhan vat moi.';
        userContent += '\n- Chi tao nhan vat con thieu. Khong lay dia danh, tieu de phan/chuong, vat pham, phe phai, thuat ngu, hoac cau prose lam ten nhan vat.';
        userContent += '\n- Neu tac gia dang chon so cao hon so con thieu, bo qua so cao va tra ve dung so con thieu.';
        userContent += '\n- Neu tac gia dang chon so thap hon so con thieu, chi tao toi da so duoc chon/so toi da va uu tien cac ten xuat hien trong danh sach nhan vat.';
        if (Number(selectedBatchCount) > 0) {
          userContent += '\n- So tac gia dang chon tren UI: ' + Number(selectedBatchCount) + '.';
        }
        if (missingNames.length > 0) {
          userContent += '\n\n[DANH SACH CON THIEU UI GOI Y - CAN KIEM TRA LAI]\n' + missingNames.map((name) => '- ' + name).join('\n');
        }
      }
      userContent += '\n\n[YEU CAU CUA TAC GIA]\n' + (userPrompt || 'Hay tao mot muc phu hop voi du an nay.');
      userContent += '\n\n[OUTPUT JSON BAT BUOC]\n' + outputSchema;
      break;
    }

    case TASK_TYPES.SCENE_DRAFT:
      userContent = userPrompt
        ? userPrompt
        : 'Viet ban nhap cuc ky chi tiet va dai cho canh "' + (sceneTitle || 'chua dat ten') + '", muc tieu la 1500-2500 tu de huong toi chuan muc 1 chuong dai 7000 tu.';
      break;

    case TASK_TYPES.ARC_OUTLINE: {
      const arcParts = [];
      const allowsStructureChange = revisionInstructionAllowsStructureChange(outlineRevisionInstruction);
      const outlineReportLines = (validatorReports || []).map(function (report, index) {
        const scope = report?.chapterIndex == null
          ? 'Toan bo dot'
          : 'Chuong ' + (startChapterNumber + Number(report.chapterIndex));
        const severity = report?.severity || 'warning';
        const code = report?.code || 'issue';
        const sourceText = report?.inputLabel
          ? ' | Nguon: ' + report.inputLabel
          : '';
        const fieldText = Array.isArray(report?.relevantFields) && report.relevantFields.length > 0
          ? ' | Fields: ' + report.relevantFields.join(', ')
          : '';
        return (index + 1) + '. [' + severity.toUpperCase() + ' | ' + code + ' | ' + scope + sourceText + fieldText + '] ' + (report?.message || '');
      }).join('\n');
      if (userPrompt) arcParts.push('Muc tieu Arc: ' + userPrompt);
      arcParts.push('Chuong moi phai bat dau tu: Chuong ' + startChapterNumber);
      arcParts.push('So luong chuong can tao: ' + (context.chapterCount || 10));
      if (context.arcPacing) {
        const pacingDesc = { slow: 'Cham - xay dung, kham pha', medium: 'Trung binh', fast: 'Nhanh - hanh dong, cao trao' };
        arcParts.push('Nhip do: ' + (pacingDesc[context.arcPacing] || context.arcPacing));
      }
      if (currentMacroArc?.title) {
        const macroParts = ['[MACRO ARC HIEN TAI]'];
        macroParts.push('Tieu de: ' + currentMacroArc.title);
        if (currentMacroArc.description) macroParts.push('Mo ta: ' + currentMacroArc.description);
        if (currentMacroArc.chapter_from && currentMacroArc.chapter_to) {
          macroParts.push('Pham vi: Chuong ' + currentMacroArc.chapter_from + ' den Chuong ' + currentMacroArc.chapter_to);
        }
        arcParts.push(macroParts.join('\n'));
      }
      if (effectiveMacroArcContract) {
        arcParts.push(formatMacroArcContract(effectiveMacroArcContract, {
          header: '[HOP DONG DAI CUC BAT BUOC]',
        }));
      }
      const batchAnchorText = formatChapterAnchorLines(batchChapterAnchors);
      if (batchAnchorText) {
        arcParts.push('[CHAPTER ANCHORS BAT BUOC TRONG BATCH]\n' + batchAnchorText);
      }
      if (previousSummary) arcParts.push('\nTom tat chuong truoc:\n' + previousSummary);
      const budgetText = formatStoryProgressBudget(storyProgressBudget);
      if (budgetText) {
        arcParts.push('[STORY PROGRESS BUDGET]\n' + budgetText);
        arcParts.push([
          'Quy tac bat buoc:',
          '- Khong giai quyet tuyen chinh neu budget hien tai chua cho phep.',
          '- Khong lo dai bi mat neu chua toi milestone/macro arc phu hop.',
          '- It nhat 1 chuong trong batch phai la buildup/setup/consequence.',
          '- Moi chuong phai co purpose rieng va neo it nhat 1 plot thread, su kien, hoac rang buoc canon.',
        ].join('\n'));
      }
      if (generatedOutline?.chapters?.length) {
        const currentOutlineText = generatedOutline.chapters.map(function (chapter, index) {
          const number = startChapterNumber + index;
          const beats = Array.isArray(chapter?.key_events) && chapter.key_events.length > 0
            ? '\n  Beats: ' + chapter.key_events.join(' | ')
          : '';
          return '- Chuong ' + number + ': ' + (chapter?.title || '') + '\n  Purpose: ' + (chapter?.purpose || '') + '\n  Tom tat: ' + (chapter?.summary || '') + beats;
        }).join('\n');
        arcParts.push('[DAN Y HIEN TAI CAN CHINH SUA]\n' + currentOutlineText);
      }
      if (outlineReportLines) {
        arcParts.push('[LOI VALIDATOR CAN XU LY]\n' + outlineReportLines);
        arcParts.push([
          'Yeu cau sua loi validator:',
          '- Uu tien xu ly het cac loi severity=error truoc.',
          '- Neu co loi too-fast hoac premature-resolution, hay lam cham nhip, chen buildup/setup/consequence, va doi tiet lo/ket qua lon thanh manh moi nho hoac he qua nho.',
          '- Giu nguyen batch, so chuong, budget tien do, va cac thread dang mo neu khong bat buoc phai doi.',
          '- Sau khi sua, muc tieu la dan y moi phai pass validator hien tai.',
        ].join('\n'));
      }
      if (outlineRevisionInstruction) {
        arcParts.push('[YEU CAU CHINH SUA DAN Y]\n' + outlineRevisionInstruction);
        arcParts.push(
          allowsStructureChange
            ? 'Hay chinh sua tren dan y hien tai. Ban duoc phep tang/giam/chia/gop so chuong BEN TRONG chinh batch nay neu can de xu ly loi pacing/validator, nhung khong duoc vuot khoi pham vi batch hay budget tien do. Output van phai la FULL JSON outline.'
            : 'Hay chinh sua IN-PLACE tren dan y hien tai. Giu nguyen pham vi batch, so chuong, va budget tien do. Output van phai la FULL JSON outline.'
        );
      }
      const existingBriefText = formatChapterBriefList(existingChapterBriefs, {
        header: '[CAC CHUONG DA CO - KHONG DUOC LAP LAI]',
        limit: 12,
      });
      if (existingBriefText) arcParts.push(existingBriefText);
      userContent = arcParts.join('\n');
      break;
    }

    case TASK_TYPES.ARC_CHAPTER_DRAFT: {
      userContent = '[DAN Y CHUONG]\n';
      userContent += 'So chuong thuc te: ' + startChapterNumber + '\n';
      userContent += 'Tieu de: ' + (context.chapterOutlineTitle || '') + '\n';
      if (context.chapterOutlinePurpose) {
        userContent += 'Purpose: ' + context.chapterOutlinePurpose + '\n';
      }
      userContent += 'Tom tat: ' + (context.chapterOutlineSummary || '') + '\n';
      if (context.chapterOutlineEvents) {
        userContent += 'Su kien chinh:\n' + context.chapterOutlineEvents.map(e => '- ' + e).join('\n');
      }
      if (Array.isArray(context.chapterOutlineObjectiveRefs) && context.chapterOutlineObjectiveRefs.length > 0) {
        userContent += 'Objective refs: ' + context.chapterOutlineObjectiveRefs.join(', ') + '\n';
      }
      if (Array.isArray(context.chapterOutlineAnchorRefs) && context.chapterOutlineAnchorRefs.length > 0) {
        userContent += 'Anchor refs: ' + context.chapterOutlineAnchorRefs.join(', ') + '\n';
      }
      if (context.chapterOutlineStateDelta) {
        userContent += 'State delta duoc phep: ' + context.chapterOutlineStateDelta + '\n';
      }
      if (context.chapterOutlineGuardrail) {
        userContent += 'Arc guard: ' + context.chapterOutlineGuardrail + '\n';
      }
      const currentAnchorText = formatChapterAnchorLines(currentChapterAnchors);
      if (currentAnchorText) {
        userContent += '\n[ANCHOR BAT BUOC CHO CHUONG NAY]\n' + currentAnchorText + '\n';
      }
      const futureAnchorText = formatChapterAnchorLines(futureChapterAnchors);
      if (futureAnchorText) {
        userContent += '\n[ANCHOR CHUA DEN HAN]\n' + futureAnchorText + '\n';
      }
      if (Array.isArray(chapterAnchorValidationReports) && chapterAnchorValidationReports.length > 0) {
        const reportLines = chapterAnchorValidationReports.map((report, index) => (
          (index + 1) + '. [' + (report?.severity || 'warning').toUpperCase() + ' | ' + (report?.code || 'anchor') + '] ' + (report?.message || '')
        )).join('\n');
        userContent += '\n[LOI ANCHOR CAN SUA]\n' + reportLines + '\n';
      }
      if (effectiveMacroArcContract) {
        userContent += '\n' + formatMacroArcContract(effectiveMacroArcContract, {
          header: '[HOP DONG DAI CUC BAT BUOC]',
        }) + '\n';
      }
      const existingBriefText = formatChapterBriefList(existingChapterBriefs, {
        header: '\n[CAC CHUONG DA CO - CHI NHAC LAI NGAN GON, KHONG VIET LAI]',
        limit: 10,
      });
      if (existingBriefText) userContent += '\n' + existingBriefText;
      const priorGeneratedText = formatChapterBriefList(priorGeneratedChapterBriefs, {
        header: '\n[CAC CHUONG MOI DA DUOC LEN DAN Y TRUOC CHUONG NAY]',
        limit: 6,
      });
      if (priorGeneratedText) userContent += '\n' + priorGeneratedText;
      const budgetText = formatStoryProgressBudget(storyProgressBudget);
      if (budgetText) {
        userContent += '\n\n[STORY PROGRESS BUDGET]\n' + budgetText;
        userContent += '\nQuy tac: khong resolve tuyen chinh, khong lo dai bi mat, khong nhay cap suc manh neu budget khong cho phep.';
      }
      break;
    }

    case TASK_TYPES.FREE_PROMPT:
      userContent = userPrompt || '';
      if (sceneText) {
        userContent += '\n\n[Noi dung canh hien tai:]\n' + sceneText;
      }
      break;

    case TASK_TYPES.SUGGEST_UPDATES: {
      const charStatuses = characters.map(function (c) {
        return '- ' + c.name + ': ' + (c.current_status || '(chua co trang thai)');
      }).join('\n');
      const existingFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');

      userContent = '[TRANG THAI HIEN TAI CUA NHAN VAT]\n' + (charStatuses || '(chua co nhan vat)');
      userContent += '\n\n[CANON FACTS HIEN CO]\n' + (existingFacts || '(chua co)');
      userContent += '\n\n[NOI DUNG CHUONG]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CHECK_CONFLICT: {
      const charStatuses = characters.map(function (c) {
        return '- ' + c.name + ': ' + (c.current_status || '(chua co trang thai)');
      }).join('\n');
      const existingFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');

      userContent = '[TRANG THAI NHAN VAT DE KIEM TRA]\n' + (charStatuses || '(chua co nhan vat)');
      userContent += '\n\n[CANON FACTS DE KIEM TRA]\n' + (existingFacts || '(chua co)');
      userContent += '\n\n[NOI DUNG CANH/CHUONG CAN KIEM TRA MAU THUAN]\n---\n' + (sceneText || selectedText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CANON_EXTRACT_OPS: {
      const knownCharacters = characters.map(function (c) {
        return '- ' + c.name + (c.current_status ? ': ' + c.current_status : '');
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

      userContent = '[NHAN VAT DA BIET]\n' + (knownCharacters || '(khong co)');
      userContent += '\n\n[THREAD DA BIET]\n' + (knownThreads || '(khong co)');
      userContent += '\n\n[CANON FACTS DA BIET]\n' + (knownFacts || '(khong co)');
      userContent += '\n\n[DANH SACH CANH]\n' + (sceneTextList || '(khong co)');
      userContent += '\n\n[TOAN BO CHUONG]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CANON_REPAIR: {
      const reportLines = (validatorReports || []).map(function (report, index) {
        return (index + 1) + '. [' + (report.rule_code || report.severity || 'report') + '] ' + report.message;
      }).join('\n');
      userContent = '[LOI CONTINUITY CAN SUA]\n' + (reportLines || '(khong co)');
      userContent += '\n\n[NOI DUNG CHUONG HIEN TAI]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.GENERATE_MACRO_MILESTONES: {
      userContent = '[Y TUONG TAC GIA]\n' + (authorIdea || userPrompt || '(Chua co y tuong cu the)');
      if (projectTitle) userContent += '\n\n[TEN TRUYEN]\n' + projectTitle;
      if (genre) userContent += '\n\n[THE LOAI]\n' + genre;
      if (targetLength > 0) userContent += '\n\n[TONG DO DAI TRUYEN DU KIEN]\n' + targetLength + ' chuong';
      if (Number(planningScopeStart) > 0 && Number(planningScopeEnd) >= Number(planningScopeStart)) {
        const planningScopeSpan = Number(planningScopeEnd) - Number(planningScopeStart) + 1;
        userContent += '\n\n[PHAM VI LAP DAI CUC LAN NAY]\n';
        userContent += 'Chuong ' + planningScopeStart + ' -> ' + planningScopeEnd + ' (' + planningScopeSpan + ' chuong)';
        userContent += '\nChi duoc tao va phan bo cot moc trong dung pham vi nay.';
        userContent += '\nKhong duoc tu y keo nguoc ve chuong 1 neu pham vi khong bat dau tu chuong 1.';
        userContent += '\nKhong duoc ngam coi pham vi nay la toan bo truyen neu tong do dai truyen con lon hon.';
      }
      if (ultimateGoal) userContent += '\n\n[MUC TIEU CUOI CUNG]\n' + ultimateGoal;
      if (macroMilestoneCount > 0) {
        userContent += '\n\n[SO LUONG COT MOC CAN TAO]\n' + macroMilestoneCount;
        userContent += '\nTra ve DUNG ' + macroMilestoneCount + ' phan tu trong mang milestones.';
      }
      if (Array.isArray(macroMilestoneChapterPlans) && macroMilestoneChapterPlans.length > 0) {
        const planLines = macroMilestoneChapterPlans.map(function (item, index) {
          const from = Number(item?.chapter_from) || 0;
          const to = Number(item?.chapter_to) || 0;
          if (from > 0 && to >= from) {
            return '- Cot moc ' + (index + 1) + ': KHOA trong Chuong ' + from + ' -> ' + to;
          }
          return '- Cot moc ' + (index + 1) + ': AUTO phan bo';
        }).join('\n');
        userContent += '\n\n[PHAM VI RIENG TUNG COT MOC]\n' + planLines;
        userContent += '\n\n[YEU CAU AP DUNG CHO TUNG COT MOC]\n';
        userContent += 'Nhung cot moc da KHOA pham vi thi phai giu dung chapter range do.';
        userContent += '\nNhung cot moc AUTO thi tu phan bo vao phan chapter con lai mot cach hop ly.';
        userContent += '\nKhong duoc de hai cot moc KHOA dung sai thu tu hoac lan ra ngoai planning scope chung.';
      }
      if (macroMilestoneRequirements) {
        userContent += '\n\n[YEU CAU RIENG]\n' + macroMilestoneRequirements;
      }
      if (Array.isArray(macroChapterAnchorInputs) && macroChapterAnchorInputs.length > 0) {
        userContent += '\n\n[YEU CAU BAT BUOC THEO CHUONG]\n' + formatChapterAnchorLines(macroChapterAnchorInputs);
        userContent += '\nNguon nay la du lieu co cau truc, uu tien cao hon prose tu do. Cot moc nao chua chapter dich phai mang chapter anchor tuong ung trong contract.';
      }
      const milestoneText = formatMacroMilestoneList(existingMacroMilestones);
      if (milestoneText) {
        userContent += '\n\n[DAI CUC HIEN TAI / BAN NHAP CAN CHINH SUA]\n' + milestoneText;
        userContent += '\n\n[YEU CAU]\nChinh sua va toi uu hoa batch cot moc hien tai. Giu logic leo thang, chapter range hop ly, va output lai FULL JSON.';
      }
      if (macroRevisionInstruction) {
        userContent += '\n\n[HUONG DAN CHINH SUA]\n' + macroRevisionInstruction;
      }
      break;
    }

    case TASK_TYPES.ANALYZE_MACRO_CONTRACT: {
      userContent = '[COT MOC DAI CUC CAN PHAN TICH]\n';
      if (projectTitle) userContent += 'Ten truyen: ' + projectTitle + '\n';
      if (genre) userContent += 'The loai: ' + genre + '\n';
      userContent += 'Ten cot moc: ' + (currentMacroArc?.title || '');
      userContent += '\nChuong: ' + (currentMacroArc?.chapter_from || '?') + ' -> ' + (currentMacroArc?.chapter_to || '?');
      if (currentMacroArc?.emotional_peak) {
        userContent += '\nCam xuc dich: ' + currentMacroArc.emotional_peak;
      }
      userContent += '\n\n[NOI DUNG COT MOC]\n' + (currentMacroArc?.description || userPrompt || '(trong)');
      if (ultimateGoal) {
        userContent += '\n\n[MUC TIEU CUOI CUNG CUA TRUYEN]\n' + ultimateGoal;
      }
      if (currentMacroArc?.contract_json) {
        userContent += '\n\n[CONTRACT HIEN CO NEU CO]\n' + currentMacroArc.contract_json;
        userContent += '\n\n[YEU CAU]\nPhan tich lai contract cho dung voi noi dung cot moc hien tai, khong bê nguyen contract cu neu no da lech.';
      }
      const existingAnchorText = formatChapterAnchorLines(
        currentMacroArc?.chapter_anchors
          || effectiveMacroArcContract?.chapterAnchors
          || []
      );
      if (existingAnchorText) {
        userContent += '\n\n[CHAPTER ANCHORS HIEN CO]\n' + existingAnchorText;
        userContent += '\nGiu lai chapter anchors co cau truc neu chung van hop le; neu can chinh thi chinh cho dung y do hien tai, khong duoc lam mat.';
      }
      break;
    }

    case TASK_TYPES.AUDIT_ARC_ALIGNMENT: {
      const summaryText = Array.isArray(recentChapterSummaries) && recentChapterSummaries.length > 0
        ? recentChapterSummaries.map(function (item, index) {
          return (index + 1) + '. ' + (item.title || ('Chuong ' + (index + 1))) + ': ' + (item.summary || '(chua co tom tat)');
        }).join('\n')
        : '(Chua co chuong gan day)';
      userContent = '[CAC CHUONG GAN DAY]\n' + summaryText;
      if (ultimateGoal) userContent += '\n\n[DAI CUC]\n' + ultimateGoal;
      if (currentMacroArc?.title) {
        userContent += '\n\n[COT MOC DAI CUC HIEN TAI]\n' + currentMacroArc.title;
        if (currentMacroArc.description) userContent += '\n' + currentMacroArc.description;
      }
      if (currentArc?.title || currentArc?.goal) {
        userContent += '\n\n[ARC HIEN TAI]\n';
        if (currentArc.title) userContent += 'Ten arc: ' + currentArc.title;
        if (currentArc.goal) userContent += (currentArc.title ? '\n' : '') + 'Muc tieu arc: ' + currentArc.goal;
      }
      if (Number.isFinite(Number(currentChapterIndex))) {
        userContent += '\n\n[VI TRI HIEN TAI]\nChuong ' + (Number(currentChapterIndex) + 1);
      }
      break;
    }

    default:
      userContent = userPrompt || 'Hay giup toi voi tac pham nay.';
  }


  return userContent;
}
