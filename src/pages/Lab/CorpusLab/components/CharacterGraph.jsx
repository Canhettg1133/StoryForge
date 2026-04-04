/**
 * CharacterGraph - Character relationship graph visualization
 * Force-directed layout with node size by appearances
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import useCharacterGraph from '../hooks/useCharacterGraph.js';
import { exportElementAsPNG, exportSVGFile } from '../../../../services/viewer/exportPNG.js';

const EDGE_STYLES = {
  allies: { color: '#3b82f6', dashArray: null },
  enemies: { color: '#ef4444', dashArray: null },
  romantic: { color: '#ec4899', dashArray: null },
  neutral: { color: '#9ca3af', dashArray: '5,5' },
};

const EDGE_LABELS = {
  allies: 'Đồng minh',
  enemies: 'Đối địch',
  romantic: 'Tình cảm',
  neutral: 'Trung lập',
};

export default function CharacterGraph({
  data,
  events,
  selectedIds,
  onNodeClick,
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [exporting, setExporting] = useState(false);

  const {
    layout,
    selectedNode,
    hoveredNode,
    draggingNode,
    handleNodeClick,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragEnd,
    resetLayout,
    getConnections,
  } = useCharacterGraph({ data, onNodeClick });

  const handleExportPNG = async () => {
    if (!svgRef.current) return;
    setExporting(true);
    try {
      await exportElementAsPNG(svgRef.current, {
        filename: `character-graph-${Date.now()}.png`,
        scale: 2,
        padding: 40,
      });
    } catch (err) {
      console.error('Export PNG failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSVG = () => {
    if (!svgRef.current) return;
    try {
      exportSVGFile(svgRef.current, { filename: `character-graph-${Date.now()}.svg` });
    } catch (err) {
      console.error('Export SVG failed:', err);
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (draggingNode) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        handleNodeDrag(e.clientX, e.clientY);
      }
    }
  }, [draggingNode, handleNodeDrag]);

  const handleMouseUp = useCallback(() => {
    if (draggingNode) {
      handleNodeDragEnd();
    }
  }, [draggingNode, handleNodeDragEnd]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  if (!data?.nodes?.length) {
    return (
      <div className="character-graph-empty">
        <div className="empty-icon">👥</div>
        <h3>Không có dữ liệu nhân vật</h3>
        <p>Hãy chạy phân tích đầy đủ để xem quan hệ nhân vật.</p>
      </div>
    );
  }

  const activeNode = hoveredNode || selectedNode;
  const connections = activeNode ? getConnections(activeNode.id) : null;

  // Determine which nodes/edges to highlight
  const highlightNodeIds = connections
    ? new Set(connections.nodes.map((n) => n.id))
    : null;
  const highlightEdgeIds = connections
    ? new Set(connections.edges.map((e) => e.id))
    : null;

  return (
    <div className="character-graph">
      {/* Toolbar */}
      <div className="graph-toolbar">
        <span className="graph-title">Quan hệ nhân vật</span>
        <div className="graph-legend">
          {Object.entries(EDGE_STYLES).map(([type, style]) => (
            <span key={type} className="legend-item">
              <svg width="20" height="4">
                <line
                  x1="0" y1="2" x2="20" y2="2"
                  stroke={style.color}
                  strokeWidth="2"
                  strokeDasharray={style.dashArray}
                />
              </svg>
              {EDGE_LABELS[type] || type}
            </span>
          ))}
        </div>
        <button className="graph-reset-btn" onClick={resetLayout}>
          Đặt lại bố cục
        </button>
        <button
          className="graph-reset-btn"
          onClick={handleExportPNG}
          disabled={exporting}
          title="Xuất PNG"
        >
          📷 PNG
        </button>
        <button
          className="graph-reset-btn"
          onClick={handleExportSVG}
          title="Xuất SVG"
        >
          🖼️ SVG
        </button>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="graph-container"
        onMouseUp={handleMouseUp}
      >
        <svg ref={svgRef} className="graph-svg" width="100%" height="100%">
          {/* Edges */}
          <g className="edges">
            {(layout?.edges || []).map((edge) => {
              const sourceNode = layout.nodes.find(
                (n) => n.id === (typeof edge.source === 'string' ? edge.source : edge.source?.id)
              );
              const targetNode = layout.nodes.find(
                (n) => n.id === (typeof edge.target === 'string' ? edge.target : edge.target?.id)
              );
              if (!sourceNode || !targetNode) return null;

              const isHighlighted = highlightEdgeIds?.has(edge.id);
              const style = EDGE_STYLES[edge.type] || EDGE_STYLES.neutral;

              return (
                <g key={edge.id} className="edge">
                  {/* Thicker invisible edge for easier hover */}
                  <line
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke="transparent"
                    strokeWidth="12"
                  />
                  <line
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke={isHighlighted ? style.color : '#475569'}
                    strokeWidth={isHighlighted ? 3 : 1.5}
                    strokeDasharray={style.dashArray}
                    opacity={highlightEdgeIds && !isHighlighted ? 0.2 : 1}
                  />
                  {/* Relationship label */}
                  {isHighlighted && (
                    <text
                      x={(sourceNode.x + targetNode.x) / 2}
                      y={(sourceNode.y + targetNode.y) / 2 - 8}
                      textAnchor="middle"
                      fill={style.color}
                      fontSize="11"
                    >
                      {(EDGE_LABELS[edge.type] || edge.type)} ({edge.interactions})
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Nodes */}
          <g className="nodes">
            {(layout?.nodes || []).map((node) => {
              const isHighlighted = highlightNodeIds
                ? highlightNodeIds.has(node.id)
                : true;
              const isActive = activeNode?.id === node.id;

              return (
                <g
                  key={node.id}
                  className={`node ${isActive ? 'active' : ''}`}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNodeClick(node, e);
                  }}
                  onMouseEnter={() => handleNodeMouseEnter(node)}
                  onMouseLeave={handleNodeMouseLeave}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleNodeDragStart(node, e.clientX, e.clientY);
                  }}
                  style={{ cursor: 'grab' }}
                >
                  {/* Node circle */}
                  <circle
                    r={node.size / 2}
                    fill={node.color || '#6366f1'}
                    stroke={isActive ? '#fff' : '#1e293b'}
                    strokeWidth={isActive ? 3 : 2}
                    opacity={highlightNodeIds && !isHighlighted ? 0.25 : 1}
                  />

                  {/* POV indicator */}
                  {node.mainPOV && (
                    <circle
                      r={node.size / 2 + 4}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2"
                      strokeDasharray="4,2"
                    />
                  )}

                  {/* Node label */}
                  <text
                    textAnchor="middle"
                    dy={`${node.size / 2 + 16}px`}
                    fill="#e2e8f0"
                    fontSize="12"
                    fontWeight="500"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.name?.substring(0, 15)}
                  </text>

                  {/* Appearances badge */}
                  <text
                    textAnchor="middle"
                    dy="4px"
                    fill="#fff"
                    fontSize="11"
                    fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.appearances || 0}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="graph-tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <strong>{tooltip.name}</strong>
            <span>Số lần xuất hiện: {tooltip.appearances}</span>
            {tooltip.role && <span>Vai trò: {tooltip.role}</span>}
          </div>
        )}

        {/* Legend / info panel */}
        {activeNode && (
          <div className="graph-node-info">
            <h4>{activeNode.name}</h4>
            <div className="info-row">
              <span>Số lần xuất hiện:</span>
              <strong>{activeNode.appearances || 0}</strong>
            </div>
            {activeNode.role && (
              <div className="info-row">
                <span>Vai trò:</span>
                <strong>{activeNode.role}</strong>
              </div>
            )}
            {activeNode.mainPOV && (
              <div className="info-row">
                <span>POV:</span>
                <strong>POV chính</strong>
              </div>
            )}
            <div className="info-connections">
              <span>Kết nối: {connections?.edges?.length || 0}</span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {(!layout?.nodes || layout.nodes.length === 0) && (
          <div className="graph-empty">
            <p>Không có dữ liệu nhân vật.</p>
          </div>
        )}
      </div>
    </div>
  );
}
