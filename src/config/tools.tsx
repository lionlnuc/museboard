import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Hand,
  ImagePlus,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { Tool } from '../types';

export interface ToolDefinition {
  id: Tool;
  label: string;
  commandLabel: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  shortcut?: string;
  mobilePrimary?: boolean;
  dividerBefore?: boolean;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: 'select', label: '选择', commandLabel: '选择工具', icon: MousePointer2, shortcut: 'V', mobilePrimary: true },
  { id: 'hand', label: '移动画布', commandLabel: '移动画布', icon: Hand, shortcut: 'H', mobilePrimary: true },
  { id: 'frame', label: '画框', commandLabel: '创建画框', icon: Frame, shortcut: 'F', dividerBefore: true },
  { id: 'rect', label: '矩形', commandLabel: '绘制矩形', icon: Square, shortcut: 'R', mobilePrimary: true },
  { id: 'ellipse', label: '椭圆', commandLabel: '绘制椭圆', icon: Circle, shortcut: 'O', mobilePrimary: true },
  { id: 'diamond', label: '菱形', commandLabel: '绘制菱形', icon: Diamond, shortcut: 'D' },
  { id: 'arrow', label: '箭头', commandLabel: '绘制箭头', icon: ArrowUpRight, shortcut: 'A', mobilePrimary: true, dividerBefore: true },
  { id: 'line', label: '直线', commandLabel: '绘制直线', icon: Minus, shortcut: 'L' },
  { id: 'pen', label: '自由画笔', commandLabel: '自由画笔', icon: Pencil, shortcut: 'P' },
  { id: 'text', label: '文本', commandLabel: '添加文本', icon: Type, shortcut: 'T', mobilePrimary: true, dividerBefore: true },
  { id: 'note', label: '便签', commandLabel: '添加便签', icon: StickyNote, shortcut: 'N' },
  { id: 'image', label: '插入图片', commandLabel: '插入图片', icon: ImagePlus, dividerBefore: true },
  { id: 'eraser', label: '橡皮擦', commandLabel: '橡皮擦', icon: Eraser, shortcut: 'E' },
];

export const TOOL_SHORTCUTS = Object.fromEntries(
  TOOL_DEFINITIONS.filter((tool) => tool.shortcut).map((tool) => [tool.id, tool.shortcut]),
) as Partial<Record<Tool, string>>;

export const TOOL_BY_SHORTCUT = Object.fromEntries(
  TOOL_DEFINITIONS.filter((tool) => tool.shortcut).map((tool) => [tool.shortcut!.toLowerCase(), tool.id]),
) as Record<string, Tool>;
