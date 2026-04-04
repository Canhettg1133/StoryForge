/**
 * useMindMap - Hook for MindMap interactions
 * Handles zoom, pan, node expansion, drag
 */

import { useCallback, useMemo, useRef, useState } from 'react';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;

export default function useMindMap({ data, onNodeClick, onNodeExpand, onNodeCollapse }) {
  const containerRef = useRef(null);

  // Transform state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

  // Expanded nodes
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // Selected node
  const [selectedNode, setSelectedNode] = useState(null);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNode, setDraggedNode] = useState(null);
  const dragStartRef = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });

  // Panning state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // Zoom
  const zoomIn = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.min(MAX_ZOOM, prev.scale + ZOOM_STEP),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.max(MIN_ZOOM, prev.scale - ZOOM_STEP),
    }));
  }, []);

  const zoomToFit = useCallback(() => {
    if (!containerRef.current || !data?.children?.length) return;

    setTransform({ x: 0, y: 0, scale: 1 });
  }, [data]);

  const zoomTo = useCallback((scale) => {
    setTransform(prev => ({
      ...prev,
      scale: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale)),
    }));
  }, []);

  // Pan
  const handlePanStart = useCallback((clientX, clientY) => {
    setIsPanning(true);
    panStartRef.current = {
      x: clientX,
      y: clientY,
      tx: transform.x,
      ty: transform.y,
    };
  }, [transform.x, transform.y]);

  const handlePanMove = useCallback((clientX, clientY) => {
    if (!isPanning) return;

    const dx = clientX - panStartRef.current.x;
    const dy = clientY - panStartRef.current.y;

    setTransform(prev => ({
      ...prev,
      x: panStartRef.current.tx + dx,
      y: panStartRef.current.ty + dy,
    }));
  }, [isPanning]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((event) => {
    // React may attach wheel listeners as passive in some environments.
    // Guard preventDefault to avoid runtime warnings.
    if (event.cancelable) {
      event.preventDefault();
    }
    const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setTransform(prev => ({
      ...prev,
      scale: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.scale + delta)),
    }));
  }, []);

  // Node click
  const handleNodeClick = useCallback((node, event) => {
    event?.stopPropagation?.();
    setSelectedNode(node);
    onNodeClick?.(node, event);
  }, [onNodeClick]);

  // Node expand/collapse
  const handleNodeExpand = useCallback((nodeId) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        onNodeCollapse?.(nodeId);
      } else {
        next.add(nodeId);
        onNodeExpand?.(nodeId);
      }
      return next;
    });
  }, [onNodeExpand, onNodeCollapse]);

  const expandAll = useCallback(() => {
    if (!data) return;
    const allIds = collectAllNodeIds(data);
    setExpandedNodes(new Set(allIds));
  }, [data]);

  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  // Node drag
  const handleNodeDragStart = useCallback((node, clientX, clientY) => {
    setIsDragging(true);
    setDraggedNode(node);
    dragStartRef.current = { x: clientX, y: clientY, nodeX: 0, nodeY: 0 };
  }, []);

  const handleNodeDragMove = useCallback((clientX, clientY) => {
    if (!isDragging || !draggedNode) return;

    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;

    dragStartRef.current.nodeX += dx;
    dragStartRef.current.nodeY += dy;

    // Update node position (would update state in real implementation)
  }, [isDragging, draggedNode]);

  const handleNodeDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedNode(null);
  }, []);

  // Double click - edit
  const handleNodeDoubleClick = useCallback((node) => {
    // Trigger event edit modal
  }, []);

  // Right click - context menu
  const [contextMenu, setContextMenu] = useState(null);

  const handleContextMenu = useCallback((node, event) => {
    event.preventDefault();
    setContextMenu({
      node,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Center on node
  const centerOnNode = useCallback((node) => {
    if (!containerRef.current) return;
    setTransform(prev => ({
      ...prev,
      x: containerRef.current.clientWidth / 2 - (node.x || 0) * prev.scale,
      y: containerRef.current.clientHeight / 2 - (node.y || 0) * prev.scale,
    }));
  }, []);

  // Auto layout (Dagre-like horizontal tree)
  const autoLayout = useCallback(() => {
    if (!data) return data;

    const HORIZONTAL_SPACING = 240;
    const VERTICAL_SPACING = 120;

    const layoutNode = (node, x, y, depth = 0) => {
      const children = node.children || [];
      const childCount = children.length;

      if (childCount === 0) {
        return { ...node, x, y, width: 220, height: 80 };
      }

      const totalHeight = (childCount - 1) * VERTICAL_SPACING;
      const startY = y - totalHeight / 2;

      const layoutedChildren = children.map((child, i) => {
        const childX = x + HORIZONTAL_SPACING;
        const childY = startY + i * VERTICAL_SPACING;
        return layoutNode(child, childX, childY, depth + 1);
      });

      const avgY = layoutedChildren.reduce((sum, c) => sum + c.y, 0) / childCount;

      return {
        ...node,
        x,
        y: avgY,
        width: 220,
        height: 80,
        children: layoutedChildren,
      };
    };

    return layoutNode(data, 100, 300, 0);
  }, [data]);

  // Visible nodes (respecting expanded state)
  const visibleNodes = useMemo(() => {
    if (!data) return [];

    const visible = [];
    const traverse = (node, isExpanded) => {
      visible.push(node);
      if (node.children?.length && isExpanded) {
        for (const child of node.children) {
          traverse(child, expandedNodes.has(child.id));
        }
      }
    };

    traverse(data, true);
    return visible;
  }, [data, expandedNodes]);

  // Node position map for rendering
  const nodePositions = useMemo(() => {
    const positions = {};
    const layouted = autoLayout();
    const collect = (node) => {
      positions[node.id] = { x: node.x || 0, y: node.y || 0 };
      if (node.children?.length && expandedNodes.has(node.id)) {
        for (const child of node.children) {
          collect(child);
        }
      }
    };
    if (layouted) collect(layouted);
    return positions;
  }, [autoLayout, expandedNodes]);

  return {
    // Refs
    containerRef,

    // Transform
    transform,
    setTransform,
    zoomIn,
    zoomOut,
    zoomToFit,
    zoomTo,

    // Pan
    isPanning,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    handleWheel,

    // Nodes
    selectedNode,
    expandedNodes,
    visibleNodes,
    nodePositions,
    autoLayout,

    // Interactions
    handleNodeClick,
    handleNodeExpand,
    handleNodeDoubleClick,
    handleContextMenu,
    handleNodeDragStart,
    handleNodeDragMove,
    handleNodeDragEnd,

    // Helpers
    expandAll,
    collapseAll,
    centerOnNode,
    closeContextMenu,
    contextMenu,
    isDragging,
    draggedNode,
  };
}

// Helper
function collectAllNodeIds(node, ids = []) {
  if (!node) return ids;
  ids.push(node.id);
  if (node.children) {
    for (const child of node.children) {
      collectAllNodeIds(child, ids);
    }
  }
  return ids;
}
