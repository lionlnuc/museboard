import {
  Check,
  ChevronDown,
  Download,
  FileCode2,
  FileImage,
  FileJson,
  FolderOpen,
  Layers3,
  Menu,
  MonitorDown,
  PanelRight,
  Redo2,
  Search,
  Save,
  SaveAll,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface HeaderBarProps {
  title: string;
  saveState: 'saved' | 'saving' | 'error';
  canUndo: boolean;
  canRedo: boolean;
  hasContent: boolean;
  rightOpen: boolean;
  onTitleChange: (title: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onImport: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportJSON: () => void;
  onExportSVG: () => void;
  onExportPNG: () => void;
  onExportJPEG: () => void;
  onExportWebP: () => void;
  onOpenExportSettings: () => void;
  canInstall?: boolean;
  onInstall?: () => void;
  onClear: () => void;
  onCommand: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function HeaderBar(props: HeaderBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);

  const focusExportItem = (position: 'first' | 'last') => {
    window.requestAnimationFrame(() => {
      const items = exportMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      if (!items?.length) return;
      items[position === 'first' ? 0 : items.length - 1]?.focus();
    });
  };

  const openExportMenu = (position: 'first' | 'last' = 'first') => {
    setExportOpen(true);
    focusExportItem(position);
  };

  const closeExportMenu = (restoreFocus = false) => {
    setExportOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
  };

  const runExport = (action: () => void) => {
    action();
    closeExportMenu(true);
  };

  const handleExportMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const settingsItem = event.currentTarget.querySelector<HTMLButtonElement>('.export-settings-item');
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'ArrowDown') next = current < items.length - 1 ? current + 1 : 0;
    else if (event.key === 'ArrowUp') next = current > 0 ? current - 1 : items.length - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeExportMenu(true);
      return;
    } else if (event.key === 'Tab') {
      if (!event.shiftKey && document.activeElement === items.at(-1) && settingsItem) {
        event.preventDefault();
        settingsItem.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === settingsItem) {
        event.preventDefault();
        items.at(-1)?.focus();
        return;
      }
      closeExportMenu();
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  };

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        if (exportOpen) closeExportMenu(true);
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [exportOpen]);

  return (
    <header className="app-header">
      <div className="header-left">
        <button
          className="icon-button mobile-panel-button"
          type="button"
          aria-label="打开对象面板"
          data-tooltip="对象面板"
          onClick={props.onToggleLeft}
        >
          <Menu size={20} />
        </button>
        <div className="brand" aria-label="Museboard">
          <span className="brand-mark"><span /></span>
          <span className="brand-name">Museboard</span>
        </div>
        <span className="header-divider" />
        <div className="file-menu" ref={menuRef}>
          <button className="file-menu-trigger" type="button" onClick={() => setMenuOpen((open) => !open)}>
            文件 <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="dropdown-menu">
              <button type="button" onClick={() => { props.onImport(); setMenuOpen(false); }}>
                <FolderOpen size={17} /> 导入画板
              </button>
              <button type="button" onClick={() => { props.onSave(); setMenuOpen(false); }}>
                <Save size={17} /> 保存文件
              </button>
              <button type="button" onClick={() => { props.onSaveAs(); setMenuOpen(false); }}>
                <SaveAll size={17} /> 另存为
              </button>
              <button type="button" onClick={() => { props.onExportJSON(); setMenuOpen(false); }}>
                <FileJson size={17} /> 导出源文件
              </button>
              <button type="button" onClick={() => { props.onExportSVG(); setMenuOpen(false); }}>
                <FileCode2 size={17} /> 导出 SVG
              </button>
              {props.canInstall && props.onInstall && (
                <button type="button" onClick={() => { props.onInstall?.(); setMenuOpen(false); }}>
                  <MonitorDown size={17} /> 安装应用
                </button>
              )}
              <button className="danger-item" type="button" onClick={() => { props.onClear(); setMenuOpen(false); }}>
                <Trash2 size={17} /> 清空画板
              </button>
            </div>
          )}
        </div>
        <input
          className="document-title"
          value={props.title}
          aria-label="画板名称"
          spellCheck={false}
          onChange={(event) => props.onTitleChange(event.target.value)}
          onBlur={(event) => { if (!event.target.value.trim()) props.onTitleChange('未命名画板'); }}
        />
          <div
            className={`save-state ${props.saveState}`}
            aria-live="polite"
            title={props.saveState === 'error' ? '本机文档无法保存或恢复，请先导出源文件' : undefined}
          >
            {props.saveState === 'saved' ? <Check size={14} /> : props.saveState === 'saving' ? <span className="save-spinner" /> : <span className="save-error-mark">!</span>}
            <span>{props.saveState === 'saved' ? '已保存到本机' : props.saveState === 'saving' ? '正在保存' : '保存失败'}</span>
        </div>
      </div>

      <div className="header-actions">
        <div className="history-actions">
          <button className="icon-button" type="button" disabled={!props.canUndo} aria-label="撤销" data-tooltip="撤销 · Ctrl Z" onClick={props.onUndo}>
            <Undo2 size={18} />
          </button>
          <button className="icon-button" type="button" disabled={!props.canRedo} aria-label="重做" data-tooltip="重做 · Ctrl Shift Z" onClick={props.onRedo}>
            <Redo2 size={18} />
          </button>
        </div>
        <button
          className="icon-button clear-canvas-button"
          type="button"
          disabled={!props.hasContent}
          aria-label="清空画布"
          data-tooltip="清空画布 · Ctrl Shift Backspace"
          onClick={props.onClear}
        >
          <Trash2 size={18} />
        </button>
        <button className="command-trigger" type="button" aria-label="快速命令" onClick={props.onCommand}>
          <Search size={17} />
          <span>快速命令</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button className="secondary-button import-button" type="button" onClick={props.onImport}>
          <FolderOpen size={17} />
          <span>导入</span>
        </button>
        <div className="export-menu" ref={exportMenuRef}>
          <button
            ref={exportTriggerRef}
            className="primary-button"
            type="button"
            aria-label="导出"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            aria-controls="export-format-menu"
            onClick={() => exportOpen ? closeExportMenu() : openExportMenu()}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                openExportMenu(event.key === 'ArrowUp' ? 'last' : 'first');
              }
            }}
          >
            <Download size={17} />
            <span>导出</span>
            <ChevronDown className="export-chevron" size={13} />
          </button>
          {exportOpen && (
            <div
              id="export-format-menu"
              className="dropdown-menu export-dropdown"
              role="menu"
              aria-label="导出格式"
              onKeyDown={handleExportMenuKeyDown}
            >
              <button type="button" role="menuitem" onClick={() => runExport(props.onExportPNG)}><FileImage size={17} /> PNG 图片</button>
              <button type="button" role="menuitem" onClick={() => runExport(props.onExportJPEG)}><FileImage size={17} /> JPG 图片</button>
              <button type="button" role="menuitem" onClick={() => runExport(props.onExportWebP)}><FileImage size={17} /> WebP 图片</button>
              <button type="button" role="menuitem" onClick={() => runExport(props.onExportSVG)}><FileCode2 size={17} /> SVG 矢量图</button>
              <button type="button" role="menuitem" onClick={() => runExport(props.onExportJSON)}><FileJson size={17} /> Museboard 源文件</button>
              <div className="export-menu-divider" role="separator" />
              <div role="none">
                <button className="export-settings-item" type="button" onClick={() => { closeExportMenu(); props.onOpenExportSettings(); }}>
                  <SlidersHorizontal size={17} /> 高级导出设置
                </button>
              </div>
            </div>
          )}
        </div>
        <button className="icon-button mobile-panel-button" type="button" aria-label="打开属性" data-tooltip="属性" onClick={props.onToggleRight}>
          <PanelRight size={20} />
        </button>
        <button className="icon-button desktop-panel-toggle" type="button" aria-label="切换对象面板" data-tooltip="对象面板" onClick={props.onToggleLeft}>
          <Layers3 size={19} />
        </button>
        <button
          className={`icon-button desktop-panel-toggle ${props.rightOpen ? 'is-active' : ''}`}
          type="button"
          aria-label="切换属性面板"
          aria-pressed={props.rightOpen}
          data-tooltip="属性面板"
          onClick={props.onToggleRight}
        >
          <PanelRight size={19} />
        </button>
      </div>
    </header>
  );
}
