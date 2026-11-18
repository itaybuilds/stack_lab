import {
  ArrowDirection,
  Bounds,
  PaletteColor,
  Point,
  ShapeKind,
  ShapeNode,
} from './diagramModel';
import {
  boundsIntersect,
  clamp,
  computeBounds,
  convexHull,
  distance,
  expandBounds,
  pathLength,
  pointToSegmentDistance,
  polygonArea,
  rdpSimplify,
  resampleStroke,
  smoothStroke,
  unionBounds,
} from './geometry';

export type RecognitionCandidateScore = {
  label: string;
  score: number;
};

export type RecognitionResult =
  | {
      type: 'shape';
      kind: ShapeKind;
      bounds: Bounds;
      color: PaletteColor;
      confidence: number;
      candidates: RecognitionCandidateScore[];
    }
  | {
      type: 'connector';
      start: Point;
      end: Point;
      direction: ArrowDirection;
      color: PaletteColor;
      confidence: number;
      candidates: RecognitionCandidateScore[];
    }
  | {
      type: 'ink';
      strokes: Point[][];
      bounds: Bounds;
      color: PaletteColor;
      confidence: number;
      reason: string;
    };

export function shouldSplitStrokeGroup(existingStrokes: Point[][], nextStroke: Point[]): boolean {
  if (existingStrokes.length === 0) return false;
  if (existingStrokes.length >= 6) return true;

  const groupBounds = unionBounds(existingStrokes);
  const nextBounds = computeBounds(nextStroke);
  const pad = clamp(Math.max(groupBounds.width, groupBounds.height) * 0.45, 44, 120);
  const expanded = expandBounds(groupBounds, pad);
  return !boundsIntersect(expanded, nextBounds);
}

export function canAutoFinalizeSingleStroke(stroke: Point[]): boolean {
  if (stroke.length < 8) return false;
  const bounds = computeBounds(stroke);
  const maxDim = Math.max(bounds.width, bounds.height);
  if (maxDim < 32) return false;

  const len = pathLength(stroke);
  if (len < 85) return false;

  const closure = distance(stroke[0], stroke[stroke.length - 1]);
  const isTightlyClosed = closure <= Math.max(20, maxDim * 0.18);
  if (!isTightlyClosed) return false;

  // Flat or medium ovals may be the top cap of a multi-stroke database cylinder
  const aspect = bounds.width / Math.max(1, bounds.height);
  if (aspect >= 1.35 && bounds.height <= 85) {
    return false;
  }

  const res = recognizeStrokeGroup([stroke], 'slate');
  return res.type === 'shape' && res.confidence >= 0.72;
}

