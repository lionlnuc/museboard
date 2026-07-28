import { Focus, Grid3X3, LocateFixed, Minus, Plus } from 'lucide-react';
import type { CanvasSettings } from '../types';

interface BottomControlsProps {
  zoom: number;
  settings: CanvasSettings;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  onReset: () => void;
  onToggleGrid: () => void;
}

export function BottomControls(props: BottomControlsProps) {
  return (
    <div className="bottom-controls" role="toolbar" aria-label="画布视图">
      <button className="icon-button" type="button" aria-label="缩小" data-tooltip="缩小" onClick={() => props.onZoom(Math.max(0.15, props.zoom - 0.1))}><Minus size={17} /></button>
      <button className="zoom-value" type="button" aria-label="重置缩放" onClick={props.onReset}>{Math.round(props.zoom * 100)}%</button>
      <button className="icon-button" type="button" aria-label="放大" data-tooltip="放大" onClick={() => props.onZoom(Math.min(4, props.zoom + 0.1))}><Plus size={17} /></button>
      <span className="control-divider" />
      <button className={`icon-button ${props.settings.grid ? 'is-active' : ''}`} type="button" aria-label="切换点阵" data-tooltip="点阵" onClick={props.onToggleGrid}><Grid3X3 size={17} /></button>
      <button className="icon-button" type="button" aria-label="适应内容" data-tooltip="适应内容" onClick={props.onFit}><Focus size={17} /></button>
      <button className="icon-button" type="button" aria-label="回到原点" data-tooltip="回到原点" onClick={props.onReset}><LocateFixed size={17} /></button>
    </div>
  );
}
