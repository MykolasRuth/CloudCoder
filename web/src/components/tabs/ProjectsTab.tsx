import { ProjectInfo } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import Icon from '../Icon';

export default function ProjectsTab({
  projects,
  onOpen,
}: {
  projects: ProjectInfo[];
  onOpen: (name: string) => void;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="rise px-5 pb-2 pt-5">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Projects</h1>
        <p className="mono mt-0.5 text-[11px] text-faint">~\Projects</p>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pb-8 pt-2">
        {projects.map((p, i) => (
          <button
            key={p.name}
            onClick={() => onOpen(p.name)}
            className="rise flex items-center gap-3 rounded-2xl border border-line bg-card p-3.5 text-left active:bg-press"
            style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-dim">
              <Icon name="folder" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[14.5px] font-semibold tracking-tight text-ink">{p.name}</span>
                {p.dirty > 0 && (
                  <span className="mono shrink-0 rounded-full border border-amb/30 bg-amb/10 px-1.5 py-px text-[9.5px] font-medium text-amb">
                    {p.dirty}Δ
                  </span>
                )}
              </span>
              <span className="mono mt-1 flex items-center gap-2 text-[10.5px] text-faint">
                {p.branch && (
                  <span className="flex items-center gap-1">
                    <Icon name="branch" size={11} />
                    {p.branch}
                  </span>
                )}
                {p.sessions > 0 && (
                  <span>
                    {p.sessions} session{p.sessions > 1 ? 's' : ''}
                  </span>
                )}
                {p.lastActiveAt && <span>{timeAgo(p.lastActiveAt)}</span>}
                {!p.branch && !p.sessions && <span>no repo</span>}
              </span>
            </span>
            <Icon name="chevronR" size={15} className="shrink-0 text-faint" />
          </button>
        ))}
      </div>
    </div>
  );
}
