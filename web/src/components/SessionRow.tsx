import { SessionMeta } from '../lib/api';
import { projectName, sessionDot, timeAgo, lastActive } from '../lib/format';
import Icon from './Icon';

export default function SessionRow({
  session,
  onOpen,
  onDelete,
  showProject = true,
  style,
}: {
  session: SessionMeta;
  onOpen: () => void;
  onDelete?: () => void;
  showProject?: boolean;
  style?: React.CSSProperties;
}) {
  const dot = sessionDot(session);
  return (
    <div className="rise flex items-center border-b border-linesoft" style={style}>
      <button className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-press" onClick={onOpen}>
        <span
          className={
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ' +
            (session.kind === 'chat'
              ? 'border-coral/25 bg-coral/10 text-coral'
              : 'border-line bg-card text-dim')
          }
        >
          <Icon name={session.kind === 'chat' ? 'chat' : 'terminal'} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-snug text-ink">{session.title}</span>
          <span className="mono mt-0.5 block truncate text-[10.5px] text-faint">
            {showProject && <>{projectName(session.cwd)} · </>}
            {timeAgo(lastActive(session))}
            {session.kind === 'terminal' && session.status === 'exited' && ' · ended'}
            {session.kind === 'terminal' && session.program === 'shell' && ' · pwsh'}
          </span>
        </span>
        <span className={'dot dot-' + dot} />
      </button>
      {onDelete && (
        <button
          className="px-3 py-3 text-faint active:text-rd"
          onClick={() => {
            if (confirm(`Delete "${session.title}"?`)) onDelete();
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      )}
    </div>
  );
}
