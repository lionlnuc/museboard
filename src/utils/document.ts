import type { BoardDocument, BoardShape, CanvasSettings, ShapeType } from '../types';

export const CURRENT_DOCUMENT_VERSION = 1;

const shapeTypes = new Set<ShapeType>([
  'rect',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'pen',
  'text',
  'note',
  'image',
  'frame',
]);

const defaultSettings: CanvasSettings = {
  background: '#f8fafc',
  grid: true,
  snap: false,
  guides: true,
};

export class DocumentFormatError extends Error {
  constructor(message = '无法识别这个画板文件') {
    super(message);
    this.name = 'DocumentFormatError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function normalizeShape(value: unknown, index: number): BoardShape {
  if (!isRecord(value)) throw new DocumentFormatError(`对象 ${index + 1} 格式无效`);
  const type = value.type;
  if (typeof type !== 'string' || !shapeTypes.has(type as ShapeType)) {
    throw new DocumentFormatError(`对象 ${index + 1} 类型不受支持`);
  }

  const rawPoints = value.points;
  const points = Array.isArray(rawPoints)
    ? rawPoints.filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
    : undefined;
  const shape: BoardShape = {
    ...value,
    id: typeof value.id === 'string' && value.id ? value.id : `shape-${index + 1}`,
    type: type as ShapeType,
    name: typeof value.name === 'string' && value.name ? value.name : `${type} ${index + 1}`,
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    width: Math.max(1, finiteNumber(value.width, 120)),
    height: Math.max(1, finiteNumber(value.height, 80)),
    rotation: finiteNumber(value.rotation, 0),
    scaleX: finiteNumber(value.scaleX, 1) || 1,
    scaleY: finiteNumber(value.scaleY, 1) || 1,
    fill: typeof value.fill === 'string' ? value.fill : '#ffffff',
    stroke: typeof value.stroke === 'string' ? value.stroke : '#2563eb',
    strokeWidth: Math.max(0, finiteNumber(value.strokeWidth, 2)),
    opacity: Math.min(1, Math.max(0, finiteNumber(value.opacity, 1))),
    cornerRadius: Math.max(0, finiteNumber(value.cornerRadius, 12)),
    points: points && points.length >= 2 ? points : undefined,
    text: optionalString(value.text),
    textColor: optionalString(value.textColor),
    fontSize: value.fontSize === undefined ? undefined : Math.max(1, finiteNumber(value.fontSize, 18)),
    fontFamily: optionalString(value.fontFamily),
    fontStyle: optionalString(value.fontStyle),
    textAlign: value.textAlign === 'center' || value.textAlign === 'right' ? value.textAlign : value.textAlign === 'left' ? 'left' : undefined,
    url: optionalString(value.url),
    assetId: optionalString(value.assetId),
    startBindingId: optionalString(value.startBindingId),
    endBindingId: optionalString(value.endBindingId),
    groupId: optionalString(value.groupId),
    visible: value.visible !== false,
    locked: value.locked === true,
  };
  return shape;
}

export function createBlankDocument(): BoardDocument {
  return {
    version: CURRENT_DOCUMENT_VERSION,
    title: '未命名画板',
    shapes: [],
    settings: { ...defaultSettings },
    updatedAt: Date.now(),
  };
}

export function parseBoardDocument(value: unknown, options: { stripLegacyStarters?: boolean } = {}): BoardDocument {
  if (!isRecord(value)) throw new DocumentFormatError();
  const version = value.version === undefined ? CURRENT_DOCUMENT_VERSION : value.version;
  if (version !== CURRENT_DOCUMENT_VERSION) {
    throw new DocumentFormatError(`暂不支持 v${String(version)} 画板文件`);
  }
  if (!Array.isArray(value.shapes)) throw new DocumentFormatError('画板对象列表格式无效');

  const normalizedShapes = value.shapes.map(normalizeShape);
  const shapes = options.stripLegacyStarters
    ? normalizedShapes.filter((shape) => !shape.id.startsWith('starter-'))
    : normalizedShapes;
  const rawSettings = isRecord(value.settings) ? value.settings : {};
  return {
    version: CURRENT_DOCUMENT_VERSION,
    title: typeof value.title === 'string' && value.title.trim() ? value.title : '未命名画板',
    shapes,
    settings: {
      ...defaultSettings,
      background: typeof rawSettings.background === 'string' ? rawSettings.background : defaultSettings.background,
      grid: rawSettings.grid !== false,
      snap: rawSettings.snap === true,
      guides: rawSettings.guides !== false,
    },
    updatedAt: finiteNumber(value.updatedAt, Date.now()),
  };
}
