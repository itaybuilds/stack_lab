import {
  ArrowDirection,
  Bounds,
  ConnectorNode,
  DEFAULT_SHAPE_DIMENSIONS,
  DiagramNode,
  DiagramState,
  InkNode,
  PALETTE_ORDER,
  PaletteColor,
  Point,
  SHAPE_KIND_LABELS,
  ShapeKind,
  ShapeNode,
  TextNode,
} from './diagramModel';
import {
  boundsCenter,
  boundsIntersect,
  clamp,
  computeBounds,
  computeConnectorAnchors,
  expandBounds,
  scaleInkNode,
  snapConnectorEndpoints,
  snapEndpointToShapes,
  translateNode,
  updateBoundConnectors,
} from './geometry';
import { isCylinderBodyForCap, RecognitionResult } from './recognition';

export type HistorySnapshot = {
  nodes: DiagramNode[];
  label: string;
};

export type DiagramHistoryState = {
  present: DiagramState;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  nextId: number;
};

export const CANVAS_LOGICAL_BOUNDS: Bounds = {
  x: 0,
  y: 0,
  width: 960,
  height: 560,
};

export type AiToolCommand =
  | {
      name: 'add_shape';
      arguments: {
        kind: ShapeKind;
        label?: string;
        color?: PaletteColor;
        position?: 'center' | 'above' | 'below' | 'left' | 'right';
        relativeTo?: string;
      };
    }
  | {
      name: 'connect_shapes';
      arguments: {
        from: string;
        to: string;
        direction?: ArrowDirection;
      };
    }
  | {
      name: 'rename_shape';
      arguments: {
        target: string;
        label: string;
      };
    }
  | {
      name: 'set_shape_color';
      arguments: {
        target: string;
        color: PaletteColor;
      };
    }
  | {
      name: 'move_shape';
      arguments: {
        target: string;
        direction: 'above' | 'below' | 'left' | 'right' | 'center';
        relativeTo?: string;
      };
    }
  | {
      name: 'delete_shape';
      arguments: {
        target: string;
      };
    };

export type DiagramAction =
  | { type: 'COMMIT_RECOGNITION'; result: RecognitionResult; sourceStrokes: Point[][] }
  | { type: 'ADD_INK'; strokes: Point[][]; color: PaletteColor }
  | { type: 'ADD_TEXT'; position: Point; text: string; color: PaletteColor }
  | { type: 'MOVE_NODE'; id: string; dx: number; dy: number }
  | { type: 'RESIZE_NODE'; id: string; bounds: Bounds }
  | { type: 'RESIZE_CONNECTOR_ENDPOINT'; id: string; endpoint: 'start' | 'end'; point: Point }
  | { type: 'UPDATE_LABEL'; id: string; label: string }
  | { type: 'SET_NODE_COLOR'; id: string; color: PaletteColor }
  | { type: 'REORDER_NODE_LAYER'; id: string; direction: 'up' | 'down' }
  | { type: 'DELETE_NODE'; id: string }
  | { type: 'CLEAR_BOARD' }
  | { type: 'APPLY_AI_BATCH'; expectedRevision: number; calls: AiToolCommand[]; summary: string }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function createInitialHistoryState(): DiagramHistoryState {
  return {
    present: { nodes: [], revision: 1 },
    past: [],
    future: [],
    nextId: 1,
  };
}

function makeId(prefix: string, counter: number): string {
  return `${prefix}-${counter}`;
}

function pushHistory(
  state: DiagramHistoryState,
  nextNodes: DiagramNode[],
  label: string,
  nextId = state.nextId
): DiagramHistoryState {
  return {
    present: {
      nodes: nextNodes,
      revision: state.present.revision + 1,
    },
    past: [...state.past, { nodes: state.present.nodes, label }],
    future: [],
    nextId,
  };
}

export function isValidPaletteColor(value: unknown): value is PaletteColor {
  return typeof value === 'string' && PALETTE_ORDER.includes(value as PaletteColor);
}

export function isValidShapeKind(value: unknown): value is ShapeKind {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(SHAPE_KIND_LABELS, value)
  );
}