export function recognizeStrokeGroup(
  rawStrokes: Point[][],
  color: PaletteColor
): RecognitionResult {
  const strokes = rawStrokes.filter((s) => s.length >= 2);
  if (strokes.length === 0) {
    return {
      type: 'ink',
      strokes: rawStrokes,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      color,
      confidence: 0,
      reason: 'empty',
    };
  }

  const groupBounds = unionBounds(strokes);
  const maxDim = Math.max(groupBounds.width, groupBounds.height);
  const totalLen = strokes.reduce((acc, s) => acc + pathLength(s), 0);

  if (maxDim < 20 || totalLen < 24) {
    return {
      type: 'ink',
      strokes,
      bounds: groupBounds,
      color,
      confidence: 0,
      reason: 'too-small',
    };
  }

  // 1. Check multi-stroke cylinder (database) before connectors
  if (strokes.length >= 2 && strokes.length <= 4) {
    const dbScore = scoreMultiStrokeDatabase(strokes, groupBounds);
    if (dbScore >= 0.68) {
      return {
        type: 'shape',
        kind: 'database',
        bounds: normalizeShapeBounds(groupBounds, 'database'),
        color,
        confidence: dbScore,
        candidates: [{ label: 'database', score: dbScore }],
      };
    }
  }

  // 2. Check multi-stroke closed polygon vs multi-stroke arrow/line
  if (strokes.length >= 2) {
    const stitched = tryStitchClosedLoop(strokes, groupBounds);
    const arrowMulti = tryRecognizeMultiStrokeArrow(strokes);

    if (stitched && (!arrowMulti || stitched.closureRatio < 0.22)) {
      const closedResult = classifyClosedContour(stitched.contour, color, strokes);
      if (closedResult.type === 'shape' && closedResult.confidence >= 0.66) {
        return closedResult;
      }
    }

    if (arrowMulti && arrowMulti.confidence >= 0.68) {
      return {
        type: 'connector',
        start: arrowMulti.start,
        end: arrowMulti.end,
        direction: arrowMulti.direction,
        color,
        confidence: arrowMulti.confidence,
        candidates: [{ label: `connector:${arrowMulti.direction}`, score: arrowMulti.confidence }],
      };
    }

    if (stitched) {
      const closedResult = classifyClosedContour(stitched.contour, color, strokes);
      if (closedResult.type === 'shape' && closedResult.confidence >= 0.62) {
        return closedResult;
      }
    }

    return {
      type: 'ink',
      strokes,
      bounds: groupBounds,
      color,
      confidence: 0,
      reason: 'multi-stroke-ambiguous',
    };
  }

  // 3. Single-stroke recognition
  const stroke = strokes[0];
  const smoothed = smoothStroke(stroke, 2);
  const start = smoothed[0];
  const end = smoothed[smoothed.length - 1];
  const endDist = distance(start, end);
  const len = pathLength(smoothed);
  const diag = Math.hypot(groupBounds.width, groupBounds.height);

  // 3a. Straight line check
  const straightness = len > 0 ? endDist / len : 0;
  if (straightness >= 0.90 && endDist >= 24) {
    const maxDev = maxPerpendicularDeviation(smoothed, start, end);
    if (maxDev <= Math.max(8, endDist * 0.11)) {
      const conf = clamp(0.75 + (straightness - 0.9) * 2.2, 0.75, 0.98);
      return {
        type: 'connector',
        start,
        end,
        direction: 'none',
        color,
        confidence: conf,
        candidates: [{ label: 'connector:none', score: conf }],
      };
    }
  }

  // 3b. Single-stroke arrow check (shaft + barb head drawn continuously)
  const singleArrow = tryRecognizeSingleStrokeArrow(smoothed);
  if (singleArrow && singleArrow.confidence >= 0.70) {
    return {
      type: 'connector',
      start: singleArrow.start,
      end: singleArrow.end,
      direction: singleArrow.direction,
      color,
      confidence: singleArrow.confidence,
      candidates: [{ label: `connector:${singleArrow.direction}`, score: singleArrow.confidence }],
    };
  }

  // 3b-bis. Single-stroke database cylinder (works even if start & end points don't meet)
  const singleDbScore = scoreSingleStrokeDatabase(smoothed, groupBounds);
  if (singleDbScore >= 0.72) {
    return {
      type: 'shape',
      kind: 'database',
      bounds: normalizeShapeBounds(groupBounds, 'database'),
      color,
      confidence: singleDbScore,
      candidates: [{ label: 'database', score: singleDbScore }],
    };
  }

  // 3c. Single-stroke closed shape check
  const closureRatio = diag > 0 ? endDist / diag : 1;
  const minEdge = Math.min(groupBounds.width, groupBounds.height);
  if (closureRatio <= 0.36 && minEdge >= 18) {
    const closedResult = classifyClosedContour(smoothed, color, strokes);
    if (closedResult.type === 'shape') {
      return closedResult;
    }
  }

  return {
    type: 'ink',
    strokes,
    bounds: groupBounds,
    color,
    confidence: 0,
    reason: 'unrecognized-single-stroke',
  };
}

function maxPerpendicularDeviation(points: Point[], a: Point, b: Point): number {
  let maxD = 0;
  for (const p of points) {
    const { dist } = pointToSegmentDistance(p, a, b);
    if (dist > maxD) maxD = dist;
  }
  return maxD;
}

