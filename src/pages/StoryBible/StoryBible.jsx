import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  BookMarked,
  BookOpen,
  MapPin,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import ProjectContentModeControl from '../../features/projectContentMode/ProjectContentModeControl.jsx';
import { resolveProjectContentMode } from '../../features/projectContentMode/projectContentMode.js';
import useCodexStore from '../../stores/codexStore';
import useProjectStore from '../../stores/projectStore';
import useProgressiveIdleSections from '../../hooks/useProgressiveIdleSections.js';
import {
  AI_STRICTNESS_LEVELS,
  PRONOUN_STYLE_PRESETS,
} from '../../utils/constants';
import StoryBibleSectionHeader from './components/StoryBibleSectionHeader';
import useStoryBibleCanonInspector from './hooks/useStoryBibleCanonInspector';
import useStoryBibleDrafts from './hooks/useStoryBibleDrafts';
import useStoryBibleMacroArcs from './hooks/useStoryBibleMacroArcs';
import useStoryBibleProjectFields from './hooks/useStoryBibleProjectFields';
import StoryBibleOverviewSection from './sections/StoryBibleOverviewSection';
import StoryBibleWorldLoreSummarySection from './sections/StoryBibleWorldLoreSummarySection';
import './StoryBible.css';

const SuggestionInbox = React.lazy(() => import('../../components/ai/SuggestionInbox'));
const StoryBibleCanonSection = React.lazy(() => import('./sections/StoryBibleCanonSection'));
const StoryBibleCharactersSection = React.lazy(() => import('./sections/StoryBibleCharactersSection'));
const StoryBibleMacroArcSection = React.lazy(() => import('./sections/StoryBibleMacroArcSection'));
const StoryBibleSummariesSection = React.lazy(() => import('./sections/StoryBibleSummariesSection'));

