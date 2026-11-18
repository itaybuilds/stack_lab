import {
  Bounds,
  ConnectorNode,
  DiagramNode,
  Endpoint,
  InkNode,
  Point,
  ShapeNode,
} from './diagramModel';

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeBounds(points: Point[]): Bounds {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!isFinitePoint(p)) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function unionBounds(strokes: Point[][]): Bounds {
  return computeBounds(strokes.flat());
}

export function boundsCenter(b: Bounds): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function expandBounds(b: Bounds, pad: number): Bounds {
  return {
    x: b.x - pad,
    y: b.y - pad,
    width: b.width + pad * 2,
    height: b.height + pad * 2,
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += distance(points[i - 1], points[i]);
  }
  return len;
}

export function resampleStroke(points: Point[], targetCount = 64): Point[] {
  const clean = points.filter(isFinitePoint);
  if (clean.length === 0) return [];
  if (clean.length === 1) return Array.from({ length: targetCount }, () => ({ ...clean[0] }));

  const total = pathLength(clean);
  if (total < 1e-3) {
    return Array.from({ length: targetCount }, () => ({ ...clean[0] }));
  }

  const step = total / Math.max(1, targetCount - 1);
  const result: Point[] = [{ ...clean[0] }];
  let accumulated = 0;
  let prev = clean[0];

  for (let i = 1; i < clean.length; i++) {
    let curr = clean[i];
    let segLen = distance(prev, curr);
    while (accumulated + segLen >= step && result.length < targetCount) {
      const t = (step - accumulated) / Math.max(segLen, 1e-9);
      const interpolated = {
        x: prev.x + t * (curr.x - prev.x),
        y: prev.y + t * (curr.y - prev.y),
      };
      result.push(interpolated);
      prev = interpolated;
      segLen = distance(prev, curr);
      accumulated = 0;
    }
    accumulated += segLen;
    prev = curr;
  }

  while (result.length < targetCount) {
    result.push({ ...clean[clean.length - 1] });
  }
  return result;
}

export function smoothStroke(points: Point[], window = 2): Point[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  return points.map((p, idx) => {
    if (idx === 0 || idx === points.length - 1) return { ...p };
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let j = Math.max(0, idx - window); j <= Math.min(points.length - 1, idx + window); j++) {
      sx += points[j].x;
      sy += points[j].y;
      count++;
    }
    return { x: sx / count, y: sy / count };
  });
}

export function pointToSegmentDistance(p: Point, a: Point, b: Point): { dist: number; closest: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { dist: distance(p, a), closest: { ...a } };
  }
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: distance(p, closest), closest };
}

export function rdpSimplify(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const { dist } = pointToSegmentDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, index + 1), epsilon);
    const right = rdpSimplify(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [{ ...start }, { ...end }];
}

export function signedArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function polygonArea(points: Point[]): number {
  return Math.abs(signedArea(points));
}

