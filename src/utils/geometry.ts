import type { BoardShape } from '../types';

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export type AlignMode = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type DistributeMode = 'horizontal' | 'vertical';

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}

export interface Point {
  x: number;
  y: number;
}

const fromEdges = (left: number, top: number, right: number, bottom: number): Bounds => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
  centerX: (left + right) / 2,
  centerY: (top + bottom) / 2,
});

function transformLocalPoint(shape: BoardShape, x: number, y: number): Point {
  const radians = shape.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaledX = x * shape.scaleX;
  const scaledY = y * shape.scaleY;
  return {
    x: shape.x + scaledX * cos - scaledY * sin,
    y: shape.y + scaledX * sin + scaledY * cos,
  };
}

function boundsFromPoints(points: Point[], padding = 0): Bounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return fromEdges(
    Math.min(...xs) - padding,
    Math.min(...ys) - padding,
    Math.max(...xs) + padding,
    Math.max(...ys) + padding,
  );
}

export function getShapeBounds(shape: BoardShape): Bounds {
  if (shape.points?.length && ['arrow', 'line', 'pen'].includes(shape.type)) {
    const points: Point[] = [];
    for (let index = 0; index < shape.points.length; index += 2) {
      points.push(transformLocalPoint(shape, shape.points[index], shape.points[index + 1]));
    }
    const padding = Math.max(shape.strokeWidth / 2, 1);
    return boundsFromPoints(points, padding);
  }

  if (shape.type === 'ellipse') {
    const center = transformLocalPoint(shape, shape.width / 2, shape.height / 2);
    const radians = shape.rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const radiusX = Math.abs(shape.width * shape.scaleX) / 2;
    const radiusY = Math.abs(shape.height * shape.scaleY) / 2;
    const halfWidth = Math.sqrt((radiusX * cos) ** 2 + (radiusY * sin) ** 2);
    const halfHeight = Math.sqrt((radiusX * sin) ** 2 + (radiusY * cos) ** 2);
    return fromEdges(center.x - halfWidth, center.y - halfHeight, center.x + halfWidth, center.y + halfHeight);
  }

  const localPoints = shape.type === 'diamond'
    ? [
      { x: shape.width / 2, y: 0 },
      { x: shape.width, y: shape.height / 2 },
      { x: shape.width / 2, y: shape.height },
      { x: 0, y: shape.height / 2 },
    ]
    : [
      { x: 0, y: 0 },
      { x: shape.width, y: 0 },
      { x: shape.width, y: shape.height },
      { x: 0, y: shape.height },
    ];
  return boundsFromPoints(localPoints.map((point) => transformLocalPoint(shape, point.x, point.y)));
}

export function isBindableShape(shape: BoardShape) {
  return ['rect', 'ellipse', 'diamond', 'note', 'image'].includes(shape.type);
}

function getConnectorEndpoints(shape: BoardShape): { start: Point; end: Point } {
  const points = shape.points ?? [0, 0, shape.width, shape.height];
  const radians = shape.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const transform = (x: number, y: number): Point => {
    const scaledX = x * shape.scaleX;
    const scaledY = y * shape.scaleY;
    return {
      x: shape.x + scaledX * cos - scaledY * sin,
      y: shape.y + scaledX * sin + scaledY * cos,
    };
  };
  return {
    start: transform(points[0] ?? 0, points[1] ?? 0),
    end: transform(points.at(-2) ?? shape.width, points.at(-1) ?? shape.height),
  };
}

function getConnectionAnchor(shape: BoardShape, toward: Point): Point {
  const bounds = getShapeBounds(shape);
  const center = { x: bounds.centerX, y: bounds.centerY };
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return center;

  const halfWidth = Math.max(bounds.width / 2, 1);
  const halfHeight = Math.max(bounds.height / 2, 1);
  let ratio: number;
  if (shape.type === 'ellipse') {
    ratio = 1 / Math.sqrt((dx * dx) / (halfWidth * halfWidth) + (dy * dy) / (halfHeight * halfHeight));
  } else if (shape.type === 'diamond') {
    ratio = 1 / (Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight);
  } else {
    ratio = Math.min(
      Math.abs(dx) < 0.001 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
      Math.abs(dy) < 0.001 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
    );
  }
  const offset = Math.max(shape.strokeWidth / 2 + 2, 2);
  const expandedRatio = ratio + offset / distance;
  return { x: center.x + dx * expandedRatio, y: center.y + dy * expandedRatio };
}

