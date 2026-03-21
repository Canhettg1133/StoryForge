import React, { useState, useCallback } from 'react';
import ChapterList from '../../components/common/ChapterList';
import StoryEditor from '../../components/editor/StoryEditor';
import AISidebar from '../../components/ai/AISidebar';
import useProjectStore from '../../stores/projectStore';
import useUIStore from '../../stores/uiStore';
import { useNavigate } from 'react-router-dom';
import { BookOpen, PanelRightOpen, PanelRightClose } from 'lucide-react';
import './SceneEditor.css';

export default function SceneEditor() {
  const { currentProject } = useProjectStore();
  const { rightPanelOpen, toggleRightPanel } = useUIStore();
  const navigate = useNavigate();
  const [editorInstance, setEditorInstance] = useState(null);

  const handleEditorReady = useCallback((editor) => {
    setEditorInstance(editor);
  }, []);

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
    <div className="scene-editor-layout">
      <ChapterList />
      <div className="scene-editor-main">
        {/* AI toggle button */}
        <button
          className="ai-toggle-btn btn btn-ghost btn-icon"
          onClick={toggleRightPanel}
          title={rightPanelOpen ? 'Ẩn AI' : 'Mở AI'}
        >
          {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
        <StoryEditor onEditorReady={handleEditorReady} />
      </div>
      {rightPanelOpen && <AISidebar editor={editorInstance} />}
    </div>
  );
}
