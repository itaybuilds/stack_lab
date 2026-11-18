import { describe, expect, it } from 'vitest';
import {
  areSuppressedCallsGroundedInPrompt,
  buildCompactSystemPrompt,
  describeToolCall,
  groundNeedleToolCalls,
  isLikelyNonEnglishPrompt,
  SKETCH_TOOL_DEFINITIONS,
  validateToolCalls,
} from './sketchTools';
import { applyAiCommandBatch } from '../domain/commands';
import { DiagramNode } from '../domain/diagramModel';

const SAMPLE_NODES: DiagramNode[] = [
  {
    type: 'shape',
    id: 's-1',
    kind: 'rectangle',
    bounds: { x: 100, y: 100, width: 140, height: 50 },
    color: 'blue',
    label: 'API Gateway',
    sourceStrokes: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]],
  },
  {
    type: 'shape',
    id: 's-2',
    kind: 'terminator',
    bounds: { x: 100, y: 20, width: 120, height: 44 },
    color: 'blue',
    label: 'Client',
  },
];

describe('AI Tool Validation & Context Builder', () => {
  it('keeps SKETCH_TOOL_DEFINITIONS at <= 5 tools for optimal Needle 3 routing', () => {
    expect(SKETCH_TOOL_DEFINITIONS.length).toBeLessThanOrEqual(5);
  });

  it('validates allowlisted tool calls and rejects unknown tools or invalid enums', () => {
    const res = validateToolCalls([
      {
        name: 'add_shape',
        arguments: { kind: 'rectangle', label: 'API Gateway', color: 'blue', position: 'center' },
      },
      {
        name: 'exec_shell',
        arguments: { cmd: 'rm -rf /' },
      },
      {
        name: 'set_shape_color',
        arguments: { target: 'API Gateway', color: 'neon_pink' },
      },
    ]);

    expect(res.valid).toHaveLength(1);
    expect(res.valid[0].name).toBe('add_shape');
    expect(res.errors).toHaveLength(2);
  });

  it('builds compact factual context without raw stroke arrays and detects non-English scripts', () => {
    const prompt = buildCompactSystemPrompt(SAMPLE_NODES, 's-1');
    expect(prompt).toContain('Current diagram has shapes:');
    expect(prompt).toContain('API Gateway');
    expect(prompt).toContain('[selected]');
    expect(prompt).not.toContain('sourceStrokes');

    expect(buildCompactSystemPrompt([], null)).toBe('The diagram is currently empty.');
    expect(isLikelyNonEnglishPrompt('תוסיף מלבן כחול')).toBe(true);
    expect(isLikelyNonEnglishPrompt('Add a blue rectangle')).toBe(false);
  });

  it('grounds add_shape relative placement and strips leaked direction/anchor labels', () => {
    const groundedFromLeak = groundNeedleToolCalls(
      [
        {
          name: 'add_shape',
          arguments: { kind: 'database', label: 'Below', color: 'blue', position: 'below' },
        },
      ],
      'Create a database below API Gateway',
      SAMPLE_NODES
    );

    expect(groundedFromLeak).toEqual([
      {
        name: 'add_shape',
        arguments: {
          kind: 'database',
          label: undefined,
          color: 'blue',
          position: 'below',
          relativeTo: 'API Gateway',
        },
      },
    ]);
    expect(describeToolCall(groundedFromLeak[0])).toBe(
      'Add blue database below "API Gateway"'
    );
    expect(
      areSuppressedCallsGroundedInPrompt(groundedFromLeak, 'Create a database below API Gateway')
    ).toBe(true);

    const groundedWithSuffixLeak = groundNeedleToolCalls(
      [
        {
          name: 'add_shape',
          arguments: { kind: 'database', label: 'Gateway' },
        },
      ],
      'Create a database below API Gateway',
      SAMPLE_NODES
    );
    expect(groundedWithSuffixLeak[0]).toEqual({
      name: 'add_shape',
      arguments: {
        kind: 'database',
        label: undefined,
        position: 'below',
        relativeTo: 'API Gateway',
      },
    });
  });

  it('keeps unresolved relative anchor on empty board so missing-shape error is reported cleanly', () => {
    const groundedEmpty = groundNeedleToolCalls(
      [
        {
          name: 'add_shape',
          arguments: { kind: 'database', label: 'Gateway', color: 'blue', position: 'below' },
        },
      ],
      'Create a database below API Gateway',
      []
    );
    expect(groundedEmpty[0]).toEqual({
      name: 'add_shape',
      arguments: {
        kind: 'database',
        label: undefined,
        color: 'blue',
        position: 'below',
        relativeTo: 'API Gateway',
      },
    });
    const dryRun = applyAiCommandBatch([], 1, groundedEmpty);
    expect(dryRun.ok).toBe(false);
    if (!dryRun.ok) {
      expect(dryRun.error).toContain('API Gateway');
    }
  });

  it('preserves explicit called labels while attaching relative anchor', () => {
    const grounded = groundNeedleToolCalls(
      [
        {
          name: 'add_shape',
          arguments: { kind: 'database', label: 'Users', color: 'blue', position: 'below' },
        },
      ],
      'Add a blue database called Users below API Gateway',
      SAMPLE_NODES
    );
    expect(grounded[0]).toEqual({
      name: 'add_shape',
      arguments: {
        kind: 'database',
        label: 'Users',
        color: 'blue',
        position: 'below',
        relativeTo: 'API Gateway',
      },
    });
  });

  it('repairs swapped rename_shape arguments and misclassified color edits on existing shapes, while blocking ungrounded/destructive suppressed calls', () => {
    const renamed = groundNeedleToolCalls(
      [
        {
          name: 'rename_shape',
          arguments: { target: 'Edge Proxy', label: 'API Gateway' },
        },
      ],
      'Rename API Gateway to Edge Proxy',
      SAMPLE_NODES
    );
    expect(renamed[0]).toEqual({
      name: 'rename_shape',
      arguments: { target: 'API Gateway', label: 'Edge Proxy' },
    });

    const recolored = groundNeedleToolCalls(
      [
        {
          name: 'add_shape',
          arguments: { kind: 'rectangle', label: 'API Gateway', color: 'green' },
        },
      ],
      'Make API Gateway green',
      SAMPLE_NODES
    );
    expect(recolored[0]).toEqual({
      name: 'set_shape_color',
      arguments: { target: 'API Gateway', color: 'green' },
    });

    // Destructive delete_shape from suppressed_calls must never bypass confirmation
    expect(
      areSuppressedCallsGroundedInPrompt(
        [{ name: 'delete_shape', arguments: { target: 'Client' } }],
        'Delete Client'
      )
    ).toBe(false);
  });
});
