import { Minus, Plus, RotateCcw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDirection,
  Bounds,
  DiagramNode,
  PALETTE_STYLES,
  PaletteColor,
  Point,
  ShapeNode,
  ToolMode,
} from '../domain/diagramModel';
import {
  boundsCenter,
  clamp,
  computeResizedBounds,
  distance,
  hitTestNode,
  ResizeHandle,
  scaleInkNode,
  updateBoundConnectors,
} from '../domain/geometry';
import {
  canAutoFinalizeSingleStroke,
  isCylinderBodyForCap,
  recognizeStrokeGroup,
  RecognitionResult,
  shouldSplitStrokeGroup,
} from '../domain/recognition';

type Viewport = {
  zoom: number;
  panX: number;
  panY: number;
};

const MIN_ZOOM = 0.002;
const MAX_ZOOM = 8;

function clampZoom(z: number): number {
  return clamp(z, MIN_ZOOM, MAX_ZOOM);
}

function formatZoomPercent(zoom: number): string {
  const pct = zoom * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

type DrawingBoardProps = {
  nodes: DiagramNode[];
  tool: ToolMode;
  activeColor: PaletteColor;
  selectedId: string | null;
  onSelectNode: (id: string | null) => void;
  onCommitRecognition: (result: RecognitionResult, sourceStrokes: Point[][]) => void;
  onAddInk: (strokes: Point[][], color: PaletteColor) => void;
  onMoveNode: (id: string, dx: number, dy: number) => void;
  onResizeNode: (id: string, bounds: Bounds) => void;
  onResizeConnectorEndpoint: (id: string, endpoint: 'start' | 'end', point: Point) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onAddText: (position: Point, text: string, color: PaletteColor) => void;
  onDeleteNode: (id: string) => void;
  statusText: string;
  onStatusChange: (status: string) => void;
};

type EditingTarget =
  | { mode: 'node'; id: string; x: number; y: number; value: string }
  | { mode: 'new-text'; x: number; y: number; value: string };

function pointsToSvgPath(pts: Point[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  return d;
}

function renderShapeSvg(shape: ShapeNode, isSelected: boolean) {
  const { x, y, width, height } = shape.bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const palette = PALETTE_STYLES[shape.color];
  const stroke = palette.stroke;
  const fill = palette.fill;
  const strokeWidth = isSelected ? 2.5 : 2;

  let geometryEl: React.ReactNode;

  switch (shape.kind) {
    case 'terminator':
      geometryEl = (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={Math.min(width, height) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
      break;
    case 'circle':
    case 'ellipse':
      geometryEl = (
        <ellipse
          cx={cx}
          cy={cy}
          rx={Math.max(4, width / 2)}
          ry={Math.max(4, height / 2)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
      break;
    case 'diamond':
      geometryEl = (
        <polygon
          points={`${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      );
      break;
    case 'triangle':
      geometryEl = (
        <polygon
          points={`${cx},${y} ${x + width},${y + height} ${x},${y + height}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      );
      break;
    case 'parallelogram': {
      const skew = Math.min(24, width * 0.16);
      geometryEl = (
        <polygon
          points={`${x + skew},${y} ${x + width},${y} ${x + width - skew},${y + height} ${x},${y + height}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      );
      break;
    }
    case 'database': {
      const rx = Math.max(8, width / 2);
      const ry = Math.min(14, Math.max(7, height * 0.17));
      const topY = y + ry;
      const botY = y + height - ry;
      geometryEl = (
        <g>
          <path
            d={`M ${x} ${topY} L ${x} ${botY} A ${rx} ${ry} 0 0 0 ${x + width} ${botY} L ${x + width} ${topY} Z`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          <ellipse
            cx={cx}
            cy={topY}
            rx={rx}
            ry={ry}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </g>
      );
      break;
    }
    case 'rectangle':
    default:
      geometryEl = (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={5}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
      break;
  }

  const labelY =
    shape.kind === 'triangle'
      ? y + height * 0.68
      : shape.kind === 'database'
        ? y + height * 0.60
        : cy + 5;

  return (
    <g>
      {geometryEl}
      {shape.label && (
        <text
          x={cx}
          y={labelY}
          textAnchor="middle"
          fill={palette.text}
          fontSize={14}
          fontWeight={500}
          className="select-none pointer-events-none"
        >
          {shape.label}
        </text>
      )}
      {isSelected && (
        <rect
          x={x - 5}
          y={y - 5}
          width={width + 10}
          height={height + 10}
          rx={7}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          className="pointer-events-none"
        />
      )}
    </g>
  );
}

const TOOL_HINTS: Record<ToolMode, string> = {
  pen: 'Smart Pen · Draw any shape or arrow',
  ink: 'Pen · Draw regular freehand ink',
  select: 'Select · Drag, resize handles, or double-click to label',
  erase: 'Erase · Click any object to remove it',
  text: 'Text · Click canvas or shape to label',
};

type HandleDef = {
  handle: ResizeHandle;
  x: number;
  y: number;
  cursor: string;
};

function getBoxHandles(bounds: Bounds, pad: number): HandleDef[] {
  const x1 = bounds.x - pad;
  const x2 = bounds.x + bounds.width + pad;
  const y1 = bounds.y - pad;
  const y2 = bounds.y + bounds.height + pad;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return [
    { handle: 'nw', x: x1, y: y1, cursor: 'nwse-resize' },
    { handle: 'n', x: mx, y: y1, cursor: 'ns-resize' },
    { handle: 'ne', x: x2, y: y1, cursor: 'nesw-resize' },
    { handle: 'e', x: x2, y: my, cursor: 'ew-resize' },
    { handle: 'se', x: x2, y: y2, cursor: 'nwse-resize' },
    { handle: 's', x: mx, y: y2, cursor: 'ns-resize' },
    { handle: 'sw', x: x1, y: y2, cursor: 'nesw-resize' },
    { handle: 'w', x: x1, y: my, cursor: 'ew-resize' },
  ];
}

type ResizeState =
  | {
      kind: 'box';
      id: string;
      handle: ResizeHandle;
      startPt: Point;
      initialBounds: Bounds;
      currentBounds: Bounds;
      cursor: string;
    }
  | {
      kind: 'connector';
      id: string;
      endpoint: 'start' | 'end';
      currentPoint: Point;
    };

export function DrawingBoard({
  nodes,
  tool,
  activeColor,
  selectedId,
  onSelectNode,
  onCommitRecognition,
  onAddInk,
  onMoveNode,
  onResizeNode,
  onResizeConnectorEndpoint,
  onUpdateLabel,
  onAddText,
  onDeleteNode,
  statusText,
  onStatusChange,
}: DrawingBoardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const viewportRef = useRef<Viewport>(viewport);
  viewportRef.current = viewport;

  const [spacePressed, setSpacePressed] = useState(false);
  const spacePressedRef = useRef(false);
  spacePressedRef.current = spacePressed;

  const [panState, setPanState] = useState<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
    clearOnTap: boolean;
  } | null>(null);

  const [activeStroke, setActiveStroke] = useState<Point[] | null>(null);
  const [pendingStrokes, setPendingStrokes] = useState<Point[][]>([]);
  const pendingRef = useRef<Point[][]>([]);
  const idleTimerRef = useRef<number | null>(null);
  const activeColorRef = useRef<PaletteColor>(activeColor);
  activeColorRef.current = activeColor;

  const [dragState, setDragState] = useState<{
    id: string;
    startPt: Point;
    dx: number;
    dy: number;
  } | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);

  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const isErasingRef = useRef(false);
  const lastErasePtRef = useRef<Point | null>(null);
  const erasedThisDragRef = useRef<Set<string>>(new Set());
  const wasEditingOnDownRef = useRef(false);

  const zoomAtCenter = useCallback((nextZoom: number) => {
    const svg = svgRef.current;
    const vp = viewportRef.current;
    const clamped = clampZoom(nextZoom);
    if (!svg) {
      setViewport({ ...vp, zoom: clamped });
      return;
    }
    const rect = svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const worldX = (cx - vp.panX) / vp.zoom;
    const worldY = (cy - vp.panY) / vp.zoom;
    setViewport({
      zoom: clamped,
      panX: cx - worldX * clamped,
      panY: cy - worldY * clamped,
    });
  }, []);

  const handleResetView = useCallback(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
    onStatusChange('Reset view to 100%');
  }, [onStatusChange]);

  // Native non-passive wheel listener for smooth Excalidraw-style pinch/Ctrl+wheel zoom and pan
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = viewportRef.current;

      if (e.ctrlKey || e.metaKey) {
        const rect = svg.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0045);
        const nextZoom = clampZoom(vp.zoom * factor);
        const worldX = (sx - vp.panX) / vp.zoom;
        const worldY = (sy - vp.panY) / vp.zoom;
        setViewport({
          zoom: nextZoom,
          panX: sx - worldX * nextZoom,
          panY: sy - worldY * nextZoom,
        });
      } else {
        setViewport({
          zoom: vp.zoom,
          panX: vp.panX - e.deltaX,
          panY: vp.panY - e.deltaY,
        });
      }
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Spacebar panning + Ctrl/Cmd +/-/0 zoom shortcuts
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const target = el as HTMLElement | null;
      return Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomAtCenter(viewportRef.current.zoom * 1.25);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        zoomAtCenter(viewportRef.current.zoom / 1.25);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        setViewport({ zoom: 1, panX: 0, panY: 0 });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    const onBlur = () => setSpacePressed(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [zoomAtCenter]);

  const editingKey = editing
    ? editing.mode === 'node'
      ? `node:${editing.id}`
      : `new:${editing.x}:${editing.y}`
    : null;

  useEffect(() => {
    if (editingKey) {
      const id = requestAnimationFrame(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [editingKey]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const flushPendingStrokes = useCallback(() => {
    clearIdleTimer();
    const strokes = pendingRef.current;
    if (strokes.length === 0) return;
    pendingRef.current = [];
    setPendingStrokes([]);

    const result = recognizeStrokeGroup(strokes, activeColorRef.current);
    onCommitRecognition(result, strokes);
    if (result.type === 'shape') {
      onStatusChange(`Recognized ${result.kind}`);
    } else if (result.type === 'connector') {
      const label =
        result.direction === 'none'
          ? 'line'
          : result.direction === 'double'
            ? 'double arrow'
            : 'arrow';
      onStatusChange(`Recognized ${label}`);
    } else {
      const upgradedCap = nodes.some(
        (n) => n.type === 'shape' && isCylinderBodyForCap(strokes, n) !== null
      );
      onStatusChange(upgradedCap ? 'Recognized database' : 'Kept as freehand ink');
    }
  }, [clearIdleTimer, nodes, onCommitRecognition, onStatusChange]);

  // Flush pending strokes if user switches away from Smart Pen or clears canvas
  useEffect(() => {
    if (tool !== 'pen' && pendingRef.current.length > 0) {
      flushPendingStrokes();
    }
  }, [tool, flushPendingStrokes]);

  useEffect(() => {
    return () => clearIdleTimer();
  }, [clearIdleTimer]);

  const getBoardPoint = useCallback((e: React.PointerEvent | React.MouseEvent): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vp = viewportRef.current;
    return {
      x: (e.clientX - rect.left - vp.panX) / vp.zoom,
      y: (e.clientY - rect.top - vp.panY) / vp.zoom,
    };
  }, []);

  const eraseAlongSegment = useCallback(
    (from: Point, to: Point) => {
      const zoom = viewportRef.current.zoom;
      const dist = distance(from, to);
      const stepSize = Math.max(1, 8 / zoom);
      const steps = Math.max(1, Math.ceil(dist / stepSize));
      const tol = Math.max(4, 14 / zoom);
      let deletedCount = 0;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const sample = {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        };
        const hit = hitTestNode(nodes, sample, tol);
        if (hit && !erasedThisDragRef.current.has(hit.id)) {
          erasedThisDragRef.current.add(hit.id);
          onDeleteNode(hit.id);
          deletedCount++;
        }
      }
      if (deletedCount > 0) {
        onStatusChange('Removed object');
      }
    },
    [nodes, onDeleteNode, onStatusChange]
  );

  const openTextEditorAt = useCallback(
    (pt: Point) => {
      const tol = Math.max(4, 10 / viewportRef.current.zoom);
      const hit = hitTestNode(nodes, pt, tol);
      if (hit && (hit.type === 'shape' || hit.type === 'connector')) {
        const center =
          hit.type === 'shape'
            ? boundsCenter(hit.bounds)
            : {
                x: (hit.start.point.x + hit.end.point.x) / 2,
                y: (hit.start.point.y + hit.end.point.y) / 2,
              };
        onSelectNode(hit.id);
        setEditing({
          mode: 'node',
          id: hit.id,
          x: center.x,
          y: center.y,
          value: hit.label ?? '',
        });
      } else if (hit && hit.type === 'text') {
        onSelectNode(hit.id);
        setEditing({
          mode: 'node',
          id: hit.id,
          x: hit.position.x,
          y: hit.position.y,
          value: hit.text,
        });
      } else {
        setEditing({
          mode: 'new-text',
          x: pt.x,
          y: pt.y,
          value: '',
        });
      }
    },
    [nodes, onSelectNode]
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const isMiddleButton = e.button === 1;
    if (!isMiddleButton && e.button !== 0 && e.pointerType === 'mouse') return;
    wasEditingOnDownRef.current = editing !== null;
    if (editing) return;

    if (isMiddleButton || spacePressedRef.current) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanState({
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: viewportRef.current.panX,
        startPanY: viewportRef.current.panY,
        moved: false,
        clearOnTap: false,
      });
      return;
    }

    const pt = getBoardPoint(e);

    if (tool === 'pen') {
      e.currentTarget.setPointerCapture(e.pointerId);
      clearIdleTimer();

      if (pendingRef.current.length > 0 && shouldSplitStrokeGroup(pendingRef.current, [pt])) {
        flushPendingStrokes();
      }

      setActiveStroke([pt]);
      onStatusChange('Drawing...');
      return;
    }

    if (tool === 'ink') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setActiveStroke([pt]);
      onStatusChange('Drawing ink...');
      return;
    }

    if (tool === 'erase') {
      e.currentTarget.setPointerCapture(e.pointerId);
      isErasingRef.current = true;
      lastErasePtRef.current = pt;
      erasedThisDragRef.current = new Set();
      eraseAlongSegment(pt, pt);
      return;
    }

    if (tool === 'text') {
      // Capture pointer so text editor opens cleanly on pointerup without losing focus
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === 'select') {
      const zoom = viewportRef.current.zoom;
      const handleHitRadius = 11 / zoom;

      // Priority 1: Resize handle of currently selected node
      if (selectedId) {
        const selectedNode = nodes.find((n) => n.id === selectedId);
        if (selectedNode && (selectedNode.type === 'shape' || selectedNode.type === 'ink')) {
          const pad = 5 / zoom;
          const handles = getBoxHandles(selectedNode.bounds, pad);
          const matched = handles.find((h) => distance(pt, { x: h.x, y: h.y }) <= handleHitRadius);
          if (matched) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setResizeState({
              kind: 'box',
              id: selectedNode.id,
              handle: matched.handle,
              startPt: pt,
              initialBounds: selectedNode.bounds,
              currentBounds: selectedNode.bounds,
              cursor: matched.cursor,
            });
            return;
          }
        } else if (selectedNode && selectedNode.type === 'connector') {
          if (distance(pt, selectedNode.start.point) <= handleHitRadius) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setResizeState({
              kind: 'connector',
              id: selectedNode.id,
              endpoint: 'start',
              currentPoint: selectedNode.start.point,
            });
            return;
          }
          if (distance(pt, selectedNode.end.point) <= handleHitRadius) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setResizeState({
              kind: 'connector',
              id: selectedNode.id,
              endpoint: 'end',
              currentPoint: selectedNode.end.point,
            });
            return;
          }
        }
      }

      const tol = Math.max(4, 10 / zoom);
      const hit = hitTestNode(nodes, pt, tol);
      if (hit) {
        onSelectNode(hit.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragState({ id: hit.id, startPt: pt, dx: 0, dy: 0 });
      } else {
        e.currentTarget.setPointerCapture(e.pointerId);
        setPanState({
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPanX: viewportRef.current.panX,
          startPanY: viewportRef.current.panY,
          moved: false,
          clearOnTap: true,
        });
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panState) {
      const dx = e.clientX - panState.startClientX;
      const dy = e.clientY - panState.startClientY;
      const moved = panState.moved || Math.hypot(dx, dy) > 3;
      if (moved !== panState.moved) {
        setPanState((prev) => (prev ? { ...prev, moved: true } : null));
      }
      setViewport((prev) => ({
        ...prev,
        panX: panState.startPanX + dx,
        panY: panState.startPanY + dy,
      }));
      return;
    }

    const pt = getBoardPoint(e);

    if ((tool === 'pen' || tool === 'ink') && activeStroke) {
      const last = activeStroke[activeStroke.length - 1];
      const minStep = Math.max(0.5, 2 / viewportRef.current.zoom);
      if (!last || distance(last, pt) >= minStep) {
        setActiveStroke((prev) => (prev ? [...prev, pt] : [pt]));
      }
      return;
    }

    if (tool === 'erase' && isErasingRef.current) {
      const prev = lastErasePtRef.current ?? pt;
      eraseAlongSegment(prev, pt);
      lastErasePtRef.current = pt;
      return;
    }

    if (tool === 'select' && resizeState) {
      if (resizeState.kind === 'box') {
        const dx = pt.x - resizeState.startPt.x;
        const dy = pt.y - resizeState.startPt.y;
        const nextBounds = computeResizedBounds(
          resizeState.initialBounds,
          resizeState.handle,
          dx,
          dy,
          24
        );
        setResizeState({ ...resizeState, currentBounds: nextBounds });
      } else {
        setResizeState({ ...resizeState, currentPoint: pt });
      }
      return;
    }

    if (tool === 'select' && dragState) {
      setDragState((prev) =>
        prev
          ? {
              ...prev,
              dx: pt.x - prev.startPt.x,
              dy: pt.y - prev.startPt.y,
            }
          : null
      );
      return;
    }

    if (tool === 'select' && selectedId) {
      const zoom = viewportRef.current.zoom;
      const handleHitRadius = 11 / zoom;
      const selectedNode = nodes.find((n) => n.id === selectedId);
      if (selectedNode && (selectedNode.type === 'shape' || selectedNode.type === 'ink')) {
        const pad = 5 / zoom;
        const matched = getBoxHandles(selectedNode.bounds, pad).find(
          (h) => distance(pt, { x: h.x, y: h.y }) <= handleHitRadius
        );
        setHoverCursor(matched ? matched.cursor : null);
      } else if (selectedNode && selectedNode.type === 'connector') {
        const nearEnd =
          distance(pt, selectedNode.start.point) <= handleHitRadius ||
          distance(pt, selectedNode.end.point) <= handleHitRadius;
        setHoverCursor(nearEnd ? 'grab' : null);
      } else {
        setHoverCursor(null);
      }
    } else if (hoverCursor) {
      setHoverCursor(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (panState) {
      if (!panState.moved && panState.clearOnTap) {
        onSelectNode(null);
      }
      setPanState(null);
      return;
    }

    if (tool === 'erase') {
      isErasingRef.current = false;
      lastErasePtRef.current = null;
      erasedThisDragRef.current.clear();
      return;
    }

    if (tool === 'text' && !editing && !wasEditingOnDownRef.current) {
      openTextEditorAt(getBoardPoint(e));
      return;
    }

    if (tool === 'ink' && activeStroke) {
      const finishedStroke = activeStroke;
      setActiveStroke(null);
      if (finishedStroke.length >= 2) {
        onAddInk([finishedStroke], activeColor);
        onStatusChange('Added freehand ink');
      } else {
        onStatusChange('Ready to draw');
      }
      return;
    }

    if (tool === 'pen' && activeStroke) {
      const finishedStroke = activeStroke;
      setActiveStroke(null);

      if (finishedStroke.length < 2) {
        if (pendingRef.current.length === 0) {
          onStatusChange('Ready to draw');
        }
        return;
      }

      const nextGroup = [...pendingRef.current, finishedStroke];
      if (nextGroup.length === 1 && canAutoFinalizeSingleStroke(finishedStroke)) {
        pendingRef.current = [];
        setPendingStrokes([]);
        const res = recognizeStrokeGroup(nextGroup, activeColor);
        onCommitRecognition(res, nextGroup);
        onStatusChange(res.type === 'shape' ? `Recognized ${res.kind}` : 'Ready to draw');
        return;
      }

      pendingRef.current = nextGroup;
      setPendingStrokes(nextGroup);
      onStatusChange('Recognizing...');
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => {
        flushPendingStrokes();
      }, 850);
      return;
    }

    if (tool === 'select' && resizeState) {
      if (resizeState.kind === 'box') {
        const init = resizeState.initialBounds;
        const cur = resizeState.currentBounds;
        if (
          Math.abs(cur.x - init.x) > 0.5 ||
          Math.abs(cur.y - init.y) > 0.5 ||
          Math.abs(cur.width - init.width) > 0.5 ||
          Math.abs(cur.height - init.height) > 0.5
        ) {
          onResizeNode(resizeState.id, cur);
          onStatusChange('Resized object');
        }
      } else {
        onResizeConnectorEndpoint(
          resizeState.id,
          resizeState.endpoint,
          resizeState.currentPoint
        );
        onStatusChange('Adjusted connector');
      }
      setResizeState(null);
      return;
    }

    if (tool === 'select' && dragState) {
      if (Math.abs(dragState.dx) > 1 || Math.abs(dragState.dy) > 1) {
        onMoveNode(dragState.id, dragState.dx, dragState.dy);
        onStatusChange('Moved object');
      }
      setDragState(null);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    isErasingRef.current = false;
    lastErasePtRef.current = null;
    erasedThisDragRef.current.clear();
    setPanState(null);
    setActiveStroke(null);
    setDragState(null);
    setResizeState(null);
    setHoverCursor(null);
    onStatusChange('Ready to draw');
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getBoardPoint(e);
    const tol = Math.max(4, 10 / viewportRef.current.zoom);
    const hit = hitTestNode(nodes, pt, tol);
    if (!hit) return;

    if (hit.type === 'shape' || hit.type === 'connector') {
      const center =
        hit.type === 'shape'
          ? boundsCenter(hit.bounds)
          : {
              x: (hit.start.point.x + hit.end.point.x) / 2,
              y: (hit.start.point.y + hit.end.point.y) / 2,
            };
      onSelectNode(hit.id);
      setEditing({
        mode: 'node',
        id: hit.id,
        x: center.x,
        y: center.y,
        value: hit.label ?? '',
      });
    } else if (hit.type === 'text') {
      onSelectNode(hit.id);
      setEditing({
        mode: 'node',
        id: hit.id,
        x: hit.position.x,
        y: hit.position.y,
        value: hit.text,
      });
    }
  };

  const commitInlineEdit = () => {
    if (!editing) return;
    if (editing.mode === 'node') {
      onUpdateLabel(editing.id, editing.value);
    } else if (editing.value.trim()) {
      onAddText({ x: editing.x, y: editing.y }, editing.value, activeColor);
    }
    setEditing(null);
  };

  const isEmpty =
    nodes.length === 0 && !activeStroke && pendingStrokes.length === 0 && !editing;
  const cursorStyle = panState
    ? 'grabbing'
    : spacePressed
      ? 'grab'
      : resizeState
        ? resizeState.kind === 'box'
          ? resizeState.cursor
          : 'grabbing'
        : tool === 'pen' || tool === 'ink'
          ? 'crosshair'
          : tool === 'erase'
            ? 'pointer'
            : tool === 'text'
              ? 'text'
              : dragState
                ? 'grabbing'
                : hoverCursor ?? 'default';

  // Apply live resize preview across target node and bound connectors
  let displayNodes = nodes;
  if (resizeState) {
    if (resizeState.kind === 'box') {
      const target = nodes.find((n) => n.id === resizeState.id);
      if (target?.type === 'shape') {
        const previewShape: ShapeNode = { ...target, bounds: resizeState.currentBounds };
        displayNodes = updateBoundConnectors(
          nodes.map((n) => (n.id === target.id ? previewShape : n)),
          previewShape
        );
      } else if (target?.type === 'ink') {
        const previewInk = scaleInkNode(target, resizeState.currentBounds);
        displayNodes = nodes.map((n) => (n.id === target.id ? previewInk : n));
      }
    } else {
      displayNodes = nodes.map((n) => {
        if (n.id !== resizeState.id || n.type !== 'connector') return n;
        return resizeState.endpoint === 'start'
          ? { ...n, start: { point: resizeState.currentPoint } }
          : { ...n, end: { point: resizeState.currentPoint } };
      });
    }
  }

  // Adaptive infinite grid spacing: keeps dot spacing crisp even at extreme zoom-out
  let gridStep = 20 * viewport.zoom;
  while (gridStep < 14) gridStep *= 2;
  while (gridStep > 44) gridStep /= 2;

  const isDefaultViewport =
    Math.abs(viewport.zoom - 1) < 0.001 &&
    Math.abs(viewport.panX) < 1 &&
    Math.abs(viewport.panY) < 1;

  const selectedDisplayNode =
    tool === 'select' && selectedId
      ? displayNodes.find((n) => n.id === selectedId)
      : undefined;
  const handleSize = 8 / viewport.zoom;
  const handlePad = 5 / viewport.zoom;
  const handleStroke = 1.5 / viewport.zoom;

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: '#ffffff',
        backgroundImage: 'radial-gradient(circle, #dce4ed 0.9px, transparent 1px)',
        backgroundSize: `${gridStep}px ${gridStep}px`,
        backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
      }}
      className="relative flex-1 min-h-[260px] overflow-hidden select-none"
    >
      <svg
        ref={svgRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
        aria-label="Sketch2Flow drawing canvas"
        style={{ cursor: cursorStyle }}
        className="w-full h-full block touch-none"
      >
        <defs>
          {(Object.keys(PALETTE_STYLES) as PaletteColor[]).map((c) => (
            <React.Fragment key={c}>
              <marker
                id={`arrow-end-${c}`}
                markerWidth="10"
                markerHeight="10"
                refX="8.5"
                refY="5"
                orient="auto"
              >
                <path
                  d="M 1.5 1.5 L 8.5 5 L 1.5 8.5"
                  fill="none"
                  stroke={PALETTE_STYLES[c].stroke}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
              <marker
                id={`arrow-start-${c}`}
                markerWidth="10"
                markerHeight="10"
                refX="1.5"
                refY="5"
                orient="auto"
              >
                <path
                  d="M 8.5 1.5 L 1.5 5 L 8.5 8.5"
                  fill="none"
                  stroke={PALETTE_STYLES[c].stroke}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            </React.Fragment>
          ))}
        </defs>

        <g transform={`translate(${viewport.panX}, ${viewport.panY}) scale(${viewport.zoom})`}>
          {displayNodes.map((node) => {
            const isSelected = node.id === selectedId;
            const offset =
              dragState && dragState.id === node.id
                ? `translate(${dragState.dx}, ${dragState.dy})`
                : undefined;

            if (node.type === 'shape') {
              return (
                <g key={node.id} transform={offset}>
                  {renderShapeSvg(node, isSelected)}
                </g>
              );
            }

            if (node.type === 'connector') {
              const p = PALETTE_STYLES[node.color];
              const dir: ArrowDirection = node.direction;
              const markerEnd =
                dir === 'single' || dir === 'double' ? `url(#arrow-end-${node.color})` : undefined;
              const markerStart =
                dir === 'double' ? `url(#arrow-start-${node.color})` : undefined;
              const mx = (node.start.point.x + node.end.point.x) / 2;
              const my = (node.start.point.y + node.end.point.y) / 2;

              return (
                <g key={node.id} transform={offset}>
                  <line
                    x1={node.start.point.x}
                    y1={node.start.point.y}
                    x2={node.end.point.x}
                    y2={node.end.point.y}
                    stroke={p.stroke}
                    strokeWidth={isSelected ? 2.8 : 2}
                    strokeLinecap="round"
                    markerEnd={markerEnd}
                    markerStart={markerStart}
                  />
                  {isSelected && (
                    <line
                      x1={node.start.point.x}
                      y1={node.start.point.y}
                      x2={node.end.point.x}
                      y2={node.end.point.y}
                      stroke="#2563eb"
                      strokeWidth={6}
                      strokeOpacity={0.22}
                      strokeLinecap="round"
                    />
                  )}
                  {node.label && (
                    <g>
                      <rect
                        x={mx - Math.max(24, node.label.length * 3.8 + 8)}
                        y={my - 11}
                        width={Math.max(48, node.label.length * 7.6 + 16)}
                        height={20}
                        rx={4}
                        fill="#ffffff"
                        stroke="#e2e8f0"
                      />
                      <text
                        x={mx}
                        y={my + 3}
                        textAnchor="middle"
                        fontSize={12}
                        fill="#475569"
                        className="select-none pointer-events-none"
                      >
                        {node.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            }

            if (node.type === 'ink') {
              const p = PALETTE_STYLES[node.color];
              return (
                <g key={node.id} transform={offset}>
                  {node.strokes.map((st, idx) => (
                    <path
                      key={idx}
                      d={pointsToSvgPath(st)}
                      fill="none"
                      stroke={p.stroke}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {isSelected && (
                    <rect
                      x={node.bounds.x - 5}
                      y={node.bounds.y - 5}
                      width={node.bounds.width + 10}
                      height={node.bounds.height + 10}
                      rx={6}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}
                </g>
              );
            }

            if (node.type === 'text') {
              const p = PALETTE_STYLES[node.color];
              return (
                <g key={node.id} transform={offset}>
                  <text
                    x={node.position.x}
                    y={node.position.y}
                    textAnchor="middle"
                    fontSize={15}
                    fontWeight={500}
                    fill={p.stroke}
                    className="select-none"
                  >
                    {node.text}
                  </text>
                  {isSelected && (
                    <circle
                      cx={node.position.x}
                      cy={node.position.y - 5}
                      r={4}
                      fill="#2563eb"
                    />
                  )}
                </g>
              );
            }

            return null;
          })}

          {/* Resize handles overlay when an element is selected in Select mode */}
          {selectedDisplayNode && !dragState && (
            <g className="pointer-events-none">
              {(selectedDisplayNode.type === 'shape' || selectedDisplayNode.type === 'ink') &&
                getBoxHandles(selectedDisplayNode.bounds, handlePad).map((h) => (
                  <rect
                    key={h.handle}
                    x={h.x - handleSize / 2}
                    y={h.y - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    rx={1.5 / viewport.zoom}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={handleStroke}
                  />
                ))}
              {selectedDisplayNode.type === 'connector' && (
                <>
                  <circle
                    cx={selectedDisplayNode.start.point.x}
                    cy={selectedDisplayNode.start.point.y}
                    r={handleSize * 0.6}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={handleStroke}
                  />
                  <circle
                    cx={selectedDisplayNode.end.point.x}
                    cy={selectedDisplayNode.end.point.y}
                    r={handleSize * 0.6}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={handleStroke}
                  />
                </>
              )}
            </g>
          )}

          {/* Pending multi-stroke ink */}
          {pendingStrokes.map((st, idx) => (
            <path
              key={`pending-${idx}`}
              d={pointsToSvgPath(st)}
              fill="none"
              stroke={PALETTE_STYLES[activeColor].stroke}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.85}
            />
          ))}

          {/* Live active stroke */}
          {activeStroke && (
            <path
              d={pointsToSvgPath(activeStroke)}
              fill="none"
              stroke={PALETTE_STYLES[activeColor].stroke}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      </svg>

      {/* Empty state */}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <svg
            viewBox="0 0 180 90"
            fill="none"
            strokeLinejoin="round"
            strokeWidth="2"
            className="w-44 h-[88px] mb-2"
            aria-hidden="true"
          >
            <path d="M12 22Q38 14 66 20L64 67Q38 63 10 70Z" stroke="#94a3b8" />
            <path d="M80 44h22m-6-6 6 6-6 6" stroke="#64748b" />
            <rect x="115" y="20" width="54" height="48" rx="4" stroke="#2563eb" fill="#dbeafe" />
          </svg>
          <h2 className="text-lg md:text-[19px] font-bold text-[#334155] mb-1">
            Draw a shape or arrow anywhere.
          </h2>
          <p className="text-xs md:text-[13px] text-[#64748b] max-w-[300px]">
            We&apos;ll straighten it for you. One pen is all you need.
          </p>
        </div>
      )}

      {/* Inline label editor */}
      {editing && (
        <div
          style={{
            left: `${Math.max(96, editing.x * viewport.zoom + viewport.panX)}px`,
            top: `${Math.max(28, editing.y * viewport.zoom + viewport.panY)}px`,
            transform: 'translate(-50%, -50%)',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-20 flex flex-col items-center gap-1"
        >
          <input
            ref={editInputRef}
            autoFocus
            type="text"
            value={editing.value}
            maxLength={48}
            placeholder="Type text..."
            aria-label="Edit label"
            onChange={(e) => setEditing((prev) => (prev ? { ...prev, value: e.target.value } : null))}
            onBlur={commitInlineEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitInlineEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(null);
              }
            }}
            className="w-44 px-2.5 py-1.5 text-sm text-center bg-white border border-[#2563eb] rounded-md shadow-md text-[#1e293b] focus:outline-none"
          />
          <span className="text-[10px] text-[#64748b] bg-white/95 px-1.5 py-0.5 rounded border border-[#e2e8f0]">
            Enter to apply · Esc to cancel
          </span>
        </div>
      )}

      {/* Bottom-left Excalidraw-style zoom bar + tool hint */}
      <div className="absolute left-3 md:left-5 bottom-3 z-10 flex items-center gap-2">
        <div
          role="group"
          aria-label="Canvas zoom controls"
          className="inline-flex items-center bg-white/95 border border-[#e2e8f0] rounded-lg shadow-xs overflow-hidden"
        >
          <button
            type="button"
            onClick={() => zoomAtCenter(viewport.zoom / 1.25)}
            aria-label="Zoom out"
            title="Zoom out (Ctrl/Cmd+-)"
            className="inline-flex items-center justify-center w-8 h-8 text-[#475569] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#2563eb] transition-colors"
          >
            <Minus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            aria-label="Reset zoom to 100%"
            title="Reset zoom and pan (Ctrl/Cmd+0)"
            className="h-8 px-2 text-[11px] font-medium text-[#334155] hover:bg-slate-100 font-mono-tabular min-w-[46px] text-center border-x border-[#e2e8f0] focus-visible:outline-2 focus-visible:outline-[#2563eb] transition-colors"
          >
            {formatZoomPercent(viewport.zoom)}
          </button>
          <button
            type="button"
            onClick={() => zoomAtCenter(viewport.zoom * 1.25)}
            disabled={viewport.zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            title="Zoom in (Ctrl/Cmd+=)"
            className="inline-flex items-center justify-center w-8 h-8 text-[#475569] hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[#2563eb] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          {!isDefaultViewport && (
            <button
              type="button"
              onClick={handleResetView}
              aria-label="Reset view"
              title="Reset view"
              className="inline-flex items-center justify-center w-8 h-8 text-[#64748b] hover:bg-slate-100 border-l border-[#e2e8f0] focus-visible:outline-2 focus-visible:outline-[#2563eb] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.85} />
            </button>
          )}
        </div>

        {(!isEmpty || tool !== 'pen') && (
          <div className="pointer-events-none hidden sm:block text-[11px] text-[#64748b] bg-white/95 border border-[#e2e8f0] rounded-md px-2.5 py-1.5">
            {TOOL_HINTS[tool]}
          </div>
        )}
      </div>

      <div
        aria-live="polite"
        className="pointer-events-none absolute right-3 md:right-5 bottom-3 text-[10px] md:text-[11px] text-[#64748b] bg-white/95 px-2 py-1 rounded-[5px]"
      >
        {statusText}
      </div>
    </div>
  );
}
