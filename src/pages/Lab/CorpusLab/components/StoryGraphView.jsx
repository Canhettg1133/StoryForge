import { useMemo, useState } from 'react';

function prettyType(value) {
  return String(value || '').replace(/_/g, ' ').trim() || 'unknown';
}

function buildTrustBadges(node) {
  const provenance = node?.provenance || {};
  const badges = [];
  if (provenance.grounded || Array.isArray(provenance.evidenceRefs) && provenance.evidenceRefs.length > 0) {
    badges.push('Grounded');
  }
  if (provenance.aiValidated || provenance.sourcePass) {
    badges.push('AI Validated');
  }
  if (provenance.repaired || provenance.schemaRepaired) {
    badges.push('Schema Repaired');
  }
  if (provenance.fallback || provenance.fallbackUsed) {
    badges.push('Fallback');
  }
  if (String(provenance.reviewStatus || '').toLowerCase() === 'needs_review') {
    badges.push('Needs Review');
  }
  return badges;
}

export default function StoryGraphView({ graph }) {
  const [selectedNodeId, setSelectedNodeId] = useState('');

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
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
        <p>Khong co story graph cho artifact nay.</p>
      </div>
    );
  }

  return (
    <div className="story-graph-view">
      <div className="story-graph-sidebar">
        <div className="story-graph-summary">
          <strong>Story Graph</strong>
          <span>{graph.summary?.nodeCount || nodes.length} nodes</span>
          <span>{graph.summary?.edgeCount || edges.length} edges</span>
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
            <p>Chon mot node de xem provenance va lien ket.</p>
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
              <span>Confidence: {Number(selected.node.confidence || 0).toFixed(2)}</span>
              <span>Source pass: {selected.node.provenance?.sourcePass || 'unknown'}</span>
              <span>Review: {selected.node.provenance?.reviewStatus || 'unknown'}</span>
              {selected.node.chapterNumber && <span>Chapter: {selected.node.chapterNumber}</span>}
            </div>

            {Array.isArray(selected.node.provenance?.evidenceRefs) && selected.node.provenance.evidenceRefs.length > 0 && (
              <div className="story-graph-evidence">
                <strong>Evidence</strong>
                <ul>
                  {selected.node.provenance.evidenceRefs.map((item, index) => (
                    <li key={`${selected.node.id}-evidence-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="story-graph-relations">
              <div>
                <strong>Incoming</strong>
                <ul>
                  {selected.incoming.map((edge) => (
                    <li key={edge.id}>
                      {prettyType(edge.type)} {'<-'} {nodeLabelById.get(edge.from) || edge.from}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Outgoing</strong>
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
