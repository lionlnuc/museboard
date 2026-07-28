import { useEffect, useRef, useState } from 'react';
import type { BoardShape, Viewport } from '../types';
import { getSelectionBounds, getShapeBounds } from '../utils/geometry';

export function MiniMap({ shapes, viewport }: { shapes: BoardShape[]; viewport: Viewport }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 150, height: 96 });
  useEffect(() => {
    if (!containerRef.current) return;
    const canvas = containerRef.current.parentElement;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const visible = shapes.filter((shape) => shape.visible);
  if (!visible.length) return null;
  const bounds = getSelectionBounds(visible)!;
  const viewportBounds = {
    left: -viewport.x / viewport.zoom,
    top: -viewport.y / viewport.zoom,
    right: (-viewport.x + size.width) / viewport.zoom,
    bottom: (-viewport.y + size.height) / viewport.zoom,
  };
  const viewportFits = viewportBounds.right - viewportBounds.left <= bounds.width * 3
    && viewportBounds.bottom - viewportBounds.top <= bounds.height * 3;
  const left = viewportFits ? Math.min(bounds.left, viewportBounds.left) : bounds.left;
  const top = viewportFits ? Math.min(bounds.top, viewportBounds.top) : bounds.top;
  const right = viewportFits ? Math.max(bounds.right, viewportBounds.right) : bounds.right;
  const bottom = viewportFits ? Math.max(bounds.bottom, viewportBounds.bottom) : bounds.bottom;
  const width = Math.max(right - left, 240);
  const height = Math.max(bottom - top, 140);
  const pad = 20;
  const visibleViewport = {
    left: Math.max(viewportBounds.left, left),
    top: Math.max(viewportBounds.top, top),
    right: Math.min(viewportBounds.right, right),
    bottom: Math.min(viewportBounds.bottom, bottom),
  };
  return (
    <div ref={containerRef} className="mini-map" aria-label="画布缩略图">
      <svg viewBox={`${left - pad} ${top - pad} ${width + pad * 2} ${height + pad * 2}`} preserveAspectRatio="xMidYMid meet">
        {visible.map((shape) => {
          const item = getShapeBounds(shape);
          return (
            <rect
              key={shape.id}
              x={item.left}
              y={item.top}
              width={Math.max(item.width, 8)}
              height={Math.max(item.height, 8)}
              rx={3}
              fill={shape.type === 'frame' || shape.fill === 'transparent' ? 'none' : shape.fill}
              stroke={shape.stroke === 'transparent' ? '#64748b' : shape.stroke}
              strokeWidth={2}
              opacity={shape.type === 'frame' ? 0.55 : 1}
            />
          );
        })}
        {visibleViewport.right > visibleViewport.left && visibleViewport.bottom > visibleViewport.top && (
          <rect
            x={visibleViewport.left}
            y={visibleViewport.top}
            width={Math.max(visibleViewport.right - visibleViewport.left, 1)}
            height={Math.max(visibleViewport.bottom - visibleViewport.top, 1)}
            fill="rgba(54,89,227,.08)"
            stroke="#3659e3"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span>{Math.round(viewport.zoom * 100)}%</span>
    </div>
  );
}
