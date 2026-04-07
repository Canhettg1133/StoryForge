export default function ArtifactDebugView({ artifact, windows = [] }) {
  if (!artifact) {
    return (
      <div className="graph-empty">
        <p>Artifact V3 chưa sẵn sàng cho run này.</p>
      </div>
    );
  }

  return (
    <div className="knowledge-view">
      <section className="knowledge-section">
        <div className="knowledge-section-head">
          <h3>Artifact V3</h3>
          <span>{artifact.artifactVersion || artifact.artifact_version || 'v3'}</span>
        </div>
        <div className="knowledge-card">
          <p><strong>Cửa sổ:</strong> {windows.length || artifact.analysisWindows?.length || 0}</p>
          <p><strong>Sự kiện lớn:</strong> {artifact.incidents?.length || 0}</p>
          <p><strong>Nhịp:</strong> {artifact.incidentBeats?.length || 0}</p>
          <p><strong>Lượt nhắc:</strong> {artifact.entityMentions?.length || 0}</p>
          <p><strong>Mục review:</strong> {artifact.reviewQueue?.length || 0}</p>
        </div>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-section-head">
          <h3>Cửa sổ</h3>
          <span>{windows.length}</span>
        </div>
        <div className="knowledge-grid">
          {windows.map((window) => (
            <article key={window.id || window.windowId} className="knowledge-card">
              <p><strong>ID:</strong> {window.windowId}</p>
              <p><strong>Chương:</strong> {window.chapterStart} - {window.chapterEnd}</p>
              <p><strong>Trạng thái:</strong> {window.status || 'chưa rõ'}</p>
              <p><strong>Carry vào:</strong> {Array.isArray(window.carryIn) ? window.carryIn.length : 0}</p>
              <p><strong>Carry ra:</strong> {Array.isArray(window.carryOut) ? window.carryOut.length : 0}</p>
              <p><strong>Biên mở:</strong> {window.openBoundaries?.length || 0}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-section-head">
          <h3>Dữ liệu thô</h3>
          <span>JSON</span>
        </div>
        <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 480 }}>
          {JSON.stringify(artifact, null, 2)}
        </pre>
      </section>
    </div>
  );
}
