import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomControls } from './components/BottomControls';
import { CanvasStage, type CanvasStageHandle } from './components/CanvasStage';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { ExportDialog, type ExportOptions } from './components/ExportDialog';
import { HeaderBar } from './components/HeaderBar';
import { LeftPanel } from './components/LeftPanel';
import { MiniMap } from './components/MiniMap';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SelectionBar } from './components/SelectionBar';
import { Toolbar } from './components/Toolbar';
import { TOOL_BY_SHORTCUT, TOOL_DEFINITIONS } from './config/tools';
import { useBoardDocument } from './hooks/useBoardDocument';
import { isTextEditableShape, type BoardShape, type Tool, type Viewport } from './types';
import { boardToSvg } from './utils/exportSvg';
import { parseBoardDocument } from './utils/document';
import {
  alignShapes,
  distributeShapes,
  getShapeBounds,
  isBindableShape,
  type AlignMode,
  type DistributeMode,
} from './utils/geometry';

const createId = () => crypto.randomUUID?.() ?? `shape-${Date.now()}-${Math.random()}`;
const CLIPBOARD_PREFIX = 'MUSEBOARD_CLIPBOARD_V1\n';
const CLIPBOARD_MIME = 'web application/x-museboard+json';

function serializeShapesForClipboard(shapes: BoardShape[]) {
  return JSON.stringify({ version: 1, shapes });
}

function readShapesFromClipboard(value: string) {
  const serialized = value.startsWith(CLIPBOARD_PREFIX) ? value.slice(CLIPBOARD_PREFIX.length) : value;
  try {
    const payload = JSON.parse(serialized) as { version?: unknown; shapes?: unknown };
    return payload.version === 1 && Array.isArray(payload.shapes) ? payload.shapes : null;
  } catch {
    return null;
  }
}

