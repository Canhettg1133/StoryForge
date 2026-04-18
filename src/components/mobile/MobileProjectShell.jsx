import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BookMarked,
  BookOpen,
  Cloud,
  FileSearch,
  FlaskConical,
  Languages,
  LayoutDashboard,
  Map,
  PenTool,
  Palette,
  Sparkles,
  Settings,
  Users,
  Globe,
  ShieldCheck,
} from 'lucide-react';
import { PRODUCT_SURFACE, shouldShowNavItem } from '../../config/productSurface';
import useProjectStore from '../../stores/projectStore';
import MobileSheet from './MobileSheet';
import MobileProjectTopBar from './MobileProjectTopBar';
import './MobileProjectShell.css';

const EDITOR_PANEL_EVENT = 'storyforge:open-mobile-editor-panel';

const MORE_ITEMS = [
  { id: 'editor', label: 'Vi\u1ebft', icon: PenTool, path: (id) => `/project/${id}/editor` },
  { id: 'outline', label: 'D\u00e0n \u00fd', icon: Map, path: (id) => `/project/${id}/outline` },
  { id: 'chat', label: 'Chat v\u1edbi AI', icon: Sparkles, path: (id) => `/project/${id}/chat` },
  { id: 'story-bible', label: 'S\u1ed5 tay truy\u1ec7n', icon: BookOpen, path: (id) => `/project/${id}/story-bible` },
  { id: 'characters', label: 'Nh\u00e2n v\u1eadt', icon: Users, path: (id) => `/project/${id}/characters` },
  { id: 'world', label: 'Th\u1ebf gi\u1edbi', icon: Globe, path: (id) => `/project/${id}/world` },
  { id: 'canon', label: 'Canon', icon: ShieldCheck, path: (id) => `/project/${id}/su-that` },
  { id: 'prompts', label: 'Prompt truy\u1ec7n', icon: BookMarked, path: (id) => `/project/${id}/prompts` },
  { id: 'prompt-manager', label: 'Prompt t\u1ed5ng qu\u00e1t', icon: Sparkles, path: (id) => `/project/${id}/prompt-manager` },
  { id: 'cloud-sync', label: 'Cloud Sync', icon: Cloud, path: (id) => `/project/${id}/cloud-sync` },
  { id: 'settings', label: 'C\u00e0i \u0111\u1eb7t', icon: Settings, path: (id) => `/project/${id}/settings` },
  { id: 'translator', label: 'D\u1ecbch truy\u1ec7n', icon: Languages, path: () => '/translator' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: () => '/' },
  { id: 'lab', label: 'Narrative Lab', icon: FlaskConical, path: (id) => `/project/${id}/lab`, surface: 'lab' },
  { id: 'corpus-lab', label: 'Corpus Lab', icon: FlaskConical, path: (id) => `/project/${id}/corpus-lab`, surface: 'lab' },
  { id: 'timeline', label: 'Timeline', icon: Map, path: (id) => `/project/${id}/timeline`, surface: 'roadmap' },
  { id: 'revision', label: 'Revision & QA', icon: FileSearch, path: (id) => `/project/${id}/revision`, surface: 'roadmap' },
  { id: 'style-lab', label: 'Style Lab', icon: Palette, path: (id) => `/project/${id}/style-lab`, surface: 'roadmap' },
];

function getPageTitle(pathname) {
  if (pathname.includes('/editor')) return 'Vi\u1ebft truy\u1ec7n';
  if (pathname.includes('/outline')) return 'D\u00e0n \u00fd';
  if (pathname.includes('/story-bible')) return 'S\u1ed5 tay truy\u1ec7n';
  if (pathname.includes('/characters')) return 'Nh\u00e2n v\u1eadt';
  if (pathname.includes('/world')) return 'Th\u1ebf gi\u1edbi';
  if (pathname.includes('/su-that')) return 'Canon';
  if (pathname.includes('/chat')) return 'Chat v\u1edbi AI';
  if (pathname.includes('/prompt-manager')) return 'Prompt t\u1ed5ng qu\u00e1t';
  if (pathname.includes('/cloud-sync')) return 'Cloud Sync';
  if (pathname.includes('/settings')) return 'C\u00e0i \u0111\u1eb7t';
  if (pathname.includes('/prompts')) return 'Prompt truy\u1ec7n';
  if (pathname.includes('/lab')) return 'Lab';
  return 'D\u1ef1 \u00e1n';
}

function canShowItem(item) {
  if (!shouldShowNavItem(item)) return false;
  if (item.surface === 'lab') return PRODUCT_SURFACE.showLabs;
  if (item.surface === 'roadmap') return PRODUCT_SURFACE.showRoadmapPages;
  return true;
}

function formatStoryLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/^Canh(?=(\s|:|-))/i, 'Cảnh')
    .replace(/^Chuong(?=(\s|:|-))/i, 'Chương');
}

export default function MobileProjectShell({ children }) {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject, chapters, scenes, activeChapterId, activeSceneId } = useProjectStore();
  const [moreOpen, setMoreOpen] = useState(false);

  const numericProjectId = Number(projectId || currentProject?.id);
  const isEditorRoute = location.pathname.includes('/editor');
  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId) || null;
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) || null;
  const pageTitle = getPageTitle(location.pathname);
  const displaySceneTitle = formatStoryLabel(activeScene?.title);
  const displayChapterTitle = formatStoryLabel(activeChapter?.title);
  const mobileTitle = isEditorRoute
    ? (displaySceneTitle || displayChapterTitle || currentProject?.title || 'StoryForge')
    : (currentProject?.title || 'StoryForge');
  const backLabel = isEditorRoute ? 'V\u1ec1 Dashboard' : 'V\u1ec1 m\u00e0n vi\u1ebft';

  const visibleMoreItems = useMemo(() => MORE_ITEMS.filter(canShowItem), []);

  const openEditorPanel = (panel) => {
    window.dispatchEvent(new CustomEvent(EDITOR_PANEL_EVENT, { detail: { panel } }));
  };

  const handleTitleClick = () => {
    if (isEditorRoute) openEditorPanel('chapters');
  };

  const handleMoreNavigate = (item) => {
    const target = item.path(numericProjectId);
    if (item.id === 'translator') {
      window.location.assign(new URL(target, window.location.origin).href);
      return;
    }
    navigate(target);
    setMoreOpen(false);
  };

  return (
    <div className="project-mobile-shell">
      <MobileProjectTopBar
        pageTitle={pageTitle}
        title={mobileTitle}
        titleIsAction={isEditorRoute}
        onBack={() => navigate(isEditorRoute ? '/' : `/project/${numericProjectId}/editor`)}
        backLabel={backLabel}
        onTitleClick={handleTitleClick}
        onMore={() => setMoreOpen(true)}
      />

      <main className="project-mobile-content">
        {children}
      </main>

      <MobileSheet
        open={moreOpen}
        title="Menu"
        kicker={currentProject?.title || 'StoryForge'}
        size="full"
        onClose={() => setMoreOpen(false)}
      >
        <div className="project-mobile-more-list">
          {visibleMoreItems.map((item) => {
            const Icon = item.icon;
            const target = item.path(numericProjectId);
            const active = location.pathname === target || (target !== '/' && location.pathname.startsWith(target));
            return (
              <button
                key={item.id}
                type="button"
                className={`project-mobile-more-item ${active ? 'project-mobile-more-item--active' : ''}`}
                onClick={() => handleMoreNavigate(item)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </MobileSheet>
    </div>
  );
}

export { EDITOR_PANEL_EVENT };
