/**
 * StoryForge - Relationship Cockpit V1
 *
 * Focus-first relationship manager. The graph view is intentionally static:
 * click a node/edge to inspect it in Focus mode.
 */

import React, { useEffect, useMemo, useState } from 'react';
import useCodexStore from '../../stores/codexStore';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import useSuggestionStore from '../../stores/suggestionStore';
import db, { rebuildFlaggedCanonProjects, scheduleBackgroundCanonRebuild } from '../../services/db/database';
import { buildRelationshipAnalysisChapterPlans } from '../../services/ai/relationshipAnalysisPlanner';
import {
  AlertTriangle,
  Check,
  CircleDot,
  Edit2,
  GitBranch,
  Heart,
  Link2,
  ListChecks,
  Network,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Star,
  Sword,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import './RelationshipMap.css';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';

const RELATIONSHIP_OP_TYPES = new Set([
  'RELATIONSHIP_STATUS_CHANGED',
  'RELATIONSHIP_SECRET_CHANGED',
  'INTIMACY_LEVEL_CHANGED',
]);

const ACTIVE_COMMIT_STATUSES = new Set(['canonical', 'has_warnings']);

const RELATION_TYPES = [
  { value: 'ally', label: 'Đồng minh', icon: Shield, color: 'var(--color-info)' },
  { value: 'enemy', label: 'Kẻ thù', icon: Sword, color: 'var(--color-danger)' },
  { value: 'lover', label: 'Người yêu', icon: Heart, color: '#e91e63' },
  { value: 'family', label: 'Gia đình', icon: Users, color: 'var(--color-warning)' },
  { value: 'mentor', label: 'Sư phụ / Cố vấn', icon: Star, color: 'var(--color-accent)' },
  { value: 'rival', label: 'Đối thủ', icon: Sword, color: '#ff9800' },
  { value: 'friend', label: 'Bạn bè', icon: UserCheck, color: 'var(--color-success)' },
  { value: 'subordinate', label: 'Cấp dưới / Cấp trên', icon: Users, color: 'var(--color-text-secondary)' },
  { value: 'other', label: 'Khác', icon: Link2, color: 'var(--color-text-muted)' },
];

function pairKey(characterAId, characterBId) {
  const left = String(characterAId ?? '').trim();
  const right = String(characterBId ?? '').trim();
  const bothNumeric = left !== '' && right !== ''
    && Number.isFinite(Number(left))
    && Number.isFinite(Number(right));
  return [left, right]
    .sort((a, b) => (bothNumeric ? Number(a) - Number(b) : a.localeCompare(b, 'en')))
    .join(':');
}

function groupByPairKey(rows = [], keyGetter = (row) => pairKey(row.character_a_id, row.character_b_id)) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const key = keyGetter(row);
    if (!key || key === ':') return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, rows: group }));
}