function readShapesFromClipboardHtml(value: string) {
  if (!value) return null;
  const document = new DOMParser().parseFromString(value, 'text/html');
  const payload = document.querySelector<HTMLElement>('[data-museboard-clipboard]')?.dataset.museboardClipboard;
  if (!payload) return null;
  try {
    return readShapesFromClipboard(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

function download(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'museboard';
}

interface ToastState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface BrowserFileHandle {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: unknown) => Promise<BrowserFileHandle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<BrowserFileHandle>;
};

export default function App() {
  const board = useBoardDocument();
  const [tool, setTool] = useState<Tool>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const [commandOpen, setCommandOpen] = useState(false);
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const canvasRef = useRef<CanvasStageHandle>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const fileHandleRef = useRef<BrowserFileHandle | null>(null);
  const shapeClipboardRef = useRef<BoardShape[]>([]);
  const pasteOffsetRef = useRef(0);
  const selectedShapes = useMemo(
    () => board.document.shapes.filter((shape) => selectedIds.includes(shape.id)),
    [board.document.shapes, selectedIds],
  );

  const getOutputDocument = useCallback(() => {
    const editing = canvasRef.current?.getEditingSnapshot();
    if (!editing) return board.document;
    return {
      ...board.document,
      shapes: editing.remove
        ? board.document.shapes.filter((shape) => shape.id !== editing.id)
        : board.document.shapes.map((shape) => shape.id === editing.id
          ? { ...shape, text: editing.text, height: editing.height }
          : shape),
    };
  }, [board.document]);

  const showToast = useCallback((message: string, action?: Pick<ToastState, 'actionLabel' | 'onAction'>) => {
    setToast({ message, ...action });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), action?.onAction ? 5000 : 2200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  useEffect(() => {
    const available = new Set(board.document.shapes.map((shape) => shape.id));
    setSelectedIds((ids) => ids.filter((id) => available.has(id)));
  }, [board.document.shapes]);

  useEffect(() => {
    const timer = window.setTimeout(() => canvasRef.current?.fitToContent(), 320);
    return () => window.clearTimeout(timer);
  }, []);

  const patchShape = useCallback((id: string, patch: Partial<BoardShape>) => {
    board.commitShapes((shapes) => shapes.map((shape) => shape.id === id ? { ...shape, ...patch } : shape));
  }, [board]);

  const patchSelected = useCallback((patch: Partial<BoardShape>) => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    board.commitShapes((shapes) => shapes.map((shape) => selected.has(shape.id) ? { ...shape, ...patch } : shape));
  }, [board, selectedIds]);

  const addShape = useCallback((shape: BoardShape) => {
    const names: Partial<Record<BoardShape['type'], string>> = {
      rect: '矩形', ellipse: '椭圆', diamond: '菱形', arrow: '箭头', line: '直线', pen: '画笔', text: '文本', note: '便签', image: '图片', frame: '画框',
    };
    const count = board.presentRef.current.shapes.filter((item) => item.type === shape.type).length + 1;
    const named = { ...shape, name: `${names[shape.type]} ${count}` };
    board.commitShapes((shapes) => shape.type === 'frame' ? [named, ...shapes] : [...shapes, named]);
  }, [board]);

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    board.commitShapes((shapes) => shapes.filter((shape) => !selected.has(shape.id)));
    setSelectedIds([]);
    showToast(`已删除 ${selected.size} 个对象`);
  }, [board, selectedIds, showToast]);

  const duplicateSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    const nextIds: string[] = [];
    board.commitShapes((shapes) => {
      const source = shapes.filter((shape) => selected.has(shape.id));
      const idMap = new Map(source.map((shape) => [shape.id, createId()]));
      const groupMap = new Map<string, string>();
      const copies = source.map((shape) => {
        const id = idMap.get(shape.id)!;
        nextIds.push(id);
        if (shape.groupId && !groupMap.has(shape.groupId)) groupMap.set(shape.groupId, `group-${createId()}`);
        return {
          ...shape,
          id,
          name: `${shape.name} 副本`,
          x: shape.x + 24,
          y: shape.y + 24,
          groupId: shape.groupId ? groupMap.get(shape.groupId) : undefined,
          startBindingId: shape.startBindingId ? idMap.get(shape.startBindingId) : undefined,
          endBindingId: shape.endBindingId ? idMap.get(shape.endBindingId) : undefined,
          points: shape.points ? [...shape.points] : undefined,
        };
      });
      return [...shapes, ...copies];
    });
    setSelectedIds(nextIds);
    showToast('已创建副本');
  }, [board, selectedIds, showToast]);

  const copySelected = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    shapeClipboardRef.current = board.document.shapes
      .filter((shape) => selected.has(shape.id))
      .map((shape) => ({ ...shape, points: shape.points ? [...shape.points] : undefined }));
    pasteOffsetRef.current = 0;
    const serialized = serializeShapesForClipboard(shapeClipboardRef.current);
    const fallback = `${CLIPBOARD_PREFIX}${serialized}`;
    const writeFallback = () => navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(fallback).catch(() => undefined)
      : Promise.resolve();
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const label = shapeClipboardRef.current
        .map((shape) => shape.text?.trim())
        .filter(Boolean)
        .join('\n') || `Museboard 选区（${shapeClipboardRef.current.length} 个对象）`;
      const html = `<div data-museboard-clipboard="${encodeURIComponent(serialized)}">${label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</div>`;
      try {
        const item = new ClipboardItem({
          [CLIPBOARD_MIME]: new Blob([serialized], { type: CLIPBOARD_MIME }),
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([label], { type: 'text/plain' }),
        });
        void navigator.clipboard.write([item]).catch(writeFallback);
      } catch {
        void writeFallback();
      }
    } else {
      void writeFallback();
    }
    showToast(`已复制 ${shapeClipboardRef.current.length} 个对象`);
  }, [board.document.shapes, selectedIds, showToast]);

  const pasteShapes = useCallback((source: BoardShape[]) => {
    if (!source.length) return;
    pasteOffsetRef.current += 24;
    const groupMap = new Map<string, string>();
    const idMap = new Map(source.map((shape) => [shape.id, createId()]));
    const nextIds: string[] = [];
    const copies = source.map((shape) => {
      const id = idMap.get(shape.id)!;
      nextIds.push(id);
      if (shape.groupId && !groupMap.has(shape.groupId)) groupMap.set(shape.groupId, `group-${createId()}`);
      return {
        ...shape,
        id,
        name: `${shape.name} 副本`,
        x: shape.x + pasteOffsetRef.current,
        y: shape.y + pasteOffsetRef.current,
        groupId: shape.groupId ? groupMap.get(shape.groupId) : undefined,
        startBindingId: shape.startBindingId ? idMap.get(shape.startBindingId) : undefined,
        endBindingId: shape.endBindingId ? idMap.get(shape.endBindingId) : undefined,
        points: shape.points ? [...shape.points] : undefined,
      };
    });
    board.commitShapes((shapes) => [...shapes, ...copies]);
    setSelectedIds(nextIds);
    setTool('select');
    showToast(`已粘贴 ${copies.length} 个对象`);
  }, [board, showToast]);

  const pasteSelected = useCallback(() => pasteShapes(shapeClipboardRef.current), [pasteShapes]);

  const nudgeSelected = useCallback((x: number, y: number) => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    board.commitShapes((shapes) => shapes.map((shape) => selected.has(shape.id) && !shape.locked
      ? { ...shape, x: shape.x + x, y: shape.y + y }
      : shape), { historyGroup: `nudge:${selectedIds.join(',')}:${x}:${y}` });
  }, [board, selectedIds]);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    board.commitShapes((shapes) => {
      const index = shapes.findIndex((shape) => shape.id === id);
      const target = direction === 'up' ? index + 1 : index - 1;
      if (index < 0 || target < 0 || target >= shapes.length) return shapes;
      const next = [...shapes];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, [board]);

  const reorderLayer = useCallback((sourceId: string, targetId: string) => {
    board.commitShapes((shapes) => {
      const visualOrder = [...shapes].reverse();
      const sourceIndex = visualOrder.findIndex((shape) => shape.id === sourceId);
      const targetIndex = visualOrder.findIndex((shape) => shape.id === targetId);
      if (sourceIndex < 0) return shapes;
      if (targetIndex < 0) return shapes;
      const [source] = visualOrder.splice(sourceIndex, 1);
      visualOrder.splice(targetIndex, 0, source);
      return visualOrder.reverse();
    });
  }, [board]);

  const bringToFront = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    board.commitShapes((shapes) => [
      ...shapes.filter((shape) => !selected.has(shape.id)),
      ...shapes.filter((shape) => selected.has(shape.id)),
    ]);
  }, [board, selectedIds]);

  const sendToBack = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    board.commitShapes((shapes) => [
      ...shapes.filter((shape) => selected.has(shape.id)),
      ...shapes.filter((shape) => !selected.has(shape.id)),
    ]);
  }, [board, selectedIds]);

  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    const selected = new Set(selectedIds);
    const groupId = `group-${createId()}`;
    board.commitShapes((shapes) => shapes.map((shape) => selected.has(shape.id) ? { ...shape, groupId } : shape));
    showToast(`已组合 ${selectedIds.length} 个对象`);
  }, [board, selectedIds, showToast]);

  const ungroupSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    const groupIds = new Set(board.document.shapes.filter((shape) => selected.has(shape.id) && shape.groupId).map((shape) => shape.groupId));
    if (!groupIds.size) return;
    board.commitShapes((shapes) => shapes.map((shape) => shape.groupId && groupIds.has(shape.groupId) ? { ...shape, groupId: undefined } : shape));
    showToast('已取消组合');
  }, [board, selectedIds, showToast]);

  const alignSelected = useCallback((mode: AlignMode) => {
    if (selectedIds.length < 2) return;
    const selected = new Set(selectedIds);
    board.commitShapes((shapes) => alignShapes(shapes, selected, mode));
  }, [board, selectedIds]);

  const distributeSelected = useCallback((mode: DistributeMode) => {
    if (selectedIds.length < 3) return;
    const selected = new Set(selectedIds);
    board.commitShapes((shapes) => distributeShapes(shapes, selected, mode));
  }, [board, selectedIds]);

  const autoFlowSelected = useCallback(() => {
    const selected = new Set(selectedIds);
    const nodes = board.document.shapes
      .filter((shape) => selected.has(shape.id) && isBindableShape(shape) && !shape.locked)
      .sort((a, b) => {
        const aBounds = getShapeBounds(a);
        const bBounds = getShapeBounds(b);
        return aBounds.left - bBounds.left || aBounds.top - bBounds.top;
      });
    if (nodes.length < 2) {
      showToast('至少选择两个形状才能整理为流程');
      return;
    }

    const nodeBounds = nodes.map(getShapeBounds);
    const left = Math.min(...nodeBounds.map((bounds) => bounds.left));
    const top = Math.min(...nodeBounds.map((bounds) => bounds.top));
    const rowHeight = Math.max(...nodeBounds.map((bounds) => bounds.height));
    const centerY = top + rowHeight / 2;
    const movement = new Map<string, { x: number; y: number }>();
    let cursor = left;
    nodes.forEach((node, index) => {
      const bounds = nodeBounds[index];
      const delta = { x: cursor - bounds.left, y: centerY - bounds.centerY };
      movement.set(node.id, delta);
      if (node.groupId) {
        board.document.shapes.forEach((shape) => {
          if (shape.groupId === node.groupId) movement.set(shape.id, delta);
        });
      }
      cursor += bounds.width + 104;
    });

    const createdCount = nodes.slice(0, -1).filter((start, index) => !board.document.shapes.some((shape) => (
      (shape.type === 'arrow' || shape.type === 'line')
      && shape.startBindingId === start.id
      && shape.endBindingId === nodes[index + 1].id
    ))).length;
    board.commitShapes((shapes) => {
      const arranged = shapes.map((shape) => {
        const delta = movement.get(shape.id);
        return delta ? { ...shape, x: shape.x + delta.x, y: shape.y + delta.y } : shape;
      });
      const additions: BoardShape[] = [];
      for (let index = 0; index < nodes.length - 1; index += 1) {
        const start = nodes[index];
        const end = nodes[index + 1];
        const exists = arranged.some((shape) => (
          (shape.type === 'arrow' || shape.type === 'line')
          && shape.startBindingId === start.id
          && shape.endBindingId === end.id
        ));
        if (exists) continue;
        const startBounds = getShapeBounds(arranged.find((shape) => shape.id === start.id) ?? start);
        const endBounds = getShapeBounds(arranged.find((shape) => shape.id === end.id) ?? end);
        additions.push({
          id: createId(),
          type: 'arrow',
          name: `智能连接 ${index + 1}`,
          x: startBounds.centerX,
          y: startBounds.centerY,
          width: Math.abs(endBounds.centerX - startBounds.centerX),
          height: Math.abs(endBounds.centerY - startBounds.centerY),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          fill: '#64748b',
          stroke: '#64748b',
          strokeWidth: 2.5,
          opacity: 1,
          cornerRadius: 0,
          points: [0, 0, endBounds.centerX - startBounds.centerX, endBounds.centerY - startBounds.centerY],
          startBindingId: start.id,
          endBindingId: end.id,
          visible: true,
          locked: false,
        });
      }
      return [...arranged, ...additions];
    });
    showToast(createdCount ? `已整理流程并创建 ${createdCount} 条智能连接` : '已重新整理流程');
  }, [board, selectedIds, showToast]);

  const addImage = useCallback((url: string, position?: { x: number; y: number }) => {
    const image = new Image();
    image.onload = () => {
      const max = 480;
      const ratio = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(120, image.naturalWidth * ratio);
      const height = Math.max(80, image.naturalHeight * ratio);
      const point = position ?? {
        x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
        y: (window.innerHeight / 2 - viewport.y) / viewport.zoom,
      };
      const created: BoardShape = {
        id: createId(),
        type: 'image',
        name: '图片',
        x: point.x - width / 2,
        y: point.y - height / 2,
        width,
        height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        fill: '#ffffff',
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        cornerRadius: 0,
        url,
        visible: true,
        locked: false,
      };
      addShape(created);
      setSelectedIds([created.id]);
      setTool('select');
      showToast('图片已放入画布');
    };
    image.src = url;
  }, [addShape, showToast, viewport]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        const reader = new FileReader();
        reader.onload = () => addImage(String(reader.result));
        reader.readAsDataURL(file);
        return;
      }

      const clipboardText = event.clipboardData?.getData('text/plain') ?? '';
      const customPayload = event.clipboardData?.getData(CLIPBOARD_MIME) ?? '';
      const clipboardHtml = event.clipboardData?.getData('text/html') ?? '';
      const rawShapes = readShapesFromClipboard(customPayload)
        ?? (clipboardText.startsWith(CLIPBOARD_PREFIX) ? readShapesFromClipboard(clipboardText) : null)
        ?? readShapesFromClipboardHtml(clipboardHtml);
      if (rawShapes) {
        event.preventDefault();
        try {
          const parsed = parseBoardDocument({
            version: 1,
            title: '剪贴板',
            shapes: rawShapes,
            settings: board.document.settings,
            updatedAt: Date.now(),
          });
          shapeClipboardRef.current = parsed.shapes;
          pasteOffsetRef.current = 0;
          pasteShapes(parsed.shapes);
        } catch {
          showToast('剪贴板中的画板对象无法识别');
        }
        return;
      }

      if (!clipboardText && shapeClipboardRef.current.length) {
        event.preventDefault();
        pasteSelected();
        return;
      }

      const text = clipboardText.replace(/\r\n/g, '\n').trim().slice(0, 20000);
      if (!text) return;
      event.preventDefault();
      const lineCount = Math.max(text.split('\n').length, Math.ceil(text.length / 34));
      const point = {
        x: (window.innerWidth / 2 - viewport.x) / viewport.zoom,
        y: (window.innerHeight / 2 - viewport.y) / viewport.zoom,
      };
      const created: BoardShape = {
        id: createId(),
        type: 'text',
        name: '文本',
        x: point.x - 160,
        y: point.y - 24,
        width: 320,
        height: Math.max(48, lineCount * 24),
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        fill: '#172033',
        stroke: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        cornerRadius: 0,
        text,
        textColor: '#172033',
        fontSize: 18,
        fontFamily: 'Inter, Microsoft YaHei, sans-serif',
        textAlign: 'left',
        visible: true,
        locked: false,
      };
      addShape(created);
      setSelectedIds([created.id]);
      setTool('select');
      showToast('文本已粘贴到画布');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImage, addShape, board.document.settings, pasteSelected, pasteShapes, showToast, viewport]);

  const exportJSON = useCallback(() => {
    const document = getOutputDocument();
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    download(url, `${safeFilename(document.title)}.museboard.json`);
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast('源文件已导出');
  }, [getOutputDocument, showToast]);

  const saveDocumentFile = useCallback(async (saveAs = false) => {
    const pickerWindow = window as FilePickerWindow;
    if (!pickerWindow.showSaveFilePicker) {
      exportJSON();
      return;
    }
    try {
      const document = getOutputDocument();
      const handle = !saveAs && fileHandleRef.current
        ? fileHandleRef.current
        : await pickerWindow.showSaveFilePicker({
          suggestedName: `${safeFilename(document.title)}.museboard.json`,
          types: [{
            description: 'Museboard 画板',
            accept: { 'application/json': ['.museboard.json', '.json'] },
          }],
        });
      const writable = await handle.createWritable();
      await writable.write(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
      await writable.close();
      fileHandleRef.current = handle;
      showToast(saveAs ? '画板已另存为文件' : '画板文件已保存');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showToast('文件保存失败');
    }
  }, [exportJSON, getOutputDocument, showToast]);

  const exportSVG = useCallback((shapeIds?: string[], options?: { transparent?: boolean; padding?: number }) => {
    const selection = Boolean(shapeIds?.length);
    const document = getOutputDocument();
    const svg = boardToSvg(document, { shapeIds, transparent: options?.transparent, padding: options?.padding });
    if (!svg) {
      showToast(selection ? '选区为空，暂无内容可导出' : '画布为空，暂无内容可导出');
      return false;
    }
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    download(url, `${safeFilename(document.title)}${selection ? '-选区' : ''}.svg`);
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast(selection ? '选区 SVG 已导出' : '可编辑 SVG 已导出');
    return true;
  }, [getOutputDocument, showToast]);

  const exportRaster = useCallback((
    format: 'png' | 'jpeg' | 'webp',
    shapeIds?: string[],
    options?: { pixelRatio?: number; transparent?: boolean; padding?: number; quality?: number },
  ) => {
    const config = {
      png: { mimeType: 'image/png' as const, extension: 'png', label: 'PNG', quality: 1 },
      jpeg: { mimeType: 'image/jpeg' as const, extension: 'jpg', label: 'JPG', quality: 0.92 },
      webp: { mimeType: 'image/webp' as const, extension: 'webp', label: 'WebP', quality: 0.92 },
    }[format];
    const selection = Boolean(shapeIds?.length);
    let url: string | null | undefined;
    try {
      url = canvasRef.current?.exportRaster(config.mimeType, options?.quality ?? config.quality, {
        shapeIds,
        pixelRatio: options?.pixelRatio,
        transparent: format === 'jpeg' ? false : options?.transparent,
        padding: options?.padding,
      });
    } catch {
      showToast('导出失败，请检查画布中的图片资源');
      return false;
    }
    if (!url) {
      showToast(selection ? '选区为空，暂无内容可导出' : '画布为空，暂无内容可导出');
      return false;
    }
    download(url, `${safeFilename(board.document.title)}${selection ? '-选区' : ''}.${config.extension}`);
    showToast(`${selection ? '选区 ' : ''}${config.label} 已导出`);
    return true;
  }, [board.document.title, showToast]);

  const exportPNG = useCallback(() => exportRaster('png'), [exportRaster]);
  const exportJPEG = useCallback(() => exportRaster('jpeg'), [exportRaster]);
  const exportWebP = useCallback(() => exportRaster('webp'), [exportRaster]);
  const exportSelectionPNG = useCallback(() => exportRaster('png', selectedIds), [exportRaster, selectedIds]);
  const exportSelectionSVG = useCallback(() => exportSVG(selectedIds), [exportSVG, selectedIds]);
  const exportWithSettings = useCallback((options: ExportOptions) => {
    const shapeIds = options.scope === 'selection' ? selectedIds : undefined;
    const exported = options.format === 'svg'
      ? exportSVG(shapeIds, { transparent: options.transparent, padding: options.padding })
      : exportRaster(options.format, shapeIds, {
        pixelRatio: options.scale,
        transparent: options.transparent,
        padding: options.padding,
        quality: options.quality,
      });
    if (exported) setExportSettingsOpen(false);
  }, [exportRaster, exportSVG, selectedIds]);

  const importDocument = useCallback(async (file: File) => {
    try {
      const parsed = parseBoardDocument(JSON.parse(await file.text()));
      board.importDocument(parsed);
      setSelectedIds([]);
      window.setTimeout(() => canvasRef.current?.fitToContent(), 80);
      showToast('画板已导入');
      return true;
    } catch {
      showToast('无法识别这个画板文件');
      return false;
    }
  }, [board, showToast]);

  const openDocumentFile = useCallback(async () => {
    const pickerWindow = window as FilePickerWindow;
    if (!pickerWindow.showOpenFilePicker) {
      documentInputRef.current?.click();
      return;
    }
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'Museboard 画板',
          accept: { 'application/json': ['.museboard.json', '.json'] },
        }],
      });
      if (!handle) return;
      if (await importDocument(await handle.getFile())) fileHandleRef.current = handle;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showToast('无法打开这个画板文件');
    }
  }, [importDocument, showToast]);

  const clearBoard = useCallback(() => {
    const count = board.document.shapes.length;
    if (!count) return;
    board.clearDocument();
    setSelectedIds([]);
    showToast(`已清空 ${count} 个对象`, {
      actionLabel: '撤销',
      onAction: () => {
        board.undo();
        showToast('已恢复画布内容');
      },
    });
  }, [board, showToast]);

  const selectTool = useCallback((nextTool: Tool) => {
    setTool(nextTool);
    if (nextTool !== 'select') setSelectedIds([]);
  }, []);

  const installApp = useCallback(async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    setInstallPrompt(null);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    showToast(choice.outcome === 'accepted' ? 'Museboard 已安装' : '已取消安装');
  }, [installPrompt, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (command && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (typing) showToast('请先完成文字编辑'); else void openDocumentFile();
        return;
      }
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (typing) showToast('请先完成文字编辑'); else void saveDocumentFile(event.shiftKey);
        return;
      }
      if (typing) return;
      if (!command && !event.altKey && event.key === '1') {
        event.preventDefault();
        canvasRef.current?.resetView();
        return;
      }
      if (!command && !event.altKey && event.key === '2') {
        event.preventDefault();
        canvasRef.current?.fitToContent();
        return;
      }
      if (!command && !event.altKey && event.key === '3') {
        event.preventDefault();
        if (selectedIds.length) canvasRef.current?.fitToSelection(selectedIds);
        return;
      }
      if (command && event.shiftKey && event.key === 'Backspace') {
        event.preventDefault();
        clearBoard();
        return;
      }
      if ((event.key === 'Enter' || event.key === 'F2') && selectedIds.length === 1) {
        const shape = board.document.shapes.find((item) => item.id === selectedIds[0]);
        if (shape && isTextEditableShape(shape)) {
          event.preventDefault();
          canvasRef.current?.startEditing(shape.id);
          return;
        }
      }
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) board.redo(); else board.undo();
        return;
      }
      if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); board.redo(); return; }
      if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); return; }
      if (command && event.key.toLowerCase() === 'x') { event.preventDefault(); copySelected(); deleteSelected(); return; }
      if (command && event.key.toLowerCase() === 'v') return;
      if (command && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected(); else groupSelected();
        return;
      }
      if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return; }
      if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedIds(board.document.shapes.filter((shape) => shape.visible && !shape.locked).map((shape) => shape.id)); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return; }
      if (event.key.startsWith('Arrow') && selectedIds.length) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft') nudgeSelected(-amount, 0);
        if (event.key === 'ArrowRight') nudgeSelected(amount, 0);
        if (event.key === 'ArrowUp') nudgeSelected(0, -amount);
        if (event.key === 'ArrowDown') nudgeSelected(0, amount);
        return;
      }
      if (event.key === 'Escape') { setSelectedIds([]); setTool('select'); setCommandOpen(false); return; }
      if (!command && TOOL_BY_SHORTCUT[event.key.toLowerCase()]) selectTool(TOOL_BY_SHORTCUT[event.key.toLowerCase()]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [board, clearBoard, copySelected, deleteSelected, duplicateSelected, groupSelected, nudgeSelected, openDocumentFile, pasteSelected, saveDocumentFile, selectTool, selectedIds, showToast, ungroupSelected]);

  const commands = useMemo<CommandAction[]>(() => [
    ...TOOL_DEFINITIONS.map(({ id, commandLabel, shortcut }) => ({
      id: `tool-${id}`,
      label: commandLabel,
      hint: shortcut,
      group: '工具',
      run: () => id === 'image' ? imageInputRef.current?.click() : selectTool(id),
    })),
    { id: 'reset-view', label: '重置为 100% 视图', hint: '1', group: '视图', run: () => canvasRef.current?.resetView() },
    { id: 'fit', label: '适应全部内容', hint: '2', group: '视图', run: () => canvasRef.current?.fitToContent() },
    { id: 'fit-selection', label: '聚焦所选对象', hint: '3', group: '视图', run: () => canvasRef.current?.fitToSelection(selectedIds) },
    { id: 'grid', label: board.document.settings.grid ? '隐藏点阵' : '显示点阵', group: '视图', run: () => board.setSettings({ grid: !board.document.settings.grid }) },
    { id: 'guides', label: board.document.settings.guides ? '关闭智能参考线' : '开启智能参考线', group: '视图', run: () => board.setSettings({ guides: !board.document.settings.guides }) },
    { id: 'group', label: '组合所选对象', hint: 'Ctrl G', group: '排列', run: groupSelected },
    { id: 'ungroup', label: '取消对象组合', hint: 'Ctrl Shift G', group: '排列', run: ungroupSelected },
    { id: 'auto-flow', label: '整理为智能流程', group: '排列', run: autoFlowSelected },
    { id: 'copy', label: '复制所选对象', hint: 'Ctrl C', group: '编辑', run: copySelected },
    { id: 'paste', label: '粘贴对象', hint: 'Ctrl V', group: '编辑', run: pasteSelected },
    { id: 'clear', label: '清空画布', hint: 'Ctrl Shift Backspace', group: '编辑', run: clearBoard },
    { id: 'export-png', label: '导出高清 PNG', group: '文件', run: exportPNG },
    { id: 'export-jpeg', label: '导出 JPG', group: '文件', run: exportJPEG },
    { id: 'export-webp', label: '导出 WebP', group: '文件', run: exportWebP },
    { id: 'export-svg', label: '导出可编辑 SVG', group: '文件', run: exportSVG },
    { id: 'export-selection-png', label: '导出选区 PNG', group: '文件', run: exportSelectionPNG },
    { id: 'export-selection-svg', label: '导出选区 SVG', group: '文件', run: exportSelectionSVG },
    { id: 'export-settings', label: '打开高级导出设置', group: '文件', run: () => setExportSettingsOpen(true) },
    ...(installPrompt ? [{
      id: 'install-app',
      label: '安装 Museboard 应用',
      group: '文件',
      run: () => { void installApp(); },
    } satisfies CommandAction] : []),
    { id: 'open-file', label: '打开画板文件', hint: 'Ctrl O', group: '文件', run: openDocumentFile },
    { id: 'save-file', label: '保存画板文件', hint: 'Ctrl S', group: '文件', run: () => { void saveDocumentFile(false); } },
    { id: 'save-file-as', label: '画板文件另存为', hint: 'Ctrl Shift S', group: '文件', run: () => { void saveDocumentFile(true); } },
    { id: 'export-json', label: '导出源文件', group: '文件', run: exportJSON },
  ], [autoFlowSelected, board, clearBoard, copySelected, exportJPEG, exportJSON, exportPNG, exportSVG, exportSelectionPNG, exportSelectionSVG, exportWebP, groupSelected, installApp, installPrompt, openDocumentFile, pasteSelected, saveDocumentFile, selectTool, selectedIds, ungroupSelected]);

  return (
    <div className={`app-shell ${leftOpen ? 'left-open' : 'left-closed'} ${rightOpen ? 'right-open' : 'right-closed'}`}>
      <HeaderBar
        title={board.document.title}
        saveState={board.saveState}
        canUndo={board.canUndo}
        canRedo={board.canRedo}
        hasContent={board.document.shapes.length > 0}
        rightOpen={rightOpen}
        onTitleChange={board.setTitle}
        onUndo={board.undo}
        onRedo={board.redo}
        onImport={openDocumentFile}
        onSave={() => { void saveDocumentFile(false); }}
        onSaveAs={() => { void saveDocumentFile(true); }}
        onExportJSON={exportJSON}
        onExportSVG={exportSVG}
        onExportPNG={exportPNG}
        onExportJPEG={exportJPEG}
        onExportWebP={exportWebP}
        canInstall={Boolean(installPrompt)}
        onInstall={() => { void installApp(); }}
        onOpenExportSettings={() => setExportSettingsOpen(true)}
        onClear={clearBoard}
        onCommand={() => setCommandOpen(true)}
        onToggleLeft={() => setLeftOpen((open) => !open)}
        onToggleRight={() => setRightOpen((open) => !open)}
      />

      <div className="workspace">
        <LeftPanel
          open={leftOpen}
          shapes={board.document.shapes}
          selectedIds={selectedIds}
          onSelect={(ids) => { setSelectedIds(ids); setTool('select'); }}
          onPatchShape={patchShape}
          onMoveLayer={moveLayer}
          onReorder={reorderLayer}
          onClose={() => setLeftOpen(false)}
        />

        <main className="workspace-canvas" aria-label="Museboard 画布">
          <CanvasStage
            ref={canvasRef}
            shapes={board.document.shapes}
            selectedIds={selectedIds}
            tool={tool}
            viewport={viewport}
            settings={board.document.settings}
            onSelect={setSelectedIds}
            onToolChange={selectTool}
            onViewportChange={setViewport}
            onAddShape={addShape}
            onPreviewShapes={board.previewShapes}
            onCommitPreview={board.commitPreview}
            onCommitShapes={board.commitShapes}
            onOpenImagePicker={() => imageInputRef.current?.click()}
            onDropImage={addImage}
          />
          <Toolbar activeTool={tool} onChange={selectTool} />
          <SelectionBar
            selected={selectedShapes}
            viewport={viewport}
            onPatch={patchSelected}
            onDuplicate={duplicateSelected}
            onBringToFront={bringToFront}
            onSendToBack={sendToBack}
            onDelete={deleteSelected}
            onGroup={groupSelected}
            onUngroup={ungroupSelected}
            onAlign={alignSelected}
            onDistribute={distributeSelected}
            onAutoFlow={autoFlowSelected}
            onExport={exportSelectionPNG}
          />
          <BottomControls
            zoom={viewport.zoom}
            settings={board.document.settings}
            onZoom={(zoom) => canvasRef.current?.zoomTo(zoom)}
            onFit={() => canvasRef.current?.fitToContent()}
            onReset={() => canvasRef.current?.resetView()}
            onToggleGrid={() => board.setSettings({ grid: !board.document.settings.grid })}
          />
          <MiniMap shapes={board.document.shapes} viewport={viewport} />
        </main>

        <PropertiesPanel
          open={rightOpen}
          selected={selectedShapes}
          settings={board.document.settings}
          totalShapes={board.document.shapes.length}
          onPatchSelected={patchSelected}
          onSettingsChange={board.setSettings}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onBringToFront={bringToFront}
          onSendToBack={sendToBack}
          onAutoFlow={autoFlowSelected}
          onClose={() => setRightOpen(false)}
        />
      </div>

      <input
        ref={imageInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => addImage(String(reader.result));
            reader.readAsDataURL(file);
          }
          event.target.value = '';
        }}
      />
      <input
        ref={documentInputRef}
        className="visually-hidden"
        type="file"
        accept=".json,.museboard.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importDocument(file);
          event.target.value = '';
        }}
      />

      <CommandPalette open={commandOpen} actions={commands} onClose={() => setCommandOpen(false)} />
      {exportSettingsOpen && (
        <ExportDialog
          open
          title={board.document.title}
          shapes={board.document.shapes}
          selectedIds={selectedIds}
          onClose={() => setExportSettingsOpen(false)}
          onExport={exportWithSettings}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              onClick={() => {
                const action = toast.onAction;
                setToast(null);
                action?.();
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
