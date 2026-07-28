import { MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Tool } from '../types';
import { TOOL_DEFINITIONS, TOOL_SHORTCUTS } from '../config/tools';

export function Toolbar({ activeTool, onChange }: { activeTool: Tool; onChange: (tool: Tool) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [activeTool]);
  const secondaryTools = TOOL_DEFINITIONS.filter((tool) => !tool.mobilePrimary);
  return (
    <div className={`tool-dock ${moreOpen ? 'is-menu-open' : ''}`} role="toolbar" aria-label="绘图工具">
      {TOOL_DEFINITIONS.map(({ id, label, icon: Icon, dividerBefore, mobilePrimary }) => (
        <div className={`${dividerBefore ? 'tool-item has-divider' : 'tool-item'} ${mobilePrimary ? 'mobile-primary-tool' : 'mobile-secondary-tool'}`} key={id}>
          <button
            className={`icon-button tool-button ${activeTool === id ? 'is-active' : ''}`}
            type="button"
            aria-label={label}
            aria-pressed={activeTool === id}
            data-tooltip={`${label}${TOOL_SHORTCUTS[id] ? ` · ${TOOL_SHORTCUTS[id]}` : ''}`}
            onClick={() => onChange(id)}
          >
            <Icon size={19} strokeWidth={activeTool === id ? 2.35 : 1.9} />
          </button>
        </div>
      ))}
      <div className="mobile-more-tools">
        <button
          className={`icon-button tool-button ${secondaryTools.some((tool) => tool.id === activeTool) || moreOpen ? 'is-active' : ''}`}
          type="button"
          aria-label="更多工具"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal size={20} />
        </button>
        {moreOpen && (
          <div className="mobile-tool-menu" role="menu" aria-label="更多绘图工具">
            {secondaryTools.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="menuitem" className={activeTool === id ? 'is-active' : ''} onClick={() => onChange(id)}>
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
