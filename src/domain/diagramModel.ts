export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShapeKind =
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'terminator'
  | 'diamond'
  | 'parallelogram'
  | 'triangle'
  | 'database';

export type PaletteColor = 'slate' | 'blue' | 'red' | 'green' | 'amber';

export type ArrowDirection = 'none' | 'single' | 'double';

export type ToolMode = 'pen' | 'ink' | 'select' | 'erase' | 'text';

export type Endpoint = {
  point: Point;
  shapeId?: string;
};

export type ShapeNode = {
  type: 'shape';
  id: string;
  kind: ShapeKind;
  bounds: Bounds;
  color: PaletteColor;
  label?: string;
  sourceStrokes?: Point[][];
};

export type ConnectorNode = {
  type: 'connector';
  id: string;
  start: Endpoint;
  end: Endpoint;
  direction: ArrowDirection;
  color: PaletteColor;
  label?: string;
  sourceStrokes?: Point[][];
};

export type InkNode = {
  type: 'ink';
  id: string;
  strokes: Point[][];
  bounds: Bounds;
  color: PaletteColor;
};

export type TextNode = {
  type: 'text';
  id: string;
  position: Point;
  text: string;
  color: PaletteColor;
};

export type DiagramNode = ShapeNode | ConnectorNode | InkNode | TextNode;

export type DiagramState = {
  nodes: DiagramNode[];
  revision: number;
};

export type PaletteStyle = {
  name: string;
  stroke: string;
  fill: string;
  text: string;
};

export const PALETTE_STYLES: Record<PaletteColor, PaletteStyle> = {
  slate: {
    name: 'Slate',
    stroke: '#334155',
    fill: '#f8fafc',
    text: '#1e293b',
  },
  blue: {
    name: 'Blue',
    stroke: '#2563eb',
    fill: '#dbeafe',
    text: '#1e3a8a',
  },
  red: {
    name: 'Red',
    stroke: '#dc2626',
    fill: '#fee2e2',
    text: '#7f1d1d',
  },
  green: {
    name: 'Green',
    stroke: '#16a34a',
    fill: '#dcfce7',
    text: '#14532d',
  },
  amber: {
    name: 'Amber',
    stroke: '#d97706',
    fill: '#fef3c7',
    text: '#78350f',
  },
};

export const PALETTE_ORDER: PaletteColor[] = ['slate', 'blue', 'red', 'green', 'amber'];

export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  terminator: 'Terminator',
  diamond: 'Diamond',
  parallelogram: 'Parallelogram',
  triangle: 'Triangle',
  database: 'Database',
};

export const DEFAULT_SHAPE_DIMENSIONS: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 164, height: 54 },
  circle: { width: 76, height: 76 },
  ellipse: { width: 150, height: 64 },
  terminator: { width: 160, height: 48 },
  diamond: { width: 160, height: 92 },
  parallelogram: { width: 166, height: 58 },
  triangle: { width: 120, height: 96 },
  database: { width: 128, height: 84 },
};