function tryRecognizeSingleStrokeArrow(
  points: Point[]
): { start: Point; end: Point; direction: ArrowDirection; confidence: number } | null {
  const resampled = resampleStroke(points, 48);
  if (resampled.length < 14) return null;

  const tryFromTail = (pts: Point[], reversed: boolean) => {
    let best: { tipIdx: number; score: number; shaftEnd: Point; tip: Point } | null = null;
    for (let idx = Math.floor(pts.length * 0.48); idx <= Math.floor(pts.length * 0.92); idx++) {
      const shaft = pts.slice(0, idx + 1);
      const head = pts.slice(idx);
      const sStart = shaft[0];
      const tip = shaft[shaft.length - 1];
      const shaftDist = distance(sStart, tip);
      const shaftLen = pathLength(shaft);
      if (shaftDist < 28 || shaftLen < 28) continue;
      const shaftStraight = shaftDist / shaftLen;
      if (shaftStraight < 0.86) continue;

      const headLen = pathLength(head);
      if (headLen < 9 || headLen > Math.max(64, shaftDist * 0.95)) continue;

      const shaftVec = { x: (tip.x - sStart.x) / shaftDist, y: (tip.y - sStart.y) / shaftDist };
      const maxHeadSpan = Math.max(...head.map((p) => distance(p, tip)));
      if (maxHeadSpan < 6 || maxHeadSpan > Math.max(46, shaftDist * 0.58)) continue;

      // Measure backward reach along -shaftVec and lateral flare across shaft
      const projForward = head.map(
        (p) => (p.x - tip.x) * shaftVec.x + (p.y - tip.y) * shaftVec.y
      );
      const minBackward = -Math.min(...projForward);
      if (minBackward < 5) continue;
      if (Math.max(...projForward) > Math.max(14, minBackward * 0.65)) continue;

      const perpOffset = maxPerpendicularDeviation(head, sStart, tip);
      if (perpOffset < 4) continue;

      const score = clamp(
        0.58 + (shaftStraight - 0.86) * 2.2 + Math.min(0.2, minBackward / Math.max(1, shaftDist) * 0.6),
        0,
        0.96
      );
      if (!best || score > best.score) {
        best = { tipIdx: idx, score, shaftEnd: sStart, tip };
      }
    }
    if (!best) return null;
    return {
      start: reversed ? best.tip : best.shaftEnd,
      end: reversed ? best.shaftEnd : best.tip,
      direction: 'single' as ArrowDirection,
      confidence: best.score,
    };
  };

  const forward = tryFromTail(resampled, false);
  const backward = tryFromTail([...resampled].reverse(), true);
  if (forward && (!backward || forward.confidence >= backward.confidence)) return forward;
  return backward;
}

function tryRecognizeMultiStrokeArrow(
  strokes: Point[][]
): { start: Point; end: Point; direction: ArrowDirection; confidence: number } | null {
  if (strokes.length < 2 || strokes.length > 5) return null;

  // Candidate shaft: longest nearly-straight stroke
  const stats = strokes.map((s, idx) => {
    const sm = smoothStroke(s, 1);
    const d = distance(sm[0], sm[sm.length - 1]);
    const l = pathLength(sm);
    return {
      idx,
      stroke: sm,
      start: sm[0],
      end: sm[sm.length - 1],
      endDist: d,
      len: l,
      straightness: l > 0 ? d / l : 0,
    };
  });

  const straightCandidates = stats
    .filter((s) => s.endDist >= 24 && s.straightness >= 0.82)
    .sort((a, b) => b.endDist - a.endDist);
  if (straightCandidates.length === 0) return null;

  const shaft = straightCandidates[0];
  const others = stats.filter((s) => s.idx !== shaft.idx);
  const shaftVec = {
    x: (shaft.end.x - shaft.start.x) / shaft.endDist,
    y: (shaft.end.y - shaft.start.y) / shaft.endDist,
  };
  const headRadius = clamp(shaft.endDist * 0.48, 30, 75);

  let startHeadStrokes = 0;
  let endHeadStrokes = 0;
  let adjustedEnd = shaft.end;
  let adjustedStart = shaft.start;

  for (const other of others) {
    // Allow 2-barb V-strokes whose total path length is up to ~1.35x a short shaft
    if (other.len > Math.max(72, shaft.endDist * 1.35)) return null;

    const minDistToStart = Math.min(...other.stroke.map((p) => distance(p, shaft.start)));
    const minDistToEnd = Math.min(...other.stroke.map((p) => distance(p, shaft.end)));
    const maxDistFromStart = Math.max(...other.stroke.map((p) => distance(p, shaft.start)));
    const maxDistFromEnd = Math.max(...other.stroke.map((p) => distance(p, shaft.end)));

    const nearEnd = minDistToEnd <= headRadius * 0.85 && maxDistFromEnd <= headRadius * 1.65;
    const nearStart = minDistToStart <= headRadius * 0.85 && maxDistFromStart <= headRadius * 1.65;

    if (nearEnd && (!nearStart || minDistToEnd <= minDistToStart)) {
      const check = analyzeArrowheadStroke(other.stroke, shaft.end, shaftVec, headRadius);
      if (!check.valid) return null;
      if (check.apexAdvance > 0) {
        adjustedEnd = {
          x: shaft.end.x + shaftVec.x * check.apexAdvance,
          y: shaft.end.y + shaftVec.y * check.apexAdvance,
        };
      }
      endHeadStrokes++;
    } else if (nearStart) {
      const revVec = { x: -shaftVec.x, y: -shaftVec.y };
      const check = analyzeArrowheadStroke(other.stroke, shaft.start, revVec, headRadius);
      if (!check.valid) return null;
      if (check.apexAdvance > 0) {
        adjustedStart = {
          x: shaft.start.x + revVec.x * check.apexAdvance,
          y: shaft.start.y + revVec.y * check.apexAdvance,
        };
      }
      startHeadStrokes++;
    } else {
      return null;
    }
  }

  if (startHeadStrokes === 0 && endHeadStrokes === 0) return null;

  if (startHeadStrokes > 0 && endHeadStrokes > 0) {
    return {
      start: adjustedStart,
      end: adjustedEnd,
      direction: 'double',
      confidence: clamp(0.78 + (shaft.straightness - 0.82) * 1.1, 0.78, 0.97),
    };
  }

  if (endHeadStrokes > 0) {
    return {
      start: adjustedStart,
      end: adjustedEnd,
      direction: 'single',
      confidence: clamp(0.78 + (shaft.straightness - 0.82) * 1.1, 0.78, 0.97),
    };
  }

  return {
    start: adjustedEnd,
    end: adjustedStart,
    direction: 'single',
    confidence: clamp(0.78 + (shaft.straightness - 0.82) * 1.1, 0.78, 0.97),
  };
}