function resolveShapeTarget(
  nodes: DiagramNode[],
  query: string
): { ok: true; shape: ShapeNode } | { ok: false; error: string } {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, error: 'Missing target shape reference.' };
  }
  const shapes = nodes.filter((n): n is ShapeNode => n.type === 'shape');
  if (shapes.length === 0) {
    return { ok: false, error: `No shapes on the board match "${trimmed}".` };
  }

  // Exact ID match
  const byId = shapes.find((s) => s.id.toLowerCase() === trimmed.toLowerCase());
  if (byId) return { ok: true, shape: byId };

  // Exact case-insensitive label match
  const exactLabels = shapes.filter(
    (s) => (s.label ?? '').trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (exactLabels.length === 1) return { ok: true, shape: exactLabels[0] };
  if (exactLabels.length > 1) {
    return {
      ok: false,
      error: `Multiple shapes are labeled "${trimmed}". Rename or select one first.`,
    };
  }

  // Partial label or shape-kind match
  const normalized = trimmed.toLowerCase();
  const partialMatches = shapes.filter((s) => {
    const lbl = (s.label ?? '').toLowerCase();
    const kind = s.kind.toLowerCase();
    return (lbl && lbl.includes(normalized)) || normalized.includes(kind);
  });

  if (partialMatches.length === 1) return { ok: true, shape: partialMatches[0] };
  if (partialMatches.length > 1) {
    return {
      ok: false,
      error: `Multiple shapes match "${trimmed}". Please use a more specific label.`,
    };
  }

  return { ok: false, error: `Could not find a shape named "${trimmed}".` };
}

function findSafePlacement(
  existingShapes: ShapeNode[],
  width: number,
  height: number,
  position: 'center' | 'above' | 'below' | 'left' | 'right' = 'center',
  relativeShape?: ShapeNode
): Bounds {
  const gap = 46;
  let candidate: Bounds;

  if (relativeShape) {
    const rb = relativeShape.bounds;
    const rc = boundsCenter(rb);
    if (position === 'above') {
      candidate = { x: rc.x - width / 2, y: rb.y - gap - height, width, height };
    } else if (position === 'below') {
      candidate = { x: rc.x - width / 2, y: rb.y + rb.height + gap, width, height };
    } else if (position === 'left') {
      candidate = { x: rb.x - gap - width, y: rc.y - height / 2, width, height };
    } else if (position === 'right') {
      candidate = { x: rb.x + rb.width + gap, y: rc.y - height / 2, width, height };
    } else {
      candidate = { x: rc.x - width / 2, y: rb.y + rb.height + gap, width, height };
    }
  } else {
    const cx = CANVAS_LOGICAL_BOUNDS.width / 2;
    const cy = CANVAS_LOGICAL_BOUNDS.height / 2;
    if (position === 'above') {
      candidate = { x: cx - width / 2, y: 80, width, height };
    } else if (position === 'below') {
      candidate = { x: cx - width / 2, y: CANVAS_LOGICAL_BOUNDS.height - height - 80, width, height };
    } else if (position === 'left') {
      candidate = { x: 100, y: cy - height / 2, width, height };
    } else if (position === 'right') {
      candidate = { x: CANVAS_LOGICAL_BOUNDS.width - width - 100, y: cy - height / 2, width, height };
    } else {
      candidate = { x: cx - width / 2, y: cy - height / 2, width, height };
    }
  }

  // Clamp inside logical board
  candidate = {
    x: clamp(candidate.x, 32, CANVAS_LOGICAL_BOUNDS.width - width - 32),
    y: clamp(candidate.y, 32, CANVAS_LOGICAL_BOUNDS.height - height - 32),
    width,
    height,
  };

  // Nudge downward or right if overlapping another shape
  const offsets: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: height + 36 },
    { x: width + 36, y: 0 },
    { x: -(width + 36), y: 0 },
    { x: 0, y: -(height + 36) },
    { x: 40, y: 40 },
    { x: -40, y: 40 },
  ];

  for (const offset of offsets) {
    const test: Bounds = {
      x: clamp(candidate.x + offset.x, 32, CANVAS_LOGICAL_BOUNDS.width - width - 32),
      y: clamp(candidate.y + offset.y, 32, CANVAS_LOGICAL_BOUNDS.height - height - 32),
      width,
      height,
    };
    const overlaps = existingShapes.some((s) => boundsIntersect(expandBounds(s.bounds, 12), test));
    if (!overlaps) {
      return test;
    }
  }

  return candidate;
}

