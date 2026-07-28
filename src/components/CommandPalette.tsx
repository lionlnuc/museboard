import { Command, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

export function CommandPalette({ open, actions, onClose }: { open: boolean; actions: CommandAction[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? actions.filter((action) => `${action.label} ${action.group}`.toLowerCase().includes(normalized)) : actions;
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);
  if (!open) return null;

  const execute = (action: CommandAction | undefined) => {
    if (!action) return;
    action.run();
    onClose();
  };

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="快速命令">
        <div className="command-search">
          <Search size={19} />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索工具或操作"
            aria-label="搜索命令"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
              if (event.key === 'Enter') execute(filtered[activeIndex]);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-results">
          {filtered.map((action, index) => (
            <button
              type="button"
              key={action.id}
              className={index === activeIndex ? 'is-active' : ''}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => execute(action)}
            >
              <span className="command-icon"><Command size={16} /></span>
              <span><strong>{action.label}</strong><small>{action.group}</small></span>
              {action.hint && <kbd>{action.hint}</kbd>}
            </button>
          ))}
          {filtered.length === 0 && <div className="command-empty">没有匹配的命令</div>}
        </div>
      </section>
    </div>
  );
}
