import { useState } from 'react';
import Icon from '../Icon';

export interface ToolItem {
  kind: 'tool';
  toolId: string;
  name: string;
  label: string;
  input: string;
  output?: string;
  isError?: boolean;
  done: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  Write: 'file',
  Edit: 'diff',
  MultiEdit: 'diff',
  Read: 'eye',
  Bash: 'terminal',
  PowerShell: 'terminal',
  Glob: 'search',
  Grep: 'search',
  Task: 'spark',
  Agent: 'spark',
  TodoWrite: 'check',
};

export default function ToolCard({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const icon = TOOL_ICONS[tool.name] || (/web|fetch/i.test(tool.name) ? 'external' : 'gear');
  return (
    <div className="my-1 overflow-hidden rounded-xl border border-linesoft bg-raised">
      <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left" onClick={() => setOpen(!open)}>
        <Icon name={icon} size={14} className="shrink-0 text-faint" />
        <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-dim">{tool.label}</span>
        {!tool.done && <span className="spin h-3 w-3 shrink-0 rounded-full border-[1.5px] border-amb border-t-transparent" />}
        {tool.done && !tool.isError && <Icon name="check" size={13} className="shrink-0 text-grn" />}
        {tool.done && tool.isError && <Icon name="x" size={13} className="shrink-0 text-rd" />}
      </button>
      {open && (
        <div className="border-t border-linesoft px-3 py-2.5">
          <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-faint">{tool.input}</pre>
          {tool.output != null && tool.output !== '' && (
            <>
              <div className="mono mt-2 text-[9px] uppercase tracking-[0.16em] text-faint">output</div>
              <pre className="mono mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-dim">{tool.output}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