export function convexHull(points: Point[]): Point[] {
  const clean = points.filter(isFinitePoint);
  if (clean.length <= 2) return clean.map((p) => ({ ...p }));
  const sorted = [...clean].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function closestPointOnShapeBoundary(shape: ShapeNode, target: Point): Point {
  const { x, y, width, height } = shape.bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;

  if (shape.kind === 'circle' || shape.kind === 'ellipse') {
    const rx = Math.max(1, width / 2);
    const ry = Math.max(1, height / 2);
    const angle = Math.atan2((target.y - cy) / ry, (target.x - cx) / rx);
    return {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  }

  if (shape.kind === 'diamond') {
    const verts: Point[] = [
      { x: cx, y },
      { x: x + width, y: cy },
      { x: cx, y: y + height },
      { x, y: cy },
    ];
    return closestPointOnPolygon(verts, target);
  }

  if (shape.kind === 'triangle') {
    const verts: Point[] = [
      { x: cx, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
    return closestPointOnPolygon(verts, target);
  }

  if (shape.kind === 'parallelogram') {
    const skew = Math.min(24, width * 0.16);
    const verts: Point[] = [
      { x: x + skew, y },
      { x: x + width, y },
      { x: x + width - skew, y: y + height },
      { x, y: y + height },
    ];
    return closestPointOnPolygon(verts, target);
  }

  const dx = target.x - cx;
  const dy = target.y - cy;
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) {
    return { x: cx, y };
  }
  const hw = Math.max(1, width / 2);
  const hh = Math.max(1, height / 2);
  const scaleX = Math.abs(dx) / hw;
  const scaleY = Math.abs(dy) / hh;
  const scale = Math.max(scaleX, scaleY, 1e-6);
  return {
    x: cx + dx / scale,
    y: cy + dy / scale,
  };
}

function closestPointOnPolygon(verts: Point[], target: Point): Point {
  let bestDist = Infinity;
  let best = verts[0];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const { dist, closest } = pointToSegmentDistance(target, a, b);
    if (dist < bestDist) {
      bestDist = dist;
      best = closest;
    }
  }
  return best;
}

function isPointInsideBounds(point: Point, b: Bounds, pad = 10): boolean {
  return (
    point.x >= b.x - pad &&
    point.x <= b.x + b.width + pad &&
    point.y >= b.y - pad &&
    point.y <= b.y + b.height + pad
  );
}

export function snapEndpointToShapes(
  point: Point,
  shapes: ShapeNode[],
  maxSnapDistance = 64
): Endpoint {
  // 1. Prefer a shape the pointer is actually inside (or immediately touching)
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (isPointInsideBounds(point, shape.bounds, 10)) {
      return {
        point: closestPointOnShapeBoundary(shape, point),
        shapeId: shape.id,
      };
    }
  }

  // 2. Otherwise pick the closest shape boundary within maxSnapDistance
  let bestShape: ShapeNode | undefined;
  let bestPoint = point;
  let bestDist = maxSnapDistance;

  for (const shape of shapes) {
    const boundaryPoint = closestPointOnShapeBoundary(shape, point);
    const d = distance(point, boundaryPoint);
    if (d <= bestDist) {
      bestDist = d;
      bestShape = shape;
      bestPoint = boundaryPoint;
    }
  }

  if (bestShape) {
    return { point: bestPoint, shapeId: bestShape.id };
  }
  return { point: { ...point } };
}

function findShapeAlongRay(
  origin: Point,
  dir: Point,
  shapes: ShapeNode[],
  maxDistance = 135,
  excludeShapeId?: string
): ShapeNode | undefined {
  let bestShape: ShapeNode | undefined;
  let bestT = maxDistance + 1;

  for (const shape of shapes) {
    if (shape.id === excludeShapeId) continue;
    const b = expandBounds(shape.bounds, 20);
    for (let step = 8; step <= maxDistance; step += 8) {
      const sample = { x: origin.x + dir.x * step, y: origin.y + dir.y * step };
      if (
        sample.x >= b.x &&
        sample.x <= b.x + b.width &&
        sample.y >= b.y &&
        sample.y <= b.y + b.height
      ) {
        if (step < bestT) {
          bestT = step;
          bestShape = shape;
        }
        break;
      }
    }
  }
  return bestShape;
}

export function snapConnectorEndpoints(
  rawStart: Point,
  rawEnd: Point,
  shapes: ShapeNode[]
): { start: Endpoint; end: Endpoint } {
  let start = snapEndpointToShapes(rawStart, shapes, 64);
  let end = snapEndpointToShapes(rawEnd, shapes, 64);

  const shapesById = new Map(shapes.map((s) => [s.id, s]));

  // If both endpoints snapped to the same shape, keep only the closer endpoint
  // and allow the other endpoint to search remaining shapes.
  if (start.shapeId && end.shapeId && start.shapeId === end.shapeId) {
    const shared = shapesById.get(start.shapeId);
    if (shared) {
      const startInside = isPointInsideBounds(rawStart, shared.bounds, 0);
      const endInside = isPointInsideBounds(rawEnd, shared.bounds, 0);
      if (startInside && endInside) {
        return {
          start: { point: { ...rawStart } },
          end: { point: { ...rawEnd } },
        };
      }
      const dStart = distance(rawStart, start.point);
      const dEnd = distance(rawEnd, end.point);
      const otherShapes = shapes.filter((s) => s.id !== shared.id);
      if (dStart <= dEnd) {
        end = snapEndpointToShapes(rawEnd, otherShapes, 64);
      } else {
        start = snapEndpointToShapes(rawStart, otherShapes, 64);
      }
    }
  }

  const len = distance(rawStart, rawEnd);
  if (len >= 12) {
    const dir = { x: (rawEnd.x - rawStart.x) / len, y: (rawEnd.y - rawStart.y) / len };
    if (!start.shapeId) {
      const rayBackShape = findShapeAlongRay(
        rawStart,
        { x: -dir.x, y: -dir.y },
        shapes,
        135,
        end.shapeId
      );
      if (rayBackShape) {
        start = {
          shapeId: rayBackShape.id,
          point: closestPointOnShapeBoundary(rayBackShape, rawStart),
        };
      }
    }
    if (!end.shapeId) {
      const rayFwdShape = findShapeAlongRay(rawEnd, dir, shapes, 135, start.shapeId);
      if (rayFwdShape) {
        end = {
          shapeId: rayFwdShape.id,
          point: closestPointOnShapeBoundary(rayFwdShape, rawEnd),
        };
      }
    }
  }

  const startShape = start.shapeId ? shapesById.get(start.shapeId) : undefined;
  const endShape = end.shapeId ? shapesById.get(end.shapeId) : undefined;

  // When connecting two distinct shapes, anchor them cleanly edge-to-edge
  if (startShape && endShape && startShape.id !== endShape.id) {
    return computeConnectorAnchors(startShape, endShape);
  }

  // If only one end snapped to a shape, orient its boundary anchor toward the other point
  if (startShape && !endShape) {
    start = {
      shapeId: startShape.id,
      point: closestPointOnShapeBoundary(startShape, end.point),
    };
  } else if (endShape && !startShape) {
    end = {
      shapeId: endShape.id,
      point: closestPointOnShapeBoundary(endShape, start.point),
    };
  }

  return { start, end };
}

export function updateBoundConnectors(nodes: DiagramNode[], movedShape: ShapeNode): DiagramNode[] {
  const shapesById = new Map<string, ShapeNode>();
  for (const node of nodes) {
    if (node.type === 'shape') {
      shapesById.set(node.id, node.id === movedShape.id ? movedShape : node);
    }
  }

  return nodes.map((node) => {
    if (node.type !== 'connector') return node;
    const touchesStart = node.start.shapeId === movedShape.id;
    const touchesEnd = node.end.shapeId === movedShape.id;
    if (!touchesStart && !touchesEnd) return node;

    const startShape = node.start.shapeId ? shapesById.get(node.start.shapeId) : undefined;
    const endShape = node.end.shapeId ? shapesById.get(node.end.shapeId) : undefined;

    if (startShape && endShape && startShape.id !== endShape.id) {
      const anchors = computeConnectorAnchors(startShape, endShape);
      return { ...node, start: anchors.start, end: anchors.end };
    }

    const startTarget = endShape ? boundsCenter(endShape.bounds) : node.end.point;
    const endTarget = startShape ? boundsCenter(startShape.bounds) : node.start.point;

    const nextStart: Endpoint = startShape
      ? {
          shapeId: startShape.id,
          point: closestPointOnShapeBoundary(startShape, startTarget),
        }
      : node.start;

    const nextEnd: Endpoint = endShape
      ? {
          shapeId: endShape.id,
          point: closestPointOnShapeBoundary(endShape, endTarget),
        }
      : node.end;

    return {
      ...node,
      start: nextStart,
      end: nextEnd,
    };
  });
}

export function computeConnectorAnchors(from: ShapeNode, to: ShapeNode): {
  start: Endpoint;
  end: Endpoint;
} {
  const fromCenter = boundsCenter(from.bounds);
  const toCenter = boundsCenter(to.bounds);
  const dx = Math.abs(fromCenter.x - toCenter.x);
  const dy = Math.abs(fromCenter.y - toCenter.y);

  // Use clean top/bottom or left/right center ports when shapes are roughly aligned
  if (dx <= 26 && dy > 26) {
    return {
      start: {
        shapeId: from.id,
        point: closestPointOnShapeBoundary(from, { x: fromCenter.x, y: toCenter.y }),
      },
      end: {
        shapeId: to.id,
        point: closestPointOnShapeBoundary(to, { x: toCenter.x, y: fromCenter.y }),
      },
    };
  }
  if (dy <= 26 && dx > 26) {
    return {
      start: {
        shapeId: from.id,
        point: closestPointOnShapeBoundary(from, { x: toCenter.x, y: fromCenter.y }),
      },
      end: {
        shapeId: to.id,
        point: closestPointOnShapeBoundary(to, { x: fromCenter.x, y: toCenter.y }),
      },
    };
  }

  return {
    start: {
      shapeId: from.id,
      point: closestPointOnShapeBoundary(from, toCenter),
    },
    end: {
      shapeId: to.id,
      point: closestPointOnShapeBoundary(to, fromCenter),
    },
  };
}

export function getNodeBounds(node: DiagramNode): Bounds {
  if (node.type === 'shape' || node.type === 'ink') {
    return node.bounds;
  }
  if (node.type === 'connector') {
    return computeBounds([node.start.point, node.end.point]);
  }
  const approxWidth = Math.max(48, node.text.length * 8.5 + 12);
  return {
    x: node.position.x - approxWidth / 2,
    y: node.position.y - 14,
    width: approxWidth,
    height: 28,
  };
}

export function hitTestNode(nodes: DiagramNode[], point: Point, tolerance = 10): DiagramNode | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.type === 'text') {
      const b = expandBounds(getNodeBounds(node), tolerance);
      if (
        point.x >= b.x &&
        point.x <= b.x + b.width &&
        point.y >= b.y &&
        point.y <= b.y + b.height
      ) {
        return node;
      }
      continue;
    }
    if (node.type === 'connector') {
      const { dist } = pointToSegmentDistance(point, node.start.point, node.end.point);
      if (dist <= tolerance + 4) return node;
      continue;
    }
    if (node.type === 'ink') {
      for (const stroke of node.strokes) {
        for (let j = 1; j < stroke.length; j++) {
          if (pointToSegmentDistance(point, stroke[j - 1], stroke[j]).dist <= tolerance + 2) {
            return node;
          }
        }
      }
      continue;
    }
    const b = expandBounds(node.bounds, tolerance * 0.5);
    if (
      point.x >= b.x &&
      point.x <= b.x + b.width &&
      point.y >= b.y &&
      point.y <= b.y + b.height
    ) {
      return node;
    }
  }
  return undefined;
}

