import { SessionMeta } from '../../lib/api';
import { dayLabel, greeting, lastActive, projectName, sessionDot } from '../../lib/format';
import Icon from '../Icon';
import SessionRow from '../SessionRow';

export default function HomeTab({
  sessions,
  onOpen,
  onDelete,
  onCompose,
}: {
  sessions: SessionMeta[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCompose: () => void;
}) {
  const sorted = [...sessions].sort((a, b) => lastActive(b) - lastActive(a));
  const continueRail = sorted.filter((s) => sessionDot(s) !== 'dead').slice(0, 6);

  // group history by day
  const groups: { label: string; items: SessionMeta[] }[] = [];
  for (const s of sorted) {
    const label = dayLabel(lastActive(s));
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(s);
    else groups.push({ label, items: [s] });
  }

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="rise px-5 pb-1 pt-5">
        <div className="flex items-center gap-2">
          <Icon name="spark" size={16} className="text-coral" strokeWidth={2} />
          <span className="mono text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">CloudCoder</span>
        </div>
        <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight text-ink">
          {greeting()}, Mykolas
        </h1>
        <p className="mt-0.5 text-[13px] text-faint">
          {sessions.length === 0
            ? 'Your homelab is ready.'
            : `${sessions.length} session${sessions.length > 1 ? 's' : ''} on the homelab`}
        </p>
      </div>

      {continueRail.length > 0 && (
        <>
          <div className="mt-4 px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Continue</div>
          <div className="rail mt-2 flex gap-2.5 overflow-x-auto px-5 pb-1">
            {continueRail.map((s, i) => {
              const dot = sessionDot(s);
              return (
                <button
                  key={s.id}
                  onClick={() => onOpen(s.id)}
                  className="rise w-44 shrink-0 rounded-2xl border border-line bg-card p-3 text-left active:bg-press"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="mono flex items-center gap-1.5 text-[10px] text-faint">
                      <Icon name={s.kind === 'chat' ? 'chat' : 'terminal'} size={12} />
                      {projectName(s.cwd)}
                    </span>
                    <span className={'dot dot-' + dot} />
                  </div>
                  <div className="mt-2 line-clamp-2 min-h-[2.4em] text-[13px] font-medium leading-snug text-ink">
                    {s.title}
                  </div>
                  <div className="mono mt-1.5 text-[10px] text-faint">
                    {dot === 'busy' ? 'working…' : dot === 'live' ? 'ready' : 'ended'}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {sorted.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 px-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-card text-coral">
            <Icon name="spark" size={24} />
          </span>
          <div>
            <div className="text-[15px] font-medium text-ink">No sessions yet</div>
            <div className="mt-1 text-[13px] leading-relaxed text-faint">
              Describe a task and Claude will build it on the homelab.
            </div>
          </div>
          <button
            onClick={onCompose}
            className="flex items-center gap-2 rounded-full bg-coral px-5 py-2.5 text-[13.5px] font-semibold text-bg"
          >
            <Icon name="plus" size={16} strokeWidth={2.2} /> New session
          </button>
        </div>
      ) : (
        <div className="pb-8">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mt-5 px-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                {g.label}
              </div>
              {g.items.map((s, i) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onOpen={() => onOpen(s.id)}
                  onDelete={() => onDelete(s.id)}
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
