import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronsUp,
  ChevronsDown,
  CircleDashed,
  Copy,
  Grid3X3,
  Lock,
  ScanLine,
  SlidersHorizontal,
  Trash2,
  Unlink2,
  Workflow,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { isTextEditableShape, SHAPE_LABELS, type BoardShape, type CanvasSettings } from '../types';

const fillColors = ['#ffffff', '#e0f2fe', '#d7f6e5', '#fff2a8', '#fee2e2', '#f3e8ff', '#1f2937'];
const strokeColors = ['#1f2937', '#2563eb', '#0284c7', '#16a34a', '#d97706', '#dc2626', '#7c3aed'];
const textColors = ['#172033', '#2563eb', '#0e7490', '#15803d', '#b45309', '#b91c1c', '#ffffff'];
const canvasColors = ['#f8fafc', '#ffffff', '#f5f3ff', '#f0fdf4', '#fff7ed', '#111827'];

interface PropertiesPanelProps {
  open: boolean;
  selected: BoardShape[];
  settings: CanvasSettings;
  totalShapes: number;
  onPatchSelected: (patch: Partial<BoardShape>) => void;
  onSettingsChange: (patch: Partial<CanvasSettings>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onAutoFlow: () => void;
  onClose: () => void;
}

function Toggle({ checked, onChange, label, icon }: { checked: boolean; onChange: (value: boolean) => void; label: string; icon?: React.ReactNode }) {
  return (
    <label className="toggle-row">
      <span>{icon}{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function TextEditor({ shape, onCommit }: { shape: BoardShape; onCommit: (text: string) => void }) {
  const [value, setValue] = useState(shape.text ?? '');
  useEffect(() => setValue(shape.text ?? ''), [shape.id, shape.text]);
  return (
    <textarea
      className="property-textarea"
      value={value}
      aria-label="文字内容"
      rows={4}
      placeholder="输入文字"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => { if (value !== shape.text) onCommit(value); }}
    />
  );
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const primary = props.selected[0];
  const textShape = props.selected.length === 1 && primary && isTextEditableShape(primary) ? primary : null;
  const lineOnly = primary && ['line', 'arrow', 'pen'].includes(primary.type);

  return (
    <aside className={`side-panel properties-panel ${props.open ? 'is-open' : ''}`} aria-label="属性面板">
      <div className="properties-header">
        <div>
          <span>{primary ? (props.selected.length > 1 ? `已选择 ${props.selected.length} 个` : SHAPE_LABELS[primary.type]) : '画布属性'}</span>
          {primary && props.selected.length === 1 && <small>{primary.name}</small>}
        </div>
        <SlidersHorizontal size={18} />
      </div>

      {primary ? (
        <div className="property-content">
          {props.selected.length === 1 && (
            <section className="property-section">
              <h3>位置与尺寸</h3>
              <div className="geometry-grid">
                <label><span>X</span><input type="number" value={Math.round(primary.x)} onChange={(event) => props.onPatchSelected({ x: Number(event.target.value) })} /></label>
                <label><span>Y</span><input type="number" value={Math.round(primary.y)} onChange={(event) => props.onPatchSelected({ y: Number(event.target.value) })} /></label>
                {!lineOnly && (
                  <>
                    <label><span>W</span><input type="number" min="1" value={Math.round(primary.width * primary.scaleX)} onChange={(event) => props.onPatchSelected({ width: Math.max(1, Number(event.target.value)), scaleX: 1 })} /></label>
                    <label><span>H</span><input type="number" min="1" value={Math.round(primary.height * primary.scaleY)} onChange={(event) => props.onPatchSelected({ height: Math.max(1, Number(event.target.value)), scaleY: 1 })} /></label>
                  </>
                )}
                <label className="rotation-field"><span>°</span><input type="number" value={Math.round(primary.rotation)} onChange={(event) => props.onPatchSelected({ rotation: Number(event.target.value) })} /></label>
              </div>
            </section>
          )}
          {textShape && (
            <section className="property-section">
              <h3>内容</h3>
              <TextEditor shape={textShape} onCommit={(text) => props.onPatchSelected({ text })} />
            </section>
          )}

          {!lineOnly && primary.type !== 'image' && (
            <section className="property-section">
              <h3>{primary.type === 'text' ? '文字颜色' : '填充'}</h3>
              <div className="color-row">
                {fillColors.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`color-swatch ${primary.fill === color ? 'is-active' : ''}`}
                    style={{ '--swatch': color } as React.CSSProperties}
                    aria-label={`颜色 ${color}`}
                    onClick={() => props.onPatchSelected({ fill: color })}
                  />
                ))}
                <label className="custom-color" aria-label="自定义颜色">
                  <input type="color" value={primary.fill.startsWith('#') ? primary.fill : '#ffffff'} onChange={(event) => props.onPatchSelected({ fill: event.target.value })} />
                  <CircleDashed size={18} />
                </label>
              </div>
            </section>
          )}

          {textShape && textShape.type !== 'text' && (
            <section className="property-section">
              <h3>文字颜色</h3>
              <div className="color-row">
                {textColors.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`color-swatch ${(primary.textColor ?? '#172033') === color ? 'is-active' : ''}`}
                    style={{ '--swatch': color } as React.CSSProperties}
                    aria-label={`文字颜色 ${color}`}
                    onClick={() => props.onPatchSelected({ textColor: color })}
                  />
                ))}
                <label className="custom-color" aria-label="自定义文字颜色">
                  <input type="color" value={primary.textColor?.startsWith('#') ? primary.textColor : '#172033'} onChange={(event) => props.onPatchSelected({ textColor: event.target.value })} />
                  <CircleDashed size={18} />
                </label>
              </div>
            </section>
          )}

