import {
  ArrowDirection,
  DiagramNode,
  PaletteColor,
  ShapeKind,
  ShapeNode,
} from '../domain/diagramModel';
import {
  AiToolCommand,
  isValidPaletteColor,
  isValidShapeKind,
} from '../domain/commands';

export type RawNeedleResponse = {
  type?: string;
  success?: boolean;
  error?: string | null;
  error_code?: string | null;
  reason?: string | null;
  function_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  suppressed_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  reasoning?: string;
  confidence?: number | null;
  prefill_tps?: number;
  decode_tps?: number;
  validation?: {
    ungrounded?: string[];
    negation?: boolean;
  };
};

// Keep <= 5 tools so Cactus Needle 3 avoids embedding-based tool filtering overhead
// and maintains high structural accuracy across all diagram operations.
export const SKETCH_TOOL_DEFINITIONS = [
  {
    name: 'add_shape',
    description: 'Add a new shape to the diagram.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'rectangle',
            'circle',
            'ellipse',
            'terminator',
            'diamond',
            'parallelogram',
            'triangle',
            'database',
          ],
          description: 'Shape kind',
        },
        label: { type: 'string', description: 'New shape label' },
        color: {
          type: 'string',
          enum: ['slate', 'blue', 'red', 'green', 'amber'],
          description: 'Shape color',
        },
        position: {
          type: 'string',
          enum: ['center', 'above', 'below', 'left', 'right'],
          description: 'Placement direction',
        },
        relativeTo: {
          type: 'string',
          description: 'Existing shape label to place next to',
        },
      },
      required: ['kind'],
    },
  },
  {
    name: 'connect_shapes',
    description: 'Connect two existing shapes with a line or arrow.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source shape label' },
        to: { type: 'string', description: 'Target shape label' },
        direction: {
          type: 'string',
          enum: ['single', 'double', 'none'],
          description: 'Arrow style',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'rename_shape',
    description: 'Rename an existing shape.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Current label of the shape' },
        label: { type: 'string', description: 'New label text' },
      },
      required: ['target', 'label'],
    },
  },
  {
    name: 'set_shape_color',
    description: 'Change the color of an existing shape.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Existing shape label' },
        color: {
          type: 'string',
          enum: ['slate', 'blue', 'red', 'green', 'amber'],
          description: 'New color',
        },
      },
      required: ['target', 'color'],
    },
  },
  {
    name: 'delete_shape',
    description: 'Delete an existing shape from the diagram.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Label of the shape to delete' },
      },
      required: ['target'],
    },
  },
];

export function buildCompactSystemPrompt(nodes: DiagramNode[], selectedId: string | null): string {
  const shapes = nodes.filter((n): n is ShapeNode => n.type === 'shape').slice(0, 20);
  if (shapes.length === 0) {
    return 'The diagram is currently empty.';
  }
  const list = shapes
    .map((s) => {
      const tag = s.label ? `"${s.label}"` : s.id;
      const sel = s.id === selectedId ? ' [selected]' : '';
      return `${tag} (${s.kind}, ${s.color}${sel})`;
    })
    .join(', ');
  return `Current diagram has shapes: ${list}.`;
}

export function isLikelyNonEnglishPrompt(prompt: string): boolean {
  // Detect Hebrew/Arabic/Cyrillic/CJK scripts so we can give a clear English-baseline hint
  return /[\u0590-\u05FF\u0600-\u06FF\u0400-\u04FF\u4E00-\u9FFF]/.test(prompt);
}

const VALID_POSITIONS = new Set(['center', 'above', 'below', 'left', 'right']);
const VALID_DIRECTIONS = new Set(['single', 'double', 'none']);

