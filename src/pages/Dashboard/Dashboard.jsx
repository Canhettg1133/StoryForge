import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import { getGenreEmoji, getGenreLabel, formatDate, countWords } from '../../utils/constants';
import { Plus, BookOpen, Trash2, MoreVertical, Download, Languages } from 'lucide-react';
import NewProjectModal from './NewProjectModal';
import ExportModal from '../../components/common/ExportModal';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const { projects, loadProjects, loadProject, deleteProject } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [exportingProject, setExportingProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  const handleOpenProject = async (id) => {
    await loadProject(id);
    navigate(`/project/${id}/editor`);
  };

  const handleDeleteProject = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('Bạn chắc chắn muốn xoá dự án này? Tất cả dữ liệu sẽ bị mất.')) {
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
      {/* Header */}
      <header className="dashboard-header animate-fade-in">
        <div>
          <h1 className="dashboard-title">
            <span className="dashboard-title-icon">📖</span>
            StoryForge
          </h1>
          <p className="dashboard-subtitle">Story OS for Novelists — Chọn dự án hoặc bắt đầu truyện mới</p>
        </div>
      </header>

      <div className="dashboard-mobile-search">
        <input
          className="input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Tim truyen..."
        />
      </div>

      {/* Content */}
      <div className="dashboard-content">
        {/* New Project Card */}
        <div className="project-grid">
          <button className="new-project-card animate-slide-up" onClick={() => setShowModal(true)}>
            <div className="new-project-icon">
              <Plus size={32} />
            </div>
            <span className="new-project-label">Truyện mới</span>
          </button>

          <button className="new-project-card new-project-card--utility animate-slide-up" onClick={() => navigate('/translator')}>
            <div className="new-project-icon">
              <Languages size={30} />
            </div>
            <span className="new-project-label">Dá»‹ch truyá»‡n</span>
          </button>

          {/* Project Cards */}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(contextMenu === project.id ? null : project.id);
                  }}
                >
                  <MoreVertical size={14} />
                </button>
                {contextMenu === project.id && (
                  <div className="context-menu project-context-menu">
                    <button className="context-menu-item" onClick={(e) => { e.stopPropagation(); setContextMenu(null); setExportingProject(project); }}>
                      <Download size={14} /> Xuất bản truyện
                    </button>
                    <button className="context-menu-item danger" onClick={(e) => handleDeleteProject(project.id, e)}>
                      <Trash2 size={14} /> Xoá dự án
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

        {/* Empty state */}
        {projects.length === 0 && (
          <div className="empty-state animate-fade-in">
            <BookOpen size={48} />
            <h3>Chưa có dự án nào</h3>
            <p>Bắt đầu hành trình sáng tác bằng cách tạo truyện mới!</p>
            <button className="btn btn-primary btn-lg" onClick={() => setShowModal(true)}>
              <Plus size={18} /> Tạo truyện mới
            </button>
          </div>
        )}
      </div>

      <button className="dashboard-mobile-cta btn btn-primary" onClick={() => setShowModal(true)}>
        <Plus size={18} /> Tao truyen
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
