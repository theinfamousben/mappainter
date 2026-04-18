import type { Point, Rect, Road } from "./types";
import { clamp } from "./utils";

export function lanePixels(road: Road): number {
  return 8 + road.lanes * 4;
}

export function normal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

export function normalize(point: Point): Point {
  const len = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / len, y: point.y / len };
}

export function offsetPolyline(points: Point[], offset: number): Point[] {
  if (points.length < 2) {
    return points;
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (i === 0) {
      const n = normal(points[0], points[1]);
      out.push({ x: points[0].x + n.x * offset, y: points[0].y + n.y * offset });
      continue;
    }
    if (i === points.length - 1) {
      const n = normal(points[i - 1], points[i]);
      out.push({ x: points[i].x + n.x * offset, y: points[i].y + n.y * offset });
      continue;
    }

    const n1 = normal(points[i - 1], points[i]);
    const n2 = normal(points[i], points[i + 1]);
    const blend = normalize({ x: n1.x + n2.x, y: n1.y + n2.y });
    out.push({ x: points[i].x + blend.x * offset, y: points[i].y + blend.y * offset });
  }
  return out;
}

export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

export function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lengthSq = abx * abx + aby * aby;

  if (lengthSq === 0) {
    return Math.hypot(apx, apy);
  }

  const t = clamp((apx * abx + apy * aby) / lengthSq, 0, 1);
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  return Math.hypot(p.x - closestX, p.y - closestY);
}

export function sampleQuadraticCurve(start: Point, anchor: Point, end: Point, samples: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const oneMinusT = 1 - t;
    points.push({
      x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * anchor.x + t * t * end.x,
      y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * anchor.y + t * t * end.y
    });
  }
  return points;
}

export function samePoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.001;
}

export function dedupeConsecutivePoints(points: Point[]): Point[] {
  if (points.length <= 1) {
    return points;
  }
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    if (!samePoint(points[i], out[out.length - 1])) {
      out.push(points[i]);
    }
  }
  return out;
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function parametricPosition(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx === 0 ? 0 : (p.x - a.x) / dx;
  }
  return dy === 0 ? 0 : (p.y - a.y) / dy;
}

export function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  const epsilon = 0.001;
  return (
    p.x >= Math.min(a.x, b.x) - epsilon &&
    p.x <= Math.max(a.x, b.x) + epsilon &&
    p.y >= Math.min(a.y, b.y) - epsilon &&
    p.y <= Math.max(a.y, b.y) + epsilon
  );
}

export function segmentIntersectionWithParameters(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): { point: Point; tA: number; tB: number } | null {
  const denominator = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(denominator) < 0.0001) {
    return null;
  }

  const numX =
    (a1.x * a2.y - a1.y * a2.x) * (b1.x - b2.x) -
    (a1.x - a2.x) * (b1.x * b2.y - b1.y * b2.x);
  const numY =
    (a1.x * a2.y - a1.y * a2.x) * (b1.y - b2.y) -
    (a1.y - a2.y) * (b1.x * b2.y - b1.y * b2.x);

  const intersection = { x: numX / denominator, y: numY / denominator };

  if (!pointOnSegment(intersection, a1, a2) || !pointOnSegment(intersection, b1, b2)) {
    return null;
  }

  const tA = parametricPosition(intersection, a1, a2);
  const tB = parametricPosition(intersection, b1, b2);

  return { point: intersection, tA, tB };
}

export function segmentIntersectionPoint(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const hit = segmentIntersectionWithParameters(a1, a2, b1, b2);
  return hit ? hit.point : null;
}

export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  return segmentIntersectionWithParameters(a1, a2, b1, b2) !== null;
}

export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (pointInRect(a, rect) || pointInRect(b, rect)) {
    return true;
  }

  const r1 = { x: rect.x, y: rect.y };
  const r2 = { x: rect.x + rect.width, y: rect.y };
  const r3 = { x: rect.x + rect.width, y: rect.y + rect.height };
  const r4 = { x: rect.x, y: rect.y + rect.height };

  return (
    segmentsIntersect(a, b, r1, r2) ||
    segmentsIntersect(a, b, r2, r3) ||
    segmentsIntersect(a, b, r3, r4) ||
    segmentsIntersect(a, b, r4, r1)
  );
}
