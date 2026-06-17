import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import Panel from '../Panel';
import DiffView from './DiffView';
import Icon from '../Icon';

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

function statusBadge(s: string): { label: string; cls: string } {
  if (s === '??') return { label: 'A', cls: 'text-grn' };
  if (s.includes('D')) return { label: 'D', cls: 'text-rd' };
  if (s.includes('A')) return { label: 'A', cls: 'text-grn' };
  if (s.includes('R')) return { label: 'R', cls: 'text-amb' };
  return { label: 'M', cls: 'text-amb' };
}

export default function GitPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [status, setStatus] = useState<{
    isRepo: boolean;
    branch?: string;
    files?: GitFile[];
    error?: string;
  } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitOut, setCommitOut] = useState('');
  const [log, setLog] = useState('');

  const load = useCallback(() => {
    api.gitStatus(cwd).then(setStatus).catch(() => setStatus({ isRepo: false, error: 'failed to load' }));
    api.gitLog(cwd).then((r) => setLog(r.log || '')).catch(() => {});
  }, [cwd]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!sel) return;
    setDiff('');
    api.gitDiff(cwd, sel).then((r) => setDiff(r.diff || r.error || '')).catch((e) => setDiff(String(e.message)));
  }, [cwd, sel]);

  if (sel) {
    return (
      <Panel title={sel.split('/').pop() || sel} icon="diff" onClose={() => setSel(null)}>
        <DiffView diff={diff} />
      </Panel>
    );
  }

  return (
    <Panel
      title={status?.branch ? cwd.split('\\').pop() + '' : 'Git'}
      icon="branch"
      onClose={onClose}
      actions={
        <>
          {status?.branch && (
            <span className="mono mr-1 flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[10px] text-dim">
              <Icon name="branch" size={10} />
              {status.branch}
            </span>
          )}
          <button className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-dim active:bg-press" onClick={load}>
            <Icon name="refresh" size={13} />
          </button>
        </>
      }
    >
      {!status && <div className="p-5 text-[13px] text-faint">loading…</div>}
      {status && !status.isRepo && (
        <div className="p-5 text-[13px] text-faint">Not a git repository.{status.error ? ` (${status.error})` : ''}</div>
      )}
      {status?.isRepo && (
        <div className="flex flex-col">
          <div className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            Changes ({status.files?.length || 0})
          </div>
          <div className="mx-3 mt-2 overflow-hidden rounded-2xl border border-line bg-raised">
            {(status.files || []).map((f) => {
              const b = statusBadge(f.status);
              return (
                <button
                  key={f.path}
                  className="flex w-full items-center gap-2.5 border-b border-linesoft/60 px-3.5 py-2.5 text-left last:border-b-0 active:bg-press"
                  onClick={() => setSel(f.path)}
                >
                  <span className={'mono w-3.5 shrink-0 text-center text-[11px] font-semibold ' + b.cls}>{b.label}</span>
                  <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-dim">{f.path}</span>
                  <Icon name="chevronR" size={12} className="shrink-0 text-faint" />
                </button>
              );
            })}
            {(status.files || []).length === 0 && (
              <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-faint">
                <Icon name="check" size={14} className="text-grn" /> working tree clean
              </div>
            )}
          </div>

          {(status.files || []).length > 0 && (
            <div className="mx-3 mt-3">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Commit message"
                rows={2}
                className="w-full resize-none rounded-2xl border border-line bg-card px-3.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-faint focus:border-coral/60"
              />
              <button
                disabled={!message.trim() || committing}
                className="mt-2 w-full rounded-xl bg-coral py-2.5 text-[13px] font-semibold text-bg disabled:opacity-35"
                onClick={async () => {
                  setCommitting(true);
                  setCommitOut('');
                  try {
                    const r = await api.gitCommit(cwd, message.trim(), true);
                    setCommitOut(r.out);
                    if (r.ok) setMessage('');
                    load();
                  } catch (e: any) {
                    setCommitOut(e.message);
                  }
                  setCommitting(false);
                }}
              >
                {committing ? 'Committing…' : 'Stage all + commit'}
              </button>
              {commitOut && <pre className="mono mt-2 whitespace-pre-wrap text-[10.5px] text-faint">{commitOut}</pre>}
            </div>
          )}

          {log && (
            <div className="px-4 pb-8 pt-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">History</div>
              <pre className="mono mt-2 overflow-x-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-dim">{log}</pre>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
