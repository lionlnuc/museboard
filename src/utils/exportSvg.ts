import type { BoardDocument, BoardShape } from '../types';
import { getSelectionBounds } from './geometry';

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const paint = (value: string) => value === 'transparent' ? 'none' : value;

export interface SvgExportOptions {
  shapeIds?: string[];
  transparent?: boolean;
  padding?: number;
}

function textSvg(shape: BoardShape, color = shape.fill, inset = 0) {
  if (!shape.text) return '';
  const lines = (shape.text ?? '').split('\n');
  const fontSize = shape.fontSize ?? 18;
  const anchor = shape.textAlign === 'center' ? 'middle' : shape.textAlign === 'right' ? 'end' : 'start';
  const x = shape.textAlign === 'center'
    ? shape.width / 2
    : shape.textAlign === 'right'
      ? shape.width - inset
      : inset;
  const totalHeight = lines.length * fontSize * 1.3;
  const contained = ['rect', 'ellipse', 'diamond', 'note'].includes(shape.type);
  const y = contained ? Math.max(inset + fontSize, (shape.height - totalHeight) / 2 + fontSize) : fontSize;
  return `<text x="${x}" y="${y}" fill="${escapeXml(paint(color))}" font-family="${escapeXml(shape.fontFamily ?? 'Inter, sans-serif')}" font-size="${fontSize}" font-weight="${shape.fontStyle === 'bold' ? '700' : '400'}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : fontSize * 1.3}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function shapeSvg(shape: BoardShape) {
  const transform = `translate(${shape.x} ${shape.y}) rotate(${shape.rotation}) scale(${shape.scaleX} ${shape.scaleY})`;
  const opacity = `opacity="${shape.opacity}"`;
  const stroke = escapeXml(paint(shape.stroke));
  const fill = escapeXml(paint(shape.fill));

  if (shape.type === 'rect') {
    return `<g transform="${transform}" ${opacity}><rect width="${shape.width}" height="${shape.height}" rx="${shape.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${shape.strokeWidth}"/>${textSvg(shape, shape.textColor ?? '#172033', 12)}</g>`;
  }
  if (shape.type === 'frame') {
    return `<g transform="${transform}" ${opacity}><rect width="${shape.width}" height="${shape.height}" rx="${shape.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${shape.strokeWidth}" stroke-dasharray="10 7"/></g>`;
  }
  if (shape.type === 'ellipse') {
    return `<g transform="${transform}" ${opacity}><ellipse cx="${shape.width / 2}" cy="${shape.height / 2}" rx="${shape.width / 2}" ry="${shape.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${shape.strokeWidth}"/>${textSvg(shape, shape.textColor ?? '#172033', 12)}</g>`;
  }
  if (shape.type === 'diamond') {
    return `<g transform="${transform}" ${opacity}><polygon points="${shape.width / 2},0 ${shape.width},${shape.height / 2} ${shape.width / 2},${shape.height} 0,${shape.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${shape.strokeWidth}"/>${textSvg(shape, shape.textColor ?? '#172033', 18)}</g>`;
  }
  if (shape.type === 'arrow' || shape.type === 'line' || shape.type === 'pen') {
    const points = shape.points ?? [0, 0, shape.width, shape.height];
    const marker = shape.type === 'arrow' ? ` marker-end="url(#arrow-${shape.id.replace(/[^a-zA-Z0-9_-]/g, '')})"` : '';
    const tag = shape.type === 'pen' ? 'polyline' : 'line';
    const geometry = tag === 'line'
      ? `x1="${points[0]}" y1="${points[1]}" x2="${points.at(-2)}" y2="${points.at(-1)}"`
      : `points="${Array.from({ length: Math.floor(points.length / 2) }, (_, index) => `${points[index * 2]},${points[index * 2 + 1]}`).join(' ')}"`;
    return `<g transform="${transform}" ${opacity}><${tag} ${geometry} fill="none" stroke="${stroke}" stroke-width="${shape.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${marker}/></g>`;
  }
  if (shape.type === 'text') {
    return `<g transform="${transform}" ${opacity}>${textSvg(shape)}</g>`;
  }
  if (shape.type === 'note') {
    return `<g transform="${transform}" ${opacity}><rect width="${shape.width}" height="${shape.height}" rx="${shape.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${shape.strokeWidth}"/><path d="M ${shape.width - 24} 0 L ${shape.width} 24 L ${shape.width} 0 Z" fill="rgba(255,255,255,.5)"/>${textSvg(shape, shape.textColor ?? '#3f3a24', 14)}</g>`;
  }
  if (shape.type === 'image' && shape.url) {
    return `<image href="${escapeXml(shape.url)}" transform="${transform}" ${opacity} width="${shape.width}" height="${shape.height}" preserveAspectRatio="none"/>`;
  }
  return '';
}

export function boardToSvg(document: BoardDocument, options: SvgExportOptions = {}) {
  const requestedIds = options.shapeIds ? new Set(options.shapeIds) : null;
  const shapes = document.shapes.filter((shape) => shape.visible && (!requestedIds || requestedIds.has(shape.id)));
  const bounds = getSelectionBounds(shapes);
  if (!bounds) return null;
  const padding = Math.max(0, Math.min(256, options.padding ?? 48));
  const width = Math.ceil(Math.max(bounds.width + padding * 2, 1));
  const height = Math.ceil(Math.max(bounds.height + padding * 2, 1));
  const offsetX = padding - bounds.left;
  const offsetY = padding - bounds.top;
  const markers = shapes.filter((shape) => shape.type === 'arrow').map((shape) => (
    `<marker id="arrow-${shape.id.replace(/[^a-zA-Z0-9_-]/g, '')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeXml(paint(shape.stroke))}"/></marker>`
  )).join('');

  const background = options.transparent ? '' : `<rect width="100%" height="100%" fill="${escapeXml(paint(document.settings.background))}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${markers}</defs>${background}<g transform="translate(${offsetX} ${offsetY})">${shapes.map(shapeSvg).join('')}</g></svg>`;
}
