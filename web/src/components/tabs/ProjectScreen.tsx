import { ProjectInfo, SessionMeta } from '../../lib/api';
import { lastActive } from '../../lib/format';
import Icon from '../Icon';
import SessionRow from '../SessionRow';

export default function ProjectScreen({
  project,
  sessions,
  onBack,
  onOpen,
  onDelete,
  onCompose,
  onTool,
}: {
  project: ProjectInfo;
  sessions: SessionMeta[];
  onBack: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCompose: () => void;
  onTool: (tool: 'git' | 'files' | 'preview') => void;
}) {
  const mine = sessions.sort((a, b) => lastActive(b) - lastActive(a));

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg">
      <header
        className="flex shrink-0 items-center gap-1 border-b border-linesoft bg-raised/80 px-2 py-2 backdrop-blur"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
      >
        <button className="flex h-8 w-8 items-center justify-center text-dim" onClick={onBack}>
          <Icon name="chevronL" size={19} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-tight text-ink">{project.name}</div>
          <div className="mono flex items-center gap-2 text-[10px] text-faint">
            {project.branch && (
              <span className="flex items-center gap-1">
                <Icon name="branch" size={10} />
                {project.branch}
              </span>
            )}
            {project.dirty > 0 && <span className="text-amb">{project.dirty} uncommitted</span>}
            {project.dirty === 0 && project.branch && <span className="text-grn">clean</span>}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-4">
          <button
            onClick={onCompose}
            className="rise flex w-full items-center justify-center gap-2 rounded-2xl bg-coral py-3 text-[14px] font-semibold text-bg active:opacity-90"
          >
            <Icon name="spark" size={16} strokeWidth={2} /> New task in {project.name}
          </button>

          <div className="rise mt-2.5 grid grid-cols-3 gap-2" style={{ animationDelay: '70ms' }}>
            {(
              [
                ['git', 'branch', 'Git'],
                ['files', 'file', 'Files'],
                ['preview', 'play', 'Preview'],
              ] as const
            ).map(([tool, icon, label]) => (
              <button
                key={tool}
                onClick={() => onTool(tool)}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-card py-3 text-dim active:bg-press"
              >
                <Icon name={icon} size={18} />
                <span className="text-[11px] font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 px-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
          Sessions
        </div>
        {mine.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-faint">No sessions in this project yet.</div>
        )}
        <div className="pb-8">
          {mine.map((s, i) => (
            <SessionRow
              key={s.id}
              session={s}
              showProject={false}
              onOpen={() => onOpen(s.id)}
              onDelete={() => onDelete(s.id)}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
