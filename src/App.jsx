import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/common/AppLayout';
import { PRODUCT_SURFACE } from './config/productSurface';
import Dashboard from './pages/Dashboard/Dashboard';
import StoryBible from './pages/StoryBible/StoryBible';
import CanonTruth from './pages/CanonTruth/CanonTruth';
import OutlineBoard from './pages/OutlineBoard/OutlineBoard';
import CharacterHub from './pages/CharacterHub/CharacterHub';
import WorldLore from './pages/WorldLore/WorldLore';
import SceneEditor from './pages/SceneEditor/SceneEditor';
import TimelineThread from './pages/TimelineThread/TimelineThread';
import RevisionQA from './pages/RevisionQA/RevisionQA';
import StyleLab from './pages/StyleLab/StyleLab';
import NarrativeLab from './pages/Lab/NarrativeLab';
import LabLite from './pages/Lab/LabLite/LabLite';
import CorpusLab from './pages/Lab/CorpusLab/CorpusLab';
import AnalysisViewer from './pages/Lab/CorpusLab/AnalysisViewer';
import Settings from './pages/Settings/Settings';
import CloudSyncPage from './pages/CloudSync/CloudSyncPage';
import StoryCreationSettings from './pages/StoryCreationSettings/StoryCreationSettings';
import ProjectPromptManager from './pages/ProjectPromptManager/ProjectPromptManager';
import ProjectChat from './pages/ProjectChat/ProjectChat';
import Translator from './pages/Translator/Translator';
import GeminiSetupGuide from './pages/Guide/GeminiSetupGuide';
import GeminiProxyGuide from './pages/Guide/GeminiProxyGuide';
import TranslatorSetupGuide from './pages/Guide/TranslatorSetupGuide';
import ProjectLayout from './components/common/ProjectLayout';

export default function App() {
  const labFallback = <Navigate to="../editor" replace />;
  const roadmapFallback = <Navigate to="../story-bible" replace />;

  return (
    <BrowserRouter>
      <Routes>
          <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/cloud-sync" element={<CloudSyncPage />} />
          <Route path="/guide" element={<GeminiSetupGuide />} />
          <Route path="/guide/proxy" element={<GeminiProxyGuide />} />
          <Route path="/guide/translator" element={<TranslatorSetupGuide />} />
          <Route path="/ai-chat" element={<ProjectChat />} />
          <Route path="/translator" element={<Translator />} />
          <Route path="/lab-lite" element={PRODUCT_SURFACE.showLabLite ? <LabLite /> : <Navigate to="/" replace />} />
          <Route path="/prompt-manager" element={<StoryCreationSettings />} />
          <Route path="/story-creation-settings" element={<Navigate to="/prompt-manager" replace />} />

          {/* Project-specific routes */}
          <Route path="/project/:projectId" element={<ProjectLayout />}>
            <Route path="story-bible" element={<StoryBible />} />
            <Route path="su-that" element={<CanonTruth />} />
            <Route path="outline" element={<OutlineBoard />} />
            <Route path="characters" element={<CharacterHub />} />
            <Route path="world" element={<WorldLore />} />
            <Route path="editor" element={<SceneEditor />} />
            <Route path="settings" element={<Settings />} />
            <Route path="cloud-sync" element={<CloudSyncPage />} />
            <Route path="chat" element={<ProjectChat />} />
            <Route path="prompts" element={<ProjectPromptManager />} />
            <Route path="prompt-manager" element={<StoryCreationSettings />} />
            <Route path="timeline" element={PRODUCT_SURFACE.showRoadmapPages ? <TimelineThread /> : roadmapFallback} />
            <Route path="revision" element={PRODUCT_SURFACE.showRoadmapPages ? <RevisionQA /> : roadmapFallback} />
            <Route path="style-lab" element={PRODUCT_SURFACE.showRoadmapPages ? <StyleLab /> : roadmapFallback} />
            <Route path="lab" element={PRODUCT_SURFACE.showLabs ? <NarrativeLab /> : labFallback} />
            <Route path="lab-lite" element={PRODUCT_SURFACE.showLabLite ? <LabLite /> : labFallback} />
            <Route path="corpus-lab" element={PRODUCT_SURFACE.showLabs ? <CorpusLab /> : labFallback} />
            <Route path="corpus-lab/viewer" element={PRODUCT_SURFACE.showLabs ? <AnalysisViewer /> : labFallback} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