export function applyAiCommandBatch(
  nodes: DiagramNode[],
  nextIdStart: number,
  calls: AiToolCommand[]
): { ok: true; nodes: DiagramNode[]; nextId: number; executedDescriptions: string[] } | { ok: false; error: string } {
  if (calls.length === 0) {
    return { ok: false, error: 'No valid diagram commands were produced.' };
  }
  if (calls.length > 6) {
    return { ok: false, error: 'Too many tool calls in a single request (max 6).' };
  }

  let working = [...nodes];
  let nextId = nextIdStart;
  const executedDescriptions: string[] = [];

  for (const call of calls) {
    if (call.name === 'add_shape') {
      const args = call.arguments;
      if (!isValidShapeKind(args.kind)) {
        return { ok: false, error: `Unsupported shape kind "${String(args.kind)}".` };
      }
      const color: PaletteColor = isValidPaletteColor(args.color) ? args.color : 'blue';
      const dims = DEFAULT_SHAPE_DIMENSIONS[args.kind];
      let relShape: ShapeNode | undefined;
      if (args.relativeTo) {
        const relRes = resolveShapeTarget(working, args.relativeTo);
        if (!relRes.ok) {
          return { ok: false, error: relRes.error };
        }
        relShape = relRes.shape;
      }
      const existingShapes = working.filter((n): n is ShapeNode => n.type === 'shape');
      const bounds = findSafePlacement(
        existingShapes,
        dims.width,
        dims.height,
        args.position ?? (relShape ? 'below' : 'center'),
        relShape
      );
      const label = args.label ? args.label.trim().slice(0, 48) : undefined;
      const shape: ShapeNode = {
        type: 'shape',
        id: makeId('s', nextId++),
        kind: args.kind,
        bounds,
        color,
        label,
      };
      working.push(shape);
      const relDesc =
        relShape && args.position && args.position !== 'center'
          ? ` ${args.position} "${relShape.label ?? relShape.id}"`
          : '';
      executedDescriptions.push(
        `Added ${color} ${args.kind}${label ? ` "${label}"` : ''}${relDesc}`
      );
    } else if (call.name === 'connect_shapes') {
      const fromRes = resolveShapeTarget(working, call.arguments.from);
      if (!fromRes.ok) return { ok: false, error: fromRes.error };
      const toRes = resolveShapeTarget(working, call.arguments.to);
      if (!toRes.ok) return { ok: false, error: toRes.error };
      if (fromRes.shape.id === toRes.shape.id) {
        return { ok: false, error: 'Cannot connect a shape to itself.' };
      }
      const direction: ArrowDirection =
        call.arguments.direction === 'double' || call.arguments.direction === 'none'
          ? call.arguments.direction
          : 'single';
      const anchors = computeConnectorAnchors(fromRes.shape, toRes.shape);
      const conn: ConnectorNode = {
        type: 'connector',
        id: makeId('c', nextId++),
        start: anchors.start,
        end: anchors.end,
        direction,
        color: 'slate',
      };
      working.push(conn);
      executedDescriptions.push(
        `Connected "${fromRes.shape.label ?? fromRes.shape.id}" to "${toRes.shape.label ?? toRes.shape.id}"`
      );
    } else if (call.name === 'rename_shape') {
      const targetRes = resolveShapeTarget(working, call.arguments.target);
      if (!targetRes.ok) return { ok: false, error: targetRes.error };
      const newLabel = (call.arguments.label ?? '').trim().slice(0, 48);
      if (!newLabel) {
        return { ok: false, error: 'New label cannot be empty.' };
      }
      working = working.map((n) =>
        n.id === targetRes.shape.id && n.type === 'shape' ? { ...n, label: newLabel } : n
      );
      executedDescriptions.push(
        `Renamed "${targetRes.shape.label ?? targetRes.shape.id}" to "${newLabel}"`
      );
    } else if (call.name === 'set_shape_color') {
      const targetRes = resolveShapeTarget(working, call.arguments.target);
      if (!targetRes.ok) return { ok: false, error: targetRes.error };
      if (!isValidPaletteColor(call.arguments.color)) {
        return { ok: false, error: `Invalid color "${String(call.arguments.color)}".` };
      }
      const newColor = call.arguments.color;
      working = working.map((n) =>
        n.id === targetRes.shape.id ? { ...n, color: newColor } : n
      );
      executedDescriptions.push(
        `Colored "${targetRes.shape.label ?? targetRes.shape.id}" ${newColor}`
      );
    } else if (call.name === 'move_shape') {
      const targetRes = resolveShapeTarget(working, call.arguments.target);
      if (!targetRes.ok) return { ok: false, error: targetRes.error };
      let relShape: ShapeNode | undefined;
      if (call.arguments.relativeTo) {
        const relRes = resolveShapeTarget(working, call.arguments.relativeTo);
        if (!relRes.ok) return { ok: false, error: relRes.error };
        relShape = relRes.shape;
      }
      const otherShapes = working.filter(
        (n): n is ShapeNode => n.type === 'shape' && n.id !== targetRes.shape.id
      );
      let nextBounds: Bounds;
      if (relShape) {
        nextBounds = findSafePlacement(
          otherShapes,
          targetRes.shape.bounds.width,
          targetRes.shape.bounds.height,
          call.arguments.direction,
          relShape
        );
      } else {
        const step = 110;
        let dx = 0;
        let dy = 0;
        if (call.arguments.direction === 'left') dx = -step;
        if (call.arguments.direction === 'right') dx = step;
        if (call.arguments.direction === 'above') dy = -step;
        if (call.arguments.direction === 'below') dy = step;
        if (call.arguments.direction === 'center') {
          nextBounds = {
            ...targetRes.shape.bounds,
            x: CANVAS_LOGICAL_BOUNDS.width / 2 - targetRes.shape.bounds.width / 2,
            y: CANVAS_LOGICAL_BOUNDS.height / 2 - targetRes.shape.bounds.height / 2,
          };
        } else {
          nextBounds = {
            ...targetRes.shape.bounds,
            x: clamp(
              targetRes.shape.bounds.x + dx,
              24,
              CANVAS_LOGICAL_BOUNDS.width - targetRes.shape.bounds.width - 24
            ),
            y: clamp(
              targetRes.shape.bounds.y + dy,
              24,
              CANVAS_LOGICAL_BOUNDS.height - targetRes.shape.bounds.height - 24
            ),
          };
        }
      }
      const movedShape: ShapeNode = { ...targetRes.shape, bounds: nextBounds };
      working = working.map((n) => (n.id === movedShape.id ? movedShape : n));
      working = updateBoundConnectors(working, movedShape);
      executedDescriptions.push(
        `Moved "${targetRes.shape.label ?? targetRes.shape.id}" ${call.arguments.direction}`
      );
    } else if (call.name === 'delete_shape') {
      const targetRes = resolveShapeTarget(working, call.arguments.target);
      if (!targetRes.ok) return { ok: false, error: targetRes.error };
      working = deleteNodeAndCleanupConnectors(working, targetRes.shape.id);
      executedDescriptions.push(
        `Deleted "${targetRes.shape.label ?? targetRes.shape.id}"`
      );
    } else {
      return { ok: false, error: 'Unsupported tool command.' };
    }
  }

  return { ok: true, nodes: working, nextId, executedDescriptions };
}

