/**
 * StoryForge - Trợ lý AI tạo dự án
 * Luồng hai lượt: ý tưởng -> nền truyện -> dàn ý chương -> tạo dự án.
 */

import React, { useMemo, useState } from 'react';
import {
  GENRES,
  TONES,
  POV_MODES,
  STORY_STRUCTURES,
  PRONOUN_STYLE_PRESETS,
  GENRE_TO_PRONOUN_STYLE,
  PROJECT_TAG_PRESETS,
  AUTO_GENRE_VALUE,
  CHARACTER_ROLES,
} from '../../utils/constants';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import usePlotStore from '../../stores/plotStore';
import db from '../../services/db/database';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { toVietnameseErrorMessage } from '../../utils/errorMessages';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import {
  composeStoryCreationSystemPrompt,
  getStoryCreationSettings,
  renderStoryCreationTemplate,
} from '../../services/ai/storyCreationSettings';
import { PROMPT_PROFILE_VERSIONS } from '../../services/ai/promptProfiles';
import {
  buildChapterOutlinePassValidation,
  buildStoryBibleSeedValidation,
  buildWizardValidation,
  normalizeChapterListField,
  normalizeChapterOutlinePassResult,
  normalizeStoryBibleSeedResult,
  normalizeWizardBlueprintResult,
  resolveWizardProjectTitle,
} from '../../services/ai/blueprintGuardrails';
import { buildMacroArcDbPayload } from '../StoryBible/utils/storyBibleHelpers';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Dna,
  Eye,
  Flag,
  GitPullRequest,
  Globe,
  Landmark,
  List,
  Loader2,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import ProjectContentModeControl from '../../features/projectContentMode/ProjectContentModeControl.jsx';
import {
  buildProjectContentModePatch,
  PROJECT_CONTENT_MODES,
} from '../../features/projectContentMode/projectContentMode.js';
import './ProjectWizard.css';

const STEPS = ['Ý tưởng', 'Tạo nền truyện', 'Duyệt nền truyện', 'Tạo dàn ý', 'Duyệt & tạo dự án'];

const VALID_THREAD_TYPES = ['main', 'subplot', 'character_arc', 'mystery', 'romance'];
const TYPE_LABELS = {
  main: 'Tuyến chính',
  subplot: 'Tuyến phụ',
  character_arc: 'Nhân vật',
  mystery: 'Bí ẩn',
  romance: 'Tình cảm',
};
const CHAR_ROLES = CHARACTER_ROLES.map((role) => role.value);
const CHAR_ROLE_LABELS = Object.fromEntries(CHARACTER_ROLES.map((role) => [role.value, role.label]));
const TERM_CATEGORIES = ['magic', 'race', 'technology', 'other'];
const FACTION_TYPES = ['sect', 'kingdom', 'organization', 'other'];
const FACTION_TYPE_LABELS = {
  sect: 'Tông môn',
  kingdom: 'Vương quốc',
  organization: 'Tổ chức',
  other: 'Thế lực',
};
const PROPOSAL_GROUPS = [
  { key: 'characters', label: 'Nhân vật', icon: Users, nameField: 'name' },
  { key: 'locations', label: 'Địa điểm', icon: MapPin, nameField: 'name' },
  { key: 'objects', label: 'Vật phẩm', icon: Flag, nameField: 'name' },
  { key: 'factions', label: 'Thế lực', icon: Landmark, nameField: 'name' },
  { key: 'terms', label: 'Thuật ngữ', icon: BookOpen, nameField: 'name' },
  { key: 'plot_threads', label: 'Tuyến truyện', icon: GitPullRequest, nameField: 'title' },
];

const emptyValidation = { blockingIssues: [], warnings: [] };

function clampInitialChapterCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 10;
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

