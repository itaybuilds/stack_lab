import { describe, expect, it } from 'vitest';
import { Point } from './diagramModel';
import {
  canAutoFinalizeSingleStroke,
  recognizeStrokeGroup,
  shouldSplitStrokeGroup,
} from './recognition';

function seededNoise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

function sampleSegment(a: Point, b: Point, steps = 16, jitter = 0, seed = 1): Point[] {
  const rand = seededNoise(seed);
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const jx = i === 0 || i === steps ? 0 : rand() * jitter;
    const jy = i === 0 || i === steps ? 0 : rand() * jitter;
    pts.push({
      x: a.x + (b.x - a.x) * t + jx,
      y: a.y + (b.y - a.y) * t + jy,
    });
  }
  return pts;
}

function samplePolygon(verts: Point[], closed = true, jitter = 2.5, seed = 42): Point[] {
  const pts: Point[] = [];
  const count = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < count; i++) {
    const seg = sampleSegment(verts[i], verts[(i + 1) % verts.length], 16, jitter, seed + i * 7);
    pts.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return pts;
}

function sampleEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  steps = 64,
  jitter = 2,
  gapRatio = 0
): Point[] {
  const rand = seededNoise(99);
  const pts: Point[] = [];
  const maxAngle = Math.PI * 2 * (1 - gapRatio);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * maxAngle;
    pts.push({
      x: cx + rx * Math.cos(a) + rand() * jitter,
      y: cy + ry * Math.sin(a) + rand() * jitter,
    });
  }
  return pts;
}

