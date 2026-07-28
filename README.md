# Museboard

Museboard 是一个纯前端、本地优先的无限画布工具，适合快速绘制流程图、结构图、草图与视觉笔记。应用不需要账号或后端服务，画板内容默认保存在当前浏览器中。

## 核心特性

- 无限画布：平移、缩放、框选、多选、旋转、组合、锁定与层级调整
- 丰富图形：矩形、椭圆、菱形、直线、箭头、自由画笔、文本、便签、图片与画框
- 图形内文字：直接输入、双击或使用 `Enter` / `F2` 再次编辑，文本自动适配图形
- 高效排版：智能参考线、网格吸附、六向对齐、等距分布与自动流程整理
- 智能连接：直线和箭头可绑定图形，移动或缩放节点时自动跟随
- 编辑效率：撤销/重做、复制/粘贴、方向键微调、命令面板、一键清空与选区工具栏
- 本地持久化：使用 IndexedDB 自动保存文档和图片资源，并提供 localStorage 兼容恢复
- 文件工作流：支持 JSON 打开、保存和另存为；兼容浏览器可直接覆盖原文件
- 多格式导出：支持 PNG、JPG、WebP、SVG 和 JSON，可选择全画布或当前选区
- 离线使用：支持安装为 PWA，生产版本完成首次加载后可离线打开
- 响应式界面：桌面三栏工作台与移动端触控工具坞

## 技术栈

- React 19
- TypeScript 5
- Vite 7
- Konva / react-konva

## 快速开始

环境要求：Node.js `>=20.19.0` 或 `>=22.12.0`，以及 npm。

```bash
git clone https://github.com/lionlnuc/museboard.git
cd museboard
npm install
npm run dev
```

开发服务器默认运行在 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

## 可用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 执行 TypeScript 检查并构建生产版本 |
| `npm run preview` | 本地预览生产构建 |

## 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| `V` | 选择工具 |
| `R` / `O` / `D` | 矩形 / 椭圆 / 菱形 |
| `A` / `L` / `P` | 箭头 / 直线 / 自由画笔 |
| `T` / `N` | 文本 / 便签 |
| `Enter` 或 `F2` | 编辑选中图形的文字 |
| `Ctrl/Cmd + C` / `V` | 复制 / 粘贴 |
| `Ctrl/Cmd + Z` | 撤销 |
| `Ctrl/Cmd + Shift + Z` | 重做 |
| `Ctrl/Cmd + O` | 打开 JSON 画板 |
| `Ctrl/Cmd + S` | 保存 |
| `Ctrl/Cmd + Shift + S` | 另存为 |
| `Delete` / `Backspace` | 删除选中对象 |
| 方向键 | 微调选中对象 |

输入框获得焦点时，工具快捷键不会触发。


## 项目结构

```text
src/                 应用源码
  components/        画布与界面组件
  config/            工具定义
  hooks/             文档状态与历史记录
  utils/             几何、持久化与导出逻辑
public/              PWA 清单、Service Worker 与运行图标
scripts/             PWA 图标生成脚本
```


## 贡献

1. Fork 本仓库并创建功能分支。
2. 保持改动聚焦，提交前运行 `npm run build`。
3. 发起 Pull Request，说明问题、实现方式与验证结果。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方依赖遵循各自的许可证。
