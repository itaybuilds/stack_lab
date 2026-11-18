import { describe, expect, it } from 'vitest';
import {
  applyAiCommandBatch,
  createInitialHistoryState,
  diagramReducer,
} from './commands';

describe('Diagram Commands & Undo/Redo History', () => {
  it('restores original raw ink on first Undo after recognition, then removes on second Undo', () => {
    let state = createInitialHistoryState();
    const strokes = [
      [
        { x: 100, y: 100 },
        { x: 240, y: 100 },
        { x: 240, y: 160 },
        { x: 100, y: 160 },
        { x: 100, y: 100 },
      ],
    ];

    state = diagramReducer(state, {
      type: 'COMMIT_RECOGNITION',
      sourceStrokes: strokes,
      result: {
        type: 'shape',
        kind: 'rectangle',
        bounds: { x: 100, y: 100, width: 140, height: 60 },
        color: 'blue',
        confidence: 0.92,
        candidates: [{ label: 'rectangle', score: 0.92 }],
      },
    });

    expect(state.present.nodes).toHaveLength(1);
    expect(state.present.nodes[0].type).toBe('shape');

    // First undo restores raw ink
    state = diagramReducer(state, { type: 'UNDO' });
    expect(state.present.nodes).toHaveLength(1);
    expect(state.present.nodes[0].type).toBe('ink');

    // Second undo clears the stroke completely
    state = diagramReducer(state, { type: 'UNDO' });
    expect(state.present.nodes).toHaveLength(0);

    // Redo restores ink then shape
    state = diagramReducer(state, { type: 'REDO' });
    expect(state.present.nodes[0].type).toBe('ink');
    state = diagramReducer(state, { type: 'REDO' });
    expect(state.present.nodes[0].type).toBe('shape');
  });

  it('supports undoable Clear and invalidates redo on new edits', () => {
    let state = createInitialHistoryState();
    state = diagramReducer(state, {
      type: 'ADD_TEXT',
      position: { x: 200, y: 200 },
      text: 'Client',
      color: 'slate',
    });
    expect(state.present.nodes).toHaveLength(1);

    state = diagramReducer(state, { type: 'CLEAR_BOARD' });
    expect(state.present.nodes).toHaveLength(0);

    state = diagramReducer(state, { type: 'UNDO' });
    expect(state.present.nodes).toHaveLength(1);

    // New edit clears redo history
    state = diagramReducer(state, { type: 'UNDO' });
    expect(state.future.length).toBeGreaterThan(0);
    state = diagramReducer(state, {
      type: 'ADD_TEXT',
      position: { x: 100, y: 100 },
      text: 'New',
      color: 'blue',
    });
    expect(state.future).toHaveLength(0);
  });

  it('applies AI batch atomically, updates attached connectors on move, and rejects stale revisions', () => {
    let state = createInitialHistoryState();
    const revBefore = state.present.revision;

    state = diagramReducer(state, {
      type: 'APPLY_AI_BATCH',
      expectedRevision: revBefore,
      summary: 'Create Client and API connected',
      calls: [
        { name: 'add_shape', arguments: { kind: 'terminator', label: 'Client', color: 'blue' } },
        {
          name: 'add_shape',
          arguments: {
            kind: 'rectangle',
            label: 'API Gateway',
            color: 'blue',
            position: 'below',
            relativeTo: 'Client',
          },
        },
        {
          name: 'connect_shapes',
          arguments: { from: 'Client', to: 'API Gateway', direction: 'single' },
        },
      ],
    });

    expect(state.present.nodes).toHaveLength(3);
    const connBefore = state.present.nodes[2];
    expect(connBefore.type).toBe('connector');

    // Stale async response with old revision must be ignored
    const afterStale = diagramReducer(state, {
      type: 'APPLY_AI_BATCH',
      expectedRevision: revBefore,
      summary: 'Stale call',
      calls: [{ name: 'add_shape', arguments: { kind: 'circle', label: 'Ghost' } }],
    });
    expect(afterStale.present.nodes).toHaveLength(3);

    // Moving Client updates attached connector endpoint
    const clientNode = state.present.nodes[0];
    state = diagramReducer(state, { type: 'MOVE_NODE', id: clientNode.id, dx: 80, dy: 20 });
    const connAfter = state.present.nodes[2];
    if (connBefore.type === 'connector' && connAfter.type === 'connector') {
      expect(connAfter.start.point.x).not.toBe(connBefore.start.point.x);
    }

    // Deleting Client also deletes its attached connector
    state = diagramReducer(state, { type: 'DELETE_NODE', id: clientNode.id });
    expect(state.present.nodes).toHaveLength(1);
    expect(state.present.nodes[0].type).toBe('shape');
  });

  it('rejects invalid AI batch atomically with no partial mutation', () => {
    const base = createInitialHistoryState();
    const res = applyAiCommandBatch(base.present.nodes, base.nextId, [
      { name: 'add_shape', arguments: { kind: 'rectangle', label: 'Cache' } },
      { name: 'delete_shape', arguments: { target: 'MissingNode' } },
    ]);
    expect(res.ok).toBe(false);
  });

  it('upgrades an already-finalized circle/ellipse cap into a database when U-body ink is drawn underneath', () => {
    let state = createInitialHistoryState();
    state = diagramReducer(state, {
      type: 'COMMIT_RECOGNITION',
      sourceStrokes: [
        [
          { x: 160, y: 100 },
          { x: 260, y: 100 },
          { x: 260, y: 180 },
          { x: 160, y: 180 },
          { x: 160, y: 100 },
        ],
      ],
      result: {
        type: 'shape',
        kind: 'ellipse',
        bounds: { x: 160, y: 100, width: 100, height: 80 },
        color: 'slate',
        confidence: 0.9,
        candidates: [{ label: 'ellipse', score: 0.9 }],
      },
    });

    const uBodyStrokes = [
      [
        { x: 162, y: 145 },
        { x: 160, y: 205 },
        { x: 165, y: 250 },
        { x: 210, y: 255 },
        { x: 255, y: 248 },
        { x: 260, y: 200 },
        { x: 262, y: 150 },
      ],
    ];

    state = diagramReducer(state, {
      type: 'COMMIT_RECOGNITION',
      sourceStrokes: uBodyStrokes,
      result: {
        type: 'ink',
        strokes: uBodyStrokes,
        bounds: { x: 160, y: 145, width: 102, height: 110 },
        color: 'slate',
        confidence: 0,
        reason: 'unrecognized-single-stroke',
      },
    });

    expect(state.present.nodes).toHaveLength(1);
    const dbNode = state.present.nodes[0];
    expect(dbNode.type).toBe('shape');
    if (dbNode.type === 'shape') {
      expect(dbNode.kind).toBe('database');
      expect(dbNode.bounds.y).toBe(100);
      expect(dbNode.bounds.height).toBe(155);
    }

    // Undo once restores ellipse + raw U-body ink; undo twice leaves only ellipse
    state = diagramReducer(state, { type: 'UNDO' });
    expect(state.present.nodes).toHaveLength(2);
    expect(state.present.nodes[0].type).toBe('shape');
    expect(state.present.nodes[1].type).toBe('ink');

    state = diagramReducer(state, { type: 'UNDO' });
    expect(state.present.nodes).toHaveLength(1);
  });

  it('snaps drawn arrows cleanly between two spaced-apart elements even when endpoints are far from borders', () => {
    let state = createInitialHistoryState();
    state = diagramReducer(state, {
      type: 'COMMIT_RECOGNITION',
      sourceStrokes: [
        [
          { x: 100, y: 150 },
          { x: 220, y: 150 },
          { x: 220, y: 210 },
          { x: 100, y: 210 },
        ],
      ],
      result: {
        type: 'shape',
        kind: 'rectangle',
        bounds: { x: 100, y: 150, width: 120, height: 60 },
        color: 'blue',
        confidence: 0.9,
        candidates: [{ label: 'rectangle', score: 0.9 }],
      },
    });
    state = diagramReducer(state, {
      type: 'COMMIT_RECOGNITION',
      sourceStrokes: [
        [
          { x: 460, y: 150 },
          { x: 580, y: 150 },
          { x: 580, y: 210 },
          { x: 460, y: 210 },
        ],
      ],
      result: {
        type: 'shape',
        kind: 'rectangle',
        bounds: { x: 460, y: 150, width: 120, height: 60 },
        color: 'green',
        confidence: 0.9,
        candidates: [{ label: 'rectangle', score: 0.9 }],
      },
    });

    // Draw a short arrow in the middle between the two shapes (~80px gap on both ends)
    state = diagramReducer(state, {
      type: 'COMMIT_RECOGNITION',
      sourceStrokes: [
        [
          { x: 300, y: 180 },
          { x: 380, y: 180 },
        ],
      ],
      result: {
        type: 'connector',
        start: { x: 300, y: 180 },
        end: { x: 380, y: 180 },
        direction: 'single',
        color: 'slate',
        confidence: 0.9,
        candidates: [{ label: 'connector:single', score: 0.9 }],
      },
    });

    const leftRect = state.present.nodes[0];
    const rightRect = state.present.nodes[1];
    const conn = state.present.nodes[2];
    expect(conn.type).toBe('connector');
    if (conn.type === 'connector') {
      expect(conn.start.shapeId).toBe(leftRect.id);
      expect(conn.end.shapeId).toBe(rightRect.id);
      expect(conn.start.point).toEqual({ x: 220, y: 180 });
      expect(conn.end.point).toEqual({ x: 460, y: 180 });
    }
  });

  it('moves a selected node one layer up or down with undo support', () => {
    let state = createInitialHistoryState();
    state = diagramReducer(state, {
      type: 'ADD_TEXT',
      position: { x: 100, y: 100 },
      text: 'Bottom',
      color: 'slate',
    });
    state = diagramReducer(state, {
      type: 'ADD_TEXT',
      position: { x: 120, y: 120 },
      text: 'Middle',
      color: 'blue',
    });
    state = diagramReducer(state, {
      type: 'ADD_TEXT',
      position: { x: 140, y: 140 },
      text: 'Top',
      color: 'green',
    });

    const ids = () => state.present.nodes.map((n) => n.id);
    const [idA, idB, idC] = ids();
    expect(ids()).toEqual([idA, idB, idC]);

    // Move Bottom one layer up -> [idB, idA, idC]
    state = diagramReducer(state, { type: 'REORDER_NODE_LAYER', id: idA, direction: 'up' });
    expect(ids()).toEqual([idB, idA, idC]);

    // Move Bottom one layer down -> back to [idA, idB, idC]
    state = diagramReducer(state, { type: 'REORDER_NODE_LAYER', id: idA, direction: 'down' });
    expect(ids()).toEqual([idA, idB, idC]);

    // Moving bottom-most down or top-most up is a no-op
    const revAtBoundary = state.present.revision;
    state = diagramReducer(state, { type: 'REORDER_NODE_LAYER', id: idA, direction: 'down' });
    state = diagramReducer(state, { type: 'REORDER_NODE_LAYER', id: idC, direction: 'up' });
    expect(state.present.revision).toBe(revAtBoundary);

    // Undo restores previous order
    state = diagramReducer(state, { type: 'UNDO' });
    expect(ids()).toEqual([idB, idA, idC]);
  });

  it('adds regular freehand ink without shape/cylinder conversion and resizes shapes, ink, and connectors with undo support', () => {
    let state = createInitialHistoryState();

    // Regular pen stroke stays ink
    const inkStroke = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 180 },
      { x: 100, y: 180 },
      { x: 100, y: 100 },
    ];
    state = diagramReducer(state, {
      type: 'ADD_INK',
      strokes: [inkStroke],
      color: 'blue',
    });
    expect(state.present.nodes).toHaveLength(1);
    expect(state.present.nodes[0].type).toBe('ink');

    // Resize ink node scales strokes and bounds
    const inkId = state.present.nodes[0].id;
    state = diagramReducer(state, {
      type: 'RESIZE_NODE',
      id: inkId,
      bounds: { x: 100, y: 100, width: 200, height: 160 },
    });
    const resizedInk = state.present.nodes[0];
    expect(resizedInk.type).toBe('ink');
    if (resizedInk.type === 'ink') {
      expect(resizedInk.bounds).toEqual({ x: 100, y: 100, width: 200, height: 160 });
      expect(resizedInk.strokes[0][1]).toEqual({ x: 300, y: 100 });
      expect(resizedInk.strokes[0][2]).toEqual({ x: 300, y: 260 });
    }

    // Undo ink resize restores original bounds
    state = diagramReducer(state, { type: 'UNDO' });
    if (state.present.nodes[0].type === 'ink') {
      expect(state.present.nodes[0].bounds).toEqual({ x: 100, y: 100, width: 100, height: 80 });
    }

    // Add two connected shapes and resize the first shape -> bound connector updates
    state = diagramReducer(state, {
      type: 'APPLY_AI_BATCH',
      expectedRevision: state.present.revision,
      summary: 'Add A and B',
      calls: [
        { name: 'add_shape', arguments: { kind: 'rectangle', label: 'A', color: 'blue' } },
        {
          name: 'add_shape',
          arguments: { kind: 'rectangle', label: 'B', color: 'green', position: 'below', relativeTo: 'A' },
        },
        { name: 'connect_shapes', arguments: { from: 'A', to: 'B', direction: 'single' } },
      ],
    });
    const shapeA = state.present.nodes[1];
    const connBefore = state.present.nodes[3];
    expect(shapeA.type).toBe('shape');
    expect(connBefore.type).toBe('connector');

    if (shapeA.type === 'shape' && connBefore.type === 'connector') {
      const nextBounds = { ...shapeA.bounds, height: shapeA.bounds.height + 40 };
      state = diagramReducer(state, { type: 'RESIZE_NODE', id: shapeA.id, bounds: nextBounds });
      const resizedA = state.present.nodes[1];
      const connAfter = state.present.nodes[3];
      if (resizedA.type === 'shape' && connAfter.type === 'connector') {
        expect(resizedA.bounds.height).toBe(nextBounds.height);
        expect(connAfter.start.point.y).toBeCloseTo(resizedA.bounds.y + resizedA.bounds.height, 1);
      }

      // Connector endpoint can be adjusted independently
      state = diagramReducer(state, {
        type: 'RESIZE_CONNECTOR_ENDPOINT',
        id: connBefore.id,
        endpoint: 'end',
        point: { x: 600, y: 400 },
      });
      const movedEnd = state.present.nodes[3];
      if (movedEnd.type === 'connector') {
        expect(movedEnd.end.point).toEqual({ x: 600, y: 400 });
      }
    }
  });
});