export function validateToolCalls(
  rawCalls: Array<{ name: string; arguments: Record<string, unknown> }> | undefined
): { valid: AiToolCommand[]; errors: string[] } {
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    return { valid: [], errors: [] };
  }

  const valid: AiToolCommand[] = [];
  const errors: string[] = [];

  for (const call of rawCalls.slice(0, 6)) {
    const args = call?.arguments ?? {};
    if (call.name === 'add_shape') {
      if (!isValidShapeKind(args.kind)) {
        errors.push(`Unsupported shape kind "${String(args.kind ?? '')}".`);
        continue;
      }
      const color: PaletteColor | undefined = isValidPaletteColor(args.color)
        ? args.color
        : undefined;
      const position =
        typeof args.position === 'string' && VALID_POSITIONS.has(args.position)
          ? (args.position as 'center' | 'above' | 'below' | 'left' | 'right')
          : undefined;
      valid.push({
        name: 'add_shape',
        arguments: {
          kind: args.kind as ShapeKind,
          label: typeof args.label === 'string' ? args.label.trim().slice(0, 48) : undefined,
          color,
          position,
          relativeTo:
            typeof args.relativeTo === 'string' ? args.relativeTo.trim().slice(0, 48) : undefined,
        },
      });
    } else if (call.name === 'connect_shapes') {
      if (typeof args.from !== 'string' || typeof args.to !== 'string') {
        errors.push('connect_shapes requires "from" and "to" shape labels.');
        continue;
      }
      const direction: ArrowDirection =
        typeof args.direction === 'string' && VALID_DIRECTIONS.has(args.direction)
          ? (args.direction as ArrowDirection)
          : 'single';
      valid.push({
        name: 'connect_shapes',
        arguments: {
          from: args.from.trim().slice(0, 48),
          to: args.to.trim().slice(0, 48),
          direction,
        },
      });
    } else if (call.name === 'rename_shape') {
      if (typeof args.target !== 'string' || typeof args.label !== 'string') {
        errors.push('rename_shape requires "target" and "label".');
        continue;
      }
      valid.push({
        name: 'rename_shape',
        arguments: {
          target: args.target.trim().slice(0, 48),
          label: args.label.trim().slice(0, 48),
        },
      });
    } else if (call.name === 'set_shape_color') {
      if (typeof args.target !== 'string' || !isValidPaletteColor(args.color)) {
        errors.push('set_shape_color requires a valid "target" and palette "color".');
        continue;
      }
      valid.push({
        name: 'set_shape_color',
        arguments: {
          target: args.target.trim().slice(0, 48),
          color: args.color,
        },
      });
    } else if (call.name === 'move_shape') {
      if (
        typeof args.target !== 'string' ||
        typeof args.direction !== 'string' ||
        !VALID_POSITIONS.has(args.direction)
      ) {
        errors.push('move_shape requires "target" and a valid "direction".');
        continue;
      }
      valid.push({
        name: 'move_shape',
        arguments: {
          target: args.target.trim().slice(0, 48),
          direction: args.direction as 'above' | 'below' | 'left' | 'right' | 'center',
          relativeTo:
            typeof args.relativeTo === 'string' ? args.relativeTo.trim().slice(0, 48) : undefined,
        },
      });
    } else if (call.name === 'delete_shape') {
      if (typeof args.target !== 'string' || !args.target.trim()) {
        errors.push('delete_shape requires a "target" shape.');
        continue;
      }
      valid.push({
        name: 'delete_shape',
        arguments: {
          target: args.target.trim().slice(0, 48),
        },
      });
    } else {
      errors.push(`Tool "${String(call?.name ?? 'unknown')}" is not allowlisted.`);
    }
  }

  return { valid, errors };
}

type DirectionPosition = 'above' | 'below' | 'left' | 'right';