function getFreshnessValue(row = {}) {
  const candidates = [row.updated_at, row.updatedAt, row.created_at, row.createdAt, row.id];
  for (const value of candidates) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sortNewestFirst(rows = []) {
  return [...rows].sort((a, b) =>
    getFreshnessValue(b) - getFreshnessValue(a) || (Number(b.id) || 0) - (Number(a.id) || 0)
  );
}

function normalizeMergeLine(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function uniqueTextLines(lines = []) {
  const seen = new Set();
  const output = [];
  lines.forEach((line) => {
    const text = String(line || '').trim();
    if (!text) return;
    const key = normalizeMergeLine(text);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(text);
  });
  return output;
}

function formatStateValue(value, fallback = 'Chưa rõ') {
  const text = String(value || '').trim();
  return text || fallback;
}

const RELATIONSHIP_ENUM_LABELS = {
  secrecy: {
    public: 'Công khai',
    open: 'Công khai',
    private: 'Riêng tư',
    secret: 'Bí mật',
    hidden: 'Đang che giấu',
    concealed: 'Đang che giấu',
    secret_exposed: 'Bí mật đã lộ',
    exposed: 'Đã lộ',
    revealed: 'Đã lộ',
    unknown: 'Chưa rõ',
  },
  intimacy: {
    none: 'Chưa thân mật',
    low: 'Thấp',
    medium: 'Trung bình',
    high: 'Cao',
    intense: 'Rất cao',
    unknown: 'Chưa rõ',
  },
  consent: {
    mutual: 'Đồng thuận hai phía',
    yes: 'Đồng thuận',
    consensual: 'Đồng thuận',
    one_sided: 'Một phía',
    unilateral: 'Một phía',
    contested: 'Đang giằng co',
    conflicted: 'Mâu thuẫn',
    coerced: 'Bị ép buộc',
    no: 'Không đồng thuận',
    unknown: 'Chưa rõ',
  },
};

function normalizeEnumKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function formatRelationshipEnum(value, group, fallback = 'Chưa rõ') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const key = normalizeEnumKey(text);
  return RELATIONSHIP_ENUM_LABELS[group]?.[key] || text;
}

function formatRelationshipOpType(opType) {
  if (opType === 'RELATIONSHIP_SECRET_CHANGED') return 'Đổi bí mật';
  if (opType === 'INTIMACY_LEVEL_CHANGED') return 'Đổi thân mật';
  if (opType === 'RELATIONSHIP_STATUS_CHANGED') return 'Đổi trạng thái';
  return 'Thay đổi quan hệ';
}

function parseCandidateOp(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function getSuggestionPairKey(suggestion) {
  const op = parseCandidateOp(suggestion?.candidate_op);
  const subjectId = op?.subject_id || suggestion?.target_id;
  const targetId = op?.target_id;
  if (!subjectId || !targetId) return '';
  return pairKey(subjectId, targetId);
}

function getSuggestionSummary(suggestion) {
  const op = parseCandidateOp(suggestion?.candidate_op);
  return formatStateValue(
    op?.summary || op?.payload?.status_summary || suggestion?.suggested_value || suggestion?.reasoning,
    'Chưa có mô tả'
  );
}

function getRelationshipEventSummary(event) {
  return formatStateValue(
    event?.summary || event?.payload?.status_summary || event?.evidence,
    'Chưa có mô tả'
  );
}

function getRelationTypeLabel(type) {
  return RELATION_TYPES.find((item) => item.value === type)?.label || formatStateValue(type, 'Khác');
}

function buildDuplicateRelationshipSummary(relationships = [], relationshipStates = []) {
  return {
    baselineGroups: groupByPairKey(relationships),
    currentGroups: groupByPairKey(relationshipStates, (state) =>
      state.pair_key || pairKey(state.character_a_id, state.character_b_id)
    ),
  };
}

function buildMergedBaselineRelationship(groupRows = []) {
  const sorted = sortNewestFirst(groupRows);
  const primary = sorted[0] || null;
  if (!primary) return null;
  const primaryType = primary.relation_type || 'other';
  const redundantRows = sorted.slice(1);
  const descriptions = uniqueTextLines(sorted.map((row) => row.description));
  const oldTypeLabels = uniqueTextLines(
    sorted
      .map((row) => row.relation_type)
      .filter((type) => type && type !== primaryType)
      .map(getRelationTypeLabel)
  );
  const mergedLines = [...descriptions];
  if (oldTypeLabels.length > 0) {
    mergedLines.push(`Đã gộp loại nền cũ: ${oldTypeLabels.join(', ')}.`);
  }
  return {
    primary,
    redundantRows,
    patch: {
      character_a_id: Number(primary.character_a_id),
      character_b_id: Number(primary.character_b_id),
      relation_type: primaryType,
      description: mergedLines.join('\n'),
      updated_at: Date.now(),
    },
  };
}

function getAnalysisStatusLabel(plan) {
  if (!plan) return 'Chưa phân tích';
  if (plan.pendingSuggestionCount > 0) return 'Có đề xuất chờ duyệt';
  if (plan.status === 'empty') return 'Chưa có nội dung';
  if (plan.status === 'stale') return 'Cần phân tích lại';
  if (plan.status === 'failed') return 'Lỗi phân tích';
  if (plan.status === 'analyzed') return 'Đã phân tích';
  return 'Chưa phân tích';
}

function getAnalysisStatusTone(plan) {
  if (!plan) return 'muted';
  if (plan.pendingSuggestionCount > 0) return 'warn';
  if (plan.status === 'analyzed') return 'ok';
  if (plan.status === 'failed') return 'danger';
  if (plan.status === 'stale') return 'warn';
  if (plan.status === 'empty') return 'muted';
  return 'info';
}

function formatAnalysisOutcome(result) {
  if (!result || result.status === 'empty') {
    return 'Không có chương nào cần phân tích.';
  }
  if (result.status === 'failed') {
    return `Phân tích quan hệ bị lỗi. Chương lỗi: ${result.failedChapterIds?.length || 0}.`;
  }
  const parts = [
    `Đã phân tích ${result.analyzedChapterCount || 0} chương`,
    `${result.requestCount || 0} lần gọi AI`,
    `${result.createdCount || 0} đề xuất mới`,
  ];
  if (result.skippedDuplicateCount > 0) {
    parts.push(`bỏ qua ${result.skippedDuplicateCount} đề xuất trùng`);
  }
  if (result.failedChapterIds?.length > 0) {
    parts.push(`${result.failedChapterIds.length} chương lỗi`);
  }
  return parts.join(' · ') + '.';
}

export default function RelationshipMap({ onClose }) {
  const dialogRef = useModalAccessibility({ open: true, onClose });
  const { currentProject, chapters = [], scenes = [] } = useProjectStore();
  const { characters } = useCodexStore();
  const {
    isAnalyzingRelationships,
    relationshipAnalysisProgress,
    analyzeRelationshipChapters,
    analyzeNeededRelationshipChapters,
  } = useAIStore();
  const {
    suggestions,
    loadSuggestions,
    acceptSuggestion,
    rejectSuggestion,
  } = useSuggestionStore();

  const [relationships, setRelationships] = useState([]);
  const [relationshipStates, setRelationshipStates] = useState([]);
  const [storyEvents, setStoryEvents] = useState([]);
  const [chapterCommits, setChapterCommits] = useState([]);
  const [chapterMetas, setChapterMetas] = useState([]);
  const [activeTab, setActiveTab] = useState('focus');
  const [selectedPairKey, setSelectedPairKey] = useState('');
  const [selectedAnalysisChapterId, setSelectedAnalysisChapterId] = useState('');
  const [selectedAnalysisChapterIds, setSelectedAnalysisChapterIds] = useState([]);
  const [showChapterSelection, setShowChapterSelection] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [form, setForm] = useState({
    character_a_id: '',
    character_b_id: '',
    relation_type: 'ally',
    description: '',
  });

  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters]
  );

  const loadRelationshipData = async () => {
    if (!currentProject) return;
    const [rels, states, events, commits] = await Promise.all([
      db.relationships.where('project_id').equals(currentProject.id).toArray(),
      db.relationship_state_current.where('project_id').equals(currentProject.id).toArray(),
      db.story_events.where('project_id').equals(currentProject.id).toArray(),
      db.chapter_commits.where('project_id').equals(currentProject.id).toArray(),
    ]);
    const activeRevisionIds = new Set(
      commits
        .filter((commit) => commit.canonical_revision_id && ACTIVE_COMMIT_STATUSES.has(commit.status))
        .map((commit) => commit.canonical_revision_id)
    );
    setRelationships(rels);
    setRelationshipStates(states);
    setChapterCommits(commits);
    setStoryEvents(events.filter((event) =>
      RELATIONSHIP_OP_TYPES.has(event.op_type)
      && (!event.status || event.status === 'committed')
      && (!event.revision_id || activeRevisionIds.size === 0 || activeRevisionIds.has(event.revision_id))
    ));
  };

  const loadAnalysisData = async () => {
    if (!currentProject) {
      setChapterMetas([]);
      return;
    }
    const metas = await db.chapterMeta.where('project_id').equals(currentProject.id).toArray();
    setChapterMetas(metas);
  };

  useEffect(() => {
    if (!currentProject) return;
    loadRelationshipData();
    loadAnalysisData();
    loadSuggestions(currentProject.id);
  }, [currentProject?.id]);

  const relationshipRows = useMemo(() => {
    const map = new Map();
    relationships.forEach((relationship) => {
      const key = pairKey(relationship.character_a_id, relationship.character_b_id);
      map.set(key, {
        pairKey: key,
        baseline: relationship,
        current: null,
        characterAId: relationship.character_a_id,
        characterBId: relationship.character_b_id,
      });
    });
    relationshipStates.forEach((state) => {
      const key = state.pair_key || pairKey(state.character_a_id, state.character_b_id);
      const existing = map.get(key) || {
        pairKey: key,
        baseline: null,
        current: null,
        characterAId: state.character_a_id,
        characterBId: state.character_b_id,
      };
      map.set(key, {
        ...existing,
        current: state,
        characterAId: existing.characterAId || state.character_a_id,
        characterBId: existing.characterBId || state.character_b_id,
      });
    });
    return [...map.values()].sort((a, b) => {
      const left = `${characterById.get(a.characterAId)?.name || ''} ${characterById.get(a.characterBId)?.name || ''}`;
      const right = `${characterById.get(b.characterAId)?.name || ''} ${characterById.get(b.characterBId)?.name || ''}`;
      return left.localeCompare(right, 'vi');
    });
  }, [relationships, relationshipStates, characterById]);

  const relationshipDuplicateSummary = useMemo(
    () => buildDuplicateRelationshipSummary(relationships, relationshipStates),
    [relationships, relationshipStates]
  );
  const duplicateBaselinePairCount = relationshipDuplicateSummary.baselineGroups.length;
  const duplicateCurrentPairCount = relationshipDuplicateSummary.currentGroups.length;
  const hasRelationshipDuplicates = duplicateBaselinePairCount > 0 || duplicateCurrentPairCount > 0;

  useEffect(() => {
    if (relationshipRows.length === 0) {
      if (selectedPairKey) setSelectedPairKey('');
      return;
    }
    const selectedStillExists = relationshipRows.some((row) => row.pairKey === selectedPairKey);
    if (!selectedPairKey || !selectedStillExists) {
      setSelectedPairKey(relationshipRows[0].pairKey);
    }
  }, [relationshipRows, selectedPairKey]);

  const selectedRow = relationshipRows.find((row) => row.pairKey === selectedPairKey) || relationshipRows[0] || null;
  const selectedEvents = selectedRow
    ? storyEvents.filter((event) => event.subject_id && event.target_id && pairKey(event.subject_id, event.target_id) === selectedRow.pairKey)
    : [];

  const formPairKey = form.character_a_id && form.character_b_id
    ? pairKey(form.character_a_id, form.character_b_id)
    : '';
  const formRetconEventCount = formPairKey
    ? storyEvents.filter((event) => event.subject_id && event.target_id && pairKey(event.subject_id, event.target_id) === formPairKey).length
    : 0;

  const pendingRelationshipSuggestions = useMemo(() => (
    suggestions.filter((suggestion) =>
      suggestion.status === 'pending' && suggestion.type === 'relationship_update'
    )
  ), [suggestions]);

  const activeRevisionIds = useMemo(() => new Set(
    chapterCommits
      .filter((commit) => commit.canonical_revision_id && ACTIVE_COMMIT_STATUSES.has(commit.status))
      .map((commit) => commit.canonical_revision_id)
  ), [chapterCommits]);

  const currentPairKeys = useMemo(
    () => new Set(relationshipRows.map((row) => row.pairKey)),
    [relationshipRows]
  );

  const acceptedRelationshipSuggestions = useMemo(() => (
    suggestions
      .filter((suggestion) => suggestion.status === 'accepted' && suggestion.type === 'relationship_update')
      .map((suggestion) => {
        const op = parseCandidateOp(suggestion.candidate_op);
        const key = getSuggestionPairKey(suggestion);
        const isCurrentPair = key ? currentPairKeys.has(key) : false;
        const hasInactiveRevision = suggestion.applied_revision_id
          && activeRevisionIds.size > 0
          && !activeRevisionIds.has(suggestion.applied_revision_id);
        let statusLabel = 'Chưa vào Tập trung';
        let tone = 'warn';
        if (hasInactiveRevision) {
          statusLabel = 'Revision đã thay thế';
          tone = 'danger';
        } else if (isCurrentPair) {
          statusLabel = 'Đang hiện hành';
          tone = 'ok';
        }
        return {
          suggestion,
          op,
          pairKey: key,
          summary: getSuggestionSummary(suggestion),
          opLabel: formatRelationshipOpType(op?.op_type),
          statusLabel,
          tone,
        };
      })
      .sort((a, b) => (Number(b.suggestion.applied_at || b.suggestion.created_at) || 0)
        - (Number(a.suggestion.applied_at || a.suggestion.created_at) || 0))
  ), [suggestions, activeRevisionIds, currentPairKeys]);

  const scenesByChapterId = useMemo(() => {
    const map = new Map();
    (scenes || []).forEach((scene) => {
      const key = Number(scene.chapter_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(scene);
    });
    return map;
  }, [scenes]);

  const analysisPlans = useMemo(() => buildRelationshipAnalysisChapterPlans({
    chapters,
    scenesByChapterId,
    chapterMetas,
    pendingSuggestions: pendingRelationshipSuggestions,
  }), [chapters, scenesByChapterId, chapterMetas, pendingRelationshipSuggestions]);

  useEffect(() => {
    if (analysisPlans.length === 0) {
      if (selectedAnalysisChapterId) setSelectedAnalysisChapterId('');
      return;
    }
    const exists = analysisPlans.some((plan) => String(plan.chapterId) === String(selectedAnalysisChapterId));
    if (!exists) {
      const firstUsable = analysisPlans.find((plan) => plan.status !== 'empty') || analysisPlans[0];
      setSelectedAnalysisChapterId(String(firstUsable.chapterId));
    }
  }, [analysisPlans, selectedAnalysisChapterId]);

  useEffect(() => {
    const validIds = new Set(analysisPlans.map((plan) => Number(plan.chapterId)));
    setSelectedAnalysisChapterIds((previous) => {
      const next = previous.filter((chapterId) => validIds.has(Number(chapterId)));
      return next.length === previous.length ? previous : next;
    });
  }, [analysisPlans]);

  const selectedAnalysisPlan = analysisPlans.find((plan) =>
    String(plan.chapterId) === String(selectedAnalysisChapterId)
  ) || null;

  const analysisStats = useMemo(() => {
    const stats = {
      unanalyzed: 0,
      stale: 0,
      analyzed: 0,
      failed: 0,
      empty: 0,
      pending: 0,
      needed: 0,
    };
    analysisPlans.forEach((plan) => {
      if (plan.status === 'empty') stats.empty += 1;
      if (plan.status === 'unanalyzed') stats.unanalyzed += 1;
      if (plan.status === 'stale') stats.stale += 1;
      if (plan.status === 'analyzed') stats.analyzed += 1;
      if (plan.status === 'failed') stats.failed += 1;
      if (plan.pendingSuggestionCount > 0) stats.pending += 1;
      if (['unanalyzed', 'stale', 'failed'].includes(plan.status)) stats.needed += 1;
    });
    return stats;
  }, [analysisPlans]);

  const suggestionGroups = useMemo(() => {
    const map = new Map();
    pendingRelationshipSuggestions.forEach((suggestion) => {
      const key = `${suggestion.source_chapter_id || 'no-chapter'}:${suggestion.target_name || suggestion.id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          chapterId: suggestion.source_chapter_id,
          targetName: suggestion.target_name,
          items: [],
        });
      }
      map.get(key).items.push(suggestion);
    });
    return [...map.values()];
  }, [pendingRelationshipSuggestions]);

  const getCharName = (id) => characterById.get(id)?.name || 'Không rõ';
  const getRelType = (type) => RELATION_TYPES.find((item) => item.value === type) || RELATION_TYPES[RELATION_TYPES.length - 1];

  const selectPair = (key) => {
    setSelectedPairKey(key);
    setActiveTab('focus');
  };

  const openFocusTab = () => {
    setActiveTab('focus');
    void loadRelationshipData();
  };

  const selectCharacter = (characterId) => {
    const row = relationshipRows.find((item) => item.characterAId === characterId || item.characterBId === characterId);
    if (row) selectPair(row.pairKey);
  };

  const resetForm = () => {
    setForm({ character_a_id: '', character_b_id: '', relation_type: 'ally', description: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const openCreateForm = () => {
    setNotice('');
    setForm({ character_a_id: '', character_b_id: '', relation_type: 'ally', description: '' });
    setEditingId(null);
    setShowForm(true);
    setActiveTab('focus');
  };

  const handleEdit = (relationship) => {
    setNotice('');
    setForm({
      character_a_id: relationship.character_a_id,
      character_b_id: relationship.character_b_id,
      relation_type: relationship.relation_type,
      description: relationship.description || '',
    });
    setEditingId(relationship.id);
    setShowForm(true);
    setActiveTab('focus');
  };

  const markCanonProjectionDirty = async ({ rebuildNow = false } = {}) => {
    if (!currentProject?.id) return;
    await db.projects.update(currentProject.id, {
      canon_rebuild_required: true,
      updated_at: Date.now(),
    });
    if (rebuildNow) {
      try {
        await rebuildFlaggedCanonProjects(db);
        return;
      } catch (error) {
        console.warn('[RelationshipMap] Không dựng lại trạng thái hiện hành ngay được, chuyển sang chạy nền.', error);
      }
    }
    scheduleBackgroundCanonRebuild(db, { delayMs: 800 });
  };

  const handleCleanupDuplicateRelationships = async () => {
    if (!currentProject?.id || !hasRelationshipDuplicates) return;
    setNotice('');

    let mergedBaselineCount = 0;
    let deletedBaselineCount = 0;
    for (const group of relationshipDuplicateSummary.baselineGroups) {
      const merged = buildMergedBaselineRelationship(group.rows);
      if (!merged?.primary?.id) continue;
      await db.relationships.update(merged.primary.id, merged.patch);
      for (const redundant of merged.redundantRows) {
        if (!redundant?.id || redundant.id === merged.primary.id) continue;
        await db.relationships.delete(redundant.id);
        deletedBaselineCount += 1;
      }
      mergedBaselineCount += 1;
    }

    await markCanonProjectionDirty({ rebuildNow: true });
    await loadRelationshipData();

    const parts = [];
    if (mergedBaselineCount > 0) {
      parts.push(`gộp ${mergedBaselineCount} cặp nền, xóa ${deletedBaselineCount} dòng thừa`);
    }
    if (duplicateCurrentPairCount > 0) {
      parts.push(`đánh dấu dựng lại ${duplicateCurrentPairCount} cặp trạng thái hiện hành`);
    }
    setNotice(`Đã dọn quan hệ trùng: ${parts.join('; ')}.`);
  };

  const handleSave = async () => {
    if (!currentProject || !form.character_a_id || !form.character_b_id) return;
    if (String(form.character_a_id) === String(form.character_b_id)) return;

    const payload = {
      character_a_id: Number(form.character_a_id),
      character_b_id: Number(form.character_b_id),
      relation_type: form.relation_type,
      description: form.description,
    };
    const nextPairKey = pairKey(payload.character_a_id, payload.character_b_id);

    const duplicate = relationships.find((relationship) =>
      pairKey(relationship.character_a_id, relationship.character_b_id) === nextPairKey
      && relationship.id !== editingId
    );

    if (editingId) {
      if (duplicate) {
        await db.relationships.update(duplicate.id, payload);
        await db.relationships.delete(editingId);
      } else {
        await db.relationships.update(editingId, payload);
      }
    } else {
      if (duplicate) {
        await db.relationships.update(duplicate.id, payload);
      } else {
        await db.relationships.add({
          project_id: currentProject.id,
          ...payload,
        });
      }
    }

    if (formRetconEventCount > 0) {
      await markCanonProjectionDirty();
      setNotice('Đã lưu quan hệ nền. Cặp này có thay đổi chuẩn truyện chồng lên nên hệ thống đã đánh dấu dựng lại trạng thái hiện hành.');
    } else {
      setNotice('Đã lưu quan hệ nền.');
    }
    resetForm();
    await loadRelationshipData();
    setSelectedPairKey(nextPairKey);
  };

  const handleDelete = async (id) => {
    await db.relationships.delete(id);
    await markCanonProjectionDirty({ rebuildNow: true });
    await loadRelationshipData();
    setNotice('Đã xóa quan hệ nền và đánh dấu dựng lại trạng thái hiện hành.');
  };

  const handleDeleteCurrentRelationshipState = async (row) => {
    if (!currentProject?.id || !row?.pairKey) return;
    const eventsToSupersede = storyEvents.filter((event) =>
      event.subject_id && event.target_id
      && pairKey(event.subject_id, event.target_id) === row.pairKey
      && (!event.status || event.status === 'committed')
    );
    if (eventsToSupersede.length === 0) {
      setNotice('Không có thay đổi chuẩn truyện nào để xóa cho cặp này. Nếu muốn xóa quan hệ nền, dùng nút Xóa nền.');
      return;
    }
    await Promise.all(eventsToSupersede.map((event) => db.story_events.update(event.id, {
      status: 'superseded',
      updated_at: Date.now(),
    })));
    await markCanonProjectionDirty({ rebuildNow: true });
    await loadRelationshipData();
    setNotice(`Đã xóa trạng thái hiện hành của cặp này bằng cách bỏ ${eventsToSupersede.length} thay đổi quan hệ khỏi chuẩn truyện.`);
  };

  const handleRebuildCurrentRelationships = async () => {
    await markCanonProjectionDirty({ rebuildNow: true });
    await loadRelationshipData();
    setNotice('Đã dựng lại trạng thái quan hệ hiện hành từ chuẩn truyện.');
  };

  const handleAcceptSuggestion = async (id) => {
    try {
      const result = await acceptSuggestion(id, currentProject.id);
      await Promise.all([loadRelationshipData(), loadSuggestions(currentProject.id)]);
      if (result && result.ok === false) {
        setNotice('Đề xuất này chưa được đưa vào chuẩn truyện vì còn lỗi kiểm tra.');
        return;
      }
      setNotice('Đã duyệt đề xuất quan hệ qua bộ máy chuẩn truyện.');
    } catch (error) {
      await loadSuggestions(currentProject.id);
      setNotice(`Không duyệt được đề xuất quan hệ: ${error?.message || 'lỗi không rõ'}.`);
    }
  };

  const handleRejectSuggestion = async (id) => {
    await rejectSuggestion(id, currentProject.id);
    await loadSuggestions(currentProject.id);
    setNotice('Đã bỏ đề xuất quan hệ.');
  };

  const refreshAfterAnalysis = async () => {
    if (!currentProject?.id) return;
    await Promise.all([
      loadRelationshipData(),
      loadAnalysisData(),
      loadSuggestions(currentProject.id),
    ]);
  };

  const handleAnalyzeSelectedChapter = async () => {
    const chapterId = Number(selectedAnalysisChapterId);
    if (!currentProject?.id || !Number.isFinite(chapterId) || !analyzeRelationshipChapters) return;
    setAnalysisNotice('');
    const result = await analyzeRelationshipChapters({
      projectId: currentProject.id,
      chapterIds: [chapterId],
      force: true,
    });
    setAnalysisNotice(formatAnalysisOutcome(result));
    await refreshAfterAnalysis();
  };

  const handleAnalyzeNeededChapters = async () => {
    if (!currentProject?.id || !analyzeNeededRelationshipChapters) return;
    setAnalysisNotice('');
    const result = await analyzeNeededRelationshipChapters({
      projectId: currentProject.id,
    });
    setAnalysisNotice(formatAnalysisOutcome(result));
    await refreshAfterAnalysis();
  };

  const selectAnalysisChapters = (mode) => {
    const ids = analysisPlans
      .filter((plan) => {
        if (mode === 'needed') return ['unanalyzed', 'stale', 'failed'].includes(plan.status);
        if (mode === 'analyzed') return plan.status === 'analyzed';
        if (mode === 'content') return plan.status !== 'empty';
        return false;
      })
      .map((plan) => Number(plan.chapterId))
      .filter((chapterId) => Number.isFinite(chapterId));
    setSelectedAnalysisChapterIds(ids);
  };

  const toggleAnalysisChapter = (chapterId) => {
    const numericChapterId = Number(chapterId);
    if (!Number.isFinite(numericChapterId)) return;
    setSelectedAnalysisChapterIds((previous) => {
      if (previous.includes(numericChapterId)) {
        return previous.filter((id) => id !== numericChapterId);
      }
      return [...previous, numericChapterId];
    });
  };

  const handleAnalyzeChosenChapters = async () => {
    if (!currentProject?.id || !analyzeRelationshipChapters || selectedAnalysisChapterIds.length === 0) return;
    setAnalysisNotice('');
    const chapterIds = [...selectedAnalysisChapterIds];
    const result = await analyzeRelationshipChapters({
      projectId: currentProject.id,
      chapterIds,
      force: true,
    });
    setAnalysisNotice(formatAnalysisOutcome(result));
    await refreshAfterAnalysis();
  };

  const renderDuplicateBanner = () => {
    if (!hasRelationshipDuplicates) return null;
    const parts = [];
    if (duplicateBaselinePairCount > 0) parts.push(`${duplicateBaselinePairCount} cặp nền`);
    if (duplicateCurrentPairCount > 0) parts.push(`${duplicateCurrentPairCount} cặp trạng thái hiện hành`);
    return (
      <div className="rel-duplicate-banner">
        <AlertTriangle size={17} />
        <div>
          <strong>Có dữ liệu quan hệ bị trùng</strong>
          <span>{parts.join(' · ')}. Dọn trùng sẽ gộp quan hệ nền; trạng thái hiện hành chỉ được đánh dấu dựng lại.</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleCleanupDuplicateRelationships}>
          <RefreshCw size={14} /> Dọn quan hệ trùng
        </button>
      </div>
    );
  };

  const renderFocus = () => {
    if (!selectedRow) {
      return (
        <div className="rel-empty">
          <Link2 size={32} />
          <h3>Chưa có quan hệ</h3>
          <p>Thêm quan hệ nền để AI có điểm neo khi viết và lập dàn ý.</p>
        </div>
      );
    }

    const hasBaseline = Boolean(selectedRow.baseline);
    const hasCurrent = Boolean(selectedRow.current);
    const baselineType = hasBaseline ? getRelType(selectedRow.baseline?.relation_type || 'other') : null;
    const currentType = getRelType(selectedRow.current?.relationship_type || selectedRow.baseline?.relation_type || 'other');
    const CurrentIcon = currentType.icon;
    const selectedEventRows = [...selectedEvents].sort((a, b) =>
      (Number(a.chapter_id) || 0) - (Number(b.chapter_id) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0)
    );

    return (
      <div className="rel-focus-grid">
        <aside className="rel-pair-list">
          <div className="rel-pair-list-head">
            <strong>{relationshipRows.length} cặp đang theo dõi</strong>
            <span>Các cặp có quan hệ nền hoặc trạng thái hiện hành từ chuẩn truyện.</span>
          </div>
          {relationshipRows.map((row) => {
            const type = getRelType(row.current?.relationship_type || row.baseline?.relation_type || 'other');
            const Icon = type.icon;
            const rowEventCount = storyEvents.filter((event) =>
              event.subject_id && event.target_id && pairKey(event.subject_id, event.target_id) === row.pairKey
            ).length;
            return (
              <button
                key={row.pairKey}
                type="button"
                className={`rel-pair-button ${row.pairKey === selectedRow.pairKey ? 'is-active' : ''}`}
                onClick={() => selectPair(row.pairKey)}
              >
                <Icon size={15} style={{ color: type.color }} />
                <span className="rel-pair-main">
                  <span className="rel-pair-names">
                    <span>{getCharName(row.characterAId)}</span>
                    <span className="rel-pair-separator">/</span>
                    <span>{getCharName(row.characterBId)}</span>
                  </span>
                  <span className="rel-pair-tags">
                    {row.baseline && <em>Nền</em>}
                    {row.current && <em>Hiện hành</em>}
                    {rowEventCount > 0 && <em>Từ chuẩn truyện</em>}
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="rel-focus-panel">
          <div className="rel-focus-title">
            <div>
              <h4>{getCharName(selectedRow.characterAId)} <span>↔</span> {getCharName(selectedRow.characterBId)}</h4>
              <p>{selectedRow.baseline?.description || selectedRow.current?.summary || 'Chưa có mô tả chi tiết.'}</p>
            </div>
            <div className="rel-focus-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadRelationshipData}>
                <RefreshCw size={13} /> Làm mới
              </button>
              {selectedRow.baseline && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleEdit(selectedRow.baseline)}>
                  <Edit2 size={13} /> Sửa nền
                </button>
              )}
              {selectedRow.baseline && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDelete(selectedRow.baseline.id)}>
                  <Trash2 size={13} /> Xóa nền
                </button>
              )}
              {selectedEvents.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDeleteCurrentRelationshipState(selectedRow)}>
                  <Trash2 size={13} /> Xóa hiện tại
                </button>
              )}
            </div>
          </div>

          {selectedEvents.length > 0 && (
            <div className="rel-warning">
              <AlertTriangle size={16} />
              <span>
                {hasBaseline
                  ? `Cặp này đã có ${selectedEvents.length} thay đổi chuẩn truyện. Sửa quan hệ nền là chỉnh ngược và có thể đổi trạng thái hiện hành sau khi dựng lại.`
                  : `Cặp này có ${selectedEvents.length} thay đổi chuẩn truyện đang tạo trạng thái hiện hành. Nếu không còn đúng, dùng Xóa hiện tại để bỏ các thay đổi quan hệ của cặp này.`}
              </span>
            </div>
          )}

          <div className="rel-facts-grid">
            <div className="rel-fact">
              <span>Nền tác giả</span>
              {hasBaseline ? (
                <strong style={{ color: baselineType.color }}>{baselineType.label}</strong>
              ) : (
                <strong className="rel-muted-value">Chưa có nền</strong>
              )}
            </div>
            <div className="rel-fact">
              <span>Hiện tại</span>
              <strong style={{ color: currentType.color }}><CurrentIcon size={14} /> {currentType.label}</strong>
            </div>
            <div className="rel-fact">
              <span>Bí mật</span>
              <strong>{formatRelationshipEnum(selectedRow.current?.secrecy_state, 'secrecy', 'Công khai / chưa rõ')}</strong>
            </div>
            <div className="rel-fact">
              <span>Thân mật</span>
              <strong>{formatRelationshipEnum(selectedRow.current?.intimacy_level, 'intimacy', 'Không có dữ liệu')}</strong>
            </div>
            <div className="rel-fact">
              <span>Đồng thuận</span>
              <strong>{formatRelationshipEnum(selectedRow.current?.consent_state, 'consent')}</strong>
            </div>
            <div className="rel-fact">
              <span>Dư âm</span>
              <strong>{formatStateValue(selectedRow.current?.emotional_aftermath, 'Chưa ghi nhận')}</strong>
            </div>
          </div>

          {selectedEventRows.length > 0 && (
            <div className="rel-event-panel">
              <div className="rel-event-panel-head">
                <strong>Thay đổi đã duyệt</strong>
                <span>{selectedEventRows.length} thay đổi đang thuộc trạng thái hiện hành của cặp này.</span>
              </div>
              <div className="rel-event-list">
                {selectedEventRows.map((event) => (
                  <div key={event.id || `${event.chapter_id}-${event.op_type}-${event.summary}`} className="rel-event-row">
                    <span>Chương {event.chapter_id || '?'}</span>
                    <em>{formatRelationshipOpType(event.op_type)}</em>
                    <p>{getRelationshipEventSummary(event)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderGraph = () => {
    const connectedCharacterIds = new Set();
    relationshipRows.forEach((row) => {
      connectedCharacterIds.add(row.characterAId);
      connectedCharacterIds.add(row.characterBId);
    });
    const graphCharacters = characters.filter((character) => connectedCharacterIds.has(character.id));

    return (
      <div className="rel-graph">
        <div className="rel-graph-nodes" aria-label="Nhân vật trong sơ đồ">
          {graphCharacters.map((character) => (
            <button
              key={character.id}
              type="button"
              className="rel-node"
              onClick={() => selectCharacter(character.id)}
            >
              <CircleDot size={14} />
              {character.name}
            </button>
          ))}
        </div>
        <div className="rel-graph-edges" aria-label="Cạnh quan hệ">
          {relationshipRows.map((row) => {
            const type = getRelType(row.current?.relationship_type || row.baseline?.relation_type || 'other');
            return (
              <button
                key={row.pairKey}
                type="button"
                className="rel-edge"
                onClick={() => selectPair(row.pairKey)}
                style={{ '--rel-edge-color': type.color }}
              >
                <span>{getCharName(row.characterAId)}</span>
                <span className="rel-edge-line" />
                <strong>{type.label}</strong>
                <span className="rel-edge-line" />
                <span>{getCharName(row.characterBId)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAnalysisPanel = () => (
    <section className="rel-analysis-panel">
      <div className="rel-analysis-head">
        <div>
          <h4><Sparkles size={16} /> Phân tích quan hệ</h4>
          <p>AI gom các chương cần phân tích, tối đa 100k token đầu vào ước lượng mỗi lần gọi, rồi tạo đề xuất để bạn duyệt.</p>
        </div>
        {isAnalyzingRelationships && <span className="rel-analysis-running">Đang chạy</span>}
      </div>

      <div className="rel-analysis-controls">
        <label>
          <span>Chọn chương</span>
          <select
            className="select"
            value={selectedAnalysisChapterId}
            onChange={(event) => setSelectedAnalysisChapterId(event.target.value)}
          >
            {analysisPlans.length === 0 ? (
              <option value="">Chưa có chương</option>
            ) : analysisPlans.map((plan) => (
              <option key={plan.chapterId} value={plan.chapterId}>
                {plan.chapterTitle} · {getAnalysisStatusLabel(plan)}
              </option>
            ))}
          </select>
        </label>
        <div className="rel-analysis-action-row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleAnalyzeSelectedChapter}
            disabled={isAnalyzingRelationships || !selectedAnalysisPlan || selectedAnalysisPlan.status === 'empty'}
          >
            <Sparkles size={14} /> Phân tích chương này
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleAnalyzeNeededChapters}
            disabled={isAnalyzingRelationships || analysisStats.needed === 0}
          >
            <RefreshCw size={14} /> Phân tích các chương cần phân tích
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${showChapterSelection ? 'is-active' : ''}`}
            onClick={() => setShowChapterSelection((value) => !value)}
          >
            <ListChecks size={14} /> Chọn chương
          </button>
        </div>
      </div>

      <div className="rel-analysis-stats" aria-label="Trạng thái phân tích quan hệ">
        <span>Chưa phân tích <strong>{analysisStats.unanalyzed}</strong></span>
        <span>Cần phân tích lại <strong>{analysisStats.stale}</strong></span>
        <span>Đã phân tích <strong>{analysisStats.analyzed}</strong></span>
        <span>Lỗi <strong>{analysisStats.failed}</strong></span>
        <span>Chưa có nội dung <strong>{analysisStats.empty}</strong></span>
        <span>Có đề xuất <strong>{analysisStats.pending}</strong></span>
      </div>

      {showChapterSelection && (
        <div className="rel-chapter-selection">
          <div className="rel-chapter-selection-head">
            <strong>Đã chọn {selectedAnalysisChapterIds.length} chương</strong>
            <div>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => selectAnalysisChapters('needed')}>
                Chọn chương cần phân tích
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => selectAnalysisChapters('analyzed')}>
                Chọn chương đã phân tích
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => selectAnalysisChapters('content')}>
                Chọn tất cả chương có nội dung
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelectedAnalysisChapterIds([])}>
                Bỏ chọn
              </button>
            </div>
          </div>
          <div className="rel-chapter-selection-list">
            {analysisPlans.length === 0 ? (
              <span className="rel-chapter-selection-empty">Chưa có chương để chọn.</span>
            ) : analysisPlans.map((plan) => {
              const chapterId = Number(plan.chapterId);
              const disabled = plan.status === 'empty';
              return (
                <label key={plan.chapterId} className={`rel-chapter-selection-row ${disabled ? 'is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedAnalysisChapterIds.includes(chapterId)}
                    disabled={disabled || isAnalyzingRelationships}
                    onChange={() => toggleAnalysisChapter(chapterId)}
                  />
                  <span>{plan.chapterTitle}</span>
                  <em className={`rel-analysis-status is-${getAnalysisStatusTone(plan)}`}>
                    {getAnalysisStatusLabel(plan)}
                  </em>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm rel-analyze-selected-btn"
            onClick={handleAnalyzeChosenChapters}
            disabled={isAnalyzingRelationships || selectedAnalysisChapterIds.length === 0}
          >
            <Sparkles size={14} /> Phân tích các chương đã chọn
          </button>
        </div>
      )}

      {selectedAnalysisPlan && (
        <div className="rel-analysis-selected">
          <span className={`rel-analysis-status is-${getAnalysisStatusTone(selectedAnalysisPlan)}`}>
            {getAnalysisStatusLabel(selectedAnalysisPlan)}
          </span>
          <span>{selectedAnalysisPlan.chapterTitle}</span>
          {selectedAnalysisPlan.meta?.relationship_analyzed_at && (
            <span>Đã chạy: {new Date(selectedAnalysisPlan.meta.relationship_analyzed_at).toLocaleString('vi-VN')}</span>
          )}
          {selectedAnalysisPlan.meta?.relationship_analysis_error && (
            <span>{selectedAnalysisPlan.meta.relationship_analysis_error}</span>
          )}
        </div>
      )}

      {isAnalyzingRelationships && relationshipAnalysisProgress && (
        <div className="rel-analysis-progress">
          <span>{relationshipAnalysisProgress.message || 'Đang phân tích quan hệ...'}</span>
          {relationshipAnalysisProgress.requestCount > 0 && (
            <strong>{relationshipAnalysisProgress.currentRequest}/{relationshipAnalysisProgress.requestCount}</strong>
          )}
        </div>
      )}

      {analysisNotice && <div className="rel-analysis-result">{analysisNotice}</div>}
    </section>
  );

  const renderAcceptedRelationships = () => (
    <section className="rel-approved-panel">
      <div className="rel-approved-head">
        <div>
          <strong>Đã duyệt</strong>
          <span>
            {acceptedRelationshipSuggestions.length > 0
              ? `${acceptedRelationshipSuggestions.length} đề xuất quan hệ đã duyệt. Tập trung/Sơ đồ chỉ hiện cặp đang có nền hoặc trạng thái hiện hành.`
              : 'Chưa có đề xuất quan hệ nào đã duyệt.'}
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleRebuildCurrentRelationships}>
          <RefreshCw size={13} /> Dựng lại trạng thái
        </button>
      </div>

      {acceptedRelationshipSuggestions.length > 0 && (
        <div className="rel-approved-list">
          {acceptedRelationshipSuggestions.map(({ suggestion, op, summary, opLabel, statusLabel, tone }) => (
            <div key={suggestion.id} className="rel-approved-row">
              <div className="rel-approved-main">
                <strong>{suggestion.target_name || 'Cặp quan hệ'}</strong>
                <span>{suggestion.source_chapter_id ? `Chương #${suggestion.source_chapter_id}` : 'Không rõ chương'} · {opLabel}</span>
                <p>{summary}</p>
              </div>
              <span className={`rel-analysis-status is-${tone}`}>
                {statusLabel}
              </span>
              {!op?.subject_id || !op?.target_id ? (
                <em>Thiếu cặp nhân vật trong thao tác đã lưu.</em>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const renderSuggestions = () => (
    <div className="rel-review-stack">
      {renderAnalysisPanel()}
      <div className="rel-suggestion-list">
        {suggestionGroups.length === 0 ? (
          <div className="rel-empty rel-empty--compact">
            <Sparkles size={26} />
            <p>Chưa có đề xuất quan hệ đang chờ duyệt.</p>
          </div>
        ) : suggestionGroups.map((group) => (
          <div key={group.key} className="rel-suggestion-group">
            <div className="rel-suggestion-group-head">
              <div>
                <strong>{group.targetName || 'Cặp quan hệ'}</strong>
                <span>{group.chapterId ? `Chương #${group.chapterId}` : 'Không rõ chương'} · {group.items.length} đề xuất</span>
              </div>
            </div>
            {group.items.map((suggestion) => (
              <div key={suggestion.id} className="rel-suggestion-item">
                <div className="rel-suggestion-copy">
                  <p>{suggestion.suggested_value || suggestion.reasoning}</p>
                  {suggestion.reasoning && <em>{suggestion.reasoning}</em>}
                </div>
                <div>
                  <button type="button" className="btn btn-sm si-btn-accept" onClick={() => handleAcceptSuggestion(suggestion.id)}>
                    <Check size={13} /> Duyệt
                  </button>
                  <button type="button" className="btn btn-sm si-btn-reject" onClick={() => handleRejectSuggestion(suggestion.id)}>
                    <X size={13} /> Bỏ
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {renderAcceptedRelationships()}
    </div>
  );

  return (
    <div className="codex-modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="codex-modal codex-modal--lg relationship-cockpit" role="dialog" aria-modal="true" aria-label="Quản lý quan hệ nhân vật" onClick={(event) => event.stopPropagation()}>
        <div className="codex-modal-header rel-header">
          <div>
            <h3><Link2 size={18} /> Quan hệ nhân vật</h3>
            <p>Bộ nhớ quan hệ nền và trạng thái hiện hành cho AI khi viết truyện dài.</p>
          </div>
          <div className="rel-header-actions">
            <button className="btn btn-accent btn-sm" onClick={openCreateForm}>
              <Plus size={14} /> Thêm quan hệ
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Đóng">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="codex-modal-body rel-body">
          <div className="rel-tabs">
            <button type="button" className={activeTab === 'focus' ? 'is-active' : ''} onClick={openFocusTab}>
              <ListChecks size={14} /> Tập trung
            </button>
            <button type="button" className={activeTab === 'graph' ? 'is-active' : ''} onClick={() => setActiveTab('graph')}>
              <Network size={14} /> Sơ đồ
            </button>
            <button type="button" className={activeTab === 'suggestions' ? 'is-active' : ''} onClick={() => setActiveTab('suggestions')}>
              <GitBranch size={14} /> Cần duyệt
              {pendingRelationshipSuggestions.length > 0 && <span>{pendingRelationshipSuggestions.length}</span>}
            </button>
          </div>

          {notice && <div className="rel-notice">{notice}</div>}

          {showForm && (
            <div className="rel-form">
              {formRetconEventCount > 0 && (
                <div className="rel-warning rel-warning--form">
                  <AlertTriangle size={16} />
                  <span>Cặp này đã có {formRetconEventCount} thay đổi chuẩn truyện. Sửa quan hệ nền sẽ dựng lại trạng thái hiện hành từ nền mới cộng các thay đổi cũ.</span>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Nhân vật A</label>
                  <select className="select" value={form.character_a_id} onChange={(event) => setForm({ ...form, character_a_id: event.target.value })}>
                    <option value="">Chọn nhân vật</option>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>{character.name} ({character.role || 'nhân vật'})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Nhân vật B</label>
                  <select className="select" value={form.character_b_id} onChange={(event) => setForm({ ...form, character_b_id: event.target.value })}>
                    <option value="">Chọn nhân vật</option>
                    {characters.filter((character) => String(character.id) !== String(form.character_a_id)).map((character) => (
                      <option key={character.id} value={character.id}>{character.name} ({character.role || 'nhân vật'})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Loại nền</label>
                  <select className="select" value={form.relation_type} onChange={(event) => setForm({ ...form, relation_type: event.target.value })}>
                    {RELATION_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Mô tả nền</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Ví dụ: từng là bạn, nay còn nghi ngờ nhau..."
                />
              </div>
              <div className="rel-form-actions">
                <button className="btn btn-ghost btn-sm" onClick={resetForm}>Hủy</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave}>
                  <Save size={14} /> {editingId ? 'Cập nhật' : 'Thêm'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'focus' && renderDuplicateBanner()}
          {activeTab === 'focus' && renderFocus()}
          {activeTab === 'graph' && renderGraph()}
          {activeTab === 'suggestions' && renderSuggestions()}
        </div>
      </div>
    </div>
  );
}
