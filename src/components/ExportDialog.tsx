import { Check, Download, FileCode2, FileImage, FileType2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BoardShape } from '../types';
import { getSelectionBounds } from '../utils/geometry';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';
export type ExportScope = 'all' | 'selection';

export interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  transparent: boolean;
  scale: number;
  quality: number;
  padding: number;
}

interface ExportDialogProps {
  open: boolean;
  title: string;
  shapes: BoardShape[];
  selectedIds: string[];
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
}

const FORMAT_OPTIONS: Array<{ id: ExportFormat; label: string; description: string }> = [
  { id: 'png', label: 'PNG', description: '适合界面与透明背景' },
  { id: 'jpeg', label: 'JPG', description: '适合照片与小文件' },
  { id: 'webp', label: 'WebP', description: '现代浏览器的高压缩图片' },
  { id: 'svg', label: 'SVG', description: '可编辑的矢量图形' },
];

function formatLabel(format: ExportFormat) {
  return format === 'jpeg' ? 'JPG' : format.toUpperCase();
}

export function ExportDialog(props: ExportDialogProps) {
  const [draft, setDraft] = useExportDraft(props.selectedIds.length > 0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!props.open) return undefined;
    const focusDialog = () => {
      const firstControl = dialogRef.current?.querySelector<HTMLElement>('[role="radio"]:not([aria-disabled="true"])')
        ?? dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])');
      (firstControl ?? closeButtonRef.current)?.focus();
    };
    focusDialog();
    const timer = window.setTimeout(focusDialog, 0);
    return () => window.clearTimeout(timer);
  }, [props.open]);

  const selectedSet = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const exportShapes = useMemo(() => {
    const visible = props.shapes.filter((shape) => shape.visible);
    return draft.scope === 'selection' ? visible.filter((shape) => selectedSet.has(shape.id)) : visible;
  }, [draft.scope, props.shapes, selectedSet]);
  const bounds = useMemo(() => getSelectionBounds(exportShapes), [exportShapes]);
  const dimensions = useMemo(() => {
    if (!bounds) return null;
    return {
      width: Math.max(1, Math.ceil(bounds.width + draft.padding * 2)),
      height: Math.max(1, Math.ceil(bounds.height + draft.padding * 2)),
    };
  }, [bounds, draft.padding]);

  if (!props.open) return null;

  const isRaster = draft.format !== 'svg';
  const hasSelection = props.selectedIds.length > 0;
  const outputWidth = dimensions ? dimensions.width * (isRaster ? draft.scale : 1) : 0;
  const outputHeight = dimensions ? dimensions.height * (isRaster ? draft.scale : 1) : 0;

  const updateFormat = (format: ExportFormat) => {
    setDraft((current) => ({
      ...current,
      format,
      transparent: format === 'jpeg' ? false : current.transparent,
    }));
  };

  return (
    <div
      className="dialog-backdrop export-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => { if (event.currentTarget === event.target) props.onClose(); }}
    >
      <section
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
            .filter((element) => element.offsetParent !== null);
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="export-dialog-header">
          <div>
            <h2 id="export-dialog-title">导出画板</h2>
            <p>{props.title || '未命名画板'}</p>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" aria-label="关闭导出设置" data-tooltip="关闭" onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="export-dialog-body">
          <fieldset className="export-fieldset">
            <legend>格式</legend>
            <div className="export-format-grid" role="radiogroup" aria-label="导出格式">
              {FORMAT_OPTIONS.map((option) => {
                const active = draft.format === option.id;
                return (
                  <button
                    key={option.id}
                    className={`export-format-option ${active ? 'is-active' : ''}`}
                    type="button"
                    role="radio"
                    autoFocus={option.id === 'png'}
                    aria-checked={active}
                    onClick={() => updateFormat(option.id)}
                  >
                    <span className="export-format-icon">
                      {option.id === 'svg' ? <FileCode2 size={18} /> : option.id === 'jpeg' ? <FileType2 size={18} /> : <FileImage size={18} />}
                    </span>
                    <span className="export-format-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
                    {active && <Check className="export-format-check" size={16} />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="export-dialog-columns">
            <fieldset className="export-fieldset">
              <legend>范围</legend>
              <div className="export-segmented" role="radiogroup" aria-label="导出范围">
                <button type="button" role="radio" aria-checked={draft.scope === 'all'} className={draft.scope === 'all' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, scope: 'all' }))}>全部画板</button>
                <button type="button" role="radio" aria-checked={draft.scope === 'selection'} className={draft.scope === 'selection' ? 'is-active' : ''} disabled={!hasSelection} onClick={() => setDraft((current) => ({ ...current, scope: 'selection' }))}>当前选区{hasSelection ? ` · ${props.selectedIds.length}` : ''}</button>
              </div>
            </fieldset>

            <fieldset className="export-fieldset">
              <legend>背景</legend>
              <label className={`export-check-row ${draft.format === 'jpeg' ? 'is-disabled' : ''}`}>
                <input type="checkbox" checked={draft.transparent} disabled={draft.format === 'jpeg'} onChange={(event) => setDraft((current) => ({ ...current, transparent: event.target.checked }))} />
                <span>透明背景</span>
                {draft.format === 'jpeg' && <small>JPG 不支持透明</small>}
              </label>
            </fieldset>
          </div>

          <div className="export-dialog-columns">
            <fieldset className="export-fieldset">
              <legend>边距 <output>{draft.padding}px</output></legend>
              <div className="export-range-row">
                <input aria-label="导出边距" type="range" min="0" max="128" step="4" value={draft.padding} onChange={(event) => setDraft((current) => ({ ...current, padding: Number(event.target.value) }))} />
                <input className="export-number-input" aria-label="导出边距数值" type="number" min="0" max="128" step="4" value={draft.padding} onChange={(event) => setDraft((current) => ({ ...current, padding: Math.min(128, Math.max(0, Number(event.target.value) || 0)) }))} />
              </div>
            </fieldset>

            <fieldset className={`export-fieldset ${!isRaster ? 'is-muted' : ''}`}>
              <legend>倍率 <output>{isRaster ? `${draft.scale}x` : '矢量'}</output></legend>
              <div className="export-segmented export-scale-segmented" role="radiogroup" aria-label="导出倍率">
                {[1, 2, 3, 4].map((scale) => (
                  <button key={scale} type="button" role="radio" aria-checked={draft.scale === scale} disabled={!isRaster} className={draft.scale === scale ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, scale }))}>{scale}x</button>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset className={`export-fieldset export-quality-fieldset ${draft.format === 'png' || draft.format === 'svg' ? 'is-muted' : ''}`}>
            <legend>质量 <output>{draft.format === 'png' || draft.format === 'svg' ? '无损' : `${Math.round(draft.quality * 100)}%`}</output></legend>
            <input aria-label="图片质量" type="range" min="0.5" max="1" step="0.05" value={draft.quality} disabled={draft.format === 'png' || draft.format === 'svg'} onChange={(event) => setDraft((current) => ({ ...current, quality: Number(event.target.value) }))} />
          </fieldset>

          <div className="export-summary" aria-live="polite">
            <span className="export-summary-icon"><Download size={16} /></span>
            <span>
              {dimensions
                ? <><strong>{outputWidth} × {outputHeight}px</strong><small>{draft.scope === 'selection' ? `选区 · ${exportShapes.length} 个对象` : `全部画板 · ${exportShapes.length} 个对象`}{draft.format === 'svg' ? ' · 无限缩放' : ''}</small></>
                : <><strong>暂无可导出的对象</strong><small>先在画布中添加图形或选择对象</small></>}
            </span>
          </div>
        </div>

        <footer className="export-dialog-footer">
          <button className="secondary-button" type="button" onClick={props.onClose}>取消</button>
          <button className="primary-button export-submit" type="button" disabled={!dimensions} onClick={() => props.onExport(draft)}>
            <Download size={17} /> 导出 {formatLabel(draft.format)}
          </button>
        </footer>
      </section>
    </div>
  );
}

function useExportDraft(selectionAvailable: boolean): [ExportOptions, Dispatch<SetStateAction<ExportOptions>>] {
  return useState<ExportOptions>({
    format: 'png',
    scope: selectionAvailable ? 'selection' : 'all',
    transparent: false,
    scale: 2,
    quality: 0.92,
    padding: 48,
  });
}
