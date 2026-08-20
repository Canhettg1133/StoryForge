import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/common/AppLayout';
import RouteBoundary from './components/common/RouteBoundary';
import { ConfirmDialogProvider } from './components/common/ConfirmDialogProvider';
import { PRODUCT_SURFACE } from './config/productSurface';
import SiteAnnouncementCenter from './components/siteAnnouncement/SiteAnnouncementCenter';
import { AccessProvider } from './services/access/AccessContext.jsx';
import { lazyRoute } from './routes/routeModules.js';
import './styles/cream-overrides.css';

const Dashboard = lazyRoute('dashboard');
const StoryBible = lazyRoute('storyBible');
const CanonTruth = lazyRoute('canonTruth');
const OutlineBoard = lazyRoute('outlineBoard');
const CharacterHub = lazyRoute('characterHub');
const WorldLore = lazyRoute('worldLore');
const SceneEditor = lazyRoute('sceneEditor');
const TimelineThread = lazyRoute('timelineThread');
const RevisionQA = lazyRoute('revisionQA');
const StyleLab = lazyRoute('styleLab');
const NarrativeLab = lazyRoute('narrativeLab');
const LabLite = lazyRoute('labLite');
const CorpusLab = lazyRoute('corpusLab');
const AnalysisViewer = lazyRoute('analysisViewer');
const Settings = lazyRoute('settings');
const CloudSyncPage = lazyRoute('cloudSync');
const StoryCreationSettings = lazyRoute('storyCreationSettings');
const ProjectPromptManager = lazyRoute('projectPromptManager');
const StyleImporter = lazyRoute('styleImporter');
const ProjectChat = lazyRoute('projectChat');
const GeminiSetupGuide = lazyRoute('geminiSetupGuide');
const GeminiProxyGuide = lazyRoute('geminiProxyGuide');
const TranslatorSetupGuide = lazyRoute('translatorSetupGuide');
const Notifications = lazyRoute('notifications');
const Login = lazyRoute('login');
const NotFound = lazyRoute('notFound');
const ProjectLayout = lazyRoute('projectLayout');

const SHOW_WRITING_DEBUG = import.meta.env.VITE_SHOW_WRITING_DEBUG === 'true';
const WritingRequestDebugger = SHOW_WRITING_DEBUG
  ? lazyRoute('writingRequestDebugger')
  : null;

function withRouteBoundary(element) {
  return <RouteBoundary>{element}</RouteBoundary>;
}

export default function App() {
  const labFallback = <Navigate to="../editor" replace />;
  const roadmapFallback = <Navigate to="../story-bible" replace />;

  return (
    <AccessProvider>
      <ConfirmDialogProvider>
        <BrowserRouter>
          <Routes>
          <Route element={<AppLayout />}>
            <Route path="/login" element={withRouteBoundary(<Login />)} />
            <Route path="/" element={withRouteBoundary(<Dashboard />)} />
            <Route path="/thong-bao" element={withRouteBoundary(<Notifications />)} />
            <Route path="/settings" element={withRouteBoundary(<Settings />)} />
            <Route path="/cloud-sync" element={withRouteBoundary(<CloudSyncPage />)} />
            <Route path="/guide" element={withRouteBoundary(<GeminiSetupGuide />)} />
            <Route path="/guide/proxy" element={withRouteBoundary(<GeminiProxyGuide />)} />
            <Route path="/guide/proxy/fix-cli" element={withRouteBoundary(<GeminiProxyGuide focusFixCli />)} />
            <Route path="/guide/translator" element={withRouteBoundary(<TranslatorSetupGuide />)} />
            <Route path="/ai-chat" element={withRouteBoundary(<ProjectChat />)} />
            <Route path="/translator" element={null} />
            <Route
              path="/lab-lite"
              element={withRouteBoundary(PRODUCT_SURFACE.showLabLite ? <LabLite /> : <Navigate to="/" replace />)}
            />
            <Route path="/prompt-manager" element={withRouteBoundary(<StoryCreationSettings />)} />
            <Route path="/story-creation-settings" element={<Navigate to="/prompt-manager" replace />} />

            <Route path="/project/:projectId" element={withRouteBoundary(<ProjectLayout />)}>
              <Route path="story-bible" element={withRouteBoundary(<StoryBible />)} />
              <Route path="su-that" element={withRouteBoundary(<CanonTruth />)} />
              <Route path="outline" element={withRouteBoundary(<OutlineBoard />)} />
              <Route path="characters" element={withRouteBoundary(<CharacterHub />)} />
              <Route path="world" element={withRouteBoundary(<WorldLore />)} />
              <Route path="editor" element={withRouteBoundary(<SceneEditor />)} />
              <Route path="settings" element={withRouteBoundary(<Settings />)} />
              <Route path="cloud-sync" element={withRouteBoundary(<CloudSyncPage />)} />
              <Route path="chat" element={withRouteBoundary(<ProjectChat />)} />
              <Route path="prompts" element={withRouteBoundary(<ProjectPromptManager />)} />
              <Route path="style-importer" element={withRouteBoundary(<StyleImporter />)} />
              {SHOW_WRITING_DEBUG && WritingRequestDebugger ? (
                <Route path="writing-debug" element={withRouteBoundary(<WritingRequestDebugger />)} />
              ) : null}
              <Route path="prompt-manager" element={withRouteBoundary(<StoryCreationSettings />)} />
              <Route
                path="timeline"
                element={withRouteBoundary(PRODUCT_SURFACE.showRoadmapPages ? <TimelineThread /> : roadmapFallback)}
              />
              <Route
                path="revision"
                element={withRouteBoundary(PRODUCT_SURFACE.showRoadmapPages ? <RevisionQA /> : roadmapFallback)}
              />
              <Route
                path="style-lab"
                element={withRouteBoundary(PRODUCT_SURFACE.showRoadmapPages ? <StyleLab /> : roadmapFallback)}
              />
              <Route
                path="lab"
                element={withRouteBoundary(PRODUCT_SURFACE.showLabs ? <NarrativeLab /> : labFallback)}
              />
              <Route
                path="lab-lite"
                element={withRouteBoundary(PRODUCT_SURFACE.showLabLite ? <LabLite /> : labFallback)}
              />
              <Route
                path="corpus-lab"
                element={withRouteBoundary(PRODUCT_SURFACE.showLabs ? <CorpusLab /> : labFallback)}
              />
              <Route
                path="corpus-lab/viewer"
                element={withRouteBoundary(PRODUCT_SURFACE.showLabs ? <AnalysisViewer /> : labFallback)}
              />
            </Route>
            <Route path="*" element={withRouteBoundary(<NotFound />)} />
          </Route>
          </Routes>
          <SiteAnnouncementCenter />
        </BrowserRouter>
      </ConfirmDialogProvider>
    </AccessProvider>
  );
}
