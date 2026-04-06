/**
 * ViewToggle - Switch between different view modes
 */

export const VIEW_ICONS = {
  knowledge: '🧭',
  incidents: '📍',
  list: '📋',
  review: '🧪',
  mindmap: '🗺️',
  timeline: '🕒',
  graph: '👥',
  compare: '⚖️',
};

export const VIEW_LABELS = {
  knowledge: 'Tri thức',
  incidents: 'Sự kiện lớn',
  list: 'Danh sách',
  review: 'Review queue',
  mindmap: 'Sơ đồ tư duy',
  timeline: 'Dòng thời gian',
  graph: 'Story Graph',
  compare: 'So sánh',
};

const DEFAULT_MODES = ['knowledge', 'incidents', 'list', 'review', 'mindmap', 'timeline', 'graph', 'compare'];

export default function ViewToggle({ view, onChange, modes = DEFAULT_MODES }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="Chế độ xem">
      {modes.map((mode) => (
        <button
          key={mode}
          role="tab"
          aria-selected={view === mode}
          className={`view-toggle-btn ${view === mode ? 'active' : ''}`}
          onClick={() => onChange(mode)}
          title={VIEW_LABELS[mode] || mode}
        >
          <span className="view-toggle-icon">{VIEW_ICONS[mode] || '◉'}</span>
          <span className="view-toggle-label">{VIEW_LABELS[mode] || mode}</span>
        </button>
      ))}
    </div>
  );
}