export function resolveBoundConnectors(shapes: BoardShape[]): BoardShape[] {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  return shapes.map((shape) => {
    if (!['arrow', 'line'].includes(shape.type) || (!shape.startBindingId && !shape.endBindingId)) return shape;
    const startTarget = shape.startBindingId ? byId.get(shape.startBindingId) : undefined;
    const endTarget = shape.endBindingId ? byId.get(shape.endBindingId) : undefined;
    const endpoints = getConnectorEndpoints(shape);
    const startCenter = startTarget ? getShapeBounds(startTarget) : null;
    const endCenter = endTarget ? getShapeBounds(endTarget) : null;
    let start = startTarget
      ? getConnectionAnchor(startTarget, endCenter ? { x: endCenter.centerX, y: endCenter.centerY } : endpoints.end)
      : endpoints.start;
    let end = endTarget
      ? getConnectionAnchor(endTarget, startCenter ? { x: startCenter.centerX, y: startCenter.centerY } : start)
      : endpoints.end;
    if (startTarget) start = getConnectionAnchor(startTarget, end);
    if (endTarget) end = getConnectionAnchor(endTarget, start);
    return {
      ...shape,
      x: start.x,
      y: start.y,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      points: [0, 0, end.x - start.x, end.y - start.y],
      startBindingId: startTarget ? shape.startBindingId : undefined,
      endBindingId: endTarget ? shape.endBindingId : undefined,
    };
  });
}

export function findBindingTarget(shapes: BoardShape[], point: Point, radius: number, ignoredIds = new Set<string>()) {
  for (const shape of [...shapes].reverse()) {
    if (!shape.visible || ignoredIds.has(shape.id) || !isBindableShape(shape)) continue;
    const bounds = getShapeBounds(shape);
    if (
      point.x >= bounds.left - radius
      && point.x <= bounds.right + radius
      && point.y >= bounds.top - radius
      && point.y <= bounds.bottom + radius
    ) return shape;
  }
  return undefined;
}

export function getSelectionBounds(shapes: BoardShape[]): Bounds | null {
  if (!shapes.length) return null;
  const bounds = shapes.map(getShapeBounds);
  return fromEdges(
    Math.min(...bounds.map((item) => item.left)),
    Math.min(...bounds.map((item) => item.top)),
    Math.max(...bounds.map((item) => item.right)),
    Math.max(...bounds.map((item) => item.bottom)),
  );
}

export function intersects(a: Bounds, b: Bounds) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function alignShapes(shapes: BoardShape[], selectedIds: Set<string>, mode: AlignMode): BoardShape[] {
  const selected = shapes.filter((shape) => selectedIds.has(shape.id));
  const selection = getSelectionBounds(selected);
  if (!selection || selected.length < 2) return shapes;

  return shapes.map((shape) => {
    if (!selectedIds.has(shape.id) || shape.locked) return shape;
    const bounds = getShapeBounds(shape);
    let deltaX = 0;
    let deltaY = 0;
    if (mode === 'left') deltaX = selection.left - bounds.left;
    if (mode === 'center-x') deltaX = selection.centerX - bounds.centerX;
    if (mode === 'right') deltaX = selection.right - bounds.right;
    if (mode === 'top') deltaY = selection.top - bounds.top;
    if (mode === 'center-y') deltaY = selection.centerY - bounds.centerY;
    if (mode === 'bottom') deltaY = selection.bottom - bounds.bottom;
    return { ...shape, x: shape.x + deltaX, y: shape.y + deltaY };
  });
}