function normalizeProjectTagList(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatProjectTags(tags = []) {
  return tags.join(', ');
}

function toggleProjectTagValue(currentValue, tag) {
  const current = normalizeProjectTagList(currentValue);
  const key = tag.toLowerCase();
  const exists = current.some((item) => item.toLowerCase() === key);
  return formatProjectTags(exists
    ? current.filter((item) => item.toLowerCase() !== key)
    : [...current, tag]);
}

function toPositiveInt(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function shouldAutoAdvanceStart(currentStart, previousTo, oldPreviousTo) {
  if (!previousTo) return false;
  if (!currentStart) return true;
  if (oldPreviousTo && currentStart === oldPreviousTo + 1) return true;
  return currentStart <= previousTo;
}

function clampMacroArcInputRange(item = {}) {
  const chapterFrom = toPositiveInt(item?.chapter_from);
  const chapterTo = toPositiveInt(item?.chapter_to);
  if (!chapterFrom || !chapterTo || chapterTo >= chapterFrom) return item;
  return { ...item, chapter_to: String(chapterFrom) };
}

function cascadeMacroArcInputStarts(items = [], oldChapterTos = []) {
  const next = items.map((item) => ({ ...item }));
  for (let index = 1; index < next.length; index += 1) {
    const previousTo = toPositiveInt(next[index - 1]?.chapter_to);
    const oldPreviousTo = toPositiveInt(oldChapterTos[index - 1]);
    const currentStart = toPositiveInt(next[index]?.chapter_from);
    if (shouldAutoAdvanceStart(currentStart, previousTo, oldPreviousTo)) {
      next[index].chapter_from = String(previousTo + 1);
    }
    next[index] = clampMacroArcInputRange(next[index]);
  }
  return next.map((item) => clampMacroArcInputRange(item));
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatListField(value) {
  return normalizeChapterListField(value).join('\n');
}

function parseWizardJson(text) {
  const parsedValue = parseAIJsonValue(text);
  if (Array.isArray(parsedValue)) return { chapters: parsedValue };
  if (isPlainObject(parsedValue)) return parsedValue;
    throw new Error('Phản hồi JSON không đúng định dạng.');
}

function getRecordName(record, field = 'name') {
  return String(record?.[field] || record?.name || record?.title || '').trim();
}

function mergeRecordsByName(baseItems = [], nextItems = [], nameField = 'name') {
  const merged = [];
  const indexByName = new Map();
  [...baseItems, ...nextItems].forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const name = normalizeSearchText(getRecordName(item, nameField));
    if (!name) return;
    if (indexByName.has(name)) {
      merged[indexByName.get(name)] = { ...merged[indexByName.get(name)], ...item };
      return;
    }
    indexByName.set(name, merged.length);
    merged.push(item);
  });
  return merged;
}

function dedupeIssues(issues = []) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.chapterIndex,
      issue.entityName,
      issue.message,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeProposedEntitiesForUi(proposed = {}) {
  return {
    characters: Array.isArray(proposed.characters) ? proposed.characters : [],
    locations: Array.isArray(proposed.locations) ? proposed.locations : [],
    objects: Array.isArray(proposed.objects) ? proposed.objects : [],
    factions: Array.isArray(proposed.factions) ? proposed.factions : [],
    terms: Array.isArray(proposed.terms) ? proposed.terms : [],
    plot_threads: Array.isArray(proposed.plot_threads) ? proposed.plot_threads : [],
  };
}

function proposalKey(collectionKey, index) {
  return `proposal-${collectionKey}-${index}`;
}

function mergeAcceptedProposals(result = {}, acceptedProposals = new Set()) {
  const proposed = normalizeProposedEntitiesForUi(result.proposed_entities);
  const next = {
    ...result,
    characters: [...(result.characters || [])],
    locations: [...(result.locations || [])],
    objects: [...(result.objects || [])],
    factions: [...(result.factions || [])],
    terms: [...(result.terms || [])],
    plot_threads: [...(result.plot_threads || [])],
  };

  PROPOSAL_GROUPS.forEach((group) => {
    const acceptedItems = proposed[group.key].filter((_, index) => (
      acceptedProposals.has(proposalKey(group.key, index))
    ));
    next[group.key] = mergeRecordsByName(next[group.key], acceptedItems, group.nameField);
  });

  return normalizeWizardBlueprintResult(next);
}

function filterApprovedSeed(result = {}, excluded = new Set()) {
  return normalizeStoryBibleSeedResult({
    ...result,
    characters: (result.characters || []).filter((_, index) => !excluded.has(`char-${index}`)),
    locations: (result.locations || []).filter((_, index) => !excluded.has(`loc-${index}`)),
    objects: (result.objects || []).filter((_, index) => !excluded.has(`object-${index}`)),
    factions: (result.factions || []).filter((_, index) => !excluded.has(`faction-${index}`)),
    terms: (result.terms || []).filter((_, index) => !excluded.has(`term-${index}`)),
    plot_threads: (result.plot_threads || []).filter((_, index) => !excluded.has(`thread-${index}`)),
    chapters: [],
    proposed_entities: {},
  }, result.title || '');
}

function buildCoverageWarnings(result, excluded) {
  if (!result?.chapters?.length) return [];

  const includedChapters = result.chapters.filter((_, index) => !excluded.has(`chapter-${index}`));
  if (!includedChapters.length) return [];
  const includedCharacters = (result.characters || []).filter((_, index) => !excluded.has(`char-${index}`));
  const includedLocations = (result.locations || []).filter((_, index) => !excluded.has(`loc-${index}`));
  const includedThreads = (result.plot_threads || []).filter((_, index) => !excluded.has(`thread-${index}`));
  const warnings = [];
  const chapterSignals = includedChapters.map((chapter, index) => {
    const summary = String(chapter.summary || '').trim();
    const purpose = String(chapter.purpose || '').trim();
    const featuredCharacters = normalizeChapterListField(chapter.featured_characters).map((item) => normalizeSearchText(item));
    const threadTitles = normalizeChapterListField(chapter.thread_titles).map((item) => normalizeSearchText(item));
    const primaryLocation = normalizeSearchText(chapter.primary_location);
    const searchableText = normalizeSearchText([
      chapter.title || '',
      purpose,
      summary,
      ...normalizeChapterListField(chapter.featured_characters),
      ...normalizeChapterListField(chapter.thread_titles),
      chapter.primary_location || '',
    ].join(' \n '));

    return {
      title: chapter.title || `Chương ${index + 1}`,
      summaryLength: summary.length,
      purposeLength: purpose.length,
      threadCount: threadTitles.length,
      featuredCharacterCount: featuredCharacters.length,
      featuredCharacters: new Set(featuredCharacters),
      threadTitles: new Set(threadTitles),
      primaryLocation,
      searchableText,
    };
  });

  const missingCharacters = includedCharacters
    .filter((item) => item?.name && item.role !== 'minor')
    .filter((item) => {
      const normalizedName = normalizeSearchText(item.name);
      return !chapterSignals.some((chapter) => (
        chapter.featuredCharacters.has(normalizedName) || chapter.searchableText.includes(normalizedName)
      ));
    })
    .map((item) => item.name);
  if (missingCharacters.length) {
    warnings.push(`Nhân vật chưa bám vào dàn ý chương: ${missingCharacters.slice(0, 4).join(', ')}${missingCharacters.length > 4 ? '...' : ''}`);
  }

  const missingLocations = includedLocations
    .filter((item) => item?.name)
    .filter((item) => {
      const normalizedName = normalizeSearchText(item.name);
      return !chapterSignals.some((chapter) => (
        chapter.primaryLocation === normalizedName || chapter.searchableText.includes(normalizedName)
      ));
    })
    .map((item) => item.name);
  if (missingLocations.length) {
    warnings.push(`Địa điểm chưa xuất hiện trong dàn ý chương: ${missingLocations.slice(0, 4).join(', ')}${missingLocations.length > 4 ? '...' : ''}`);
  }

  const looseThreads = includedThreads
    .filter((item) => item?.title)
    .filter((item) => {
      const normalizedTitle = normalizeSearchText(item.title);
      return !chapterSignals.some((chapter) => (
        chapter.threadTitles.has(normalizedTitle) || chapter.searchableText.includes(normalizedTitle)
      ));
    })
    .map((item) => item.title);
  if (looseThreads.length) {
    warnings.push(`Một số tuyến truyện chưa có điểm neo rõ ở chương: ${looseThreads.slice(0, 4).join(', ')}${looseThreads.length > 4 ? '...' : ''}`);
  }

  const strictDenseChapters = chapterSignals
    .filter((chapter) => {
      let overloadScore = 0;
      if (chapter.summaryLength > 620) overloadScore += 2;
      else if (chapter.summaryLength > 500) overloadScore += 1;
      if (chapter.threadCount >= 3) overloadScore += 1;
      if (chapter.featuredCharacterCount >= 4) overloadScore += 1;
      if (chapter.purposeLength > 140) overloadScore += 1;
      return chapter.summaryLength > 420 && overloadScore >= 3;
    })
    .map((chapter) => chapter.title);
  if (strictDenseChapters.length) {
    warnings.push(`Một số chương có dấu hiệu nhồi quá nhiều tuyến hoặc sự kiện: ${strictDenseChapters.slice(0, 3).join(', ')}${strictDenseChapters.length > 3 ? '...' : ''}`);
  }

  return warnings;
}

export default function ProjectWizard({ onClose, onCreated }) {
  const { createProject, createChapter } = useProjectStore();
  const {
    createCharacter,
    createLocation,
    createObject,
    createWorldTerm,
    createFaction,
    saveChapterSummary,
  } = useCodexStore();
  const { createPlotThread } = usePlotStore();

  const [step, setStep] = useState(0);
  const [idea, setIdea] = useState('');
  const [genre, setGenre] = useState(AUTO_GENRE_VALUE);
  const [tone, setTone] = useState('');
  const [projectTags, setProjectTags] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  const [useTagFirstPromptProfile, setUseTagFirstPromptProfile] = useState(true);
  const [povMode, setPovMode] = useState('third_omni');
  const [pronounStyle, setPronounStyle] = useState(GENRE_TO_PRONOUN_STYLE[AUTO_GENRE_VALUE] || 'hien_dai');
  const [synopsis, setSynopsis] = useState('');
  const [storyStructure, setStoryStructure] = useState('');
  const [contentMode, setContentMode] = useState(PROJECT_CONTENT_MODES.SAFE);
  const [targetLength, setTargetLength] = useState(0);
  const [targetLengthType, setTargetLengthType] = useState('unset');
  const [ultimateGoal, setUltimateGoal] = useState('');
  const [milestonesInfo, setMilestonesInfo] = useState([]);
  const [initialChapterCount, setInitialChapterCount] = useState(10);
  const [macroArcsInput, setMacroArcsInput] = useState([]);
  const [showMacroArcs, setShowMacroArcs] = useState(false);
  const [autoGenerateOutline, setAutoGenerateOutline] = useState(false);

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [excluded, setExcluded] = useState(new Set());
  const [editingKey, setEditingKey] = useState(null);
  const [acceptedProposals, setAcceptedProposals] = useState(new Set());

  const currentPronoun = PRONOUN_STYLE_PRESETS.find((p) => p.value === pronounStyle);
  const currentTemplate = GENRE_TEMPLATES[genre];
  const selectedProjectTags = useMemo(() => normalizeProjectTagList(projectTags), [projectTags]);
  const hasDNA = !!(currentTemplate?.constitution?.length || currentTemplate?.style_dna?.length);
  const chapterCount = clampInitialChapterCount(initialChapterCount);

  const workingResult = useMemo(
    () => (result ? mergeAcceptedProposals(result, acceptedProposals) : null),
    [acceptedProposals, result],
  );
  const seedValidationTarget = useMemo(
    () => (workingResult ? { ...workingResult, chapters: [] } : null),
    [workingResult],
  );
  const seedValidation = useMemo(
    () => (seedValidationTarget ? buildStoryBibleSeedValidation(seedValidationTarget, { initialChapterCount: chapterCount, excluded }) : emptyValidation),
    [chapterCount, excluded, seedValidationTarget],
  );
  const outlineValidation = useMemo(() => {
    if (!workingResult?.chapters?.length) return emptyValidation;
    const baseValidation = buildWizardValidation(workingResult, excluded);
    const passValidation = buildChapterOutlinePassValidation(workingResult, workingResult, {
      excluded,
      acceptedProposals,
    });
    return {
      blockingIssues: dedupeIssues([...baseValidation.blockingIssues, ...passValidation.blockingIssues]),
      warnings: dedupeIssues([...baseValidation.warnings, ...passValidation.warnings]),
    };
  }, [acceptedProposals, excluded, workingResult]);
  const blockingIssues = step >= 4
    ? dedupeIssues([...seedValidation.blockingIssues, ...outlineValidation.blockingIssues])
    : seedValidation.blockingIssues;
  const coverageWarnings = step >= 4 && workingResult
    ? [
      ...seedValidation.warnings,
      ...outlineValidation.warnings,
      ...buildCoverageWarnings(workingResult, excluded).map((message) => ({ code: 'coverage-warning', message })),
    ]
    : seedValidation.warnings;

  const handleSelectNumericField = (event) => {
    const input = event.currentTarget;
    const selectInput = () => {
      if (document.activeElement === input) input.select();
    };
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(selectInput);
    } else {
      setTimeout(selectInput, 0);
    }
  };

  const handleGenreChange = (value) => {
    setGenre(value);
    setPronounStyle(GENRE_TO_PRONOUN_STYLE[value] || 'hien_dai');
  };

  const handleProjectTagToggle = (tag) => {
    setProjectTags((value) => toggleProjectTagValue(value, tag));
  };

  const handleTargetLengthTypeChange = (value) => {
    setTargetLengthType(value);
    if (value === 'short') setTargetLength(50);
    else if (value === 'medium') setTargetLength(150);
    else if (value === 'long') setTargetLength(400);
    else if (value === 'epic') setTargetLength(800);
  };

  const addMilestone = () => setMilestonesInfo((prev) => [...prev, { percent: 50, description: '' }]);
  const updateMilestone = (index, field, value) => {
    setMilestonesInfo((prev) => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };
  const removeMilestone = (index) => setMilestonesInfo((prev) => prev.filter((_, itemIndex) => itemIndex !== index));

  const addMacroArc = () => {
    setMacroArcsInput((prev) => {
      const previousEnd = prev.reduce((max, item) => Math.max(max, toPositiveInt(item.chapter_to)), 0);
      return [...prev, {
        title: `Cột mốc ${prev.length + 1}`,
        description: '',
        chapter_from: previousEnd ? String(previousEnd + 1) : '',
        chapter_to: '',
        emotional_peak: '',
      }];
    });
  };
  const updateMacroArc = (index, field, value) => {
    setMacroArcsInput((prev) => {
      const oldChapterTos = prev.map((item) => item?.chapter_to);
      const next = prev.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      ));
      return field === 'chapter_to' ? cascadeMacroArcInputStarts(next, oldChapterTos) : next;
    });
  };
  const removeMacroArc = (index) => setMacroArcsInput((prev) => prev.filter((_, itemIndex) => itemIndex !== index));

  const toggleExclude = (key) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleEdit = (key) => setEditingKey((prev) => (prev === key ? null : key));
  const toggleProposal = (key) => {
    setAcceptedProposals((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateResultItem = (section, index, field, value) => {
    setResult((prev) => {
      const arr = [...(prev?.[section] || [])];
      arr[index] = { ...arr[index], [field]: value };
      return { ...prev, [section]: arr };
    });
  };
  const updateResultListField = (section, index, field, value) => {
    updateResultItem(section, index, field, normalizeChapterListField(value));
  };
  const updateCharacterSpecificRole = (index, value) => {
    setResult((prev) => {
      const arr = [...(prev?.characters || [])];
      const current = arr[index] || {};
      const previousRole = String(current.specific_role || '').trim();
      const nextRole = String(value || '').trim();
      arr[index] = {
        ...current,
        specific_role: value,
        specific_role_locked: nextRole ? (previousRole ? Boolean(current.specific_role_locked) : true) : false,
      };
      return { ...prev, characters: arr };
    });
  };
  const updateCharacterSpecificRoleLocked = (index, checked) => {
    setResult((prev) => {
      const arr = [...(prev?.characters || [])];
      const current = arr[index] || {};
      const specificRole = String(current.specific_role || '').trim();
      arr[index] = {
        ...current,
        specific_role_locked: Boolean(checked && specificRole),
      };
      return { ...prev, characters: arr };
    });
  };

  const buildTemplateVariables = (approvedSeed = null) => {
    const template = GENRE_TEMPLATES[genre];
    const templateHint = template && useTemplate && genre !== AUTO_GENRE_VALUE
      ? `\n\nTham khảo mẫu thể loại "${template.label}" — Chỉ dùng mẫu như từ điển bối cảnh, không dùng làm gói cốt truyện:\n- Quy tắc nền tham khảo: ${template.worldRules?.join(', ')}\n- Thuật ngữ tham khảo, không bắt buộc dùng: ${template.terms?.map((term) => term.name).join(', ')}\n- Không gom toàn bộ thuật ngữ/entity mẫu vào seed; chỉ chọn yếu tố thật sự phục vụ premise, tag/trope và phần mở đầu.\n- Nếu ý tưởng là bất kỳ/ngẫu nhiên/tự chọn trong thể loại này, phải tạo biến thể premise riêng, không lặp công thức mở đầu phổ biến của thể loại.`
      : '';
    const genreLabel = GENRES.find((item) => item.value === genre)?.label || genre;
    let pacingGuidance = '';
    if (Number(targetLength) > 100 && chapterCount < Number(targetLength)) {
      const percent = Math.round((chapterCount / Number(targetLength)) * 100);
      pacingGuidance = `\n\nHƯỚNG DẪN PACING:\n- Đây là ${chapterCount} chương đầu trong truyện dài ${targetLength} chương, mới chiếm khoảng ${percent}% tổng chiều dài.\n- Ưu tiên nền tảng thế giới, nhân vật và mâu thuẫn mở đầu.\n- Không đốt quá nhiều biến cố lớn trong một chương.`;
    }

    return {
      genre: genreLabel,
      tone: tone || 'mặc định',
      tags_line: projectTags ? `HỢP ĐỒNG TAG / TROPE: ${projectTags}\n` : '',
      pov_label: POV_MODES.find((item) => item.value === povMode)?.label || 'Ngôi 3',
      pronoun_label: currentPronoun?.label || 'Mặc định',
      target_length_label: targetLength > 0 ? `${targetLength} chương` : 'Chưa xác định',
      ultimate_goal: ultimateGoal || 'Chưa có',
      synopsis_line: synopsis ? `Cốt truyện: ${synopsis}\n` : '',
      story_structure_line: storyStructure ? `Cấu trúc: ${STORY_STRUCTURES.find((item) => item.value === storyStructure)?.label}\n` : '',
      idea,
      template_hint: templateHint,
      initial_chapter_count: chapterCount,
      pacing_guidance: pacingGuidance,
      approved_seed_json: approvedSeed ? JSON.stringify(approvedSeed, null, 2) : '',
    };
  };

  const sendStoryCreationRequest = ({ groupKey, taskType, variables, onComplete, onError }) => {
    const storyCreationSettings = getStoryCreationSettings();
    const prompts = storyCreationSettings[groupKey];
    const messages = [
      {
        role: 'system',
        content: renderStoryCreationTemplate(
          composeStoryCreationSystemPrompt(groupKey, prompts.systemPrompt),
          variables,
        ),
      },
      {
        role: 'user',
        content: renderStoryCreationTemplate(prompts.userPromptTemplate, variables),
      },
    ];

    aiService.send({
      taskType,
      messages,
      stream: false,
      onComplete,
      onError,
    });
  };

  const requestOutline = (seedInput) => {
    const approvedSeed = filterApprovedSeed(seedInput, excluded);
    const validation = buildStoryBibleSeedValidation(approvedSeed, {
      initialChapterCount: chapterCount,
      excluded: new Set(),
    });
    if (validation.blockingIssues.length > 0) {
      setError('Nền truyện còn lỗi chặn. Hãy sửa nền truyện trước khi tạo dàn ý.');
      setStep(2);
      setIsGenerating(false);
      return;
    }

    setStep(3);
    setIsGenerating(true);
    setError(null);

    sendStoryCreationRequest({
      groupKey: 'chapterOutlinePass',
      taskType: TASK_TYPES.CHAPTER_OUTLINE_PASS,
      variables: buildTemplateVariables(approvedSeed),
      onComplete: (text) => {
        setIsGenerating(false);
        try {
          const parsed = parseWizardJson(text);
          const outline = normalizeChapterOutlinePassResult(parsed, approvedSeed);
          const seedThreadNames = new Set((approvedSeed.plot_threads || []).map((thread) => normalizeSearchText(thread.title)));
          const existingOutlineThreads = outline.plot_threads.filter((thread) => seedThreadNames.has(normalizeSearchText(thread.title)));
          const proposedOutlineThreads = outline.plot_threads
            .filter((thread) => thread.title && !seedThreadNames.has(normalizeSearchText(thread.title)))
            .map((thread) => ({
              ...thread,
              reason: thread.reason || 'Dàn ý đề xuất tuyến truyện mới ngoài nền truyện đã duyệt.',
            }));
          const mergedPlotThreads = existingOutlineThreads.length
            ? mergeRecordsByName(approvedSeed.plot_threads, existingOutlineThreads, 'title')
            : approvedSeed.plot_threads;
          const proposedEntities = {
            ...outline.proposed_entities,
            plot_threads: mergeRecordsByName(
              outline.proposed_entities?.plot_threads || [],
              proposedOutlineThreads,
              'title',
            ),
          };
          setResult((prev) => normalizeWizardBlueprintResult({
            ...(prev || approvedSeed),
            chapters: outline.chapters,
            plot_threads: mergedPlotThreads,
            proposed_entities: proposedEntities,
          }, idea));
          setAcceptedProposals(new Set());
          setEditingKey(null);
          setStep(4);
        } catch (parseError) {
          console.error('[Wizard] Outline parse error:', parseError, '\nRaw:', text);
          setError('Không parse được dàn ý chương. Hãy thử tạo lại dàn ý.');
          setStep(2);
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setError(toVietnameseErrorMessage(err, 'Lỗi kết nối AI khi tạo dàn ý.'));
        setStep(2);
      },
    });
  };

  const handleGenerateSeed = async () => {
    setStep(1);
    setIsGenerating(true);
    setError(null);
    setResult(null);
    setExcluded(new Set());
    setAcceptedProposals(new Set());
    setEditingKey(null);

    sendStoryCreationRequest({
      groupKey: 'storyBibleSeed',
      taskType: TASK_TYPES.STORY_BIBLE_SEED,
      variables: buildTemplateVariables(),
      onComplete: (text) => {
        try {
          const parsed = parseWizardJson(text);
          const seed = normalizeStoryBibleSeedResult(parsed, idea);
          setResult(seed);
          const validation = buildStoryBibleSeedValidation(seed, {
            initialChapterCount: chapterCount,
            excluded: new Set(),
          });
          if (autoGenerateOutline && validation.blockingIssues.length === 0) {
            requestOutline(seed);
            return;
          }
          setIsGenerating(false);
          setStep(2);
        } catch (parseError) {
          console.error('[Wizard] Seed parse error:', parseError, '\nRaw:', text);
          setIsGenerating(false);
          setError('Không parse được nền truyện. Hãy thử lại.');
          setStep(0);
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setError(toVietnameseErrorMessage(err, 'Lỗi kết nối AI khi tạo nền truyện.'));
        setStep(0);
      },
    });
  };

  const handleApprove = async () => {
    if (!result) return;
    const finalResult = mergeAcceptedProposals(result, acceptedProposals);
    const finalSeedValidation = buildStoryBibleSeedValidation({ ...finalResult, chapters: [] }, { initialChapterCount: chapterCount, excluded });
    const finalOutlineValidation = finalResult.chapters?.length
      ? {
        blockingIssues: dedupeIssues([
          ...buildWizardValidation(finalResult, excluded).blockingIssues,
          ...buildChapterOutlinePassValidation(finalResult, finalResult, { excluded, acceptedProposals }).blockingIssues,
        ]),
      }
      : { blockingIssues: [{ code: 'missing-outline', message: 'Chưa có dàn ý chương để tạo dự án.' }] };
    const finalBlockers = dedupeIssues([
      ...finalSeedValidation.blockingIssues,
      ...finalOutlineValidation.blockingIssues,
    ]);

    if (finalBlockers.length > 0) {
      setError('Blueprint hiện tại còn lỗi chặn. Hãy sửa các mục đỏ trước khi tạo dự án.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const wp = finalResult.world_profile || {};
      const projectTitle = resolveWizardProjectTitle(finalResult, idea);
      const projectId = await createProject({
        title: projectTitle,
        genre_primary: genre,
        tone,
        project_tags: projectTags,
        description: finalResult.premise || idea,
        world_name: wp.world_name || '',
        world_type: wp.world_type || '',
        world_scale: wp.world_scale || '',
        world_era: wp.world_era || '',
        world_rules: JSON.stringify(wp.world_rules || []),
        world_description: wp.world_description || '',
        pov_mode: povMode,
        pronoun_style: pronounStyle,
        synopsis: synopsis || finalResult.premise || '',
        story_structure: storyStructure,
        prompt_profile_version: useTagFirstPromptProfile
          ? PROMPT_PROFILE_VERSIONS.TAG_FIRST_V2
          : PROMPT_PROFILE_VERSIONS.LEGACY,
        target_length: Number(targetLength) || 0,
        target_length_type: targetLengthType,
        ultimate_goal: ultimateGoal,
        milestones: JSON.stringify(milestonesInfo),
        ...buildProjectContentModePatch(contentMode),
        skipFirstChapter: true,
      });

      if (finalResult.title?.trim() && finalResult.title.trim() !== projectTitle) {
        await db.projects.update(projectId, { title: finalResult.title.trim() });
      }

      for (let index = 0; index < (finalResult.characters || []).length; index += 1) {
        const character = finalResult.characters[index];
        if (excluded.has(`char-${index}`) || !character.name?.trim()) continue;
        await createCharacter({
          project_id: projectId,
          name: character.name.trim(),
          aliases: character.aliases || [],
          role: character.role || 'supporting',
          specific_role: String(character.specific_role || '').trim(),
          specific_role_locked: Boolean(character.specific_role_locked && String(character.specific_role || '').trim()),
          age: character.age || '',
          appearance: character.appearance || '',
          personality: (character.personality || '') + (character.flaws ? `\nĐiểm yếu: ${character.flaws}` : ''),
          flaws: character.flaws || '',
          personality_tags: character.personality_tags || '',
          goals: character.goals || '',
          current_status: character.current_status || '',
          notes: character.story_function || '',
          story_function: character.story_function || '',
        });
      }

      for (let index = 0; index < (finalResult.locations || []).length; index += 1) {
        const location = finalResult.locations[index];
        if (excluded.has(`loc-${index}`) || !location.name?.trim()) continue;
        await createLocation({
          project_id: projectId,
          name: location.name.trim(),
          description: location.description || '',
          details: location.story_function || '',
          story_function: location.story_function || '',
        });
      }

      for (let index = 0; index < (finalResult.objects || []).length; index += 1) {
        const object = finalResult.objects[index];
        if (excluded.has(`object-${index}`) || !object.name?.trim()) continue;
        await createObject({
          project_id: projectId,
          name: object.name.trim(),
          description: object.description || '',
          properties: object.story_function || '',
          story_function: object.story_function || '',
        });
      }

      for (let index = 0; index < (finalResult.factions || []).length; index += 1) {
        const faction = finalResult.factions[index];
        if (excluded.has(`faction-${index}`) || !faction.name?.trim()) continue;
        await createFaction({
          project_id: projectId,
          name: faction.name.trim(),
          faction_type: FACTION_TYPES.includes(faction.faction_type) ? faction.faction_type : 'other',
          description: faction.description || '',
          notes: faction.notes || '',
          story_function: faction.story_function || '',
          aliases: [],
        });
      }

      for (let index = 0; index < (finalResult.terms || []).length; index += 1) {
        const term = finalResult.terms[index];
        if (excluded.has(`term-${index}`) || !term.name?.trim()) continue;
        await createWorldTerm({
          project_id: projectId,
          name: term.name.trim(),
          definition: term.definition || '',
          category: term.category || 'other',
          source_kind: term.story_function ? `wizard:${term.story_function}` : '',
          story_function: term.story_function || '',
        });
      }

      for (let index = 0; index < (finalResult.plot_threads || []).length; index += 1) {
        const thread = finalResult.plot_threads[index];
        if (excluded.has(`thread-${index}`) || !thread.title?.trim()) continue;
        await createPlotThread({
          project_id: projectId,
          title: thread.title.trim(),
          type: VALID_THREAD_TYPES.includes(thread.type) ? thread.type : 'subplot',
          description: thread.description || '',
          state: thread.state === 'resolved' ? 'resolved' : 'active',
          opening_window: thread.opening_window || '',
          anchor_chapters: normalizeChapterListField(thread.anchor_chapters),
        });
      }

      for (let index = 0; index < (finalResult.chapters || []).length; index += 1) {
        const chapter = finalResult.chapters[index];
        if (excluded.has(`chapter-${index}`)) continue;
        const chapterData = {
          title: chapter.title || `Chương ${index + 1}`,
          summary: chapter.summary || '',
          purpose: chapter.purpose || '',
          opening_state: chapter.opening_state || '',
          handoff_from_previous: chapter.handoff_from_previous || '',
          ending_state: chapter.ending_state || '',
          featured_characters: normalizeChapterListField(chapter.featured_characters),
          primary_location: chapter.primary_location || '',
          thread_titles: normalizeChapterListField(chapter.thread_titles),
          key_events: normalizeChapterListField(chapter.key_events),
          required_factions: normalizeChapterListField(chapter.required_factions),
          required_objects: normalizeChapterListField(chapter.required_objects),
          required_terms: normalizeChapterListField(chapter.required_terms),
          state_delta: chapter.state_delta || '',
        };
        const createdChapter = await createChapter(projectId, chapterData.title, chapterData);
        if (createdChapter?.chapterId && chapterData.summary) {
          await saveChapterSummary(createdChapter.chapterId, projectId, chapterData.summary);
        }
      }

      const validMacroArcs = macroArcsInput.filter((item) => item.title?.trim());
      for (let index = 0; index < validMacroArcs.length; index += 1) {
        const macroArc = validMacroArcs[index];
        await db.macro_arcs.add({
          project_id: projectId,
          order_index: index,
          ...(buildMacroArcDbPayload({
            title: macroArc.title.trim(),
            description: macroArc.description || '',
            chapter_from: Number(macroArc.chapter_from) || 0,
            chapter_to: Number(macroArc.chapter_to) || 0,
            emotional_peak: macroArc.emotional_peak || '',
            chapter_anchors: [],
            contract_json: '',
          }) || {}),
        });
      }

      onCreated(projectId);
    } catch (err) {
      console.error('[Wizard] Create error:', err);
      setError(`Lỗi khi tạo dự án: ${toVietnameseErrorMessage(err, 'Không tạo được dự án.')}`);
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setStep(0);
    setResult(null);
    setExcluded(new Set());
    setAcceptedProposals(new Set());
    setEditingKey(null);
    setError(null);
  };

  const renderItemActions = (key) => (
    <div className="wizard-item-actions">
      <button
        className={`btn btn-ghost btn-icon btn-sm ${editingKey === key ? 'btn--active' : ''}`}
        onClick={() => toggleEdit(key)}
        title={editingKey === key ? 'Đóng chỉnh sửa' : 'Chỉnh sửa'}
      >
        <Pencil size={14} />
      </button>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => toggleExclude(key)}
        title={excluded.has(key) ? 'Khôi phục' : 'Loại khỏi dự án'}
      >
        {excluded.has(key) ? <RotateCcw size={14} /> : <Trash2 size={14} />}
      </button>
    </div>
  );

  const renderCharEdit = (character, index) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Tên</label>
          <input className="input input-sm" value={character.name || ''} onChange={(event) => updateResultItem('characters', index, 'name', event.target.value)} />
        </div>
        <div className="wizard-edit-field wizard-edit-field--role">
          <label>Vai trò</label>
          <select className="select select-sm wizard-role-select" value={character.role || 'supporting'} onChange={(event) => updateResultItem('characters', index, 'role', event.target.value)}>
            {CHAR_ROLES.map((role) => <option key={role} value={role}>{CHAR_ROLE_LABELS[role] || role}</option>)}
          </select>
        </div>
      </div>
      <div className="wizard-edit-field">
        <label>Vai trò canon cụ thể</label>
        <input className="input input-sm" value={character.specific_role || ''} onChange={(event) => updateCharacterSpecificRole(index, event.target.value)} />
        <label className="wizard-inline-check">
          <input
            type="checkbox"
            checked={Boolean(character.specific_role_locked && String(character.specific_role || '').trim())}
            disabled={!String(character.specific_role || '').trim()}
            onChange={(event) => updateCharacterSpecificRoleLocked(index, event.target.checked)}
          />
          <span>Khóa vai trò này như canon</span>
        </label>
      </div>
      <div className="wizard-edit-field">
        <label>Tính cách</label>
        <textarea className="textarea textarea-sm" rows={2} value={character.personality || ''} onChange={(event) => updateResultItem('characters', index, 'personality', event.target.value)} />
      </div>
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Tuổi / độ tuổi</label>
          <input className="input input-sm" value={character.age || ''} onChange={(event) => updateResultItem('characters', index, 'age', event.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Điểm yếu</label>
          <input className="input input-sm" value={character.flaws || ''} onChange={(event) => updateResultItem('characters', index, 'flaws', event.target.value)} />
        </div>
      </div>
      <div className="wizard-edit-field">
        <label>Mục tiêu</label>
        <input className="input input-sm" value={character.goals || ''} onChange={(event) => updateResultItem('characters', index, 'goals', event.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Trạng thái hiện tại / canon mở truyện</label>
        <textarea className="textarea textarea-sm" rows={2} value={character.current_status || ''} onChange={(event) => updateResultItem('characters', index, 'current_status', event.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Ngoại hình</label>
        <input className="input input-sm" value={character.appearance || ''} onChange={(event) => updateResultItem('characters', index, 'appearance', event.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Vai trò trong phần mở đầu</label>
        <textarea className="textarea textarea-sm" rows={2} value={character.story_function || ''} onChange={(event) => updateResultItem('characters', index, 'story_function', event.target.value)} />
      </div>
    </div>
  );

  const renderSimpleEntityEdit = (section, item, index, fields) => (
    <div className="wizard-item-edit">
      {fields.map((field) => (
        <div className="wizard-edit-field" key={field.key}>
          <label>{field.label}</label>
          {field.type === 'select' ? (
            <select className="select select-sm" value={item[field.key] || field.defaultValue || ''} onChange={(event) => updateResultItem(section, index, field.key, event.target.value)}>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : field.type === 'textarea' ? (
            <textarea className="textarea textarea-sm" rows={field.rows || 2} value={item[field.key] || ''} onChange={(event) => updateResultItem(section, index, field.key, event.target.value)} />
          ) : (
            <input className="input input-sm" value={item[field.key] || ''} onChange={(event) => updateResultItem(section, index, field.key, event.target.value)} />
          )}
        </div>
      ))}
    </div>
  );

  const renderChapterEdit = (chapter, index) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-field">
        <label>Tiêu đề</label>
        <input className="input input-sm" value={chapter.title || ''} onChange={(event) => updateResultItem('chapters', index, 'title', event.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Mục đích</label>
        <textarea className="textarea textarea-sm" rows={2} value={chapter.purpose || ''} onChange={(event) => updateResultItem('chapters', index, 'purpose', event.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Tóm tắt</label>
        <textarea className="textarea textarea-sm" rows={3} value={chapter.summary || ''} onChange={(event) => updateResultItem('chapters', index, 'summary', event.target.value)} />
      </div>
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Trạng thái mở chương</label>
          <textarea className="textarea textarea-sm" rows={2} value={chapter.opening_state || ''} onChange={(event) => updateResultItem('chapters', index, 'opening_state', event.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Trạng thái kết chương</label>
          <textarea className="textarea textarea-sm" rows={2} value={chapter.ending_state || ''} onChange={(event) => updateResultItem('chapters', index, 'ending_state', event.target.value)} />
        </div>
      </div>
      <div className="wizard-edit-field">
        <label>Cầu nối từ chương trước</label>
        <textarea className="textarea textarea-sm" rows={2} value={chapter.handoff_from_previous || ''} onChange={(event) => updateResultItem('chapters', index, 'handoff_from_previous', event.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Thay đổi trạng thái / canon sau chương</label>
        <textarea className="textarea textarea-sm" rows={2} value={chapter.state_delta || ''} onChange={(event) => updateResultItem('chapters', index, 'state_delta', event.target.value)} />
      </div>
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Nhân vật xuất hiện</label>
          <textarea className="textarea textarea-sm" rows={3} value={formatListField(chapter.featured_characters)} onChange={(event) => updateResultListField('chapters', index, 'featured_characters', event.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Địa điểm chính</label>
          <input className="input input-sm" value={chapter.primary_location || ''} onChange={(event) => updateResultItem('chapters', index, 'primary_location', event.target.value)} />
        </div>
      </div>
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Tuyến truyện</label>
          <textarea className="textarea textarea-sm" rows={3} value={formatListField(chapter.thread_titles)} onChange={(event) => updateResultListField('chapters', index, 'thread_titles', event.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Sự kiện chính</label>
          <textarea className="textarea textarea-sm" rows={3} value={formatListField(chapter.key_events)} onChange={(event) => updateResultListField('chapters', index, 'key_events', event.target.value)} />
        </div>
      </div>
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Thế lực cần dùng</label>
          <textarea className="textarea textarea-sm" rows={2} value={formatListField(chapter.required_factions)} onChange={(event) => updateResultListField('chapters', index, 'required_factions', event.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Vật phẩm cần dùng</label>
          <textarea className="textarea textarea-sm" rows={2} value={formatListField(chapter.required_objects)} onChange={(event) => updateResultListField('chapters', index, 'required_objects', event.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Thuật ngữ cần dùng</label>
          <textarea className="textarea textarea-sm" rows={2} value={formatListField(chapter.required_terms)} onChange={(event) => updateResultListField('chapters', index, 'required_terms', event.target.value)} />
        </div>
      </div>
    </div>
  );

  const renderIssueList = (title, issues, danger = false) => {
    if (!issues.length) return null;
    return (
      <div className="wizard-section">
        <h4><AlertCircle size={16} /> {title}</h4>
        <div className="wizard-warning-list">
          {issues.map((issue, index) => (
            <div key={`${issue.code || 'issue'}-${index}`} className={`wizard-warning-item ${danger ? 'wizard-warning-item--danger' : ''}`}>
              <AlertCircle size={14} />
              <span>{issue.message || issue}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWorldProfile = () => {
    if (!result?.world_profile) return null;
    const wp = result.world_profile;
    return (
      <div className="wizard-section">
        <h4><Globe size={16} /> Thế giới: {wp.world_name || 'Chưa đặt tên'}</h4>
        <div className="wizard-item">
          <div className="wizard-item-content">
            <div className="wizard-badge-row">
              {wp.world_type && <span className="badge badge-sm">{wp.world_type}</span>}
              {wp.world_scale && <span className="badge badge-sm">{wp.world_scale}</span>}
              {wp.world_era && <span className="badge badge-sm">{wp.world_era}</span>}
            </div>
            {wp.world_rules?.length > 0 && (
              <ul className="wizard-rule-list">
                {wp.world_rules.map((rule, index) => <li key={`${rule}-${index}`}>{rule}</li>)}
              </ul>
            )}
            {wp.world_description && <p>{wp.world_description}</p>}
          </div>
        </div>
      </div>
    );
  };

  const renderCharacters = () => {
    if (!result?.characters?.length) return null;
    return (
      <div className="wizard-section">
        <h4><Users size={16} /> Nhân vật ({result.characters.filter((_, index) => !excluded.has(`char-${index}`)).length})</h4>
        <div className="wizard-items">
          {result.characters.map((character, index) => {
            const key = `char-${index}`;
            return (
              <div key={key} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                <div className="wizard-item-content">
                  <strong>{character.name}</strong>
                  <span className="badge badge-sm">{CHAR_ROLE_LABELS[character.role] || character.role}</span>
                  {character.age && <span className="badge badge-sm">{character.age}</span>}
                  {character.specific_role && <p className="wizard-accent-text"><strong>Vai trò canon:</strong> {character.specific_role}{character.specific_role_locked ? ' - đã khóa' : ''}</p>}
                  {character.personality && <p>{character.personality}</p>}
                  {character.current_status && <p className="wizard-warning-text"><strong>Canon mở truyện:</strong> {character.current_status}</p>}
                  {character.flaws && <p className="wizard-warning-text"><strong>Điểm yếu:</strong> {character.flaws}</p>}
                  {character.story_function && <p><strong>Vai trò mở đầu:</strong> {character.story_function}</p>}
                </div>
                {renderItemActions(key)}
                {editingKey === key && renderCharEdit(character, index)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderEntitySection = ({ section, title, icon: Icon, nameField = 'name', detailField = 'description', editFields }) => {
    const items = result?.[section] || [];
    if (!items.length) return null;
    return (
      <div className="wizard-section">
        <h4><Icon size={16} /> {title} ({items.filter((_, index) => !excluded.has(`${section === 'locations' ? 'loc' : section === 'plot_threads' ? 'thread' : section.slice(0, -1)}-${index}`)).length})</h4>
        <div className="wizard-items">
          {items.map((item, index) => {
            const keyPrefix = section === 'locations' ? 'loc' : section === 'plot_threads' ? 'thread' : section.slice(0, -1);
            const key = `${keyPrefix}-${index}`;
            return (
              <div key={key} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                <div className="wizard-item-content">
                  <strong>{item[nameField]}</strong>
                  {section === 'factions' && <span className="badge badge-sm">{FACTION_TYPE_LABELS[item.faction_type] || item.faction_type || 'Thế lực'}</span>}
                  {section === 'plot_threads' && <span className="badge badge-sm">{TYPE_LABELS[item.type] || item.type}</span>}
                  {item[detailField] && <p>{item[detailField]}</p>}
                  {item.story_function && <p><strong>Vai trò:</strong> {item.story_function}</p>}
                </div>
                {renderItemActions(key)}
                {editingKey === key && renderSimpleEntityEdit(section, item, index, editFields)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderChapters = () => {
    if (!result?.chapters?.length) return null;
    return (
      <div className="wizard-section">
        <h4><List size={16} /> Dàn ý chương ({result.chapters.filter((_, index) => !excluded.has(`chapter-${index}`)).length})</h4>
        <div className="wizard-items wizard-items--compact">
          {result.chapters.map((chapter, index) => {
            const key = `chapter-${index}`;
            return (
              <div key={key} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                <div className="wizard-chapter-header">
                  <strong className="wizard-chapter-title">{chapter.title}</strong>
                  {renderItemActions(key)}
                </div>
                <div className="wizard-item-content wizard-chapter-content">
                  {chapter.summary && <p>{chapter.summary}</p>}
                  {chapter.purpose && <p><strong>Mục đích:</strong> {chapter.purpose}</p>}
                  <div className="wizard-state-grid">
                    {chapter.opening_state && <span><strong>Mở:</strong> {chapter.opening_state}</span>}
                    {chapter.handoff_from_previous && <span><strong>Cầu nối:</strong> {chapter.handoff_from_previous}</span>}
                    {chapter.ending_state && <span><strong>Kết:</strong> {chapter.ending_state}</span>}
                  </div>
                  {chapter.state_delta && <p className="wizard-warning-text"><strong>Thay đổi trạng thái:</strong> {chapter.state_delta}</p>}
                  <p>
                    {normalizeChapterListField(chapter.featured_characters).length > 0 ? `Nhân vật: ${normalizeChapterListField(chapter.featured_characters).join(', ')}` : ''}
                    {normalizeChapterListField(chapter.featured_characters).length > 0 && chapter.primary_location ? ' | ' : ''}
                    {chapter.primary_location ? `Địa điểm: ${chapter.primary_location}` : ''}
                  </p>
                  {(normalizeChapterListField(chapter.thread_titles).length > 0 || normalizeChapterListField(chapter.key_events).length > 0) && (
                    <p>
                      {normalizeChapterListField(chapter.thread_titles).length > 0 ? `Tuyến: ${normalizeChapterListField(chapter.thread_titles).join(', ')}` : ''}
                      {normalizeChapterListField(chapter.thread_titles).length > 0 && normalizeChapterListField(chapter.key_events).length > 0 ? ' | ' : ''}
                      {normalizeChapterListField(chapter.key_events).length > 0 ? `Sự kiện chính: ${normalizeChapterListField(chapter.key_events).join(', ')}` : ''}
                    </p>
                  )}
                </div>
                {editingKey === key && renderChapterEdit(chapter, index)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderProposals = () => {
    const proposed = normalizeProposedEntitiesForUi(result?.proposed_entities);
    const hasProposals = PROPOSAL_GROUPS.some((group) => proposed[group.key].length > 0);
    if (!hasProposals) return null;

    return (
      <div className="wizard-section wizard-proposals">
        <h4><Plus size={16} /> Đề xuất mới</h4>
        <p className="wizard-section-note">Các mục này chưa thành canon. Chỉ những mục được duyệt mới được tạo vào dự án.</p>
        {PROPOSAL_GROUPS.map((group) => {
          const Icon = group.icon;
          const items = proposed[group.key];
          if (!items.length) return null;
          return (
            <div className="wizard-proposal-group" key={group.key}>
              <h5><Icon size={14} /> {group.label}</h5>
              <div className="wizard-items">
                {items.map((item, index) => {
                  const key = proposalKey(group.key, index);
                  const accepted = acceptedProposals.has(key);
                  return (
                    <div key={key} className={`wizard-item wizard-proposal-item ${accepted ? 'wizard-proposal-item--accepted' : ''}`}>
                      <div className="wizard-item-content">
                        <strong>{getRecordName(item, group.nameField)}</strong>
                        {item.description && <p>{item.description}</p>}
                        {item.definition && <p>{item.definition}</p>}
                        {item.story_function && <p><strong>Vai trò:</strong> {item.story_function}</p>}
                        {item.reason && <p><strong>Lý do đề xuất:</strong> {item.reason}</p>}
                      </div>
                      <button className={`btn btn-sm ${accepted ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleProposal(key)}>
                        {accepted ? <><Check size={14} /> Đã duyệt</> : <><Plus size={14} /> Duyệt</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSeedReview = () => (
    <div className="wizard-review-stack">
      {(seedValidation.blockingIssues.length > 0 || seedValidation.warnings.length > 0) && (
        <div className="wizard-issues-grid">
          {renderIssueList('Lỗi chặn nền truyện', seedValidation.blockingIssues, true)}
          {renderIssueList('Cảnh báo nền truyện', seedValidation.warnings)}
        </div>
      )}
      <div className="wizard-review-main">
        <div className="wizard-section">
          <h4><Sparkles size={16} /> Tên truyện</h4>
          <input
            className="input wizard-title-input"
            value={result.title || ''}
            onChange={(event) => setResult((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Nhập tên truyện..."
          />
          {result.title_options?.length > 0 && (
            <div className="wizard-title-options">
              {result.title_options.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  className={`wizard-title-chip ${normalizeSearchText(option) === normalizeSearchText(result.title) ? 'wizard-title-chip--active' : ''}`}
                  onClick={() => setResult((prev) => ({ ...prev, title: option }))}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <p className="wizard-premise">{result.premise}</p>
        </div>
        {renderWorldProfile()}
        {renderCharacters()}
        {renderEntitySection({
          section: 'locations',
          title: 'Địa điểm',
          icon: MapPin,
          editFields: [
            { key: 'name', label: 'Tên địa điểm' },
            { key: 'description', label: 'Mô tả', type: 'textarea' },
            { key: 'story_function', label: 'Vai trò trong phần mở đầu', type: 'textarea' },
          ],
        })}
        {renderEntitySection({
          section: 'objects',
          title: 'Vật phẩm',
          icon: Flag,
          editFields: [
            { key: 'name', label: 'Tên vật phẩm' },
            { key: 'description', label: 'Mô tả', type: 'textarea' },
            { key: 'owner', label: 'Chủ sở hữu / người gắn liền' },
            { key: 'story_function', label: 'Vai trò trong phần mở đầu', type: 'textarea' },
          ],
        })}
        {renderEntitySection({
          section: 'factions',
          title: 'Thế lực',
          icon: Landmark,
          editFields: [
            { key: 'name', label: 'Tên thế lực' },
            {
              key: 'faction_type',
              label: 'Loại',
              type: 'select',
              defaultValue: 'sect',
              options: FACTION_TYPES.map((value) => ({ value, label: FACTION_TYPE_LABELS[value] })),
            },
            { key: 'description', label: 'Mô tả', type: 'textarea' },
            { key: 'story_function', label: 'Vai trò trong phần mở đầu', type: 'textarea' },
          ],
        })}
        {renderEntitySection({
          section: 'terms',
          title: 'Thuật ngữ',
          icon: BookOpen,
          detailField: 'definition',
          editFields: [
            { key: 'name', label: 'Thuật ngữ' },
            {
              key: 'category',
              label: 'Danh mục',
              type: 'select',
              defaultValue: 'other',
              options: TERM_CATEGORIES.map((value) => ({ value, label: value })),
            },
            { key: 'definition', label: 'Định nghĩa', type: 'textarea' },
            { key: 'story_function', label: 'Vai trò trong phần mở đầu', type: 'textarea' },
          ],
        })}
        {renderEntitySection({
          section: 'plot_threads',
          title: 'Tuyến truyện',
          icon: GitPullRequest,
          nameField: 'title',
          editFields: [
            { key: 'title', label: 'Tên tuyến truyện' },
            {
              key: 'type',
              label: 'Loại',
              type: 'select',
              defaultValue: 'subplot',
              options: VALID_THREAD_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] })),
            },
            { key: 'description', label: 'Mô tả', type: 'textarea' },
            { key: 'opening_window', label: 'Cửa sổ mở tuyến' },
          ],
        })}
        <div className="wizard-side-card wizard-side-card--note">
          <h4><Dna size={16} /> Quy tắc nền truyện</h4>
          <p>{chapterCount} chương khởi đầu: nền truyện chỉ nên giữ dàn nhân vật tối thiểu và thực thể thật sự dùng sớm.</p>
          <p>Chưa tạo dàn ý chương ở bước này để tránh nhảy cóc state.</p>
        </div>
      </div>
    </div>
  );

  const renderOutlineReview = () => (
    <div className="wizard-review-grid wizard-review-grid--with-side">
      <div className="wizard-review-main">
        {renderChapters()}
        {renderProposals()}
      </div>
      <aside className="wizard-review-side">
        {renderIssueList('Lỗi chặn dàn ý', blockingIssues, true)}
        {renderIssueList('Cảnh báo khớp nội dung', coverageWarnings)}
        <div className="wizard-side-card">
          <h4><List size={16} /> Kiểm tra outline</h4>
          <p>Mỗi chương cần có Trạng thái mở chương, Cầu nối từ chương trước và Trạng thái kết chương.</p>
          <p>Entity mới phải nằm trong Đề xuất mới và được duyệt trước khi tạo dự án.</p>
        </div>
      </aside>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wizard-modal animate-scale-up" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Sparkles size={20} style={{ color: 'var(--color-accent)' }} />
            {' '}Trợ lý AI - {STEPS[step]}
          </h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="wizard-progress">
          {STEPS.map((label, index) => (
            <div
              key={label}
              className={`wizard-step ${index === step ? 'wizard-step--active' : ''} ${index < step ? 'wizard-step--done' : ''}`}
              title={label}
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="wizard-step-number">{index < step ? '✓' : index + 1}</span>
              <span className="wizard-step-label">{label}</span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="wizard-body">
            <div className="wizard-scroll">
              {error && <div className="wizard-error"><AlertCircle size={14} /> {error}</div>}

              <div className="wizard-form-grid">
                <div className="form-group">
                  <label className="form-label">Thể loại</label>
                  <select className="select" value={genre} onChange={(event) => handleGenreChange(event.target.value)}>
                    {GENRES.map((item) => <option key={item.value} value={item.value}>{item.emoji} {item.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Tone</label>
                  <select className="select" value={tone} onChange={(event) => setTone(event.target.value)}>
                    <option value="">Mặc định</option>
                    {TONES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Tag/Trope của truyện</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {PROJECT_TAG_PRESETS.map((tag) => {
                    const selected = selectedProjectTags.some((item) => item.toLowerCase() === tag.value.toLowerCase());
                    return (
                      <button
                        key={tag.value}
                        type="button"
                        className={`btn btn-xs ${selected ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => handleProjectTagToggle(tag.value)}
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  className="input"
                  style={{ marginTop: 'var(--space-2)' }}
                  placeholder="Tag riêng, cách nhau bằng dấu phẩy..."
                  value={projectTags}
                  onChange={(event) => setProjectTags(event.target.value)}
                />
                <span className="form-hint">Tag/Trope là hợp đồng trải nghiệm: mức xung đột, kiểu nhân vật, nhịp chương và payoff sẽ được ưu tiên khi tạo truyện.</span>
              </div>

              <ProjectContentModeControl surface="wizard" mode={contentMode} onChange={setContentMode} />

              <div className="wizard-form-grid">
                <div className="form-group">
                  <label className="form-label"><Eye size={13} /> Góc nhìn</label>
                  <select className="select" value={povMode} onChange={(event) => setPovMode(event.target.value)}>
                    {POV_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <span className="form-hint">{POV_MODES.find((item) => item.value === povMode)?.desc}</span>
                </div>
                <div className="form-group">
                  <label className="form-label"><MessageSquare size={13} /> Xưng hô</label>
                  <select className="select" value={pronounStyle} onChange={(event) => setPronounStyle(event.target.value)}>
                    {PRONOUN_STYLE_PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  {currentPronoun && currentPronoun.value !== 'custom' && (
                    <span className="form-hint">Xưng: "{currentPronoun.default_self}" - gọi: "{currentPronoun.default_other}"</span>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label"><BookOpen size={13} /> Cấu trúc truyện</label>
                <select className="select" value={storyStructure} onChange={(event) => setStoryStructure(event.target.value)}>
                  {STORY_STRUCTURES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>

              <div className="wizard-form-grid wizard-form-grid--three">
                <div className="form-group">
                  <label className="form-label">Độ dài dự kiến</label>
                  <select className="select" value={targetLengthType} onChange={(event) => handleTargetLengthTypeChange(event.target.value)}>
                    <option value="unset">Chưa xác định</option>
                    <option value="short">Truyện ngắn (30-50 chương)</option>
                    <option value="medium">Truyện vừa (100-200 chương)</option>
                    <option value="long">Trường thiên (300-500 chương)</option>
                    <option value="epic">Sử thi (500+ chương)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Số chương mục tiêu</label>
                  <input type="text" inputMode="numeric" className="input" value={targetLength} onFocus={handleSelectNumericField} onChange={(event) => setTargetLength(event.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Số chương khởi đầu</label>
                  <input type="text" inputMode="numeric" className="input" value={initialChapterCount} onFocus={handleSelectNumericField} onChange={(event) => setInitialChapterCount(clampInitialChapterCount(event.target.value))} />
                  <span className="form-hint">Dùng để giới hạn số nhân vật và số chương dàn ý ban đầu.</span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Đích đến tối thượng</label>
                <textarea className="textarea" value={ultimateGoal} onChange={(event) => setUltimateGoal(event.target.value)} rows={2} placeholder="Ví dụ: nhân vật chính đạt được điều họ thiếu nhất, nhưng phải trả một cái giá làm thay đổi quan hệ và thế giới quanh họ." />
              </div>

              <div className="form-group">
                <label className="form-label wizard-row-label">
                  Cột mốc %
                  <button className="btn btn-ghost btn-xs" onClick={addMilestone}><Plus size={12} /> Thêm</button>
                </label>
                {milestonesInfo.map((milestone, index) => (
                  <div key={index} className="wizard-inline-row">
                    <input type="text" inputMode="numeric" className="input" value={milestone.percent} onFocus={handleSelectNumericField} onChange={(event) => updateMilestone(index, 'percent', Number(event.target.value))} />
                    <span>%</span>
                    <input className="input" value={milestone.description} onChange={(event) => updateMilestone(index, 'description', event.target.value)} placeholder="Mô tả cột mốc..." />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeMilestone(index)}><X size={14} /></button>
                  </div>
                ))}
              </div>

              <div className="form-group">
                <label className="form-label wizard-row-label" onClick={() => setShowMacroArcs((value) => !value)}>
                  <span><TrendingUp size={13} /> Đại Cục - cột mốc lớn</span>
                  <span className="form-hint">Không bắt buộc, có thể thêm sau trong sổ tay truyện</span>
                  <span>{showMacroArcs ? 'Ẩn' : 'Mở'}</span>
                </label>
                {showMacroArcs && (
                  <div className="wizard-macro-list">
                    {macroArcsInput.map((macroArc, index) => (
                      <div key={index} className="wizard-macro-item">
                        <div className="wizard-inline-row">
                          <span className="wizard-step-number">{index + 1}</span>
                          <input className="input input-sm" value={macroArc.title} onChange={(event) => updateMacroArc(index, 'title', event.target.value)} placeholder="Tên cột mốc" />
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeMacroArc(index)}><X size={13} /></button>
                        </div>
                        <div className="wizard-inline-row">
                          <span>Ch.</span>
                          <input type="text" inputMode="numeric" className="input input-sm" value={macroArc.chapter_from} onFocus={handleSelectNumericField} onChange={(event) => updateMacroArc(index, 'chapter_from', event.target.value)} placeholder="Từ" />
                          <span>→</span>
                          <input type="text" inputMode="numeric" className="input input-sm" value={macroArc.chapter_to} onFocus={handleSelectNumericField} onChange={(event) => updateMacroArc(index, 'chapter_to', event.target.value)} placeholder="Đến" />
                        </div>
                        <input className="input input-sm" value={macroArc.emotional_peak} onChange={(event) => updateMacroArc(index, 'emotional_peak', event.target.value)} placeholder="Cảm xúc độc giả khi kết thúc cột mốc này..." />
                      </div>
                    ))}
                    <button className="btn btn-ghost btn-sm" onClick={addMacroArc}><Plus size={13} /> Thêm cột mốc</button>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Ý tưởng truyện *</label>
                <textarea className="textarea" placeholder="Ví dụ: một nhân vật có mong muốn rõ bị kéo vào biến cố đầu tiên làm đảo nhịp đời sống, quan hệ hoặc mục tiêu của họ..." value={idea} onChange={(event) => setIdea(event.target.value)} rows={3} autoFocus />
              </div>

              <div className="form-group">
                <label className="form-label">Cốt truyện chính</label>
                <textarea className="textarea" placeholder="Tóm tắt mạch truyện chính, nếu đã có." value={synopsis} onChange={(event) => setSynopsis(event.target.value)} rows={2} />
              </div>

              {currentTemplate && (
                <div className="wizard-template-card">
                  <label className="wizard-template-toggle">
                    <input type="checkbox" checked={useTemplate} onChange={(event) => setUseTemplate(event.target.checked)} />
                    <span>Dùng mẫu <strong>{currentTemplate.label}</strong> làm cơ sở cho trợ lý AI</span>
                  </label>
                  <div className="wizard-dna-note">
                    <Dna size={14} />
                    <span>
                      <strong>Bộ quy tắc văn phong sẽ tự động nạp.</strong>
                      {hasDNA
                        ? ` Bộ luật (${currentTemplate.constitution?.length || 0} luật), hướng dẫn văn phong (${currentTemplate.style_dna?.length || 0} mục), danh sách tránh chất AI (${currentTemplate.anti_ai_blacklist?.length || 0} mục).`
                        : ' Có thể chỉnh sửa sau trong sổ tay truyện.'}
                    </span>
                  </div>
                  <label className="wizard-template-toggle">
                    <input
                      type="checkbox"
                      checked={useTagFirstPromptProfile}
                      onChange={(event) => setUseTagFirstPromptProfile(event.target.checked)}
                    />
                    <span>Dùng bộ prompt mới ưu tiên Tag/Trope</span>
                  </label>
                  <div className="wizard-dna-note">
                    <Dna size={14} />
                    <span>Prompt mới ưu tiên Tag/Trope, giảm công thức thể loại, lệnh tự do viết truyện tối thiểu 3000 từ.</span>
                  </div>
                </div>
              )}

            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
              <label className="wizard-template-toggle wizard-auto-toggle wizard-auto-toggle--action">
                <input type="checkbox" checked={autoGenerateOutline} onChange={(event) => setAutoGenerateOutline(event.target.checked)} />
                <span>Tự tạo dàn ý sau khi nền truyện hợp lệ</span>
              </label>
              <button className="btn btn-primary" onClick={handleGenerateSeed} disabled={!idea.trim()}>
                <Sparkles size={16} /> Tạo nền truyện <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-body wizard-loading">
            <Loader2 size={48} className="spin" />
            <h3>AI đang tạo nền truyện...</h3>
            <p>Chỉ dựng nền truyện, luật thế giới, dàn nhân vật tối thiểu và tuyến truyện mở đầu.</p>
          </div>
        )}

        {step === 2 && result && (
          <div className="wizard-body wizard-review">
            <div className="wizard-scroll">
              {error && <div className="wizard-error"><AlertCircle size={14} /> {error}</div>}
              {renderSeedReview()}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={handleReset}><ArrowLeft size={16} /> Quay lại</button>
              <button className="btn btn-ghost" onClick={handleGenerateSeed}><RotateCcw size={16} /> Tạo lại nền truyện</button>
              <button className="btn btn-primary" onClick={() => requestOutline(result)} disabled={isGenerating || seedValidation.blockingIssues.length > 0}>
                <List size={16} /> Tạo dàn ý <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-body wizard-loading">
            <Loader2 size={48} className="spin" />
            <h3>AI đang tạo dàn ý chương...</h3>
            <p>Mỗi chương sẽ có trạng thái mở, cầu nối nhân quả và trạng thái kết.</p>
          </div>
        )}

        {step === 4 && result && (
          <div className="wizard-body wizard-review">
            <div className="wizard-scroll">
              {error && <div className="wizard-error"><AlertCircle size={14} /> {error}</div>}
              {renderOutlineReview()}
              {macroArcsInput.filter((item) => item.title?.trim()).length > 0 && (
                <div className="wizard-section">
                  <h4><TrendingUp size={16} /> Đại Cục ({macroArcsInput.filter((item) => item.title?.trim()).length} cột mốc)</h4>
                  <div className="wizard-items">
                    {macroArcsInput.filter((item) => item.title?.trim()).map((item, index) => (
                      <div key={`${item.title}-${index}`} className="wizard-item">
                        <div className="wizard-item-content">
                          <strong>{item.title}</strong>
                          {(item.chapter_from || item.chapter_to) && <span className="badge badge-sm">Ch.{item.chapter_from}-{item.chapter_to}</span>}
                          {item.emotional_peak && <p>{item.emotional_peak}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setStep(2)}><ArrowLeft size={16} /> Sửa nền truyện</button>
              <button className="btn btn-ghost" onClick={() => requestOutline(result)}><RotateCcw size={16} /> Tạo lại dàn ý</button>
              <button className="btn btn-primary" onClick={handleApprove} disabled={isGenerating || blockingIssues.length > 0}>
                {isGenerating ? (
                  <><Loader2 size={16} className="spin" /> Đang tạo...</>
                ) : (
                  <><Check size={16} /> Duyệt & tạo dự án</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
