import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Konva from 'konva';
import {
  Arrow,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  RegularPolygon,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import useImage from 'use-image';
import type { KonvaEventObject } from 'konva/lib/Node';
import { isTextEditableShape, type BoardShape, type CanvasSettings, type Tool, type Viewport } from '../types';
import {
  calculateSmartSnap,
  findBindingTarget,
  getSelectionBounds,
  getShapeBounds,
  intersects,
  resolveBoundConnectors,
  type SnapGuide,
} from '../utils/geometry';

interface CanvasStageProps {
  shapes: BoardShape[];
  selectedIds: string[];
  tool: Tool;
  viewport: Viewport;
  settings: CanvasSettings;
  onSelect: (ids: string[]) => void;
  onToolChange: (tool: Tool) => void;
  onViewportChange: (viewport: Viewport) => void;
  onAddShape: (shape: BoardShape) => void;
  onPreviewShapes: (updater: (shapes: BoardShape[]) => BoardShape[]) => void;
  onCommitPreview: (snapshot: BoardShape[]) => void;
  onCommitShapes: (updater: (shapes: BoardShape[]) => BoardShape[]) => void;
  onOpenImagePicker: () => void;
  onDropImage: (url: string, point: { x: number; y: number }) => void;
}

export interface CanvasStageHandle {
  exportRaster: (
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    quality?: number,
    options?: { shapeIds?: string[]; pixelRatio?: number; transparent?: boolean; padding?: number },
  ) => string | null;
  fitToContent: () => void;
  fitToSelection: (shapeIds: string[]) => void;
  zoomTo: (zoom: number) => void;
  resetView: () => void;
  startEditing: (id: string) => void;
  getEditingSnapshot: () => { id: string; text: string; height: number; remove: boolean } | null;
}

interface SelectionBox {
  start: { x: number; y: number };
  current: { x: number; y: number };
  baseIds: string[];
}

interface DragSession {
  sourceId: string;
  movingIds: string[];
  snapshot: BoardShape[];
}

const createId = () => crypto.randomUUID?.() ?? `shape-${Date.now()}-${Math.random()}`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const boxShapeTypes = new Set<BoardShape['type']>(['rect', 'ellipse', 'diamond', 'note', 'image', 'text', 'frame']);
const autoHeightShapeTypes = new Set<BoardShape['type']>(['rect', 'ellipse', 'diamond', 'note', 'text']);

function baseShape(type: BoardShape['type'], point: { x: number; y: number }): BoardShape {
  const common: BoardShape = {
    id: createId(),
    type,
    name: type,
    x: point.x,
    y: point.y,
    width: 1,
    height: 1,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    fill: '#ffffff',
    stroke: '#1f2937',
    strokeWidth: 2,
    opacity: 1,
    cornerRadius: 14,
    text: '',
    textColor: '#172033',
    fontSize: 18,
    fontFamily: 'Inter, Microsoft YaHei, sans-serif',
    textAlign: 'center',
    visible: true,
    locked: false,
  };

  if (type === 'ellipse') return { ...common, fill: '#e0f2fe', stroke: '#0284c7' };
  if (type === 'diamond') return { ...common, fill: '#fef3c7', stroke: '#d97706' };
  if (type === 'frame') return { ...common, fill: 'transparent', stroke: '#94a3b8', strokeWidth: 1.5, cornerRadius: 18 };
  if (type === 'note') {
    return {
      ...common,
      name: '便签',
      width: 180,
      height: 124,
      fill: '#fff2a8',
      stroke: '#e8cf67',
      strokeWidth: 1.5,
      text: '',
      textColor: '#3f3a24',
      fontSize: 18,
      fontFamily: 'Inter, Microsoft YaHei, sans-serif',
      textAlign: 'left',
    };
  }
  if (type === 'text') {
    return {
      ...common,
      name: '文本',
      width: 220,
      height: 48,
      fill: '#111827',
      stroke: 'transparent',
      strokeWidth: 0,
      text: '',
      fontSize: 24,
      fontFamily: 'Inter, Microsoft YaHei, sans-serif',
      textAlign: 'left',
    };
  }
  if (type === 'arrow' || type === 'line' || type === 'pen') {
    return {
      ...common,
      fill: 'transparent',
      stroke: '#334155',
      strokeWidth: type === 'pen' ? 3 : 2.5,
      points: [0, 0],
    };
  }
  return common;
}

interface BoardNodeProps {
  shape: BoardShape;
  selected: boolean;
  editing: boolean;
  activeTool: Tool;
  onSelect: (event: KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number, disableSnap: boolean) => void;
  onDragEnd: (id: string, x: number, y: number, disableSnap: boolean) => void;
  onTransformStart: () => void;
  onTransformEnd: (id: string, node: Konva.Node) => void;
  onEdit: () => void;
}

function ImageNode({ shape, ...props }: BoardNodeProps) {
  const [image] = useImage(shape.url ?? '', 'anonymous');
  return (
    <KonvaImage
      id={shape.id}
      name="board-shape"
      image={image}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rotation={shape.rotation}
      scaleX={shape.scaleX}
      scaleY={shape.scaleY}
      opacity={shape.opacity}
      visible={shape.visible}
      listening={props.activeTool === 'select' || props.activeTool === 'eraser'}
      draggable={props.activeTool === 'select' && !shape.locked}
      stroke={props.selected ? '#2563eb' : 'transparent'}
      strokeWidth={props.selected ? 1.5 / Math.max(shape.scaleX, 0.25) : 0}
      onPointerDown={props.onSelect}
      onPointerEnter={(event) => { if (props.activeTool === 'eraser' && event.evt.buttons === 1) props.onSelect(event); }}
      onTap={props.onSelect}
      onDragStart={() => props.onDragStart(shape.id)}
      onDragMove={(event) => props.onDragMove(shape.id, event.target.x(), event.target.y(), event.evt.altKey)}
      onDragEnd={(event) => props.onDragEnd(shape.id, event.target.x(), event.target.y(), event.evt.altKey)}
      onTransformStart={props.onTransformStart}
      onTransformEnd={(event) => props.onTransformEnd(shape.id, event.target)}
    />
  );
}

function ShapeText({ shape, hidden = false, inset = 12, verticalAlign = 'middle' }: { shape: BoardShape; hidden?: boolean; inset?: number; verticalAlign?: 'top' | 'middle' | 'bottom' }) {
  return (
    <Text
      name="shape-text"
      x={inset}
      y={inset}
      width={Math.max(shape.width - inset * 2, 20)}
      height={Math.max(shape.height - inset * 2, 20)}
      text={shape.text}
      fontSize={shape.fontSize}
      fontFamily={shape.fontFamily}
      fontStyle={shape.fontStyle}
      align={shape.textAlign}
      verticalAlign={verticalAlign}
      fill={shape.textColor ?? (shape.type === 'note' ? '#3f3a24' : '#172033')}
      lineHeight={1.28}
      wrap="word"
      listening={false}
      visible={!hidden}
    />
  );
}

function getTextInset(shape: BoardShape) {
  if (shape.type === 'diamond') return 18;
  if (shape.type === 'note') return 14;
  if (shape.type === 'text') return 0;
  return 12;
}

function getRequiredTextHeight(shape: BoardShape, text: string) {
  if (!text.trim()) return shape.height;
  const inset = getTextInset(shape);
  const measurement = new Konva.Text({
    width: Math.max(shape.width - inset * 2, 20),
    text,
    fontSize: shape.fontSize ?? 18,
    fontFamily: shape.fontFamily,
    fontStyle: shape.fontStyle,
    lineHeight: 1.28,
    wrap: 'word',
  });
  const height = Math.ceil(measurement.height() + inset * 2);
  measurement.destroy();
  return height;
}

function BoardNode(props: BoardNodeProps) {
  const { shape } = props;
  const fixedConnector = ['arrow', 'line'].includes(shape.type) && Boolean(shape.startBindingId || shape.endBindingId);
  const common = {
    id: shape.id,
    name: 'board-shape',
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    scaleX: shape.scaleX,
    scaleY: shape.scaleY,
    opacity: shape.opacity,
    visible: shape.visible,
    listening: props.activeTool === 'select' || props.activeTool === 'eraser',
    draggable: props.activeTool === 'select' && !shape.locked && !fixedConnector,
    onPointerDown: props.onSelect,
    onPointerEnter: (event: KonvaEventObject<PointerEvent>) => {
      if (props.activeTool === 'eraser' && event.evt.buttons === 1) props.onSelect(event);
    },
    onTap: props.onSelect,
    onDblClick: props.onEdit,
    onDblTap: props.onEdit,
    onDragStart: () => props.onDragStart(shape.id),
    onDragMove: (event: KonvaEventObject<DragEvent>) => props.onDragMove(shape.id, event.target.x(), event.target.y(), event.evt.altKey),
    onDragEnd: (event: KonvaEventObject<DragEvent>) => props.onDragEnd(shape.id, event.target.x(), event.target.y(), event.evt.altKey),
    onTransformStart: props.onTransformStart,
    onTransformEnd: (event: KonvaEventObject<Event>) => props.onTransformEnd(shape.id, event.target),
  };

  if (shape.type === 'image') return <ImageNode {...props} />;
  if (shape.type === 'rect') {
    return (
      <Group {...common} width={shape.width} height={shape.height}>
        <Rect
          width={shape.width}
          height={shape.height}
          fill={shape.fill}
          fillEnabled={shape.fill !== 'transparent'}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          cornerRadius={shape.cornerRadius}
          shadowColor="#0f172a"
          shadowBlur={props.selected ? 10 : 3}
          shadowOpacity={props.selected ? 0.11 : 0.05}
          shadowOffsetY={2}
        />
        <ShapeText shape={shape} hidden={props.editing} />
      </Group>
    );
  }
  if (shape.type === 'frame') {
    return (
      <Rect
        {...common}
        width={shape.width}
        height={shape.height}
        fill={shape.fill}
        fillEnabled={shape.fill !== 'transparent'}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        cornerRadius={shape.cornerRadius}
        dash={[10, 7]}
        hitStrokeWidth={12}
      />
    );
  }
  if (shape.type === 'ellipse') {
    return (
      <Group {...common} width={shape.width} height={shape.height}>
        <Ellipse
          x={shape.width / 2}
          y={shape.height / 2}
          radiusX={shape.width / 2}
          radiusY={shape.height / 2}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
        />
        <ShapeText shape={shape} hidden={props.editing} />
      </Group>
    );
  }
  if (shape.type === 'diamond') {
    return (
      <Group {...common} width={shape.width} height={shape.height}>
        <RegularPolygon
          x={shape.width / 2}
          y={shape.height / 2}
          sides={4}
          radius={Math.min(shape.width, shape.height) / Math.SQRT2}
          scaleX={shape.width / Math.max(shape.height, 1)}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
        />
        <ShapeText shape={shape} hidden={props.editing} inset={18} />
      </Group>
    );
  }
  if (shape.type === 'arrow') {
    return (
      <Arrow
        {...common}
        points={shape.points ?? [0, 0, shape.width, shape.height]}
        fill={shape.stroke}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        pointerLength={10}
        pointerWidth={10}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={16}
      />
    );
  }
  if (shape.type === 'line' || shape.type === 'pen') {
    return (
      <Line
        {...common}
        points={shape.points ?? [0, 0, shape.width, shape.height]}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        tension={shape.type === 'pen' ? 0.32 : 0}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={16}
      />
    );
  }
  if (shape.type === 'text') {
    return (
      <Text
        {...common}
        name="board-shape shape-text"
        width={shape.width}
        height={shape.height}
        text={shape.text}
        fontSize={shape.fontSize}
        fontFamily={shape.fontFamily}
        fontStyle={shape.fontStyle}
        align={shape.textAlign}
        fill={shape.fill}
        lineHeight={1.28}
        wrap="word"
        visible={shape.visible && !props.editing}
      />
    );
  }
  return (
    <Group {...common} width={shape.width} height={shape.height}>
      <Rect
        width={shape.width}
        height={shape.height}
        fill={shape.fill}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        cornerRadius={shape.cornerRadius}
        shadowColor="#64748b"
        shadowBlur={8}
        shadowOpacity={0.13}
        shadowOffsetY={3}
      />
      <Line
        points={[shape.width - 24, 0, shape.width, 24, shape.width, 0]}
        closed
        fill="rgba(255,255,255,.48)"
        listening={false}
      />
      <ShapeText shape={shape} hidden={props.editing} inset={14} verticalAlign="top" />
    </Group>
  );
}

export const CanvasStage = forwardRef<CanvasStageHandle, CanvasStageProps>(function CanvasStage(
  {
    shapes,
    selectedIds,
    tool,
    viewport,
    settings,
    onSelect,
    onToolChange,
    onViewportChange,
    onAddShape,
    onPreviewShapes,
    onCommitPreview,
    onCommitShapes,
    onOpenImagePicker,
    onDropImage,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const shapeGroupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const [draft, setDraft] = useState<BoardShape | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const drawingStartRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{ pointer: { x: number; y: number }; viewport: Viewport } | null>(null);
  const interactionSnapshotRef = useRef<BoardShape[] | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const lastTouchRef = useRef<{ center: { x: number; y: number }; distance: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const interactive = Boolean(target?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="menuitem"]'));
      if (event.code === 'Space' && !interactive) {
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const nodes = selectedIds
      .filter((id) => {
        const shape = shapes.find((item) => item.id === id);
        return shape && !shape.locked && !shape.startBindingId && !shape.endBindingId;
      })
      .map((id) => stage.findOne(`#${id}`))
      .filter((node): node is Konva.Node => Boolean(node));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, shapes]);

  const selectedTextShape = useMemo(
    () => shapes.find((shape) => shape.id === editingId && isTextEditableShape(shape)),
    [editingId, shapes],
  );
  const renderedDraft = useMemo(
    () => draft ? resolveBoundConnectors([...shapes, draft]).at(-1) ?? draft : null,
    [draft, shapes],
  );
  const connectionTargets = useMemo(() => {
    if (!draft) return [];
    const ids = new Set([draft.startBindingId, draft.endBindingId].filter((id): id is string => Boolean(id)));
    return shapes.filter((shape) => ids.has(shape.id)).map((shape) => getShapeBounds(shape));
  }, [draft, shapes]);

  const screenToWorld = (point: { x: number; y: number }) => ({
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  });

  const getPointer = () => stageRef.current?.getPointerPosition() ?? { x: 0, y: 0 };

  const startEditing = (shape: BoardShape) => {
    if (shape.locked || !isTextEditableShape(shape)) return;
    setEditingId(shape.id);
    setEditingValue(shape.text ?? '');
  };

  const finishEditing = () => {
    if (editingId && selectedTextShape) {
      if (selectedTextShape.type === 'text' && !editingValue.trim()) {
        onCommitShapes((items) => items.filter((item) => item.id !== editingId));
        onSelect(selectedIds.filter((id) => id !== editingId));
      } else {
        const shouldGrow = autoHeightShapeTypes.has(selectedTextShape.type) && Boolean(editingValue.trim());
        const measuredHeight = shouldGrow
          ? Math.max(
            selectedTextShape.height,
            selectedTextShape.type === 'text' ? 48 : 10,
            getRequiredTextHeight(selectedTextShape, editingValue),
          )
          : selectedTextShape.height;
        const textChanged = editingValue !== selectedTextShape.text;
        const heightChanged = Math.abs(measuredHeight - selectedTextShape.height) > 0.5;
        if (textChanged || heightChanged) {
          onCommitShapes((items) => items.map((item) => item.id === editingId
            ? { ...item, text: editingValue, height: measuredHeight }
            : item));
        }
      }
    }
    setEditingId(null);
  };

  const handleShapeSelect = (shape: BoardShape, event: KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>) => {
    if (tool === 'eraser') {
      event.cancelBubble = true;
      onCommitShapes((items) => items.filter((item) => item.id !== shape.id));
      onSelect(selectedIds.filter((id) => id !== shape.id));
      return;
    }
    if (tool !== 'select') return;
    event.cancelBubble = true;
    const multi = 'shiftKey' in event.evt && event.evt.shiftKey;
    const isolate = 'altKey' in event.evt && event.evt.altKey;
    const targetIds = shape.groupId && !isolate
      ? shapes.filter((item) => item.groupId === shape.groupId).map((item) => item.id)
      : [shape.id];
    if (multi) {
      const allSelected = targetIds.every((id) => selectedIds.includes(id));
      onSelect(allSelected
        ? selectedIds.filter((id) => !targetIds.includes(id))
        : [...new Set([...selectedIds, ...targetIds])]);
    } else if (!targetIds.every((id) => selectedIds.includes(id))) {
      onSelect(targetIds);
    }
  };

  const cloneShapes = () => shapes.map((shape) => ({ ...shape, points: shape.points ? [...shape.points] : undefined }));

  const beginInteraction = () => {
    interactionSnapshotRef.current = cloneShapes();
  };

  const beginDrag = (id: string) => {
    const snapshot = cloneShapes();
    interactionSnapshotRef.current = snapshot;
    const source = snapshot.find((shape) => shape.id === id);
    const candidateIds = selectedIds.includes(id)
      ? selectedIds
      : source?.groupId
        ? snapshot.filter((shape) => shape.groupId === source.groupId).map((shape) => shape.id)
        : [id];
    const movingIds = candidateIds.filter((movingId) => !snapshot.find((shape) => shape.id === movingId)?.locked);
    dragSessionRef.current = { sourceId: id, movingIds, snapshot };
  };

  const previewPosition = (id: string, x: number, y: number, disableSnap: boolean) => {
    const session = dragSessionRef.current;
    if (!session || session.sourceId !== id) return;
    const source = session.snapshot.find((shape) => shape.id === id);
    if (!source) return;
    let rawDelta = { x: x - source.x, y: y - source.y };
    if (settings.snap && !disableSnap) {
      rawDelta = {
        x: Math.round((source.x + rawDelta.x) / 12) * 12 - source.x,
        y: Math.round((source.y + rawDelta.y) / 12) * 12 - source.y,
      };
    }

    const movingSet = new Set(session.movingIds);
    const movingShapes = session.snapshot.filter((shape) => movingSet.has(shape.id));
    const otherShapes = session.snapshot.filter((shape) => !movingSet.has(shape.id) && shape.visible);
    const snapped = settings.guides && !disableSnap
      ? calculateSmartSnap(movingShapes, otherShapes, rawDelta, 7 / viewport.zoom)
      : { delta: rawDelta, guides: [] as SnapGuide[] };
    setSnapGuides(snapped.guides);
    const origin = new Map(session.snapshot.map((shape) => [shape.id, shape]));
    onPreviewShapes((items) => items.map((item) => {
      if (!movingSet.has(item.id)) return item;
      const original = origin.get(item.id);
      return original ? { ...item, x: original.x + snapped.delta.x, y: original.y + snapped.delta.y } : item;
    }));
  };

  const finishPosition = (id: string, x: number, y: number, disableSnap: boolean) => {
    previewPosition(id, x, y, disableSnap);
    if (interactionSnapshotRef.current) onCommitPreview(interactionSnapshotRef.current);
    interactionSnapshotRef.current = null;
    dragSessionRef.current = null;
    setSnapGuides([]);
  };

  const finishTransform = (id: string, node: Konva.Node) => {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const shapeType = shapes.find((shape) => shape.id === id)?.type;
    const normalizeScale = shapeType ? boxShapeTypes.has(shapeType) : false;
    if (normalizeScale) node.scale({ x: 1, y: 1 });
    onPreviewShapes((items) => items.map((item) => {
      if (item.id !== id) return item;
      return boxShapeTypes.has(item.type) ? {
        ...item,
        x: node.x(),
        y: node.y(),
        width: Math.max(10, item.width * scaleX),
        height: Math.max(10, item.height * scaleY),
        rotation: node.rotation(),
        scaleX: 1,
        scaleY: 1,
      } : {
        ...item,
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX,
        scaleY,
      };
    }));
    if (interactionSnapshotRef.current) onCommitPreview(interactionSnapshotRef.current);
    interactionSnapshotRef.current = null;
  };

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    const pointer = getPointer();
    if (event.evt.button === 1 || tool === 'hand' || spacePressed) {
      event.evt.preventDefault();
      panRef.current = { pointer, viewport };
      return;
    }
    let target: Konva.Node | null = event.target;
    while (target) {
      if (target === transformerRef.current) return;
      target = target.getParent();
    }
    if (event.target.name() === 'board-shape') return;
    if (tool === 'select') {
      const world = screenToWorld(pointer);
      const keepSelection = event.evt.shiftKey;
      setSelectionBox({ start: world, current: world, baseIds: keepSelection ? selectedIds : [] });
      if (!keepSelection) onSelect([]);
      return;
    }
    if (tool === 'image') {
      onOpenImagePicker();
      return;
    }
    const world = screenToWorld(pointer);
    if (tool === 'text' || tool === 'note') {
      const created = baseShape(tool, world);
      onAddShape(created);
      onSelect([created.id]);
      onToolChange('select');
      window.requestAnimationFrame(() => startEditing(created));
      return;
    }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'diamond' || tool === 'arrow' || tool === 'line' || tool === 'pen' || tool === 'frame') {
      drawingStartRef.current = world;
      const created = baseShape(tool, world);
      if (tool === 'arrow' || tool === 'line') {
        created.startBindingId = findBindingTarget(shapes, world, 16 / viewport.zoom)?.id;
      }
      setDraft(created);
    }
  };

  const handlePointerMove = () => {
    const pointer = getPointer();
    if (panRef.current) {
      const deltaX = pointer.x - panRef.current.pointer.x;
      const deltaY = pointer.y - panRef.current.pointer.y;
      onViewportChange({
        ...viewport,
        x: panRef.current.viewport.x + deltaX,
        y: panRef.current.viewport.y + deltaY,
      });
      return;
    }
    if (selectionBox) {
      setSelectionBox((current) => current ? { ...current, current: screenToWorld(pointer) } : null);
      return;
    }
    if (!draft || !drawingStartRef.current) return;
    const world = screenToWorld(pointer);
    const start = drawingStartRef.current;
    if (draft.type === 'arrow' || draft.type === 'line') {
      const ignored = draft.startBindingId ? new Set([draft.startBindingId]) : undefined;
      setDraft({
        ...draft,
        points: [0, 0, world.x - start.x, world.y - start.y],
        width: Math.abs(world.x - start.x),
        height: Math.abs(world.y - start.y),
        endBindingId: findBindingTarget(shapes, world, 18 / viewport.zoom, ignored)?.id,
      });
      return;
    }
    if (draft.type === 'pen') {
      setDraft({
        ...draft,
        points: [...(draft.points ?? [0, 0]), world.x - start.x, world.y - start.y],
        width: Math.max(draft.width, Math.abs(world.x - start.x)),
        height: Math.max(draft.height, Math.abs(world.y - start.y)),
      });
      return;
    }
    setDraft({
      ...draft,
      x: Math.min(start.x, world.x),
      y: Math.min(start.y, world.y),
      width: Math.abs(world.x - start.x),
      height: Math.abs(world.y - start.y),
    });
  };

  const handlePointerUp = () => {
    panRef.current = null;
    if (selectionBox) {
      const left = Math.min(selectionBox.start.x, selectionBox.current.x);
      const top = Math.min(selectionBox.start.y, selectionBox.current.y);
      const right = Math.max(selectionBox.start.x, selectionBox.current.x);
      const bottom = Math.max(selectionBox.start.y, selectionBox.current.y);
      const moved = Math.hypot(right - left, bottom - top) * viewport.zoom;
      if (moved > 4) {
        const selectionBounds = {
          left,
          top,
          right,
          bottom,
          width: right - left,
          height: bottom - top,
          centerX: (left + right) / 2,
          centerY: (top + bottom) / 2,
        };
        const hits = shapes
          .filter((shape) => shape.visible && !shape.locked && intersects(selectionBounds, getShapeBounds(shape)))
          .flatMap((shape) => shape.groupId
            ? shapes.filter((item) => item.groupId === shape.groupId && item.visible && !item.locked).map((item) => item.id)
            : [shape.id]);
        onSelect([...new Set([...selectionBox.baseIds, ...hits])]);
      } else {
        onSelect(selectionBox.baseIds);
      }
      setSelectionBox(null);
      return;
    }
    if (!draft) return;
    const valid = draft.type === 'pen'
      ? (draft.points?.length ?? 0) > 5
      : draft.type === 'arrow' || draft.type === 'line'
        ? Math.hypot(draft.width, draft.height) > 4
        : draft.width > 4 && draft.height > 4;
    if (valid) {
      onAddShape(draft);
      onSelect([draft.id]);
      if (isTextEditableShape(draft)) startEditing(draft);
    }
    setDraft(null);
    drawingStartRef.current = null;
    if (tool !== 'pen' && tool !== 'eraser') onToolChange('select');
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = getPointer();
    if (event.evt.ctrlKey || event.evt.metaKey) {
      const nextZoom = clamp(viewport.zoom * Math.pow(1.008, -event.evt.deltaY), 0.15, 4);
      const world = screenToWorld(pointer);
      onViewportChange({
        zoom: nextZoom,
        x: pointer.x - world.x * nextZoom,
        y: pointer.y - world.y * nextZoom,
      });
    } else {
      onViewportChange({ ...viewport, x: viewport.x - event.evt.deltaX, y: viewport.y - event.evt.deltaY });
    }
  };

  const handleTouchMove = (event: KonvaEventObject<TouchEvent>) => {
    if (event.evt.touches.length !== 2) return;
    event.evt.preventDefault();
    panRef.current = null;
    drawingStartRef.current = null;
    setDraft(null);
    setSelectionBox(null);
    setSnapGuides([]);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const [a, b] = Array.from(event.evt.touches);
    const center = {
      x: (a.clientX + b.clientX) / 2 - rect.left,
      y: (a.clientY + b.clientY) / 2 - rect.top,
    };
    const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    if (!lastTouchRef.current) {
      lastTouchRef.current = { center, distance };
      return;
    }
    const nextZoom = clamp(viewport.zoom * distance / lastTouchRef.current.distance, 0.15, 4);
    const world = {
      x: (lastTouchRef.current.center.x - viewport.x) / viewport.zoom,
      y: (lastTouchRef.current.center.y - viewport.y) / viewport.zoom,
    };
    onViewportChange({
      zoom: nextZoom,
      x: center.x - world.x * nextZoom,
      y: center.y - world.y * nextZoom,
    });
    lastTouchRef.current = { center, distance };
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('image/'));
    if (!file) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const reader = new FileReader();
    reader.onload = () => {
      const point = screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      onDropImage(String(reader.result), point);
    };
    reader.readAsDataURL(file);
  };

  const fitShapesInView = (targetShapes: BoardShape[], maxZoom: number) => {
    const canvasWidth = containerRef.current?.clientWidth || size.width;
    const canvasHeight = containerRef.current?.clientHeight || size.height;
    const bounds = getSelectionBounds(targetShapes);
    if (!bounds) return;
    const contentWidth = Math.max(bounds.width, 40);
    const contentHeight = Math.max(bounds.height, 40);
    const horizontalInset = canvasWidth < 600 ? 48 : 180;
    const verticalInset = canvasHeight < 700 ? 96 : 180;
    const zoom = clamp(Math.min(
      Math.max(canvasWidth - horizontalInset, 40) / contentWidth,
      Math.max(canvasHeight - verticalInset, 40) / contentHeight,
    ), 0.15, maxZoom);
    onViewportChange({
      zoom,
      x: canvasWidth / 2 - bounds.centerX * zoom,
      y: canvasHeight / 2 - bounds.centerY * zoom,
    });
  };

  useImperativeHandle(ref, () => ({
    exportRaster: (mimeType, quality = 0.94, options) => {
      const stage = stageRef.current;
      const group = shapeGroupRef.current;
      const transformer = transformerRef.current;
      const background = stage?.findOne('.export-background') as Konva.Rect | undefined;
      if (!stage || !group || !background) return null;
      const requestedIds = options?.shapeIds ? new Set(options.shapeIds) : null;
      const exportShapes = shapes.filter((shape) => shape.visible && (!requestedIds || requestedIds.has(shape.id)));
      if (!exportShapes.length) return null;
      const exportIds = new Set(exportShapes.map((shape) => shape.id));
      const bounds = getSelectionBounds(exportShapes);
      if (!bounds) return null;
      const padding = clamp(options?.padding ?? 48, 0, 256);
      const exportWidth = Math.ceil(Math.max(bounds.width + padding * 2, 1));
      const exportHeight = Math.ceil(Math.max(bounds.height + padding * 2, 1));
      const pixelRatio = clamp(options?.pixelRatio ?? 2, 1, 4);
      const originalStageSize = stage.size();
      const originalBackgroundSize = background.size();
      const originalPosition = group.position();
      const originalScale = group.scale();
      const originalBackground = background.fill();
      const wasVisible = transformer?.visible();
      const boardNodes = stage.find('.board-shape');
      const boardVisibility = boardNodes.map((node) => ({ node, visible: node.visible() }));
      const transientNodes = stage.find('.canvas-transient');
      const transientVisibility = transientNodes.map((node) => ({ node, visible: node.visible() }));
      let editingTextNode: Konva.Text | null = null;
      let originalEditingText = '';
      let originalEditingVisibility = false;

      try {
        transformer?.visible(false);
        boardNodes.forEach((node) => node.visible(exportIds.has(node.id())));
        transientNodes.forEach((node) => node.visible(false));
        if (editingId && exportIds.has(editingId)) {
          const editingNode = stage.findOne(`#${editingId}`);
          editingTextNode = editingNode instanceof Konva.Text
            ? editingNode
            : editingNode instanceof Konva.Group
              ? editingNode.findOne('.shape-text') as Konva.Text | null
              : null;
          if (editingTextNode) {
            originalEditingText = editingTextNode.text();
            originalEditingVisibility = editingTextNode.visible();
            editingTextNode.text(editingValue);
            editingTextNode.visible(true);
          }
        }
        stage.size({ width: exportWidth, height: exportHeight });
        background.size({ width: exportWidth, height: exportHeight });
        background.fill(options?.transparent ? 'rgba(0,0,0,0)' : settings.background);
        group.position({ x: padding - bounds.left, y: padding - bounds.top });
        group.scale({ x: 1, y: 1 });
        stage.draw();
        return stage.toDataURL({ pixelRatio, mimeType, quality });
      } finally {
        if (editingTextNode) {
          editingTextNode.text(originalEditingText);
          editingTextNode.visible(originalEditingVisibility);
        }
        boardVisibility.forEach(({ node, visible }) => node.visible(visible));
        transientVisibility.forEach(({ node, visible }) => node.visible(visible));
        stage.size(originalStageSize);
        background.size(originalBackgroundSize);
        background.fill(originalBackground);
        group.position(originalPosition);
        group.scale(originalScale);
        transformer?.visible(wasVisible ?? true);
        stage.draw();
      }
    },
    fitToContent: () => {
      const canvasWidth = containerRef.current?.clientWidth || size.width;
      const canvasHeight = containerRef.current?.clientHeight || size.height;
      const visibleShapes = shapes.filter((shape) => shape.visible);
      if (!visibleShapes.length) {
        onViewportChange({ x: canvasWidth / 2, y: canvasHeight / 2, zoom: 1 });
        return;
      }
      fitShapesInView(visibleShapes, 1.35);
    },
    fitToSelection: (shapeIds) => {
      const selected = new Set(shapeIds);
      fitShapesInView(shapes.filter((shape) => shape.visible && selected.has(shape.id)), 2.5);
    },
    zoomTo: (requestedZoom) => {
      const zoom = clamp(requestedZoom, 0.15, 4);
      const canvasWidth = containerRef.current?.clientWidth || size.width;
      const canvasHeight = containerRef.current?.clientHeight || size.height;
      const anchor = { x: canvasWidth / 2, y: canvasHeight / 2 };
      const world = {
        x: (anchor.x - viewport.x) / viewport.zoom,
        y: (anchor.y - viewport.y) / viewport.zoom,
      };
      onViewportChange({
        zoom,
        x: anchor.x - world.x * zoom,
        y: anchor.y - world.y * zoom,
      });
    },
    resetView: () => onViewportChange({ x: 120, y: 90, zoom: 1 }),
    startEditing: (id: string) => {
      const shape = shapes.find((item) => item.id === id);
      if (shape) startEditing(shape);
    },
    getEditingSnapshot: () => {
      if (!editingId || !selectedTextShape) return null;
      const remove = selectedTextShape.type === 'text' && !editingValue.trim();
      const shouldGrow = autoHeightShapeTypes.has(selectedTextShape.type) && Boolean(editingValue.trim());
      const height = shouldGrow
        ? Math.max(
          selectedTextShape.height,
          selectedTextShape.type === 'text' ? 48 : 10,
          getRequiredTextHeight(selectedTextShape, editingValue),
        )
        : selectedTextShape.height;
      return { id: editingId, text: editingValue, height, remove };
    },
  }), [editingId, editingValue, shapes, size, settings.background, viewport, onViewportChange]);

  const gridSize = 24 * viewport.zoom;
  const cursor = panRef.current || tool === 'hand' || spacePressed
    ? 'grabbing'
      : tool === 'select'
      ? 'default'
      : tool === 'eraser'
        ? 'cell'
      : tool === 'text'
        ? 'text'
        : 'crosshair';
  const containedEditor = selectedTextShape && ['rect', 'ellipse', 'diamond'].includes(selectedTextShape.type);
  const editorScaleY = selectedTextShape ? Math.abs(selectedTextShape.scaleY) * viewport.zoom : viewport.zoom;
  const editorHeight = selectedTextShape ? Math.max(44, selectedTextShape.height * editorScaleY) : 44;
  const editorFontSize = selectedTextShape ? (selectedTextShape.fontSize ?? 18) * editorScaleY : 18;
  const editorLineCount = Math.max(1, editingValue.split(/\r?\n/).length);
  const editorPaddingTop = containedEditor
    ? Math.max(8, (editorHeight - editorFontSize * 1.28 * editorLineCount) / 2)
    : undefined;
  const transformerHandleSize = size.width <= 900 ? 16 : 10;

  useLayoutEffect(() => {
    const editor = textEditorRef.current;
    if (!editor || !selectedTextShape || !autoHeightShapeTypes.has(selectedTextShape.type)) return;
    const borderHeight = editor.offsetHeight - editor.clientHeight;
    const inset = selectedTextShape.type === 'note' ? 14 : containedEditor ? 12 : 10;
    editor.style.paddingTop = `${inset}px`;
    editor.style.height = '0px';
    const naturalHeight = editor.scrollHeight + borderHeight;
    const nextHeight = Math.max(editorHeight, naturalHeight);
    editor.style.height = `${nextHeight}px`;
    if (containedEditor && nextHeight > naturalHeight) {
      editor.style.paddingTop = `${inset + (nextHeight - naturalHeight) / 2}px`;
    }
  }, [containedEditor, editingValue, editorHeight, selectedTextShape, selectedTextShape?.width]);

  return (
    <div
      ref={containerRef}
      className="canvas-stage"
      data-tool={tool}
      style={{
        cursor,
        backgroundColor: settings.background,
        backgroundImage: settings.grid ? 'radial-gradient(circle, rgba(93,108,132,.24) 1px, transparent 1px)' : 'none',
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => { lastTouchRef.current = null; }}
      >
        <Layer>
          <Rect
            name="export-background"
            width={size.width}
            height={size.height}
            fill="rgba(0,0,0,0)"
            listening={false}
          />
          <Group ref={shapeGroupRef} x={viewport.x} y={viewport.y} scaleX={viewport.zoom} scaleY={viewport.zoom}>
            {shapes.map((shape) => (
              <BoardNode
                key={shape.id}
                shape={shape}
                selected={selectedIds.includes(shape.id)}
                editing={editingId === shape.id}
                activeTool={tool}
                onSelect={(event) => handleShapeSelect(shape, event)}
                onDragStart={beginDrag}
                onDragMove={previewPosition}
                onDragEnd={finishPosition}
                onTransformStart={beginInteraction}
                onTransformEnd={finishTransform}
                onEdit={() => startEditing(shape)}
              />
            ))}
            {connectionTargets.map((bounds, index) => (
              <Rect
                key={`connection-target-${index}`}
                name="canvas-transient"
                x={bounds.left - 6 / viewport.zoom}
                y={bounds.top - 6 / viewport.zoom}
                width={bounds.width + 12 / viewport.zoom}
                height={bounds.height + 12 / viewport.zoom}
                stroke="#3659e3"
                strokeWidth={2 / viewport.zoom}
                cornerRadius={8 / viewport.zoom}
                shadowColor="#3659e3"
                shadowBlur={10 / viewport.zoom}
                shadowOpacity={0.2}
                listening={false}
              />
            ))}
            {renderedDraft && (
              <BoardNode
                shape={renderedDraft}
                selected={false}
                editing={false}
                activeTool={tool}
                onSelect={() => undefined}
                onDragStart={() => undefined}
                onDragMove={() => undefined}
                onDragEnd={() => undefined}
                onTransformStart={() => undefined}
                onTransformEnd={() => undefined}
                onEdit={() => undefined}
              />
            )}
            {selectionBox && (
              <Rect
                name="canvas-transient"
                x={Math.min(selectionBox.start.x, selectionBox.current.x)}
                y={Math.min(selectionBox.start.y, selectionBox.current.y)}
                width={Math.abs(selectionBox.current.x - selectionBox.start.x)}
                height={Math.abs(selectionBox.current.y - selectionBox.start.y)}
                fill="rgba(54,89,227,.09)"
                stroke="#3659e3"
                strokeWidth={1.2 / viewport.zoom}
                dash={[6 / viewport.zoom, 4 / viewport.zoom]}
                listening={false}
              />
            )}
            {snapGuides.map((guide, index) => (
              <Line
                key={`${guide.orientation}-${guide.position}-${index}`}
                name="canvas-transient"
                points={guide.orientation === 'vertical'
                  ? [guide.position, guide.start, guide.position, guide.end]
                  : [guide.start, guide.position, guide.end, guide.position]}
                stroke="#ef5a67"
                strokeWidth={1.25 / viewport.zoom}
                dash={[5 / viewport.zoom, 4 / viewport.zoom]}
                listening={false}
              />
            ))}
            <Transformer
              ref={transformerRef}
              rotateEnabled
              keepRatio={false}
              flipEnabled={false}
              borderStroke="#2563eb"
              borderStrokeWidth={1.5 / viewport.zoom}
              anchorFill="#ffffff"
              anchorStroke="#2563eb"
              anchorStrokeWidth={1.5 / viewport.zoom}
              anchorSize={transformerHandleSize / viewport.zoom}
              padding={0}
              rotateAnchorOffset={28 / viewport.zoom}
              enabledAnchors={['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
              boundBoxFunc={(oldBox, newBox) => Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10 ? oldBox : newBox}
            />
          </Group>
        </Layer>
      </Stage>

      {selectedTextShape && editingId && (
        <textarea
          ref={textEditorRef}
          aria-label="画布文字编辑"
          placeholder="输入文字"
          className={`canvas-text-editor ${selectedTextShape.type === 'note' ? 'is-note' : ''} ${['rect', 'ellipse', 'diamond'].includes(selectedTextShape.type) ? 'is-contained' : ''}`}
          style={{
            left: viewport.x + selectedTextShape.x * viewport.zoom,
            top: viewport.y + selectedTextShape.y * viewport.zoom,
            width: Math.max(80, selectedTextShape.width * selectedTextShape.scaleX * viewport.zoom),
            height: editorHeight,
            paddingTop: editorPaddingTop,
            fontSize: editorFontSize,
            fontFamily: selectedTextShape.fontFamily,
            fontWeight: selectedTextShape.fontStyle === 'bold' ? 700 : 400,
            textAlign: selectedTextShape.textAlign,
            color: selectedTextShape.type === 'text'
              ? selectedTextShape.fill
              : (selectedTextShape.textColor ?? (selectedTextShape.type === 'note' ? '#3f3a24' : '#172033')),
            background: selectedTextShape.type === 'note' ? selectedTextShape.fill : 'transparent',
            transform: `rotate(${selectedTextShape.rotation}deg)`,
            transformOrigin: '0 0',
          }}
          value={editingValue}
          autoFocus
          onChange={(event) => setEditingValue(event.target.value)}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            if (event.key === 'Escape') finishEditing();
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') finishEditing();
          }}
        />
      )}
    </div>
  );
});