const DIRECTION_LEAK_WORDS = new Set([
  'above',
  'below',
  'under',
  'underneath',
  'over',
  'left',
  'right',
  'center',
  'next',
  'beside',
  'before',
  'after',
]);

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findUniqueShapeByPhrase(shapes: ShapeNode[], phrase: string): ShapeNode | undefined {
  const norm = normalizeText(phrase.replace(/^["']|["']$/g, '').replace(/[.,!?]+$/, ''));
  if (!norm) return undefined;

  const exact = shapes.filter((s) => normalizeText(s.label ?? s.id) === norm);
  if (exact.length === 1) return exact[0];

  const byPrefixOrContains = shapes.filter((s) => {
    const label = normalizeText(s.label ?? s.id);
    return label.length > 0 && (norm === label || norm.startsWith(`${label} `) || label.includes(norm));
  });
  if (byPrefixOrContains.length === 1) return byPrefixOrContains[0];

  // Longest existing shape label explicitly appearing inside the reference phrase
  const contained = shapes
    .filter((s) => {
      const label = normalizeText(s.label ?? '');
      return label.length >= 2 && norm.includes(label);
    })
    .sort((a, b) => (b.label?.length ?? 0) - (a.label?.length ?? 0));
  if (contained.length === 1) return contained[0];
  if (contained.length > 1) {
    const topLen = contained[0].label?.length ?? 0;
    const secondLen = contained[1].label?.length ?? 0;
    if (topLen > secondLen) return contained[0];
  }

  return undefined;
}

function extractRawRelativeCue(
  prompt: string
): { position: DirectionPosition; phrase: string } | null {
  const cueRegex =
    /\b(below|underneath|under|above|over|to the left of|left of|to the right of|right of|next to|beside|before|after)\s+(.+)$/i;
  const match = cueRegex.exec(prompt.trim());
  if (!match) return null;

  const prep = match[1].toLowerCase();
  const rawPhrase = match[2]
    .trim()
    .replace(/^the\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/[.,!?]+$/, '')
    .trim();
  if (!rawPhrase) return null;

  let position: DirectionPosition = 'below';
  if (prep === 'above' || prep === 'over' || prep === 'before') {
    position = 'above';
  } else if (prep.includes('left')) {
    position = 'left';
  } else if (prep.includes('right') || prep === 'next to' || prep === 'beside') {
    position = 'right';
  } else {
    position = 'below';
  }

  return { position, phrase: rawPhrase };
}

function hasExplicitLabelClause(prompt: string): boolean {
  return /\b(called|named|labeled|labelled|titled|with label|with text)\b/i.test(prompt);
}

function hasCreationVerbOrShapeNoun(prompt: string): boolean {
  return /\b(add|create|draw|new|insert|put|rectangle|box|square|circle|oval|ellipse|diamond|decision|database|db|cylinder|triangle|terminator|pill|parallelogram)\b/i.test(
    prompt
  );
}

function isAnchorLabelLeak(rawLabel: string, anchorPhrase: string): boolean {
  const normLabel = normalizeText(rawLabel);
  if (!normLabel) return true;
  if (DIRECTION_LEAK_WORDS.has(normLabel)) return true;

  const normAnchor = normalizeText(anchorPhrase);
  if (!normAnchor) return false;
  if (normLabel === normAnchor) return true;

  // Needle 3 sometimes leaks the final word of an anchor label (e.g. "Gateway" from "API Gateway")
  const tokens = normAnchor.split(' ').filter(Boolean);
  return tokens.some((token) => token.length >= 3 && token === normLabel);
}

/**
 * Grounds validated Needle 3 tool calls against the live board nodes and user prompt.
 * Never synthesizes commands out of thin air when Needle 3 returns nothing; it only
 * resolves omitted relative anchors and repairs entity-slot leaks in model-emitted calls.
 */
export function groundNeedleToolCalls(
  calls: AiToolCommand[],
  promptText: string,
  nodes: DiagramNode[]
): AiToolCommand[] {
  if (calls.length === 0) return calls;

  const shapes = nodes.filter((n): n is ShapeNode => n.type === 'shape');
  const rawCue = extractRawRelativeCue(promptText);
  const anchorMatch = rawCue ? findUniqueShapeByPhrase(shapes, rawCue.phrase) : undefined;
  const explicitLabel = hasExplicitLabelClause(promptText);
  const wantsCreation = hasCreationVerbOrShapeNoun(promptText);

  return calls.map((call) => {
    if (call.name === 'add_shape') {
      const args = call.arguments;

      // Guard against "Make API Gateway green" misclassified by small model as add_shape
      if (!wantsCreation && args.label && args.color) {
        const existingTarget = findUniqueShapeByPhrase(shapes, args.label);
        if (existingTarget && /\b(make|turn|color|set|change)\b/i.test(promptText)) {
          return {
            name: 'set_shape_color',
            arguments: {
              target: existingTarget.label ?? existingTarget.id,
              color: args.color,
            },
          };
        }
      }

      let nextLabel = args.label;
      let nextPosition = args.position;
      let nextRelativeTo = args.relativeTo;

      if (rawCue) {
        if (anchorMatch) {
          const resolvedRel = nextRelativeTo
            ? findUniqueShapeByPhrase(shapes, nextRelativeTo)
            : undefined;
          nextRelativeTo = resolvedRel
            ? resolvedRel.label ?? resolvedRel.id
            : anchorMatch.label ?? anchorMatch.id;
        } else if (!nextRelativeTo) {
          // Preserve unresolved anchor reference so command execution reports a clear missing-shape error
          nextRelativeTo = rawCue.phrase;
        }

        if (!nextPosition || nextPosition === 'center') {
          nextPosition = rawCue.position;
        }
        const leakRef = anchorMatch?.label ?? rawCue.phrase;
        if (!explicitLabel && nextLabel && isAnchorLabelLeak(nextLabel, leakRef)) {
          nextLabel = undefined;
        }
      } else if (!explicitLabel && nextLabel && DIRECTION_LEAK_WORDS.has(normalizeText(nextLabel))) {
        nextLabel = undefined;
      }

      return {
        name: 'add_shape',
        arguments: {
          ...args,
          label: nextLabel,
          position: nextPosition,
          relativeTo: nextRelativeTo,
        },
      };
    }

    if (call.name === 'rename_shape') {
      const targetMatch = findUniqueShapeByPhrase(shapes, call.arguments.target);
      const labelMatch = findUniqueShapeByPhrase(shapes, call.arguments.label);
      if (!targetMatch && labelMatch) {
        return {
          name: 'rename_shape',
          arguments: {
            target: labelMatch.label ?? labelMatch.id,
            label: call.arguments.target,
          },
        };
      }
      if (targetMatch) {
        return {
          name: 'rename_shape',
          arguments: {
            target: targetMatch.label ?? targetMatch.id,
            label: call.arguments.label,
          },
        };
      }
    }

    return call;
  });
}

const KIND_PROMPT_SYNONYMS: Record<ShapeKind, RegExp> = {
  rectangle: /\b(rectangle|rect|box|square|card|service|step|process)\b/i,
  circle: /\b(circle|round)\b/i,
  ellipse: /\b(ellipse|oval)\b/i,
  terminator: /\b(terminator|pill|capsule|start|end)\b/i,
  diamond: /\b(diamond|decision|branch|condition)\b/i,
  parallelogram: /\b(parallelogram|input|output|i\/o)\b/i,
  triangle: /\b(triangle|delta)\b/i,
  database: /\b(database|databases|db|cylinder|storage|postgres|postgresql|mysql|mongo|sql)\b/i,
};

const COLOR_PROMPT_SYNONYMS: Record<PaletteColor, RegExp> = {
  slate: /\b(slate|gray|grey|black|dark)\b/i,
  blue: /\b(blue)\b/i,
  red: /\b(red)\b/i,
  green: /\b(green)\b/i,
  amber: /\b(amber|yellow|orange|gold)\b/i,
};

/**
 * Checks whether a low-confidence Needle 3 suppressed batch is non-destructive and
 * directly corroborated by keywords and existing board entities in the user's prompt.
 * When true, the caller can execute the undoable edit immediately instead of blocking
 * on a confirmation banner.
 */
export function areSuppressedCallsGroundedInPrompt(
  calls: AiToolCommand[],
  promptText: string
): boolean {
  if (calls.length === 0) return false;
  const normPrompt = normalizeText(promptText);

  return calls.every((call) => {
    if (call.name === 'add_shape') {
      const kindPattern = KIND_PROMPT_SYNONYMS[call.arguments.kind];
      if (!kindPattern.test(promptText)) return false;
      if (call.arguments.relativeTo) {
        return normPrompt.includes(normalizeText(call.arguments.relativeTo));
      }
      return true;
    }
    if (call.name === 'set_shape_color') {
      return (
        COLOR_PROMPT_SYNONYMS[call.arguments.color].test(promptText) &&
        normPrompt.includes(normalizeText(call.arguments.target))
      );
    }
    if (call.name === 'connect_shapes') {
      return (
        normPrompt.includes(normalizeText(call.arguments.from)) &&
        normPrompt.includes(normalizeText(call.arguments.to))
      );
    }
    if (call.name === 'rename_shape') {
      return normPrompt.includes(normalizeText(call.arguments.target));
    }
    return false;
  });
}

export function describeToolCall(call: AiToolCommand): string {
  switch (call.name) {
    case 'add_shape': {
      const rel =
        call.arguments.relativeTo && call.arguments.position && call.arguments.position !== 'center'
          ? ` ${call.arguments.position} "${call.arguments.relativeTo}"`
          : '';
      return `Add ${call.arguments.color ?? 'blue'} ${call.arguments.kind}${
        call.arguments.label ? ` "${call.arguments.label}"` : ''
      }${rel}`;
    }
    case 'connect_shapes':
      return `Connect "${call.arguments.from}" to "${call.arguments.to}"`;
    case 'rename_shape':
      return `Rename "${call.arguments.target}" to "${call.arguments.label}"`;
    case 'set_shape_color':
      return `Color "${call.arguments.target}" ${call.arguments.color}`;
    case 'move_shape':
      return `Move "${call.arguments.target}" ${call.arguments.direction}`;
    case 'delete_shape':
      return `Delete "${call.arguments.target}"`;
  }
}