          {primary.type !== 'image' && primary.type !== 'text' && (
            <section className="property-section">
              <h3>描边</h3>
              <div className="color-row">
                {strokeColors.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`color-swatch ${primary.stroke === color ? 'is-active' : ''}`}
                    style={{ '--swatch': color } as React.CSSProperties}
                    aria-label={`描边 ${color}`}
                    onClick={() => props.onPatchSelected({ stroke: color })}
                  />
                ))}
                <label className="custom-color" aria-label="自定义描边">
                  <input type="color" value={primary.stroke.startsWith('#') ? primary.stroke : '#1f2937'} onChange={(event) => props.onPatchSelected({ stroke: event.target.value })} />
                  <CircleDashed size={18} />
                </label>
              </div>
              <div className="stroke-options segmented-control" aria-label="描边粗细">
                {[1, 2, 4, 7].map((width) => (
                  <button type="button" key={width} className={primary.strokeWidth === width ? 'is-active' : ''} aria-label={`${width} 像素`} onClick={() => props.onPatchSelected({ strokeWidth: width })}>
                    <span style={{ height: width }} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {textShape && (
            <section className="property-section">
              <h3>排版</h3>
              <div className="font-size-row">
                <label>
                  <span>字号</span>
                  <input type="number" min="10" max="96" value={primary.fontSize ?? 18} onChange={(event) => props.onPatchSelected({ fontSize: Number(event.target.value) })} />
                </label>
                <div className="segmented-control align-control">
                  {([
                    ['left', AlignLeft],
                    ['center', AlignCenter],
                    ['right', AlignRight],
                  ] as const).map(([align, Icon]) => (
                    <button type="button" key={align} className={primary.textAlign === align ? 'is-active' : ''} aria-label={`${align} 对齐`} onClick={() => props.onPatchSelected({ textAlign: align })}>
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              </div>
              <Toggle checked={primary.fontStyle === 'bold'} label="粗体" onChange={(value) => props.onPatchSelected({ fontStyle: value ? 'bold' : 'normal' })} />
            </section>
          )}

          <section className="property-section">
            <div className="range-heading"><h3>透明度</h3><span>{Math.round(primary.opacity * 100)}%</span></div>
            <input className="range-input" type="range" min="10" max="100" value={primary.opacity * 100} onChange={(event) => props.onPatchSelected({ opacity: Number(event.target.value) / 100 })} />
            {(primary.type === 'rect' || primary.type === 'note') && (
              <>
                <div className="range-heading"><h3>圆角</h3><span>{primary.cornerRadius}px</span></div>
                <input className="range-input" type="range" min="0" max="40" value={primary.cornerRadius} onChange={(event) => props.onPatchSelected({ cornerRadius: Number(event.target.value) })} />
              </>
            )}
          </section>

          <section className="property-section">
            <h3>排列与操作</h3>
            <div className="action-grid">
              {(primary.startBindingId || primary.endBindingId) && (
                <button type="button" onClick={() => props.onPatchSelected({ startBindingId: undefined, endBindingId: undefined })}><Unlink2 size={16} /> 断开连接</button>
              )}
              {props.selected.length > 1 && (
                <button type="button" onClick={props.onAutoFlow}><Workflow size={16} /> 整理流程</button>
              )}
              <button type="button" onClick={props.onDuplicate}><Copy size={16} /> 复制</button>
              <button type="button" onClick={props.onBringToFront}><ChevronsUp size={16} /> 置顶</button>
              <button type="button" onClick={props.onSendToBack}><ChevronsDown size={16} /> 置底</button>
              <button type="button" onClick={() => props.onPatchSelected({ locked: !primary.locked })}><Lock size={16} /> {primary.locked ? '解锁' : '锁定'}</button>
              <button className="danger-action" type="button" onClick={props.onDelete}><Trash2 size={16} /> 删除</button>
            </div>
          </section>
        </div>
      ) : (
        <div className="property-content canvas-properties">
          <section className="property-section">
            <h3>画布颜色</h3>
            <div className="canvas-color-grid">
              {canvasColors.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={props.settings.background === color ? 'is-active' : ''}
                  style={{ '--swatch': color } as React.CSSProperties}
                  aria-label={`画布颜色 ${color}`}
                  onClick={() => props.onSettingsChange({ background: color })}
                />
              ))}
            </div>
          </section>
          <section className="property-section">
            <h3>辅助绘制</h3>
            <Toggle checked={props.settings.grid} label="显示点阵" icon={<Grid3X3 size={17} />} onChange={(grid) => props.onSettingsChange({ grid })} />
            <Toggle checked={props.settings.snap} label="吸附网格" icon={<CrosshairIcon />} onChange={(snap) => props.onSettingsChange({ snap })} />
            <Toggle checked={props.settings.guides} label="智能参考线" icon={<ScanLine size={17} />} onChange={(guides) => props.onSettingsChange({ guides })} />
          </section>
          <section className="property-section board-summary">
            <h3>当前画板</h3>
            <div><strong>{props.totalShapes}</strong><span>个对象</span></div>
            <p>内容持续保存在这台设备上。</p>
          </section>
        </div>
      )}
      <button className="panel-scrim" type="button" aria-label="关闭属性面板" onClick={props.onClose} />
    </aside>
  );
}

function CrosshairIcon() {
  return <span className="snap-icon" aria-hidden="true" />;
}
