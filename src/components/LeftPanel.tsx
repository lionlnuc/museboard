import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Circle,
  Diamond,
  Eye,
  EyeOff,
  Frame,
  Group as GroupIcon,
  Image,
  Layers3,
  Lock,
  Minus,
  Pencil,
  Square,
  StickyNote,
  Type,
  Unlock,
} from 'lucide-react';
import { useState } from 'react';
import type { BoardShape } from '../types';
import { SHAPE_LABELS } from '../types';

const shapeIcons = {
  rect: Square,
  ellipse: Circle,
  diamond: Diamond,
  arrow: ArrowUpRight,
  line: Minus,
  pen: Pencil,
  text: Type,
  note: StickyNote,
  image: Image,
  frame: Frame,
};

interface LeftPanelProps {
  open: boolean;
  shapes: BoardShape[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onPatchShape: (id: string, patch: Partial<BoardShape>) => void;
  onMoveLayer: (id: string, direction: 'up' | 'down') => void;
  onReorder: (sourceId: string, targetId: string) => void;
  onClose: () => void;
}

function displayName(shape: BoardShape) {
  const typeLabel = SHAPE_LABELS[shape.type];
  const generatedName = shape.name === shape.type
    || shape.name === typeLabel
    || new RegExp(`^${typeLabel}\\s+\\d+$`).test(shape.name);
  const content = shape.text?.trim().split(/\r?\n/)[0]?.trim();
  return (!generatedName && shape.name) || content || shape.name || typeLabel;
}

export function LeftPanel(props: LeftPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const finishRename = (shape: BoardShape) => {
    const name = editingName.trim();
    if (name && name !== shape.name) props.onPatchShape(shape.id, { name });
    setEditingId(null);
  };

  return (
    <aside className={`side-panel left-panel ${props.open ? 'is-open' : ''}`} aria-label="对象管理">
      <div className="object-panel-header">
        <span><Layers3 size={17} /> 对象</span>
        <strong>{props.shapes.length}</strong>
      </div>

      <div className="layers-panel object-panel">
        <div className="panel-section-heading">
          <span>层级顺序</span>
          <span>{props.shapes.length ? '拖动调整' : ''}</span>
        </div>
        <div className="layer-list">
          {[...props.shapes].reverse().map((shape) => {
            const Icon = shapeIcons[shape.type];
            const label = displayName(shape);
            return (
              <div
                key={shape.id}
                className={`layer-row ${props.selectedIds.includes(shape.id) ? 'is-selected' : ''} ${draggingId === shape.id ? 'is-dragging' : ''}`}
                draggable={editingId !== shape.id}
                onDragStart={(event) => {
                  setDraggingId(shape.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', shape.id);
                }}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData('text/plain') || draggingId;
                  if (sourceId && sourceId !== shape.id) props.onReorder(sourceId, shape.id);
                  setDraggingId(null);
                }}
              >
                <div
                  className="layer-main"
                  role="button"
                  tabIndex={0}
                  aria-label={`选择 ${label}`}
                  onClick={(event) => props.onSelect(event.shiftKey ? [...new Set([...props.selectedIds, shape.id])] : [shape.id])}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setEditingId(shape.id);
                    setEditingName(shape.name || label);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onSelect([shape.id]);
                    }
                    if (event.key === 'F2') {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditingId(shape.id);
                      setEditingName(shape.name || label);
                    }
                  }}
                >
                  <span className={`layer-type-icon type-${shape.type}`}><Icon size={14} /></span>
                  {editingId === shape.id ? (
                    <input
                      className="layer-name-input"
                      value={editingName}
                      autoFocus
                      aria-label="对象名称"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setEditingName(event.target.value)}
                      onBlur={() => finishRename(shape)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') finishRename(shape);
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="layer-name" title={label}>{label}</span>
                  )}
                  {shape.groupId && <GroupIcon className="layer-group-icon" size={13} aria-label="已组合" />}
                </div>
                <span className="layer-controls">
                  <button
                    type="button"
                    aria-label={shape.visible ? '隐藏对象' : '显示对象'}
                    onClick={(event) => { event.stopPropagation(); props.onPatchShape(shape.id, { visible: !shape.visible }); }}
                  >
                    {shape.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button
                    type="button"
                    aria-label={shape.locked ? '解锁对象' : '锁定对象'}
                    onClick={(event) => { event.stopPropagation(); props.onPatchShape(shape.id, { locked: !shape.locked }); }}
                  >
                    {shape.locked ? <Lock size={14} /> : <Unlock size={14} />}
                  </button>
                </span>
                <span className="layer-reorder">
                  <button type="button" aria-label="上移对象" onClick={(event) => { event.stopPropagation(); props.onMoveLayer(shape.id, 'up'); }}><ArrowUp size={13} /></button>
                  <button type="button" aria-label="下移对象" onClick={(event) => { event.stopPropagation(); props.onMoveLayer(shape.id, 'down'); }}><ArrowDown size={13} /></button>
                </span>
              </div>
            );
          })}
          {props.shapes.length === 0 && (
            <div className="panel-empty compact-empty">
              <Layers3 size={24} />
              <p>暂无对象</p>
            </div>
          )}
        </div>
      </div>
      <button className="panel-scrim" type="button" aria-label="关闭对象面板" onClick={props.onClose} />
    </aside>
  );
}