function analyzeArrowheadStroke(
  headPts: Point[],
  shaftTip: Point,
  forwardDir: Point,
  headRadius: number
): { valid: boolean; apexAdvance: number } {
  const resampled = resampleStroke(headPts, 20);
  const perpAxis = { x: -forwardDir.y, y: forwardDir.x };
  const projPerp = resampled.map((p) => (p.x - shaftTip.x) * perpAxis.x + (p.y - shaftTip.y) * perpAxis.y);
  const projForward = resampled.map((p) => (p.x - shaftTip.x) * forwardDir.x + (p.y - shaftTip.y) * forwardDir.y);

  const perpSpan = Math.max(...projPerp) - Math.min(...projPerp);
  const minForward = Math.min(...projForward);
  const apexForward = Math.max(...projForward);
  const backSpan = apexForward - minForward;

  // Must flare laterally and sweep backward from its own apex
  if (perpSpan < 6 || backSpan < 5) {
    return { valid: false, apexAdvance: 0 };
  }

  // Arrowhead apex may sit slightly behind or ahead of shaftTip (e.g. `----> >`)
  if (apexForward < -headRadius * 0.45 || apexForward > Math.max(36, headRadius * 0.95)) {
    return { valid: false, apexAdvance: 0 };
  }

  // Ensure arrowhead sits roughly centered around the shaft axis rather than far off to one side
  const meanPerp = projPerp.reduce((s, v) => s + v, 0) / projPerp.length;
  if (Math.abs(meanPerp) > Math.max(26, perpSpan * 0.9)) {
    return { valid: false, apexAdvance: 0 };
  }

  // If it's a single straight segment perpendicular to the shaft (a T-bar), require backward sweep relative to perpSpan
  if (backSpan < perpSpan * 0.18 && perpSpan > 16) {
    return { valid: false, apexAdvance: 0 };
  }

  return { valid: true, apexAdvance: Math.max(0, apexForward) };
}

function tryStitchClosedLoop(
  strokes: Point[][],
  groupBounds: Bounds
): { contour: Point[]; closureRatio: number } | null {
  if (strokes.length < 2 || strokes.length > 4) return null;
  const diag = Math.hypot(groupBounds.width, groupBounds.height);
  if (diag < 25) return null;
  const snapThresh = Math.max(26, diag * 0.24);

  const remaining = strokes.map((s) => [...s]);
  const contour: Point[] = [...remaining.shift()!];

  while (remaining.length > 0) {
    const tail = contour[contour.length - 1];
    let bestIdx = -1;
    let reverse = false;
    let bestD = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const dStart = distance(tail, candidate[0]);
      const dEnd = distance(tail, candidate[candidate.length - 1]);
      if (dStart < bestD) {
        bestD = dStart;
        bestIdx = i;
        reverse = false;
      }
      if (dEnd < bestD) {
        bestD = dEnd;
        bestIdx = i;
        reverse = true;
      }
    }

    if (bestIdx === -1 || bestD > snapThresh) {
      return null;
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    if (reverse) chosen.reverse();
    contour.push(...chosen);
  }

  const endGap = distance(contour[0], contour[contour.length - 1]);
  const closureRatio = endGap / diag;
  if (closureRatio > 0.30) return null;

  return { contour, closureRatio };
}

