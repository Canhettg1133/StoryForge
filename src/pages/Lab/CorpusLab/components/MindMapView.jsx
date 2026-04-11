/**
 * MindMapView - Mind map visualization for events
 * Horizontal tree layout with expand/collapse
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import useMindMap from '../hooks/useMindMap.js';
import { exportElementAsPNG, exportSVGFile } from '../../../../services/viewer/exportPNG.js';

export default function MindMapView({
  data,
  selectedIds,
  onNodeClick,
  onNodeDoubleClick,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const {
    transform,
    zoomIn,
    zoomOut,
    zoomToFit,
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    selectedNode,
    expandedNodes,
    handleNodeExpand,
    handleNodeClick,
    handleNodeDoubleClick,
    handleContextMenu,
    closeContextMenu,
    contextMenu,
    expandAll,
    collapseAll,
    autoLayout,
    nodePositions,
  } = useMindMap({ data, onNodeClick });

  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const layout = autoLayout();

  const handleExportPNG = async () => {
    if (!canvasRef.current) return;
    setExporting(true);
    try {
      await exportElementAsPNG(canvasRef.current, {
        filename: `mindmap-${Date.now()}.png`,
        scale: 2,
        padding: 60,
      });
    } catch (err) {
      console.error('Export PNG failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSVG = () => {
    if (!canvasRef.current) return;
    try {
      exportSVGFile(canvasRef.current, { filename: `mindmap-${Date.now()}.svg` });
    } catch (err) {
      console.error('Export SVG failed:', err);
    }
  };

  const handleMouseDown = useCallback((e) => {
    if (e.target === canvasRef.current || e.target === containerRef.current) {
      dragStart.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
      handlePanStart(e.clientX, e.clientY);
    }
  }, [handlePanStart]);

  const handleMouseMove = useCallback((e) => {
    if (dragging) {
      handlePanMove(e.clientX, e.clientY);
    }
  }, [dragging, handlePanMove]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    handlePanEnd();
  }, [handlePanEnd]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => closeContextMenu();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [closeContextMenu]);

  const renderNode = (node, depth = 0) => {
    if (!node) return null;

    const isRoot = node.id === 'root';
    const isCategory = node.type === 'category';
    const pos = nodePositions[node.id] || { x: 0, y: 0 };
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isSelectedEvent = node.data && selectedIds.has(node.data.id);

    const nodeStyle = {
      position: 'absolute',
      left: pos.x,
      top: pos.y,
      transform: `translate(-50%, -50%)`,
      zIndex: isSelected || isSelectedEvent ? 10 : 1,
    };

    return (
      <div key={node.id}>
        {/* Node */}
        <div
          className={`mindmap-node ${isRoot ? 'root' : ''} ${isCategory ? 'category' : ''} ${isSelected || isSelectedEvent ? 'selected' : ''} ${node.type === 'event' ? 'event' : ''}`}
          style={{
            ...nodeStyle,
            borderColor: node.color || '#9ca3af',
            backgroundColor: isRoot ? '#1e293b' : isCategory ? '#334155' : undefined,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              handleNodeExpand(node.id);
            }
            handleNodeClick(node, e);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            handleNodeDoubleClick(node);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleContextMenu(node, e);
          }}
        >
          {hasChildren && (
            <span className="expand-indicator">
              {isExpanded ? '▾' : '▸'}
            </span>
          )}
          <span className="node-label">{node.label}</span>
          {node.data?.emotionalIntensity && (
            <span className="node-intensity">
              🔥{node.data.emotionalIntensity}
            </span>
          )}
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="mindmap-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}

        {/* Connector lines */}
        {hasChildren && (
          <svg className="mindmap-connectors">
            <line
              x1={pos.x}
              y1={pos.y}
              x2={pos.x + 120}
              y2={pos.y}
              stroke="#475569"
              strokeWidth="2"
            />
          </svg>
        )}
      </div>
    );
  };

  return (
    <div className="mindmap-view">
      {/* Toolbar */}
      <div className="mindmap-toolbar">
        <button onClick={zoomIn} title="Phóng to">＋</button>
        <button onClick={zoomOut} title="Thu nhỏ">－</button>
        <button onClick={zoomToFit} title="Vừa màn hình">⊡</button>
        <div className="toolbar-separator" />
        <button onClick={expandAll} title="Mở rộng tất cả">Mở rộng tất cả</button>
        <button onClick={collapseAll} title="Thu gọn tất cả">Thu gọn tất cả</button>
        <div className="toolbar-separator" />
        <button
          onClick={handleExportPNG}
          disabled={exporting}
          title="Xuất PNG"
        >
          📷 PNG
        </button>
        <button
          onClick={handleExportSVG}
          title="Xuất SVG (vector)"
        >
          🖼️ SVG
        </button>
        <span className="zoom-level">{Math.round(transform.scale * 100)}%</span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`mindmap-container ${dragging ? 'dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          ref={canvasRef}
          className="mindmap-canvas"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {layout && renderNode(layout)}
        </div>

        {/* Empty state */}
        {(!data || !data.children || data.children.length === 0) && (
          <div className="mindmap-empty">
            <div className="empty-icon">🗺️</div>
            <p>Không có sự kiện để hiển thị trong sơ đồ tư duy.</p>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="mindmap-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => {
            if (contextMenu.node.data) {
              onNodeClick?.(contextMenu.node.data);
            }
            closeContextMenu();
          }}>
            Chọn
          </button>
          <button onClick={() => {
            if (contextMenu.node.data) {
              onNodeDoubleClick?.(contextMenu.node.data);
            }
            closeContextMenu();
          }}>
            Chỉnh sửa
          </button>
          <button onClick={closeContextMenu}>Hủy</button>
        </div>
      )}
    </div>
  );
}