export default function StoryBible() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams();
  const { currentProject, chapters, updateProjectSettings } = useProjectStore(useShallow((state) => ({
    currentProject: state.currentProject,
    chapters: state.chapters,
    updateProjectSettings: state.updateProjectSettings,
  })));
  const {
    characters,
    canonFacts,
    chapterMetas,
    storyBibleWorldCounts,
    loadStoryBibleCodex,
    createCanonFact,
    updateCanonFact,
    deleteCanonFact,
    updateCharacter,
  } = useCodexStore(useShallow((state) => ({
    characters: state.characters,
    canonFacts: state.canonFacts,
    chapterMetas: state.chapterMetas,
    storyBibleWorldCounts: state.storyBibleWorldCounts,
    loadStoryBibleCodex: state.loadStoryBibleCodex,
    createCanonFact: state.createCanonFact,
    updateCanonFact: state.updateCanonFact,
    deleteCanonFact: state.deleteCanonFact,
    updateCharacter: state.updateCharacter,
  })));
  const [openSections, setOpenSections] = useState({
    overview: true,
    ai: false,
    grandStrategy: true,
    suggestions: true,
    canon: true,
    characters: true,
    worldLore: true,
    summaries: true,
  });
  const visibleDeferredSections = useProgressiveIdleSections(5);

  useEffect(() => {
    if (currentProject?.id) {
      loadStoryBibleCodex(currentProject.id, { preferCache: true });
    }
  }, [currentProject?.id, loadStoryBibleCodex]);

  const toggleSection = useCallback((key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('focus') !== 'cover') return;
    setOpenSections((prev) => ({ ...prev, overview: true }));
    const timer = setTimeout(() => {
      document.getElementById('project-cover-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [location.search]);

  const projectFields = useStoryBibleProjectFields({
    currentProject,
    updateProjectSettings,
  });

  const draftState = useStoryBibleDrafts({
    currentProjectId: currentProject?.id,
    characters,
    canonFacts,
    createCanonFact,
    updateCanonFact,
    deleteCanonFact,
    updateCharacter,
  });

  const characterNameMap = useMemo(
    () => new Map(characters.map((character) => [character.id, character.name])),
    [characters],
  );
  const allCharacterNames = useMemo(
    () => characters.map((character) => String(character.name || '').trim()).filter(Boolean),
    [characters],
  );

  const macroArcState = useStoryBibleMacroArcs({
    currentProject,
    title: projectFields.title,
    synopsis: projectFields.synopsis,
    ultimateGoal: projectFields.ultimateGoal,
    genrePrimary: projectFields.genrePrimary,
    targetLength: projectFields.targetLength,
    chaptersCount: chapters.length,
  });

  const canonState = useStoryBibleCanonInspector({
    currentProjectId: currentProject?.id,
    characterNameMap,
  });

  const activeProjectId = currentProject?.id || Number(routeProjectId) || null;
  const buildProjectPath = useCallback((path = '') => {
    if (!path) return activeProjectId ? `/project/${activeProjectId}` : '/';
    if (!activeProjectId) return path;
    if (path.startsWith(`/project/${activeProjectId}`)) return path;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `/project/${activeProjectId}${normalizedPath}`;
  }, [activeProjectId]);
  const handleNavigate = useCallback((path) => {
    navigate(buildProjectPath(path));
  }, [buildProjectPath, navigate]);

  if (!currentProject) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <div className="empty-state">
          <BookOpen size={48} />
          <h3>Chọn một dự án trước</h3>
          <p>Quay về Dashboard để chọn hoặc tạo dự án.</p>
        </div>
      </div>
    );
  }

  const worldLoreCounts = {
    locations: Number(storyBibleWorldCounts?.locations || 0),
    objects: Number(storyBibleWorldCounts?.objects || 0),
    terms: Number(storyBibleWorldCounts?.terms || 0),
  };
  const totalWorldLoreItems = worldLoreCounts.locations + worldLoreCounts.objects + worldLoreCounts.terms;
  const totalItems = characters.length + totalWorldLoreItems;
  const currentContentMode = resolveProjectContentMode(currentProject);

  return (
    <div className="story-bible">
      <div className="bible-header">
        <div className="bible-mobile-tabs" aria-label="Điều hướng Bible">
          <button className="bible-mobile-tab bible-mobile-tab--active" type="button">Tổng quan</button>
          <button className="bible-mobile-tab" type="button" onClick={() => handleNavigate('/characters')}>Nhân vật</button>
          <button className="bible-mobile-tab" type="button" onClick={() => handleNavigate('/world')}>Thế giới</button>
          <button className="bible-mobile-tab" type="button" onClick={() => handleNavigate('/su-that')}>Canon</button>
        </div>
        <h2><BookMarked size={22} /> Sổ tay truyện</h2>
        <p className="bible-subtitle">Trung tâm quản lý truyện - {totalItems} mục</p>
      </div>

      <StoryBibleOverviewSection
        isOpen={openSections.overview}
        onToggle={toggleSection}
        chaptersCount={chapters.length}
        charactersCount={characters.length}
        locationsCount={worldLoreCounts.locations}
        objectsCount={worldLoreCounts.objects}
        worldTermsCount={worldLoreCounts.terms}
        pronounStylePresets={PRONOUN_STYLE_PRESETS}
        currentProject={currentProject}
        onSaveProjectSettings={projectFields.save}
        {...projectFields}
      />

      <StoryBibleWorldLoreSummarySection
        counts={worldLoreCounts}
        isOpen={openSections.worldLore}
        onToggle={toggleSection}
        onNavigate={handleNavigate}
      />

      <div className="bible-section">
        <StoryBibleSectionHeader
          icon={Settings}
          title="Cài đặt AI"
          sectionKey="ai"
          isOpen={openSections.ai}
          onToggle={toggleSection}
        />
        {openSections.ai && (
          <div className="bible-edit-card">
            <div className="form-group">
              <label className="form-label">Mức độ nghiêm ngặt</label>
              <div className="strictness-options">
                {AI_STRICTNESS_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    className={`strictness-btn ${projectFields.aiStrictness === level.value ? 'strictness-btn--active' : ''}`}
                    onClick={() => projectFields.handleStrictnessChange(level.value)}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
              <span className="form-hint">
                {AI_STRICTNESS_LEVELS.find((item) => item.value === projectFields.aiStrictness)?.desc}
              </span>
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <ProjectContentModeControl
                surface="story-bible"
                mode={currentContentMode}
                onOpenPrompts={() => handleNavigate('/prompts')}
              />
            </div>

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-label">Prompt truyện</label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Prompt đã được chuyển sang trang riêng</div>
                  <div className="form-hint" style={{ margin: 0 }}>
                    Vào trang Prompt truyện để chỉnh chỉ dẫn AI, prompt viết truyện, canon, ghi nhớ và DNA của riêng dự án này.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleNavigate('/prompts')}
                >
                  <Sparkles size={14} /> Mở Prompt truyện
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {visibleDeferredSections >= 1 && (
        <React.Suspense fallback={null}>
          <StoryBibleMacroArcSection
            currentProjectId={currentProject.id}
            chapters={chapters}
            targetLength={projectFields.targetLength}
            isOpen={openSections.grandStrategy}
            onToggle={toggleSection}
            allCharacterNames={allCharacterNames}
            {...macroArcState}
          />
        </React.Suspense>
      )}

      {visibleDeferredSections >= 2 && <React.Suspense fallback={null}>
        <div className="bible-section">
          <StoryBibleSectionHeader
            icon={Sparkles}
            title="Hộp đề xuất"
            sectionKey="suggestions"
            isOpen={openSections.suggestions}
            onToggle={toggleSection}
          />
          {openSections.suggestions && (
            <div className="bible-edit-card">
              <SuggestionInbox
                projectId={currentProject.id}
                onAccepted={() => Promise.all([
                  loadStoryBibleCodex(currentProject.id),
                  canonState.loadCanonOverview(),
                ])}
              />
            </div>
          )}
        </div>
      </React.Suspense>}

      {visibleDeferredSections >= 3 && <React.Suspense fallback={null}>
        <StoryBibleCanonSection
          isOpen={openSections.canon}
          onToggle={toggleSection}
          chapters={chapters}
          characterNameMap={characterNameMap}
          {...canonState}
          {...draftState}
        />
      </React.Suspense>}

      {visibleDeferredSections >= 4 && <React.Suspense fallback={null}>
        <StoryBibleCharactersSection
          characters={characters}
          characterDrafts={draftState.characterDrafts}
          isOpen={openSections.characters}
          onToggle={toggleSection}
          onNavigate={handleNavigate}
          onDraftChange={draftState.handleCharacterDraftChange}
        />
      </React.Suspense>}

      {visibleDeferredSections >= 5 && <React.Suspense fallback={null}>
        <StoryBibleSummariesSection
          chapterMetas={chapterMetas}
          chapters={chapters}
          isOpen={openSections.summaries}
          onToggle={toggleSection}
        />
      </React.Suspense>}

      {totalItems === 0 && (
        <div className="empty-state">
          <BookOpen size={48} />
          <h3>Sổ tay truyện trống</h3>
          <p>Thêm nhân vật, địa điểm, thuật ngữ qua trang Nhân vật và Thế giới.</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn btn-primary" onClick={() => handleNavigate('/characters')}>
              <Users size={16} /> Nhân vật
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => handleNavigate('/world')}>
              <MapPin size={16} /> Thế giới
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