export function translateNode(node: DiagramNode, dx: number, dy: number): DiagramNode {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return node;
  if (node.type === 'shape') {
    return {
      ...node,
      bounds: {
        ...node.bounds,
        x: node.bounds.x + dx,
        y: node.bounds.y + dy,
      },
    };
  }
  if (node.type === 'text') {
    return {
      ...node,
      position: { x: node.position.x + dx, y: node.position.y + dy },
    };
  }
  if (node.type === 'ink') {
    return {
      ...node,
      bounds: {
        ...node.bounds,
        x: node.bounds.x + dx,
        y: node.bounds.y + dy,
      },
      strokes: node.strokes.map((s) => s.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
    };
  }
  return {
    ...node,
    start: {
      point: { x: node.start.point.x + dx, y: node.start.point.y + dy },
    },
    end: {
      point: { x: node.end.point.x + dx, y: node.end.point.y + dy },
    },
  };
}

export function makeConnectorDefault(
  start: Endpoint,
  end: Endpoint,
  color: ConnectorNode['color'],
  direction: ConnectorNode['direction'] = 'single'
): Omit<ConnectorNode, 'id'> {
  return {
    type: 'connector',
    start,
    end,
    direction,
    color,
  };
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function computeResizedBounds(
  initial: Bounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  minSize = 24
): Bounds {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return initial;

  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;

  if (handle.includes('w')) {
    left = Math.min(right - minSize, initial.x + dx);
  }
  if (handle.includes('e')) {
    right = Math.max(left + minSize, initial.x + initial.width + dx);
  }
  if (handle.includes('n')) {
    top = Math.min(bottom - minSize, initial.y + dy);
  }
  if (handle.includes('s')) {
    bottom = Math.max(top + minSize, initial.y + initial.height + dy);
  }

  return {
    x: left,
    y: top,
    width: Math.max(minSize, right - left),
    height: Math.max(minSize, bottom - top),
  };
}

export function scaleInkNode(node: InkNode, nextBounds: Bounds): InkNode {
  const oldB = node.bounds;
  const oldW = Math.max(1, oldB.width);
  const oldH = Math.max(1, oldB.height);

  const scaledStrokes = node.strokes.map((stroke) =>
    stroke.map((pt) => ({
      x: nextBounds.x + ((pt.x - oldB.x) / oldW) * nextBounds.width,
      y: nextBounds.y + ((pt.y - oldB.y) / oldH) * nextBounds.height,
    }))
  );

  return {
    ...node,
    bounds: nextBounds,
    strokes: scaledStrokes,
  };
}
