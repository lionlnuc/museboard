export type Tool =
  | 'select'
  | 'hand'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'note'
  | 'image'
  | 'frame'
  | 'eraser';

export type ShapeType = Exclude<Tool, 'select' | 'hand' | 'image' | 'eraser'> | 'image';

export interface BoardShape {
  id: string;
  type: ShapeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  cornerRadius: number;
  points?: number[];
  text?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  textAlign?: 'left' | 'center' | 'right';
  url?: string;
  /**
   * Optional content-addressed reference used by the IndexedDB asset store.
   * `url` remains the portable/legacy representation for JSON files and
   * browsers that do not have the asset store available.
   */
  assetId?: string;
  /** Connector endpoints can stay attached to shape boundaries. */
  startBindingId?: string;
  endBindingId?: string;
  groupId?: string;
  visible: boolean;
  locked: boolean;
}

export interface CanvasSettings {
  background: string;
  grid: boolean;
  snap: boolean;
  guides: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardDocument {
  /** Schema version. Keep this numeric so future migrations can be explicit. */
  version: number;
  title: string;
  shapes: BoardShape[];
  settings: CanvasSettings;
  updatedAt: number;
}

export function isTextEditableShape(shape: Pick<BoardShape, 'type'>) {
  return ['rect', 'ellipse', 'diamond', 'note', 'text'].includes(shape.type);
}

export const SHAPE_LABELS: Record<ShapeType, string> = {
  rect: '矩形',
  ellipse: '椭圆',
  diamond: '菱形',
  arrow: '箭头',
  line: '直线',
  pen: '画笔',
  text: '文本',
  note: '便签',
  image: '图片',
  frame: '画框',
};
