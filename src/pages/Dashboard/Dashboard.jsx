import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import { getGenreEmoji, getGenreLabel, formatDate } from '../../utils/constants';
import {
  Plus,
  BookOpen,
  Trash2,
  MoreVertical,
  Download,
  Languages,
  MessageSquare,
  BookKey,
} from 'lucide-react';
import NewProjectModal from './NewProjectModal';
import ExportModal from '../../components/common/ExportModal';
import './Dashboard.css';

const UTILITY_ITEMS = [
  {
    id: 'global-chat',
    title: 'Chat tự do',
    description: 'Hỏi AI, brainstorm hoặc làm nhanh mà không cần mở dự án.',
    icon: MessageSquare,
    path: '/ai-chat',
  },
  {
    id: 'translator',
    title: 'Dịch truyện',
    description: 'Công cụ dịch độc lập, không tạo project mới và không chen vào danh sách truyện.',
    icon: Languages,
    path: '/translator',
  },
  {
    id: 'guide',
    title: 'Hướng dẫn Gemini',
    description: 'Xem từng bước lấy API key Gemini và setup StoryForge cho người mới.',
    icon: BookKey,
    path: '/guide',
  },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { projects, loadProjects, loadProject, deleteProject } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [exportingProject, setExportingProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleOpenProject = async (id) => {
    await loadProject(id);
    navigate(`/project/${id}/editor`);
  };

  const handleDeleteProject = async (id, event) => {
    event.stopPropagation();
    if (window.confirm('Bạn chắc chắn muốn xóa dự án này? Tất cả dữ liệu sẽ bị mất.')) {
      await deleteProject(id);
    }
    setContextMenu(null);
  };

  const handleProjectCreated = async (id) => {
    setShowModal(false);
    await loadProject(id);
    navigate(`/project/${id}/editor`);
  };

  const filteredProjects = projects.filter((project) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      project.title,
      project.description,
      getGenreLabel(project.genre_primary),
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });

  return (
    <div className="dashboard">
      <header className="dashboard-header animate-fade-in">
        <div>
          <h1 className="dashboard-title">
            <span className="dashboard-title-icon">SF</span>
            StoryForge
          </h1>
          <p className="dashboard-subtitle">
            Tạo dự án để bắt đầu viết truyện, hoặc dùng nhanh Chat AI và Dịch truyện khi chưa cần mở project.
          </p>
        </div>
      </header>

      <div className="dashboard-mobile-search">
        <input
          className="input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Tìm truyện..."
        />
      </div>

      <div className="dashboard-content">
        <section className="dashboard-tools card animate-slide-up">
          <div className="dashboard-tools__grid">
            {UTILITY_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="dashboard-tool-card"
                  onClick={() => navigate(item.path)}
                >
                  <div className="dashboard-tool-card__icon">
                    <Icon size={22} />
                  </div>
                  <div className="dashboard-tool-card__content">
                    <div className="dashboard-tool-card__title-row">
                      <strong>{item.title}</strong>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="dashboard-projects">
          <div className="dashboard-projects__header">
            <div>
              <h2>Dự án truyện</h2>
              <p>Nhấn tạo truyện mới ở thẻ đầu tiên bên dưới để bắt đầu viết, hoặc mở một dự án đang viết để tiếp tục.</p>
            </div>
          </div>

          <div className="project-grid">
            <button className="new-project-card animate-slide-up" onClick={() => setShowModal(true)}>
              <div className="new-project-icon">
                <Plus size={32} />
              </div>
              <div className="new-project-card__content">
                <span className="new-project-label">Tạo truyện mới</span>
                <span className="new-project-hint">Tạo một dự án mới để vào editor, viết truyện, lên dàn ý và quản lý canon.</span>
              </div>
            </button>

            {filteredProjects.map((project, index) => (
              <div
                key={project.id}
                className="project-card card-glass animate-slide-up"
                style={{ animationDelay: `${(index + 1) * 60}ms` }}
                onClick={() => handleOpenProject(project.id)}
              >
                <div className="project-card-header">
                  <span className="project-genre-emoji">{getGenreEmoji(project.genre_primary)}</span>
                  <button
                    className="btn btn-ghost btn-icon btn-sm project-card-menu"
                    onClick={(event) => {
                      event.stopPropagation();
                      setContextMenu(contextMenu === project.id ? null : project.id);
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>
                  {contextMenu === project.id && (
                    <div className="context-menu project-context-menu">
                      <button
                        className="context-menu-item"
                        onClick={(event) => {
                          event.stopPropagation();
                          setContextMenu(null);
                          setExportingProject(project);
                        }}
                      >
                        <Download size={14} /> Xuất bản truyện
                      </button>
                      <button
                        className="context-menu-item danger"
                        onClick={(event) => handleDeleteProject(project.id, event)}
                      >
                        <Trash2 size={14} /> Xóa dự án
                      </button>
                    </div>
                  )}
                </div>

                <h3 className="project-card-title">{project.title}</h3>

                <div className="project-card-meta">
                  <span className="badge badge-accent">{getGenreLabel(project.genre_primary)}</span>
                </div>

                {project.description && (
                  <p className="project-card-desc">{project.description}</p>
                )}

                <div className="project-card-footer">
                  <span className="project-card-date">{formatDate(project.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>

          {projects.length === 0 && (
            <div className="empty-state animate-fade-in">
              <BookOpen size={48} />
              <h3>Chưa có dự án nào</h3>
              <p>Bắt đầu hành trình sáng tác bằng cách tạo truyện mới bên dưới, hoặc thử các công cụ nhanh ở phía trên.</p>
              <button className="btn btn-primary btn-lg" onClick={() => setShowModal(true)}>
                <Plus size={18} /> Tạo truyện mới
              </button>
            </div>
          )}
        </section>
      </div>

      <button className="dashboard-mobile-cta btn btn-primary" onClick={() => setShowModal(true)}>
        <Plus size={18} /> Tạo truyện
      </button>

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreated={handleProjectCreated}
        />
      )}

      {exportingProject && (
        <ExportModal
          project={exportingProject}
          onClose={() => setExportingProject(null)}
        />
      )}
    </div>
  );
}