export function distributeShapes(shapes: BoardShape[], selectedIds: Set<string>, mode: DistributeMode): BoardShape[] {
  const selected = shapes.filter((shape) => selectedIds.has(shape.id) && !shape.locked);
  if (selected.length < 3) return shapes;

  const sorted = [...selected].sort((a, b) => {
    const aBounds = getShapeBounds(a);
    const bBounds = getShapeBounds(b);
    return mode === 'horizontal' ? aBounds.left - bBounds.left : aBounds.top - bBounds.top;
  });
  const first = getShapeBounds(sorted[0]);
  const last = getShapeBounds(sorted.at(-1)!);
  const totalSize = sorted.reduce((sum, shape) => {
    const bounds = getShapeBounds(shape);
    return sum + (mode === 'horizontal' ? bounds.width : bounds.height);
  }, 0);
  const available = mode === 'horizontal'
    ? last.right - first.left - totalSize
    : last.bottom - first.top - totalSize;
  const gap = available / (sorted.length - 1);
  const positions = new Map<string, number>();
  let cursor = mode === 'horizontal' ? first.left : first.top;

  sorted.forEach((shape) => {
    const bounds = getShapeBounds(shape);
    positions.set(shape.id, cursor);
    cursor += (mode === 'horizontal' ? bounds.width : bounds.height) + gap;
  });

  return shapes.map((shape) => {
    const position = positions.get(shape.id);
    if (position === undefined) return shape;
    const bounds = getShapeBounds(shape);
    return mode === 'horizontal'
      ? { ...shape, x: shape.x + position - bounds.left }
      : { ...shape, y: shape.y + position - bounds.top };
  });
}

export function calculateSmartSnap(
  movingShapes: BoardShape[],
  otherShapes: BoardShape[],
  rawDelta: { x: number; y: number },
  threshold: number,
): { delta: { x: number; y: number }; guides: SnapGuide[] } {
  const moved = movingShapes.map((shape) => ({ ...shape, x: shape.x + rawDelta.x, y: shape.y + rawDelta.y }));
  const moving = getSelectionBounds(moved);
  if (!moving || !otherShapes.length) return { delta: rawDelta, guides: [] };

  const otherBounds = otherShapes.filter((shape) => shape.visible).map(getShapeBounds);
  const movingX = [moving.left, moving.centerX, moving.right];
  const movingY = [moving.top, moving.centerY, moving.bottom];
  let bestX: { distance: number; target: number; bounds: Bounds } | null = null;
  let bestY: { distance: number; target: number; bounds: Bounds } | null = null;

  otherBounds.forEach((bounds) => {
    [bounds.left, bounds.centerX, bounds.right].forEach((target) => {
      movingX.forEach((source) => {
        const distance = target - source;
        if (Math.abs(distance) <= threshold && (!bestX || Math.abs(distance) < Math.abs(bestX.distance))) {
          bestX = { distance, target, bounds };
        }
      });
    });
    [bounds.top, bounds.centerY, bounds.bottom].forEach((target) => {
      movingY.forEach((source) => {
        const distance = target - source;
        if (Math.abs(distance) <= threshold && (!bestY || Math.abs(distance) < Math.abs(bestY.distance))) {
          bestY = { distance, target, bounds };
        }
      });
    });
  });

  const snapX = bestX as { distance: number; target: number; bounds: Bounds } | null;
  const snapY = bestY as { distance: number; target: number; bounds: Bounds } | null;
  const delta = {
    x: rawDelta.x + (snapX?.distance ?? 0),
    y: rawDelta.y + (snapY?.distance ?? 0),
  };
  const snappedMoving = fromEdges(
    moving.left + (snapX?.distance ?? 0),
    moving.top + (snapY?.distance ?? 0),
    moving.right + (snapX?.distance ?? 0),
    moving.bottom + (snapY?.distance ?? 0),
  );
  const guides: SnapGuide[] = [];
  if (snapX) {
    guides.push({
      orientation: 'vertical',
      position: snapX.target,
      start: Math.min(snappedMoving.top, snapX.bounds.top) - 18,
      end: Math.max(snappedMoving.bottom, snapX.bounds.bottom) + 18,
    });
  }
  if (snapY) {
    guides.push({
      orientation: 'horizontal',
      position: snapY.target,
      start: Math.min(snappedMoving.left, snapY.bounds.left) - 18,
      end: Math.max(snappedMoving.right, snapY.bounds.right) + 18,
    });
  }
  return { delta, guides };
}
