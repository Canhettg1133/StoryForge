/**
 * useCharacterGraph - Hook for CharacterGraph interactions
 * Force-directed layout using D3-force concepts (simplified)
 */

import { useCallback, useMemo, useRef, useState } from 'react';

export default function useCharacterGraph({ data, onNodeClick }) {
  const containerRef = useRef(null);

  // Layout state (simulated force-directed)
  const [positions, setPositions] = useState({});
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Initialize positions if not set
  useMemo(() => {
    if (!data?.nodes?.length || Object.keys(positions).length > 0) return;

    const width = 800;
    const height = 600;
    const cx = width / 2;
    const cy = height / 2;

    const initial = {};
    data.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / data.nodes.length;
      const r = Math.min(width, height) * 0.3;
      initial[node.id] = {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      };
    });
    setPositions(initial);
  }, [data]);

  // Layout using force simulation (simplified)
  const layout = useMemo(() => {
    if (!data?.nodes?.length || Object.keys(positions).length === 0) return null;

    return {
      nodes: data.nodes.map((node) => ({
        ...node,
        x: positions[node.id]?.x || 400,
        y: positions[node.id]?.y || 300,
        size: Math.max(24, Math.min(56, 24 + (node.appearances || 0) * 0.8)),
      })),
      edges: data.edges || [],
    };
  }, [data, positions]);

  // Node interactions
  const handleNodeClick = useCallback((node, event) => {
    event?.stopPropagation();
    setSelectedNode(node);
    onNodeClick?.(node);
  }, [onNodeClick]);

  const handleNodeMouseEnter = useCallback((node) => {
    setHoveredNode(node);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

  // Drag node
  const handleNodeDragStart = useCallback((node, clientX, clientY) => {
    setDraggingNode(node.id);
    dragStart.current = { x: clientX, y: clientY };
  }, []);

  const handleNodeDrag = useCallback((clientX, clientY) => {
    if (!draggingNode) return;

    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;

    setPositions((prev) => ({
      ...prev,
      [draggingNode]: {
        x: (prev[draggingNode]?.x || 0) + dx,
        y: (prev[draggingNode]?.y || 0) + dy,
      },
    }));

    dragStart.current = { x: clientX, y: clientY };
  }, [draggingNode]);

  const handleNodeDragEnd = useCallback(() => {
    setDraggingNode(null);
  }, []);

  // Reset layout
  const resetLayout = useCallback(() => {
    setPositions({});
  }, []);

  // Get connected nodes/edges for hovered/selected node
  const getConnections = useCallback((nodeId) => {
    if (!layout) return { nodes: [], edges: [] };

    const connectedEdgeIds = new Set();
    const connectedNodeIds = new Set([nodeId]);

    for (const edge of layout.edges) {
      if (edge.source === nodeId || edge.target === nodeId || edge.source?.id === nodeId || edge.target?.id === nodeId) {
        connectedEdgeIds.add(edge.id);
        const other = edge.source === nodeId || edge.source?.id === nodeId
          ? (typeof edge.target === 'string' ? edge.target : edge.target?.id)
          : (typeof edge.source === 'string' ? edge.source : edge.source?.id);
        if (other) connectedNodeIds.add(other);
      }
    }

    return {
      nodes: layout.nodes.filter((n) => connectedNodeIds.has(n.id)),
      edges: layout.edges.filter((e) => connectedEdgeIds.has(e.id)),
    };
  }, [layout]);

  return {
    containerRef,
    layout,
    selectedNode,
    hoveredNode,
    draggingNode,
    dragging,
    handleNodeClick,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragEnd,
    resetLayout,
    getConnections,
  };
}
