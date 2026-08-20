import React from 'react';

export function createSharedModuleLoader(importer) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = Promise.resolve(importer())
        .catch((error) => {
          promise = null;
          throw error;
        });
    }
    return promise;
  };
}

const routeLoaders = {
  dashboard: createSharedModuleLoader(() => import('../pages/Dashboard/Dashboard')),
  storyBible: createSharedModuleLoader(() => import('../pages/StoryBible/StoryBible')),
  canonTruth: createSharedModuleLoader(() => import('../pages/CanonTruth/CanonTruth')),
  outlineBoard: createSharedModuleLoader(() => import('../pages/OutlineBoard/OutlineBoard')),
  characterHub: createSharedModuleLoader(() => import('../pages/CharacterHub/CharacterHub')),
  worldLore: createSharedModuleLoader(() => import('../pages/WorldLore/WorldLore')),
  sceneEditor: createSharedModuleLoader(() => import('../pages/SceneEditor/SceneEditor')),
  timelineThread: createSharedModuleLoader(() => import('../pages/TimelineThread/TimelineThread')),
  revisionQA: createSharedModuleLoader(() => import('../pages/RevisionQA/RevisionQA')),
  styleLab: createSharedModuleLoader(() => import('../pages/StyleLab/StyleLab')),
  narrativeLab: createSharedModuleLoader(() => import('../pages/Lab/NarrativeLab')),
  labLite: createSharedModuleLoader(() => import('../pages/Lab/LabLite/LabLite')),
  corpusLab: createSharedModuleLoader(() => import('../pages/Lab/CorpusLab/CorpusLab')),
  analysisViewer: createSharedModuleLoader(() => import('../pages/Lab/CorpusLab/AnalysisViewer')),
  settings: createSharedModuleLoader(() => import('../pages/Settings/Settings')),
  cloudSync: createSharedModuleLoader(() => import('../pages/CloudSync/CloudSyncPage')),
  storyCreationSettings: createSharedModuleLoader(() => import('../pages/StoryCreationSettings/StoryCreationSettings')),
  projectPromptManager: createSharedModuleLoader(() => import('../pages/ProjectPromptManager/ProjectPromptManager')),
  styleImporter: createSharedModuleLoader(() => import('../pages/StyleImporter/StyleImporter')),
  projectChat: createSharedModuleLoader(() => import('../pages/ProjectChat/ProjectChat')),
  geminiSetupGuide: createSharedModuleLoader(() => import('../pages/Guide/GeminiSetupGuide')),
  geminiProxyGuide: createSharedModuleLoader(() => import('../pages/Guide/GeminiProxyGuide')),
  translatorSetupGuide: createSharedModuleLoader(() => import('../pages/Guide/TranslatorSetupGuide')),
  notifications: createSharedModuleLoader(() => import('../pages/Notifications/Notifications')),
  login: createSharedModuleLoader(() => import('../pages/Login/Login')),
  notFound: createSharedModuleLoader(() => import('../pages/NotFound/NotFound')),
  projectLayout: createSharedModuleLoader(() => import('../components/common/ProjectLayout')),
  writingRequestDebugger: createSharedModuleLoader(() => import('../pages/WritingRequestDebugger/WritingRequestDebugger')),
};

const rootRouteIds = new Map([
  ['/', 'dashboard'],
  ['/login', 'login'],
  ['/thong-bao', 'notifications'],
  ['/settings', 'settings'],
  ['/cloud-sync', 'cloudSync'],
  ['/guide', 'geminiSetupGuide'],
  ['/guide/proxy', 'geminiProxyGuide'],
  ['/guide/proxy/fix-cli', 'geminiProxyGuide'],
  ['/guide/translator', 'translatorSetupGuide'],
  ['/ai-chat', 'projectChat'],
  ['/lab-lite', 'labLite'],
  ['/prompt-manager', 'storyCreationSettings'],
]);

const projectRouteIds = new Map([
  ['story-bible', 'storyBible'],
  ['su-that', 'canonTruth'],
  ['outline', 'outlineBoard'],
  ['characters', 'characterHub'],
  ['world', 'worldLore'],
  ['editor', 'sceneEditor'],
  ['settings', 'settings'],
  ['cloud-sync', 'cloudSync'],
  ['chat', 'projectChat'],
  ['prompts', 'projectPromptManager'],
  ['style-importer', 'styleImporter'],
  ['writing-debug', 'writingRequestDebugger'],
  ['prompt-manager', 'storyCreationSettings'],
  ['timeline', 'timelineThread'],
  ['revision', 'revisionQA'],
  ['style-lab', 'styleLab'],
  ['lab', 'narrativeLab'],
  ['lab-lite', 'labLite'],
  ['corpus-lab', 'corpusLab'],
  ['corpus-lab/viewer', 'analysisViewer'],
]);

export function lazyRoute(routeId) {
  const load = routeLoaders[routeId];
  if (!load) throw new Error(`Unknown route module: ${routeId}`);
  return React.lazy(load);
}

export function shouldPrefetchRoutes(connection = globalThis.navigator?.connection) {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !String(connection.effectiveType || '').includes('2g');
}

export function getRouteIdFromPath(pathname) {
  const cleanPath = String(pathname || '').split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
  if (cleanPath === '/translator') return null;
  const projectMatch = cleanPath.match(/^\/project\/[^/]+\/(.+)$/);
  if (projectMatch) return projectRouteIds.get(projectMatch[1]) || null;
  return rootRouteIds.get(cleanPath) || null;
}

export function prefetchRouteFromPath(pathname, connection) {
  if (!shouldPrefetchRoutes(connection)) return Promise.resolve(false);
  const routeId = getRouteIdFromPath(pathname);
  if (!routeId) return Promise.resolve(false);

  const loads = [routeLoaders[routeId]()];
  if (String(pathname).startsWith('/project/')) {
    loads.unshift(routeLoaders.projectLayout());
  }

  return Promise.all(loads).then(() => true).catch(() => false);
}
