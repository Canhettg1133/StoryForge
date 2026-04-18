import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Clock,
  Cloud,
  FileSearch,
  FlaskConical,
  Globe,
  Languages,
  LayoutDashboard,
  Map,
  MessageSquare,
  Palette,
  PanelLeft,
  PenTool,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import ChapterList from '../../components/common/ChapterList';
import StoryEditor from '../../components/editor/StoryEditor';
import AISidebar from '../../components/ai/AISidebar';
import useMobileLayout from '../../hooks/useMobileLayout';
import { EDITOR_PANEL_EVENT } from '../../components/mobile/MobileProjectShell';
import { shouldShowNavItem } from '../../config/productSurface';
import useProjectStore from '../../stores/projectStore';
import useAIStore from '../../stores/aiStore';
import './SceneEditor.css';

const MOBILE_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, needsProject: false, getPath: () => '/' },
  { id: 'story-bible', label: 'Sổ tay truyện', icon: BookOpen, needsProject: true, getPath: (projectId) => `/project/${projectId}/story-bible` },
  { id: 'outline', label: 'Outline Board', icon: Map, needsProject: true, getPath: (projectId) => `/project/${projectId}/outline` },
  { id: 'characters', label: 'Nhân vật', icon: Users, needsProject: true, getPath: (projectId) => `/project/${projectId}/characters` },
  { id: 'world', label: 'Thế giới', icon: Globe, needsProject: true, getPath: (projectId) => `/project/${projectId}/world` },
  { id: 'editor', label: 'Viết truyện', icon: PenTool, needsProject: true, getPath: (projectId) => `/project/${projectId}/editor`, primary: true },
  { id: 'project-chat', label: 'Chat với AI', icon: MessageSquare, needsProject: true, getPath: (projectId) => `/project/${projectId}/chat` },
  { id: 'project-prompts', label: 'Prompt truyện', icon: Sparkles, needsProject: true, getPath: (projectId) => `/project/${projectId}/prompts` },
  { id: 'prompt-manager', label: 'Prompt tổng quát', icon: Sparkles, needsProject: true, getPath: (projectId) => `/project/${projectId}/prompt-manager` },
  { id: 'cloud-sync', label: 'Cloud Sync', icon: Cloud, needsProject: true, getPath: (projectId) => `/project/${projectId}/cloud-sync` },
  { id: 'lab', label: 'Narrative Lab', icon: FlaskConical, needsProject: true, getPath: (projectId) => `/project/${projectId}/lab` },
  { id: 'corpus-lab', label: 'Corpus Lab', icon: FlaskConical, needsProject: true, getPath: (projectId) => `/project/${projectId}/corpus-lab` },
  { id: 'timeline', label: 'Timeline', icon: Clock, needsProject: true, getPath: (projectId) => `/project/${projectId}/timeline`, comingSoon: true },
  { id: 'revision', label: 'Revision & QA', icon: FileSearch, needsProject: true, getPath: (projectId) => `/project/${projectId}/revision`, comingSoon: true },
  { id: 'style-lab', label: 'Style Lab', icon: Palette, needsProject: true, getPath: (projectId) => `/project/${projectId}/style-lab`, comingSoon: true },
  { id: 'global-chat', label: 'Chat tự do', icon: MessageSquare, needsProject: false, getPath: () => '/ai-chat' },
  { id: 'settings', label: 'Cài đặt', icon: Settings, needsProject: false, getPath: () => '/settings' },
  { id: 'translator', label: 'Dịch truyện', icon: Languages, needsProject: false, getPath: () => '/translator' },
];
const VISIBLE_MOBILE_NAV_ITEMS = MOBILE_NAV_ITEMS.filter((item) => shouldShowNavItem(item));

