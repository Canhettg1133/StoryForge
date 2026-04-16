import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BookMarked,
  FileSearch,
  FlaskConical,
  LayoutDashboard,
  Map,
  Palette,
  Settings,
  Users,
  Globe,
  ShieldCheck,
} from 'lucide-react';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import useProjectStore from '../../stores/projectStore';
import MobileSheet from './MobileSheet';
import MobileBottomNav from './MobileBottomNav';
import MobileProjectTopBar from './MobileProjectTopBar';
import './MobileProjectShell.css';

const EDITOR_PANEL_EVENT = 'storyforge:open-mobile-editor-panel';

const MORE_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: () => '/' },
  { id: 'characters', label: 'Nhan vat', icon: Users, path: (id) => `/project/${id}/characters` },
  { id: 'world', label: 'The gioi', icon: Globe, path: (id) => `/project/${id}/world` },
  { id: 'canon', label: 'Canon', icon: ShieldCheck, path: (id) => `/project/${id}/su-that` },
  { id: 'settings', label: 'Cai dat', icon: Settings, path: (id) => `/project/${id}/settings` },
  { id: 'prompts', label: 'Prompt AI', icon: BookMarked, path: (id) => `/project/${id}/prompts` },
  { id: 'lab', label: 'Narrative Lab', icon: FlaskConical, path: (id) => `/project/${id}/lab`, surface: 'lab' },
  { id: 'corpus-lab', label: 'Corpus Lab', icon: FlaskConical, path: (id) => `/project/${id}/corpus-lab`, surface: 'lab' },
  { id: 'timeline', label: 'Timeline', icon: Map, path: (id) => `/project/${id}/timeline`, surface: 'roadmap' },
  { id: 'revision', label: 'Revision & QA', icon: FileSearch, path: (id) => `/project/${id}/revision`, surface: 'roadmap' },
  { id: 'style-lab', label: 'Style Lab', icon: Palette, path: (id) => `/project/${id}/style-lab`, surface: 'roadmap' },
];

function getPageTitle(pathname) {
  if (pathname.includes('/editor')) return 'Viet truyen';
  if (pathname.includes('/outline')) return 'Dan y';
  if (pathname.includes('/story-bible')) return 'Bible';
  if (pathname.includes('/characters')) return 'Nhan vat';
  if (pathname.includes('/world')) return 'The gioi';
  if (pathname.includes('/su-that')) return 'Canon';
  if (pathname.includes('/chat')) return 'AI';
  if (pathname.includes('/settings')) return 'Cai dat';
  if (pathname.includes('/prompts')) return 'Prompt AI';
  if (pathname.includes('/lab')) return 'Lab';
  return 'Du an';
}

function getActiveBottomId(pathname) {
  if (pathname.includes('/outline')) return 'outline';
  if (pathname.includes('/story-bible') || pathname.includes('/characters') || pathname.includes('/world') || pathname.includes('/su-that')) return 'bible';
  if (pathname.includes('/chat')) return 'ai';
  return 'write';
}

function canShowItem(item) {
  if (item.surface === 'lab') return PRODUCT_SURFACE.showLabs;
  if (item.surface === 'roadmap') return PRODUCT_SURFACE.showRoadmapPages;
  return true;
}

export default function MobileProjectShell({ children }) {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject, chapters, scenes, activeChapterId, activeSceneId } = useProjectStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const numericProjectId = Number(projectId || currentProject?.id);
  const isEditorRoute = location.pathname.includes('/editor');
  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId) || null;
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) || null;
  const pageTitle = getPageTitle(location.pathname);
  const activeBottomId = getActiveBottomId(location.pathname);
  const mobileTitle = isEditorRoute
    ? (activeScene?.title || activeChapter?.title || currentProject?.title || 'StoryForge')
    : (currentProject?.title || 'StoryForge');

  const visibleMoreItems = useMemo(() => MORE_ITEMS.filter(canShowItem), []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const syncViewport = () => {
      const availableHeight = Math.min(window.innerHeight, viewport.height);
      setKeyboardOpen(window.innerHeight - availableHeight > 140);
    };

    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
    };
  }, []);

  const openEditorPanel = (panel) => {
    window.dispatchEvent(new CustomEvent(EDITOR_PANEL_EVENT, { detail: { panel } }));
  };

  const handleTitleClick = () => {
    if (isEditorRoute) openEditorPanel('chapters');
  };

  const handleBottomClick = (item) => {
    if (item.id === 'ai' && isEditorRoute) {
      openEditorPanel('ai');
      return;
    }
    navigate(item.path(numericProjectId));
  };

  const handleMoreNavigate = (item) => {
    navigate(item.path(numericProjectId));
    setMoreOpen(false);
  };

  return (
    <div className={`project-mobile-shell ${keyboardOpen ? 'project-mobile-shell--keyboard' : ''}`}>
      <MobileProjectTopBar
        pageTitle={pageTitle}
        title={mobileTitle}
        titleIsAction={isEditorRoute}
        onBack={() => navigate('/')}
        onTitleClick={handleTitleClick}
        onMore={() => setMoreOpen(true)}
      />

      <main className="project-mobile-content">
        {children}
      </main>

      <MobileBottomNav activeId={activeBottomId} onItemClick={handleBottomClick} />

      <MobileSheet
        open={moreOpen}
        title="Menu"
        kicker={currentProject?.title || 'StoryForge'}
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