function scoreMultiStrokeDatabase(strokes: Point[][], bounds: Bounds): number {
  if (bounds.width < 32 || bounds.height < 40) return 0;
  const aspect = bounds.height / Math.max(1, bounds.width);
  if (aspect < 0.55 || aspect > 2.8) return 0;

  // Find a closed oval/circle stroke in the upper half of bounds
  let topCapIdx = -1;
  for (let i = 0; i < strokes.length; i++) {
    const b = computeBounds(strokes[i]);
    const capCenterY = b.y + b.height / 2;
    const relY = (capCenterY - bounds.y) / Math.max(1, bounds.height);
    const capW = b.width / Math.max(1, bounds.width);
    const capAspect = b.width / Math.max(1, b.height);
    const closure = distance(strokes[i][0], strokes[i][strokes[i].length - 1]);
    if (
      relY <= 0.45 &&
      capW >= 0.65 &&
      capAspect >= 0.85 &&
      closure <= Math.max(26, Math.max(b.width, b.height) * 0.35)
    ) {
      topCapIdx = i;
      break;
    }
  }

  if (topCapIdx === -1) return 0;

  // Remaining strokes should span down into the lower half and follow left/right walls & bottom
  const bodyPoints = strokes.filter((_, idx) => idx !== topCapIdx).flat();
  if (bodyPoints.length < 4) return 0;
  const bodyBounds = computeBounds(bodyPoints);

  const reachesBottom = bodyBounds.y + bodyBounds.height >= bounds.y + bounds.height * 0.85;
  const spansWidth = bodyBounds.width >= bounds.width * 0.65;
  if (!reachesBottom || !spansWidth) return 0;

  const leftEdge = bounds.x;
  const rightEdge = bounds.x + bounds.width;
  const bottomZoneY = bounds.y + bounds.height * 0.62;
  let onShellCount = 0;
  const tolX = Math.max(18, bounds.width * 0.24);
  for (const p of bodyPoints) {
    const nearLeft = Math.abs(p.x - leftEdge) <= tolX;
    const nearRight = Math.abs(p.x - rightEdge) <= tolX;
    const inBottom = p.y >= bottomZoneY;
    if (nearLeft || nearRight || inBottom) {
      onShellCount++;
    }
  }
  const shellRatio = onShellCount / bodyPoints.length;
  if (shellRatio < 0.66) return 0;

  return clamp(0.74 + (shellRatio - 0.66) * 0.7, 0.74, 0.96);
}

function scoreSingleStrokeDatabase(points: Point[], bounds: Bounds): number {
  if (bounds.width < 34 || bounds.height < 40) return 0;
  const aspect = bounds.height / Math.max(1, bounds.width);
  if (aspect < 0.55 || aspect > 2.8) return 0;

  // Single-shot cylinder draws top oval + left/right sides + bottom
  const len = pathLength(points);
  const minLen = Math.min(1.95 * (bounds.width + bounds.height), 2.35 * bounds.width + 1.35 * bounds.height);
  if (len < minLen) return 0;

  const cx = bounds.x + bounds.width / 2;
  const bandX = Math.max(10, bounds.width * 0.14);

  // Collect relative Y positions where the stroke crosses near the vertical centerline x = cx
  const centerCrossRelYs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const crosses =
      (a.x <= cx && b.x >= cx) ||
      (a.x >= cx && b.x <= cx) ||
      Math.abs(b.x - cx) <= bandX;
    if (crosses) {
      const midY = (a.y + b.y) / 2;
      centerCrossRelYs.push((midY - bounds.y) / Math.max(1, bounds.height));
    }
  }

  const hasTopBand = centerCrossRelYs.some((ry) => ry <= 0.24);
  const midBandYs = centerCrossRelYs.filter((ry) => ry >= 0.20 && ry <= 0.68);
  const hasBotBand = centerCrossRelYs.some((ry) => ry >= 0.74);

  if (!hasTopBand || midBandYs.length === 0 || !hasBotBand) return 0;

  // Ensure clear separation between top rim, inner oval seam, and bottom base
  const minTop = Math.min(...centerCrossRelYs.filter((ry) => ry <= 0.24));
  const maxBot = Math.max(...centerCrossRelYs.filter((ry) => ry >= 0.74));
  const hasDistinctMid = midBandYs.some(
    (ry) => ry - minTop >= 0.14 && maxBot - ry >= 0.16
  );
  if (!hasDistinctMid) return 0;

  // Verify lower body spans both left and right edges (not a weird spiral)
  const lowerPts = points.filter((p) => p.y >= bounds.y + bounds.height * 0.52);
  if (lowerPts.length < 6) return 0;
  const lowerBounds = computeBounds(lowerPts);
  if (lowerBounds.width < bounds.width * 0.62) return 0;

  return 0.84;
}

