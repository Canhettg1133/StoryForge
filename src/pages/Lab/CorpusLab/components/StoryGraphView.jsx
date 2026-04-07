import { useMemo, useState } from 'react';

function prettyType(value) {
  const normalized = String(value || '').trim();
  const labels = {
    incident: 'Sự kiện lớn',
    event: 'Nhịp',
    character: 'Nhân vật',
    location: 'Địa điểm',
    object: 'Vật phẩm',
    term: 'Thuật ngữ',
    causal: 'Nhân quả',
    character_state: 'Trạng thái nhân vật',
    location_transition: 'Dịch chuyển địa điểm',
    incident_precedes_incident: 'liền trước',
    incident_causes_incident: 'gây ra',
    incident_occurs_at_location: 'xảy ra tại',
    event_causes_event: 'gây ra',
    event_occurs_at_location: 'xảy ra tại',
    character_present_in_event: 'tham gia nhịp',
    character_related_to_character: 'liên hệ',
    object_used_in_event: 'được dùng trong nhịp',
  };
  return labels[normalized] || normalized.replace(/_/g, ' ').trim() || 'chưa rõ';
}

function buildTrustBadges(node) {
  const provenance = node?.provenance || {};
  const badges = [];
  if (provenance.grounded || Array.isArray(provenance.evidenceRefs) && provenance.evidenceRefs.length > 0) {
    badges.push('Có grounding');
  }
  if (provenance.aiValidated || provenance.sourcePass) {
    badges.push('AI đã kiểm');
  }
  if (provenance.repaired || provenance.schemaRepaired) {
    badges.push('Đã sửa schema');
  }
  if (provenance.fallback || provenance.fallbackUsed) {
    badges.push('Dùng fallback');
  }
  if (String(provenance.reviewStatus || '').toLowerCase() === 'needs_review') {
    badges.push('Cần duyệt');
  }
  return badges;
}

export default function StoryGraphView({ graph }) {
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [graphKind, setGraphKind] = useState('incident');

  const projectionKinds = useMemo(() => {
    if (graph?.projections && typeof graph.projections === 'object') {
      return Object.entries(graph.projections)
        .filter(([, projection]) => (
          (Array.isArray(projection?.nodes) ? projection.nodes.length : 0) > 0
          || (Array.isArray(projection?.edges) ? projection.edges.length : 0) > 0
        ))
        .map(([kind]) => kind);
    }
    const kinds = new Set(
      (Array.isArray(graph?.edges) ? graph.edges : [])
        .map((edge) => edge.graphKind || edge.graph_kind)
        .filter(Boolean),
    );
    return kinds.size ? [...kinds] : ['incident'];
  }, [graph]);

  const nodes = useMemo(() => {
    const source = Array.isArray(graph?.nodes) ? graph.nodes : [];
    if (!source.length) return [];
    const filtered = source.filter((node) => {
      const nodeKind = node.graphKind || node.graph_kind;
      return !nodeKind || nodeKind === graphKind || projectionKinds.length === 1;
    });
    if (graphKind === 'incident') {
      return filtered.filter((node) => String(node.type || '') !== 'event');
    }
    return filtered;
  }, [graph?.nodes, graphKind, projectionKinds.length]);
  const edges = useMemo(() => {
    const source = Array.isArray(graph?.edges) ? graph.edges : [];
    if (!source.length) return [];
    const filtered = source.filter((edge) => {
      const edgeKind = edge.graphKind || edge.graph_kind;
      return !edgeKind || edgeKind === graphKind || projectionKinds.length === 1;
    });
    if (graphKind === 'incident') {
      return filtered.filter((edge) => String(edge.type || '') !== 'incident_contains_event');
    }
    return filtered;
  }, [graph?.edges, graphKind, projectionKinds.length]);
  const nodeLabelById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.label || node.id])),
    [nodes],
  );

  const selected = useMemo(() => {
    const activeNodeId = selectedNodeId || nodes[0]?.id || '';
    if (!activeNodeId) return null;
    const node = nodes.find((item) => item.id === activeNodeId);
    if (!node) return null;
    return {
      node,
      incoming: edges.filter((edge) => edge.to === activeNodeId),
      outgoing: edges.filter((edge) => edge.from === activeNodeId),
      trustBadges: buildTrustBadges(node),
    };
  }, [edges, nodes, selectedNodeId]);

  if (!graph || nodes.length === 0) {
    return (
      <div className="graph-empty">
        <p>Không có đồ thị truyện cho artifact này.</p>
      </div>
    );
  }

  return (
    <div className="story-graph-view">
      <div className="story-graph-sidebar">
        <div className="story-graph-summary">
          <strong>Đồ thị truyện</strong>
          {projectionKinds.length > 1 && (
            <div className="story-graph-badges">
              {projectionKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`story-graph-badge ${graphKind === kind ? 'active' : ''}`}
                  onClick={() => {
                    setGraphKind(kind);
                    setSelectedNodeId('');
                  }}
                >
                  {prettyType(kind)}
                </button>
              ))}
            </div>
          )}
          <span>{nodes.length} nút</span>
          <span>{edges.length} cạnh</span>
        </div>

        <div className="story-graph-node-list">
          {nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={`story-graph-node-btn ${selectedNodeId === node.id ? 'active' : ''}`}
              onClick={() => setSelectedNodeId(node.id)}
            >
              <strong>{node.label}</strong>
              <span>{prettyType(node.type)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="story-graph-detail">
        {!selected && (
          <div className="graph-empty">
            <p>Chọn một nút để xem nguồn gốc và liên kết.</p>
          </div>
        )}

        {selected && (
          <>
            <header className="story-graph-detail-header">
              <strong>{selected.node.label}</strong>
              <span>{prettyType(selected.node.type)}</span>
            </header>

            {selected.trustBadges.length > 0 && (
              <div className="story-graph-badges">
                {selected.trustBadges.map((badge) => (
                  <span key={`${selected.node.id}-${badge}`} className="story-graph-badge">
                    {badge}
                  </span>
                ))}
              </div>
            )}

            <div className="story-graph-detail-meta">
              <span>Tin cậy: {Number(selected.node.confidence || 0).toFixed(2)}</span>
              <span>Pass: {selected.node.provenance?.sourcePass || 'chưa rõ'}</span>
              <span>Review: {selected.node.provenance?.reviewStatus || 'chưa rõ'}</span>
              {selected.node.chapterNumber && <span>Chương: {selected.node.chapterNumber}</span>}
            </div>

            {Array.isArray(selected.node.provenance?.evidenceRefs) && selected.node.provenance.evidenceRefs.length > 0 && (
              <div className="story-graph-evidence">
                <strong>Bằng chứng</strong>
                <ul>
                  {selected.node.provenance.evidenceRefs.map((item, index) => (
                    <li key={`${selected.node.id}-evidence-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="story-graph-relations">
              <div>
                <strong>Đi vào</strong>
                <ul>
                  {selected.incoming.map((edge) => (
                    <li key={edge.id}>
                      {prettyType(edge.type)} {'<-'} {nodeLabelById.get(edge.from) || edge.from}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Đi ra</strong>
                <ul>
                  {selected.outgoing.map((edge) => (
                    <li key={edge.id}>
                      {prettyType(edge.type)} {'->'} {nodeLabelById.get(edge.to) || edge.to}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
