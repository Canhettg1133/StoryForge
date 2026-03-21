import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/common/AppLayout';
import Dashboard from './pages/Dashboard/Dashboard';
import StoryBible from './pages/StoryBible/StoryBible';
import OutlineBoard from './pages/OutlineBoard/OutlineBoard';
import CharacterHub from './pages/CharacterHub/CharacterHub';
import WorldLore from './pages/WorldLore/WorldLore';
import SceneEditor from './pages/SceneEditor/SceneEditor';
import TimelineThread from './pages/TimelineThread/TimelineThread';
import RevisionQA from './pages/RevisionQA/RevisionQA';
import StyleLab from './pages/StyleLab/StyleLab';
import Settings from './pages/Settings/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/story-bible" element={<StoryBible />} />
          <Route path="/outline" element={<OutlineBoard />} />
          <Route path="/characters" element={<CharacterHub />} />
          <Route path="/world" element={<WorldLore />} />
          <Route path="/editor" element={<SceneEditor />} />
          <Route path="/timeline" element={<TimelineThread />} />
          <Route path="/revision" element={<RevisionQA />} />
          <Route path="/style-lab" element={<StyleLab />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