export function isCylinderBodyForCap(strokes: Point[][], cap: ShapeNode): Bounds | null {
  if (cap.kind !== 'circle' && cap.kind !== 'ellipse') return null;
  const bodyPts = strokes.flat();
  if (bodyPts.length < 4) return null;

  const bodyBounds = computeBounds(bodyPts);
  const capBottom = cap.bounds.y + cap.bounds.height;
  const bodyBottom = bodyBounds.y + bodyBounds.height;

  // Body must start near/on the cap and extend noticeably below the cap
  if (
    bodyBounds.y < cap.bounds.y - 14 ||
    bodyBounds.y > capBottom + 16
  ) {
    return null;
  }
  if (bodyBottom < capBottom + Math.max(18, cap.bounds.height * 0.28)) {
    return null;
  }

  const capCx = cap.bounds.x + cap.bounds.width / 2;
  const bodyCx = bodyBounds.x + bodyBounds.width / 2;
  if (Math.abs(bodyCx - capCx) > Math.max(32, cap.bounds.width * 0.38)) {
    return null;
  }

  if (
    bodyBounds.width < cap.bounds.width * 0.62 ||
    bodyBounds.width > cap.bounds.width * 1.45
  ) {
    return null;
  }

  const minX = Math.min(cap.bounds.x, bodyBounds.x);
  const maxX = Math.max(cap.bounds.x + cap.bounds.width, bodyBounds.x + bodyBounds.width);
  const totalWidth = maxX - minX;
  const totalHeight = bodyBottom - cap.bounds.y;

  // Verify body points trace left wall, right wall, or bottom (U-shape)
  const tolX = Math.max(18, totalWidth * 0.24);
  const bottomZoneY = cap.bounds.y + totalHeight * 0.60;
  const wallStartY = cap.bounds.y + cap.bounds.height * 0.40;
  let onShell = 0;
  let hasLeftWall = false;
  let hasRightWall = false;
  for (const p of bodyPts) {
    const nearLeft = Math.abs(p.x - minX) <= tolX;
    const nearRight = Math.abs(p.x - maxX) <= tolX;
    if (nearLeft && p.y >= wallStartY) hasLeftWall = true;
    if (nearRight && p.y >= wallStartY) hasRightWall = true;
    if (nearLeft || nearRight || p.y >= bottomZoneY) {
      onShell++;
    }
  }
  if (!hasLeftWall || !hasRightWall || onShell / bodyPts.length < 0.65) {
    return null;
  }

  return {
    x: minX,
    y: cap.bounds.y,
    width: totalWidth,
    height: totalHeight,
  };
}

