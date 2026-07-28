import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Download,
  Group,
  Lock,
  Trash2,
  Ungroup,
  Unlink2,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BoardShape, Viewport } from '../types';
import { getSelectionBounds, type AlignMode, type DistributeMode } from '../utils/geometry';

interface SelectionBarProps {
  selected: BoardShape[];
  viewport: Viewport;
  onPatch: (patch: Partial<BoardShape>) => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (mode: DistributeMode) => void;
  onAutoFlow: () => void;
  onExport: () => void;
}

const quickColors = ['#ffffff', '#dff4ff', '#fff0a8', '#d7f6e5', '#ffdede', '#20242c'];

export function SelectionBar(props: SelectionBarProps) {
  const [alignOpen, setAlignOpen] = useState(false);
  const bounds = useMemo(() => getSelectionBounds(props.selected), [props.selected]);
  const ids = props.selected.map((shape) => shape.id).join(':');
  useEffect(() => setAlignOpen(false), [ids]);
  if (!bounds || !props.selected.length) return null;

  const groupId = props.selected[0]?.groupId;
  const grouped = props.selected.length > 1 && Boolean(groupId) && props.selected.every((shape) => shape.groupId === groupId);
  const primary = props.selected[0];
  const canFill = !['arrow', 'line', 'pen', 'image', 'frame'].includes(primary.type);
  const canAutoFlow = props.selected.filter((shape) => ['rect', 'ellipse', 'diamond', 'note', 'image'].includes(shape.type) && !shape.locked).length >= 2;
  const hasBinding = props.selected.some((shape) => Boolean(shape.startBindingId || shape.endBindingId));
  const selectionTop = props.viewport.y + bounds.top * props.viewport.zoom;
  const selectionBottom = props.viewport.y + bounds.bottom * props.viewport.zoom;
  const placeBelow = selectionTop < 132;
  const style = {
    '--selection-left': `${props.viewport.x + bounds.centerX * props.viewport.zoom}px`,
    '--selection-top': `${placeBelow ? selectionBottom + 10 : selectionTop - 54}px`,
  } as React.CSSProperties;

  const alignActions: Array<{ mode: AlignMode; label: string; icon: typeof AlignHorizontalJustifyStart }> = [
    { mode: 'left', label: '左对齐', icon: AlignHorizontalJustifyStart },
    { mode: 'center-x', label: '水平居中', icon: AlignHorizontalJustifyCenter },
    { mode: 'right', label: '右对齐', icon: AlignHorizontalJustifyEnd },
    { mode: 'top', label: '顶部对齐', icon: AlignVerticalJustifyStart },
    { mode: 'center-y', label: '垂直居中', icon: AlignVerticalJustifyCenter },
    { mode: 'bottom', label: '底部对齐', icon: AlignVerticalJustifyEnd },
  ];

  return (
    <div className="selection-bar" style={style} role="toolbar" aria-label="选区快捷操作">
      {canFill && (
        <div className="selection-colors" aria-label="快速填充">
          {quickColors.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`填充 ${color}`}
              className={primary.fill === color ? 'is-active' : ''}
              style={{ '--quick-color': color } as React.CSSProperties}
              onClick={() => props.onPatch({ fill: color })}
            />
          ))}
        </div>
      )}
      {canFill && <span className="selection-divider" />}
      {props.selected.length > 1 && (
        <button
          className="icon-button"
          type="button"
          data-tooltip={grouped ? '取消组合 · Ctrl Shift G' : '组合 · Ctrl G'}
          aria-label={grouped ? '取消组合' : '组合'}
          onClick={grouped ? props.onUngroup : props.onGroup}
        >
          {grouped ? <Ungroup size={17} /> : <Group size={17} />}
        </button>
      )}
      {hasBinding && (
        <button
          className="icon-button"
          type="button"
          data-tooltip="断开智能连接"
          aria-label="断开智能连接"
          onClick={() => props.onPatch({ startBindingId: undefined, endBindingId: undefined })}
        >
          <Unlink2 size={17} />
        </button>
      )}
      <button
        className="icon-button flow-action"
        type="button"
        disabled={!canAutoFlow}
        data-tooltip="整理为智能流程"
        aria-label="整理为智能流程"
        onClick={props.onAutoFlow}
      >
        <Workflow size={17} />
      </button>
      <div className="selection-align-menu">
        <button
          className={`icon-button ${alignOpen ? 'is-active' : ''}`}
          type="button"
          disabled={props.selected.length < 2}
          data-tooltip="对齐与分布"
          aria-label="对齐与分布"
          aria-expanded={alignOpen}
          onClick={() => setAlignOpen((open) => !open)}
        >
          <AlignHorizontalJustifyCenter size={17} />
        </button>
        {alignOpen && (
          <div className="selection-align-popover">
            <div className="selection-popover-heading">对齐</div>
            <div className="selection-align-grid">
              {alignActions.map(({ mode, label, icon: Icon }) => (
                <button key={mode} type="button" aria-label={label} data-tooltip={label} onClick={() => { props.onAlign(mode); setAlignOpen(false); }}>
                  <Icon size={17} />
                </button>
              ))}
            </div>
            <div className="selection-popover-heading">分布</div>
            <div className="selection-align-grid distribute-grid">
              <button type="button" disabled={props.selected.length < 3} aria-label="水平等距" data-tooltip="水平等距" onClick={() => { props.onDistribute('horizontal'); setAlignOpen(false); }}>
                <AlignHorizontalSpaceBetween size={17} />
              </button>
              <button type="button" disabled={props.selected.length < 3} aria-label="垂直等距" data-tooltip="垂直等距" onClick={() => { props.onDistribute('vertical'); setAlignOpen(false); }}>
                <AlignVerticalSpaceBetween size={17} />
              </button>
            </div>
          </div>
        )}
      </div>
      <button className="icon-button" type="button" data-tooltip="复制 · Ctrl D" aria-label="复制选区" onClick={props.onDuplicate}><Copy size={17} /></button>
      <button className="icon-button" type="button" data-tooltip="导出选区 PNG" aria-label="导出选区 PNG" onClick={props.onExport}><Download size={17} /></button>
      <button className="icon-button" type="button" data-tooltip="置于底层" aria-label="置于底层" onClick={props.onSendToBack}><ChevronsDown size={17} /></button>
      <button className="icon-button" type="button" data-tooltip="置于顶层" aria-label="置于顶层" onClick={props.onBringToFront}><ChevronsUp size={17} /></button>
      <button className={`icon-button ${primary.locked ? 'is-active' : ''}`} type="button" data-tooltip={primary.locked ? '解锁' : '锁定'} aria-label={primary.locked ? '解锁' : '锁定'} onClick={() => props.onPatch({ locked: !primary.locked })}><Lock size={17} /></button>
      <button className="icon-button selection-delete" type="button" data-tooltip="删除" aria-label="删除选区" onClick={props.onDelete}><Trash2 size={17} /></button>
    </div>
  );
}