describe('Shape & Arrow Recognition', () => {
  it('recognizes a crooked slightly-open rectangle', () => {
    const rect = samplePolygon(
      [
        { x: 100, y: 100 },
        { x: 260, y: 104 },
        { x: 256, y: 170 },
        { x: 98, y: 168 },
      ],
      false,
      3.5,
      11
    );
    // Close mostly back to start with slight gap
    rect.push(...sampleSegment({ x: 98, y: 168 }, { x: 102, y: 112 }, 12, 2.5, 19));

    const res = recognizeStrokeGroup([rect], 'blue');
    expect(res.type).toBe('shape');
    if (res.type === 'shape') {
      expect(res.kind).toBe('rectangle');
      expect(res.color).toBe('blue');
    }
  });

  it('recognizes a square as rectangle and distinguishes circle vs ellipse', () => {
    const circle = sampleEllipse(300, 220, 45, 44, 60, 2.5);
    const circleRes = recognizeStrokeGroup([circle], 'slate');
    expect(circleRes.type).toBe('shape');
    if (circleRes.type === 'shape') {
      expect(circleRes.kind).toBe('circle');
    }

    const ellipse = sampleEllipse(300, 220, 95, 40, 64, 2.5);
    const ellipseRes = recognizeStrokeGroup([ellipse], 'green');
    expect(ellipseRes.type).toBe('shape');
    if (ellipseRes.type === 'shape') {
      expect(ellipseRes.kind).toBe('ellipse');
    }
  });

  it('recognizes a capsule terminator', () => {
    const pts: Point[] = [];
    // Top straight edge
    pts.push(...sampleSegment({ x: 140, y: 100 }, { x: 240, y: 100 }, 16, 1.5, 3));
    // Right semicircle
    for (let i = 1; i <= 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * Math.PI;
      pts.push({ x: 240 + 25 * Math.cos(a), y: 125 + 25 * Math.sin(a) });
    }
    // Bottom straight edge
    pts.push(...sampleSegment({ x: 240, y: 150 }, { x: 140, y: 150 }, 16, 1.5, 5));
    // Left semicircle
    for (let i = 1; i <= 16; i++) {
      const a = Math.PI / 2 + (i / 16) * Math.PI;
      pts.push({ x: 140 + 25 * Math.cos(a), y: 125 + 25 * Math.sin(a) });
    }

    const res = recognizeStrokeGroup([pts], 'blue');
    expect(res.type).toBe('shape');
    if (res.type === 'shape') {
      expect(res.kind).toBe('terminator');
    }
  });

  it('recognizes diamond and distinguishes it from parallelogram and rectangle', () => {
    const diamond = samplePolygon(
      [
        { x: 300, y: 100 },
        { x: 390, y: 155 },
        { x: 300, y: 210 },
        { x: 210, y: 155 },
      ],
      true,
      3,
      7
    );
    const res = recognizeStrokeGroup([diamond], 'amber');
    expect(res.type).toBe('shape');
    if (res.type === 'shape') {
      expect(res.kind).toBe('diamond');
    }

    const parallelogram = samplePolygon(
      [
        { x: 140, y: 100 },
        { x: 280, y: 100 },
        { x: 245, y: 165 },
        { x: 105, y: 165 },
      ],
      true,
      2,
      23
    );
    const pRes = recognizeStrokeGroup([parallelogram], 'slate');
    expect(pRes.type).toBe('shape');
    if (pRes.type === 'shape') {
      expect(pRes.kind).toBe('parallelogram');
    }
  });

  it('recognizes a triangle (both single-stroke and 3-stroke) and does not confuse it with an arrow', () => {
    const tri1 = samplePolygon(
      [
        { x: 200, y: 90 },
        { x: 270, y: 195 },
        { x: 130, y: 195 },
      ],
      true,
      2,
      31
    );
    const res1 = recognizeStrokeGroup([tri1], 'slate');
    expect(res1.type).toBe('shape');
    if (res1.type === 'shape') {
      expect(res1.kind).toBe('triangle');
    }

    const s1 = sampleSegment({ x: 200, y: 90 }, { x: 270, y: 195 }, 16, 1.5, 1);
    const s2 = sampleSegment({ x: 270, y: 195 }, { x: 130, y: 195 }, 16, 1.5, 2);
    const s3 = sampleSegment({ x: 130, y: 195 }, { x: 200, y: 90 }, 16, 1.5, 3);
    const res3 = recognizeStrokeGroup([s1, s2, s3], 'slate');
    expect(res3.type).toBe('shape');
    if (res3.type === 'shape') {
      expect(res3.kind).toBe('triangle');
    }
  });

  it('recognizes a multi-stroke database cylinder', () => {
    const topOval = sampleEllipse(220, 120, 55, 16, 40, 1.2);
    const leftWall = sampleSegment({ x: 165, y: 120 }, { x: 165, y: 210 }, 12, 1.5, 4);
    const rightWall = sampleSegment({ x: 275, y: 120 }, { x: 275, y: 210 }, 12, 1.5, 5);
    const bottomArc: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI;
      bottomArc.push({ x: 220 - 55 * Math.cos(a), y: 210 + 16 * Math.sin(a) });
    }
    const res = recognizeStrokeGroup([topOval, leftWall, rightWall, bottomArc], 'blue');
    expect(res.type).toBe('shape');
    if (res.type === 'shape') {
      expect(res.kind).toBe('database');
    }
  });

  it('recognizes a straight line, single-stroke arrow, multi-stroke single arrow, and double-headed arrow', () => {
    const line = sampleSegment({ x: 80, y: 100 }, { x: 260, y: 105 }, 24, 2, 9);
    const lineRes = recognizeStrokeGroup([line], 'slate');
    expect(lineRes.type).toBe('connector');
    if (lineRes.type === 'connector') {
      expect(lineRes.direction).toBe('none');
    }

    // Single-stroke arrow drawn continuously
    const singleArrow = [
      ...sampleSegment({ x: 100, y: 150 }, { x: 280, y: 150 }, 24, 1.2, 10),
      ...sampleSegment({ x: 280, y: 150 }, { x: 258, y: 136 }, 8, 0.8, 11).slice(1),
    ];
    const singleRes = recognizeStrokeGroup([singleArrow], 'slate');
    expect(singleRes.type).toBe('connector');
    if (singleRes.type === 'connector') {
      expect(singleRes.direction).toBe('single');
      expect(singleRes.end.x).toBeGreaterThan(singleRes.start.x);
    }

    // Multi-stroke arrow with V-head at start (reversed direction)
    const shaft = sampleSegment({ x: 100, y: 200 }, { x: 280, y: 200 }, 24, 1.5, 12);
    const headV = [
      ...sampleSegment({ x: 120, y: 185 }, { x: 100, y: 200 }, 8, 0.8, 13),
      ...sampleSegment({ x: 100, y: 200 }, { x: 120, y: 215 }, 8, 0.8, 14).slice(1),
    ];
    const revRes = recognizeStrokeGroup([shaft, headV], 'red');
    expect(revRes.type).toBe('connector');
    if (revRes.type === 'connector') {
      expect(revRes.direction).toBe('single');
      expect(revRes.end.x).toBeLessThan(revRes.start.x);
    }

    // Double-headed multi-stroke arrow
    const rightV = [
      ...sampleSegment({ x: 260, y: 185 }, { x: 280, y: 200 }, 8, 0.8, 15),
      ...sampleSegment({ x: 280, y: 200 }, { x: 260, y: 215 }, 8, 0.8, 16).slice(1),
    ];
    const dblRes = recognizeStrokeGroup([shaft, headV, rightV], 'green');
    expect(dblRes.type).toBe('connector');
    if (dblRes.type === 'connector') {
      expect(dblRes.direction).toBe('double');
    }
  });

  it('falls back to raw ink for handwriting / chaotic scribbles', () => {
    const scribble: Point[] = [];
    for (let i = 0; i < 60; i++) {
      scribble.push({
        x: 100 + i * 3,
        y: 200 + Math.sin(i * 1.3) * 35 + Math.cos(i * 0.7) * 18,
      });
    }
    const res = recognizeStrokeGroup([scribble], 'slate');
    expect(res.type).toBe('ink');
  });

  it('splits distant stroke groups and holds flat ovals for cylinder completion', () => {
    const strokeA = sampleSegment({ x: 50, y: 50 }, { x: 150, y: 50 }, 12);
    const strokeFar = sampleSegment({ x: 450, y: 350 }, { x: 550, y: 350 }, 12);
    expect(shouldSplitStrokeGroup([strokeA], strokeFar)).toBe(true);

    const flatOval = sampleEllipse(200, 120, 52, 16, 40, 0.5);
    expect(canAutoFinalizeSingleStroke(flatOval)).toBe(false);

    const bigCircle = sampleEllipse(300, 250, 50, 50, 60, 1);
    expect(canAutoFinalizeSingleStroke(bigCircle)).toBe(true);
  });

  it('recognizes a 2-stroke arrow whose > head extends slightly past the shaft tip', () => {
    const shaft = sampleSegment({ x: 100, y: 150 }, { x: 240, y: 152 }, 20, 1, 5);
    const head = [
      ...sampleSegment({ x: 222, y: 132 }, { x: 260, y: 151 }, 10, 1, 6),
      ...sampleSegment({ x: 260, y: 151 }, { x: 238, y: 172 }, 10, 1, 7).slice(1),
    ];
    const res = recognizeStrokeGroup([shaft, head], 'blue');
    expect(res.type).toBe('connector');
    if (res.type === 'connector') {
      expect(res.direction).toBe('single');
      expect(res.end.x).toBeGreaterThan(250);
    }
  });

  it('recognizes a short vertical arrow with a wide V-head', () => {
    const shaft = sampleSegment({ x: 200, y: 100 }, { x: 200, y: 146 }, 12, 0.8, 8);
    const vHead = [
      ...sampleSegment({ x: 184, y: 130 }, { x: 200, y: 148 }, 8, 0.8, 9),
      ...sampleSegment({ x: 200, y: 148 }, { x: 222, y: 130 }, 8, 0.8, 10).slice(1),
    ];
    const res = recognizeStrokeGroup([shaft, vHead], 'red');
    expect(res.type).toBe('connector');
    if (res.type === 'connector') {
      expect(res.direction).toBe('single');
      expect(res.end.y).toBeGreaterThan(res.start.y);
    }
  });

  it('does not turn a wide hollow block arrow outline into a diamond', () => {
    const blockArrow = samplePolygon(
      [
        { x: 100, y: 140 },
        { x: 200, y: 140 },
        { x: 200, y: 110 },
        { x: 270, y: 155 },
        { x: 200, y: 200 },
        { x: 200, y: 170 },
        { x: 100, y: 170 },
      ],
      true,
      2,
      77
    );
    const res = recognizeStrokeGroup([blockArrow], 'blue');
    expect(res.type).toBe('ink');
  });

  it('recognizes a single-shot open-ended database cylinder', () => {
    // Mimics drawing a DB cylinder in one continuous stroke:
    // top rim -> right curve -> oval seam -> left loop -> down left wall -> bottom -> up right wall
    const singleDb: Point[] = [];
    // Top arc left-to-right
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI + (i / 14) * Math.PI;
      singleDb.push({ x: 200 + 70 * Math.cos(a), y: 120 + 22 * Math.sin(a) });
    }
    // Oval bottom seam right-to-left
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      singleDb.push({ x: 200 + 70 * Math.cos(a), y: 128 + 30 * Math.sin(a) });
    }
    // Down left wall
    singleDb.push(...sampleSegment({ x: 130, y: 128 }, { x: 132, y: 235 }, 12, 1, 21).slice(1));
    // Across bottom base
    singleDb.push(...sampleSegment({ x: 132, y: 235 }, { x: 268, y: 235 }, 14, 1, 22).slice(1));
    // Up right wall stopping mid-right (not closed back to start)
    singleDb.push(...sampleSegment({ x: 268, y: 235 }, { x: 268, y: 145 }, 10, 1, 23).slice(1));

    const res = recognizeStrokeGroup([singleDb], 'slate');
    expect(res.type).toBe('shape');
    if (res.type === 'shape') {
      expect(res.kind).toBe('database');
    }
  });

  it('recognizes a multi-stroke database cylinder even when the top cap is rounder', () => {
    const topOval = sampleEllipse(220, 130, 56, 42, 48, 1.5);
    const uBody: Point[] = [
      ...sampleSegment({ x: 164, y: 136 }, { x: 162, y: 238 }, 12, 1.2, 31),
      ...sampleSegment({ x: 162, y: 238 }, { x: 274, y: 236 }, 14, 1.2, 32).slice(1),
      ...sampleSegment({ x: 274, y: 236 }, { x: 278, y: 142 }, 12, 1.2, 33).slice(1),
    ];
    const res = recognizeStrokeGroup([topOval, uBody], 'slate');
    expect(res.type).toBe('shape');
    if (res.type === 'shape') {
      expect(res.kind).toBe('database');
    }
  });
});