function classifyClosedContour(
  contour: Point[],
  color: PaletteColor,
  originalStrokes: Point[][]
): RecognitionResult {
  const closedPts = resampleStroke([...contour, contour[0]], 64);
  const bounds = computeBounds(closedPts);
  const w = bounds.width;
  const h = bounds.height;
  const diag = Math.hypot(w, h);
  const boxArea = Math.max(1, w * h);
  const area = polygonArea(closedPts);
  const fillRatio = area / boxArea;
  const aspect = w / Math.max(1, h);

  if (fillRatio < 0.20 || diag < 28) {
    return {
      type: 'ink',
      strokes: originalStrokes,
      bounds,
      color,
      confidence: 0,
      reason: 'degenerate-area',
    };
  }

  // Reject strongly concave outlines (e.g. hollow wide block arrows, L-shapes, stars)
  // so they are never forced into a convex shape like a diamond or triangle.
  const hull = convexHull(closedPts);
  const hullArea = Math.max(1, polygonArea(hull));
  const solidity = area / hullArea;
  if (solidity < 0.80) {
    return {
      type: 'ink',
      strokes: originalStrokes,
      bounds,
      color,
      confidence: 0,
      reason: 'non-convex',
    };
  }

  // Fit residuals against ideal canonical shapes in [bounds]
  const ellipseErr = meanNormalizedShapeDistance(closedPts, (p) => distToEllipse(p, bounds), diag);
  const rectErr = meanNormalizedShapeDistance(closedPts, (p) => distToRectangle(p, bounds), diag);
  const diamondErr = meanNormalizedShapeDistance(closedPts, (p) => distToDiamond(p, bounds), diag);
  const capsuleErr = meanNormalizedShapeDistance(closedPts, (p) => distToCapsule(p, bounds), diag);
  const triFit = bestTriangleFit(closedPts, bounds, diag);
  const paraFit = bestParallelogramFit(closedPts, bounds, diag);

  // Convert residuals to candidate scores [0..1]
  const candidates: RecognitionCandidateScore[] = [];

  // Circle vs Ellipse
  const isCircularAspect = aspect >= 0.74 && aspect <= 1.35;
  const circleOrEllipseScore = clamp(1 - ellipseErr * 7.2, 0, 1);
  // Bonus if fillRatio matches pi/4 ≈ 0.785
  const ellipseAreaBonus = clamp(1 - Math.abs(fillRatio - Math.PI / 4) * 2.5, 0, 1) * 0.08;

  if (isCircularAspect) {
    candidates.push({ label: 'circle', score: circleOrEllipseScore + ellipseAreaBonus });
  } else {
    candidates.push({ label: 'ellipse', score: circleOrEllipseScore + ellipseAreaBonus });
  }

  // Terminator (capsule / pill): wide aspect >= 1.55 with flat top/bottom and curved ends
  if (aspect >= 1.55) {
    const flatMiddleBonus = capsuleFlatnessBonus(closedPts, bounds);
    // Distinguish capsule from wide ellipse: capsule has straight top/bottom and higher fillRatio (~0.85+)
    const capsuleScore =
      clamp(1 - capsuleErr * 7.5, 0, 1) +
      flatMiddleBonus * 0.10 +
      (fillRatio > 0.81 ? 0.04 : -0.04);
    candidates.push({ label: 'terminator', score: capsuleScore });
  }

  // Rectangle (including square)
  const rectAreaBonus = fillRatio >= 0.74 ? 0.07 : -0.10;
  const rectScore = clamp(1 - rectErr * 7.0, 0, 1) + rectAreaBonus;
  candidates.push({ label: 'rectangle', score: rectScore });

  // Diamond: 4 diagonal edges, corners near edge midpoints, fillRatio ~ 0.50
  const diamondAreaBonus = clamp(1 - Math.abs(fillRatio - 0.50) * 3.0, 0, 1) * 0.12;
  const diamondScore = clamp(1 - diamondErr * 6.8, 0, 1) + diamondAreaBonus;
  candidates.push({ label: 'diamond', score: diamondScore });

  // Triangle: 3 corners, fillRatio ~ 0.45-0.55
  const simplified = rdpSimplify(closedPts, Math.max(6, diag * 0.055));
  const cornerBonus = simplified.length <= 5 ? 0.05 : -0.06;
  const triScore = clamp(1 - triFit.err * 6.8, 0, 1) + cornerBonus;
  candidates.push({ label: 'triangle', score: triScore });

  // Parallelogram: slanted left & right sides in same direction
  if (paraFit.skewRatio >= 0.11 && paraFit.skewRatio <= 0.45) {
    const paraScore = clamp(1 - paraFit.err * 7.2, 0, 1) + 0.06;
    candidates.push({ label: 'parallelogram', score: paraScore });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const second = candidates[1];

  // Enforce minimum confidence and reject chaotic scribbles (high total curvature/winding)
  const totalTurns = computeTotalAbsoluteTurning(closedPts);
  if (totalTurns > Math.PI * 4.5) {
    return {
      type: 'ink',
      strokes: originalStrokes,
      bounds,
      color,
      confidence: 0,
      reason: 'excessive-turns',
    };
  }

  if (!top || top.score < 0.62) {
    return {
      type: 'ink',
      strokes: originalStrokes,
      bounds,
      color,
      confidence: top ? top.score : 0,
      reason: 'low-confidence',
    };
  }

  // Break near-ties sensibly between rectangle and terminator/ellipse
  let chosenKind = top.label as ShapeKind;
  if (
    second &&
    Math.abs(top.score - second.score) < 0.035 &&
    ((top.label === 'terminator' && second.label === 'ellipse') ||
      (top.label === 'ellipse' && second.label === 'terminator'))
  ) {
    chosenKind = fillRatio >= 0.83 ? 'terminator' : 'ellipse';
  }

  return {
    type: 'shape',
    kind: chosenKind,
    bounds: normalizeShapeBounds(bounds, chosenKind),
    color,
    confidence: clamp(top.score, 0, 0.99),
    candidates,
  };
}

function normalizeShapeBounds(bounds: Bounds, kind: ShapeKind): Bounds {
  if (kind === 'circle') {
    const size = (bounds.width + bounds.height) / 2;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return {
      x: cx - size / 2,
      y: cy - size / 2,
      width: size,
      height: size,
    };
  }
  return bounds;
}

function meanNormalizedShapeDistance(
  pts: Point[],
  distFn: (p: Point) => number,
  diag: number
): number {
  let sum = 0;
  for (const p of pts) {
    sum += distFn(p);
  }
  return sum / (pts.length * Math.max(1, diag));
}

function distToEllipse(p: Point, b: Bounds): number {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rx = Math.max(1, b.width / 2);
  const ry = Math.max(1, b.height / 2);
  const angle = Math.atan2((p.y - cy) / ry, (p.x - cx) / rx);
  const onEllipse = {
    x: cx + rx * Math.cos(angle),
    y: cy + ry * Math.sin(angle),
  };
  return distance(p, onEllipse);
}

function distToRectangle(p: Point, b: Bounds): number {
  const corners: Point[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
  return distToPolygonEdges(p, corners);
}

function distToDiamond(p: Point, b: Bounds): number {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const corners: Point[] = [
    { x: cx, y: b.y },
    { x: b.x + b.width, y: cy },
    { x: cx, y: b.y + b.height },
    { x: b.x, y: cy },
  ];
  return distToPolygonEdges(p, corners);
}

function distToCapsule(p: Point, b: Bounds): number {
  const r = Math.min(b.width, b.height) / 2;
  const leftCx = b.x + r;
  const rightCx = b.x + b.width - r;
  const cy = b.y + b.height / 2;
  if (p.x < leftCx) {
    return Math.abs(distance(p, { x: leftCx, y: cy }) - r);
  }
  if (p.x > rightCx) {
    return Math.abs(distance(p, { x: rightCx, y: cy }) - r);
  }
  return Math.min(Math.abs(p.y - b.y), Math.abs(p.y - (b.y + b.height)));
}

function capsuleFlatnessBonus(pts: Point[], b: Bounds): number {
  const midLeft = b.x + b.width * 0.28;
  const midRight = b.x + b.width * 0.72;
  const midPts = pts.filter((p) => p.x >= midLeft && p.x <= midRight);
  if (midPts.length < 6) return 0;
  let maxErr = 0;
  for (const p of midPts) {
    const err = Math.min(Math.abs(p.y - b.y), Math.abs(p.y - (b.y + b.height)));
    if (err > maxErr) maxErr = err;
  }
  return clamp(1 - maxErr / Math.max(8, b.height * 0.25), 0, 1);
}

function distToPolygonEdges(p: Point, verts: Point[]): number {
  let minD = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const { dist } = pointToSegmentDistance(p, a, b);
    if (dist < minD) minD = dist;
  }
  return minD;
}

function bestTriangleFit(pts: Point[], b: Bounds, diag: number): { err: number } {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const candidates: Point[][] = [
    // Pointing up
    [
      { x: cx, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: b.y + b.height },
    ],
    // Pointing down
    [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: cx, y: b.y + b.height },
    ],
    // Pointing right
    [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: cy },
      { x: b.x, y: b.y + b.height },
    ],
    // Pointing left
    [
      { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: cy },
    ],
  ];

  let best = Infinity;
  for (const verts of candidates) {
    const err = meanNormalizedShapeDistance(pts, (p) => distToPolygonEdges(p, verts), diag);
    if (err < best) best = err;
  }
  return { err: best };
}