function deleteNodeAndCleanupConnectors(nodes: DiagramNode[], id: string): DiagramNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .filter((n) => {
      if (n.type !== 'connector') return true;
      // Remove connectors explicitly attached to deleted shape
      return n.start.shapeId !== id && n.end.shapeId !== id;
    });
}

export function diagramReducer(
  state: DiagramHistoryState,
  action: DiagramAction
): DiagramHistoryState {
  switch (action.type) {
    case 'COMMIT_RECOGNITION': {
      const { result, sourceStrokes } = action;
      const cleanStrokes = sourceStrokes.filter((s) => s.length >= 2);
      if (cleanStrokes.length === 0) return state;

      let nextId = state.nextId;

      if (result.type === 'ink') {
        // Check if this freehand U-body completes an already-finalized top oval/circle into a database cylinder
        for (let i = state.present.nodes.length - 1; i >= 0; i--) {
          const existing = state.present.nodes[i];
          if (existing.type !== 'shape') continue;
          const dbBounds = isCylinderBodyForCap(cleanStrokes, existing);
          if (dbBounds) {
            const rawInkNode: InkNode = {
              type: 'ink',
              id: makeId('ink', nextId++),
              strokes: cleanStrokes,
              bounds: computeBounds(cleanStrokes.flat()),
              color: result.color,
            };
            const withRawInk = [...state.present.nodes, rawInkNode];
            const upgradedShape: ShapeNode = {
              ...existing,
              kind: 'database',
              bounds: dbBounds,
            };
            let nextNodes = state.present.nodes.map((n) =>
              n.id === existing.id ? upgradedShape : n
            );
            nextNodes = updateBoundConnectors(nextNodes, upgradedShape);
            return {
              present: {
                nodes: nextNodes,
                revision: state.present.revision + 2,
              },
              past: [
                ...state.past,
                { nodes: state.present.nodes, label: 'Draw stroke' },
                { nodes: withRawInk, label: 'Recognize database' },
              ],
              future: [],
              nextId,
            };
          }
        }

        const inkNode: InkNode = {
          type: 'ink',
          id: makeId('ink', nextId++),
          strokes: cleanStrokes,
          bounds: computeBounds(cleanStrokes.flat()),
          color: result.color,
        };
        return pushHistory(state, [...state.present.nodes, inkNode], 'Draw ink', nextId);
      }

      // Per spec Section 4.4:
      // "If recognition replacement is wrong, restore original stroke group with a single undo,
      // then allow removal on another undo."
      const inkNodeId = makeId('ink', nextId++);
      const rawInkNode: InkNode = {
        type: 'ink',
        id: inkNodeId,
        strokes: cleanStrokes,
        bounds: computeBounds(cleanStrokes.flat()),
        color: result.color,
      };
      const withRawInk = [...state.present.nodes, rawInkNode];

      let cleanNode: DiagramNode;
      if (result.type === 'shape') {
        cleanNode = {
          type: 'shape',
          id: makeId('s', nextId++),
          kind: result.kind,
          bounds: result.bounds,
          color: result.color,
          sourceStrokes: cleanStrokes,
        };
      } else {
        const shapes = state.present.nodes.filter((n): n is ShapeNode => n.type === 'shape');
        const { start, end } = snapConnectorEndpoints(result.start, result.end, shapes);
        cleanNode = {
          type: 'connector',
          id: makeId('c', nextId++),
          start,
          end,
          direction: result.direction,
          color: result.color,
          sourceStrokes: cleanStrokes,
        };
      }

      const withCleanNode = [...state.present.nodes, cleanNode];

      return {
        present: {
          nodes: withCleanNode,
          revision: state.present.revision + 2,
        },
        past: [
          ...state.past,
          { nodes: state.present.nodes, label: 'Draw stroke' },
          { nodes: withRawInk, label: `Recognize ${result.type}` },
        ],
        future: [],
        nextId,
      };
    }

    case 'ADD_INK': {
      const cleanStrokes = action.strokes.filter((s) => s.length >= 2);
      if (cleanStrokes.length === 0) return state;
      const nextId = state.nextId + 1;
      const inkNode: InkNode = {
        type: 'ink',
        id: makeId('ink', state.nextId),
        strokes: cleanStrokes,
        bounds: computeBounds(cleanStrokes.flat()),
        color: action.color,
      };
      return pushHistory(state, [...state.present.nodes, inkNode], 'Draw ink', nextId);
    }

    case 'ADD_TEXT': {
      const trimmed = action.text.trim().slice(0, 80);
      if (!trimmed) return state;
      const nextId = state.nextId + 1;
      const textNode: TextNode = {
        type: 'text',
        id: makeId('t', state.nextId),
        position: action.position,
        text: trimmed,
        color: action.color,
      };
      return pushHistory(state, [...state.present.nodes, textNode], 'Add text', nextId);
    }

    case 'MOVE_NODE': {
      if (!Number.isFinite(action.dx) || !Number.isFinite(action.dy)) return state;
      if (Math.abs(action.dx) < 0.5 && Math.abs(action.dy) < 0.5) return state;

      const target = state.present.nodes.find((n) => n.id === action.id);
      if (!target) return state;

      const moved = translateNode(target, action.dx, action.dy);
      let nextNodes = state.present.nodes.map((n) => (n.id === action.id ? moved : n));
      if (moved.type === 'shape') {
        nextNodes = updateBoundConnectors(nextNodes, moved);
      }
      return pushHistory(state, nextNodes, 'Move object');
    }

    case 'RESIZE_NODE': {
      const b = action.bounds;
      if (
        !Number.isFinite(b.x) ||
        !Number.isFinite(b.y) ||
        !Number.isFinite(b.width) ||
        !Number.isFinite(b.height) ||
        b.width < 12 ||
        b.height < 12
      ) {
        return state;
      }
      const target = state.present.nodes.find((n) => n.id === action.id);
      if (!target) return state;

      if (target.type === 'shape') {
        const resized: ShapeNode = { ...target, bounds: { ...b } };
        let nextNodes = state.present.nodes.map((n) => (n.id === action.id ? resized : n));
        nextNodes = updateBoundConnectors(nextNodes, resized);
        return pushHistory(state, nextNodes, 'Resize shape');
      }

      if (target.type === 'ink') {
        const resized = scaleInkNode(target, b);
        const nextNodes = state.present.nodes.map((n) => (n.id === action.id ? resized : n));
        return pushHistory(state, nextNodes, 'Resize ink');
      }
      return state;
    }

    case 'RESIZE_CONNECTOR_ENDPOINT': {
      if (!Number.isFinite(action.point.x) || !Number.isFinite(action.point.y)) return state;
      const target = state.present.nodes.find((n) => n.id === action.id);
      if (!target || target.type !== 'connector') return state;

      const shapes = state.present.nodes.filter((n): n is ShapeNode => n.type === 'shape');
      const snapped = snapEndpointToShapes(action.point, shapes, 32);
      const updated: ConnectorNode =
        action.endpoint === 'start'
          ? { ...target, start: snapped }
          : { ...target, end: snapped };

      return pushHistory(
        state,
        state.present.nodes.map((n) => (n.id === action.id ? updated : n)),
        'Adjust connector'
      );
    }

    case 'UPDATE_LABEL': {
      const trimmed = action.label.trim().slice(0, 64);
      const target = state.present.nodes.find((n) => n.id === action.id);
      if (!target) return state;

      if (target.type === 'text') {
        if (!trimmed) {
          return pushHistory(
            state,
            state.present.nodes.filter((n) => n.id !== action.id),
            'Delete empty text'
          );
        }
        if (target.text === trimmed) return state;
        return pushHistory(
          state,
          state.present.nodes.map((n) => (n.id === action.id ? { ...n, text: trimmed } : n)),
          'Edit text'
        );
      }

      if (target.type === 'shape' || target.type === 'connector') {
        const nextLabel = trimmed || undefined;
        if (target.label === nextLabel) return state;
        return pushHistory(
          state,
          state.present.nodes.map((n) => (n.id === action.id ? { ...n, label: nextLabel } : n)),
          'Edit label'
        );
      }
      return state;
    }

    case 'SET_NODE_COLOR': {
      if (!isValidPaletteColor(action.color)) return state;
      const target = state.present.nodes.find((n) => n.id === action.id);
      if (!target || target.color === action.color) return state;
      return pushHistory(
        state,
        state.present.nodes.map((n) => (n.id === action.id ? { ...n, color: action.color } : n)),
        'Change color'
      );
    }

    case 'REORDER_NODE_LAYER': {
      const idx = state.present.nodes.findIndex((n) => n.id === action.id);
      if (idx === -1) return state;
      const targetIdx = action.direction === 'up' ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= state.present.nodes.length) return state;
      const nextNodes = [...state.present.nodes];
      [nextNodes[idx], nextNodes[targetIdx]] = [nextNodes[targetIdx], nextNodes[idx]];
      return pushHistory(
        state,
        nextNodes,
        action.direction === 'up' ? 'Move layer up' : 'Move layer down'
      );
    }

    case 'DELETE_NODE': {
      const exists = state.present.nodes.some((n) => n.id === action.id);
      if (!exists) return state;
      const nextNodes = deleteNodeAndCleanupConnectors(state.present.nodes, action.id);
      return pushHistory(state, nextNodes, 'Delete object');
    }

    case 'CLEAR_BOARD': {
      if (state.present.nodes.length === 0) return state;
      return pushHistory(state, [], 'Clear board');
    }

    case 'APPLY_AI_BATCH': {
      // Stale async response protection
      if (action.expectedRevision !== state.present.revision) {
        return state;
      }
      const res = applyAiCommandBatch(state.present.nodes, state.nextId, action.calls);
      if (!res.ok) return state;
      return pushHistory(state, res.nodes, action.summary || 'AI command', res.nextId);
    }

    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const nextPast = state.past.slice(0, -1);
      return {
        present: {
          nodes: previous.nodes,
          revision: state.present.revision + 1,
        },
        past: nextPast,
        future: [{ nodes: state.present.nodes, label: previous.label }, ...state.future],
        nextId: state.nextId,
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const nextFuture = state.future.slice(1);
      return {
        present: {
          nodes: next.nodes,
          revision: state.present.revision + 1,
        },
        past: [...state.past, { nodes: state.present.nodes, label: next.label }],
        future: nextFuture,
        nextId: state.nextId,
      };
    }

    default:
      return state;
  }
}