function isHtmlBlank(html = '') {
  return !String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export default function SceneEditor() {
  const { currentProject, scenes, activeSceneId, activeChapterId } = useProjectStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [editorInstance, setEditorInstance] = useState(null);
  const isMobileLayout = useMobileLayout(900);
  const [mobilePanel, setMobilePanel] = useState(null);
  const [mobileAITab, setMobileAITab] = useState('ai');
  const [aiDraftPreview, setAiDraftPreview] = useState(null);
  const aiIsStreaming = useAIStore((state) => state.isStreaming);

  const openMobilePanel = useCallback((panel) => {
    setMobilePanel(panel);
    if (panel === 'ai') {
      setMobileAITab((current) => current || 'ai');
    }
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setMobilePanel(null);
    }
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setMobilePanel(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout) return undefined;
    const handleOpenPanel = (event) => {
      const panel = event.detail?.panel;
      if (panel === 'chapters' || panel === 'ai' || panel === 'nav') {
        openMobilePanel(panel);
      }
    };

    window.addEventListener(EDITOR_PANEL_EVENT, handleOpenPanel);
    return () => window.removeEventListener(EDITOR_PANEL_EVENT, handleOpenPanel);
  }, [isMobileLayout, openMobilePanel]);

  const handleEditorReady = useCallback((editor) => {
    setEditorInstance(editor);
  }, []);

  const handleDraftPreviewChange = useCallback((preview) => {
    setAiDraftPreview(preview);
  }, []);

  const activeProjectId = currentProject?.id || null;
  const activeScene = useMemo(
    () => scenes.find((scene) => scene.id === activeSceneId) || null,
    [scenes, activeSceneId],
  );
  const scopedAiDraftPreview = useMemo(() => {
    if (!aiDraftPreview?.text) return null;
    if (!activeSceneId || !activeChapterId) return null;
    if (aiDraftPreview.sceneId !== activeSceneId) return null;
    if (aiDraftPreview.chapterId !== activeChapterId) return null;
    return aiDraftPreview;
  }, [aiDraftPreview, activeSceneId, activeChapterId]);
  const hasAiDraftPreview = !!scopedAiDraftPreview?.text && isHtmlBlank(activeScene?.draft_text || '');
  const mobileAIButtonLabel = aiIsStreaming
    ? 'AI \u0111ang vi\u1ebft'
    : hasAiDraftPreview
      ? 'B\u1ea3n nh\u00e1p AI'
      : 'AI vi\u1ebft';
  const visibleMobileNavItems = useMemo(
    () =>
      VISIBLE_MOBILE_NAV_ITEMS.filter((item) => {
        if (item.id === 'global-chat') return !activeProjectId;
        if (item.id === 'project-chat') return !!activeProjectId;
        return true;
      }),
    [activeProjectId],
  );

  const closeMobilePanel = () => {
    setMobilePanel(null);
  };

  const handleMobileNavigate = (item) => {
    if (item.comingSoon || (item.needsProject && !activeProjectId)) return;
    const targetPath = item.id === 'settings' && activeProjectId
      ? `/project/${activeProjectId}/settings`
      : item.getPath(activeProjectId);
    if (item.id === 'translator') {
      window.location.assign(new URL(targetPath, window.location.origin).href);
      return;
    }
    navigate(targetPath);
    closeMobilePanel();
  };

  if (!currentProject) {
    return (
      <div className="scene-editor-no-project">
        <div className="empty-state">
          <BookOpen size={48} />
          <h3>Chưa chọn dự án</h3>
          <p>Quay lại Dashboard để chọn hoặc tạo dự án mới</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Về Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`scene-editor-layout ${isMobileLayout ? 'scene-editor-layout--mobile' : ''}`}>
      {isMobileLayout && mobilePanel && (
        <button className="scene-editor-overlay" onClick={closeMobilePanel} aria-label="Đóng panel đang mở" />
      )}

      <aside
        className={`scene-editor-side scene-editor-side--nav ${isMobileLayout ? 'scene-editor-side--sheet scene-editor-side--sheet-left' : ''} ${mobilePanel === 'nav' ? 'is-open' : ''}`}
      >
        {isMobileLayout && (
          <div className="scene-editor-sheet-header">
            <div>
              <div className="scene-editor-sheet-kicker">Điều hướng</div>
              <div className="scene-editor-sheet-title">Menu</div>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={closeMobilePanel} title="Đóng menu">
              <X size={16} />
            </button>
          </div>
        )}
        {isMobileLayout && (
          <div className="scene-editor-mobile-nav">
            {currentProject && (
              <div className="scene-editor-mobile-nav-project">
                <div className="scene-editor-mobile-nav-project-kicker">Dự án hiện tại</div>
                <div className="scene-editor-mobile-nav-project-title">{currentProject.title}</div>
              </div>
            )}
            <div className="scene-editor-mobile-nav-list">
                {visibleMobileNavItems.map((item) => {
                const Icon = item.icon;
                const targetPath = item.getPath(activeProjectId);
                const isActive = location.pathname === targetPath || (targetPath !== '/' && targetPath !== '/settings' && location.pathname.startsWith(targetPath));
                const isDisabled = item.comingSoon || (item.needsProject && !activeProjectId);

                return (
                  <button
                    key={item.id}
                    className={`scene-editor-mobile-nav-item ${item.primary ? 'scene-editor-mobile-nav-item--primary' : ''} ${isActive ? 'scene-editor-mobile-nav-item--active' : ''} ${isDisabled ? 'scene-editor-mobile-nav-item--disabled' : ''}`}
                    onClick={() => handleMobileNavigate(item)}
                    disabled={isDisabled}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                    {item.comingSoon && <span className="scene-editor-mobile-nav-badge">Soon</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      <aside
        className={`scene-editor-side scene-editor-side--chapter ${isMobileLayout ? 'scene-editor-side--sheet scene-editor-side--sheet-left' : ''} ${mobilePanel === 'chapters' ? 'is-open' : ''}`}
      >
        {isMobileLayout && (
          <div className="scene-editor-sheet-header">
            <div>
              <div className="scene-editor-sheet-kicker">Điều hướng</div>
              <div className="scene-editor-sheet-title">Chương & Cảnh</div>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={closeMobilePanel} title="Đóng danh sách chương">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="scene-editor-side-body">
          <ChapterList
            allowCollapse={!isMobileLayout}
            isMobileLayout={isMobileLayout}
            onItemSelect={() => isMobileLayout && closeMobilePanel()}
          />
        </div>
      </aside>

      <div className="scene-editor-main">
        {isMobileLayout && (
          <div className="scene-editor-mobile-actions" aria-label="C\u00f4ng c\u1ee5 vi\u1ebft truy\u1ec7n">
            <button className="scene-editor-mobile-action" type="button" onClick={() => openMobilePanel('chapters')}>
              <PanelLeft size={16} />
              <span>{'Ch\u01b0\u01a1ng'}</span>
            </button>
            <button
              className={`scene-editor-mobile-action ${mobilePanel === 'ai' ? 'scene-editor-mobile-action--open' : ''} ${aiIsStreaming ? 'scene-editor-mobile-action--working' : ''} ${hasAiDraftPreview ? 'scene-editor-mobile-action--has-draft' : ''}`}
              type="button"
              onClick={() => openMobilePanel('ai')}
            >
              <Sparkles size={16} />
              {(aiIsStreaming || hasAiDraftPreview) && (
                <span className="scene-editor-mobile-action-status" aria-hidden="true" />
              )}
              <span>{mobileAIButtonLabel}</span>
            </button>
          </div>
        )}
        <StoryEditor
          onEditorReady={handleEditorReady}
          isMobileLayout={isMobileLayout}
          aiDraftPreview={scopedAiDraftPreview}
        />
      </div>

      <aside
        className={`scene-editor-side scene-editor-side--ai ${isMobileLayout ? 'scene-editor-side--sheet scene-editor-side--sheet-full' : ''} ${mobilePanel === 'ai' ? 'is-open' : ''}`}
      >
        {isMobileLayout && (
          <div className="scene-editor-sheet-header scene-editor-sheet-header--ai">
            <div>
              <div className="scene-editor-sheet-kicker">Trợ lý viết</div>
              <div className="scene-editor-sheet-title">AI</div>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={closeMobilePanel} title="Đóng AI">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="scene-editor-side-body">
          <AISidebar
            editor={editorInstance}
            isMobileLayout={isMobileLayout}
            mobileTab={mobileAITab}
            onMobileTabChange={setMobileAITab}
            onDraftPreviewChange={handleDraftPreviewChange}
          />
        </div>
      </aside>
    </div>
  );
}