function bestParallelogramFit(
  pts: Point[],
  b: Bounds,
  diag: number
): { err: number; skewRatio: number } {
  // Check top-half x centroid vs bottom-half x centroid to infer slant direction & ratio
  const cy = b.y + b.height / 2;
  const topPts = pts.filter((p) => p.y < b.y + b.height * 0.35);
  const botPts = pts.filter((p) => p.y > b.y + b.height * 0.65);
  if (topPts.length < 3 || botPts.length < 3) {
    return { err: 1, skewRatio: 0 };
  }
  const topCx = topPts.reduce((s, p) => s + p.x, 0) / topPts.length;
  const botCx = botPts.reduce((s, p) => s + p.x, 0) / botPts.length;
  const shift = topCx - botCx;
  const skew = Math.abs(shift) * 1.45;
  const skewRatio = skew / Math.max(1, b.width);

  if (skewRatio < 0.11 || skewRatio > 0.45) {
    return { err: 1, skewRatio: 0 };
  }

  const verts: Point[] =
    shift > 0
      ? [
          { x: b.x + skew, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width - skew, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ]
      : [
          { x: b.x, y: b.y },
          { x: b.x + b.width - skew, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x + skew, y: b.y + b.height },
        ];

  // Also ensure corners are NOT near the opposing corners (unlike rectangle)
  const rectCenterDiff = Math.abs(cy - (b.y + b.height / 2));
  void rectCenterDiff;

  const err = meanNormalizedShapeDistance(pts, (p) => distToPolygonEdges(p, verts), diag);
  return { err, skewRatio };
}

function computeTotalAbsoluteTurning(pts: Point[]): number {
  let total = 0;
  for (let i = 2; i < pts.length; i++) {
    const dx1 = pts[i - 1].x - pts[i - 2].x;
    const dy1 = pts[i - 1].y - pts[i - 2].y;
    const dx2 = pts[i].x - pts[i - 1].x;
    const dy2 = pts[i].y - pts[i - 1].y;
    if (Math.hypot(dx1, dy1) < 1e-3 || Math.hypot(dx2, dy2) < 1e-3) continue;
    const a1 = Math.atan2(dy1, dx1);
    const a2 = Math.atan2(dy2, dx2);
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    total += Math.abs(diff);
  }
  return total;
}
