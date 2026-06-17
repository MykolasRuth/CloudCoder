import { useState } from 'react';
import { api, ChangedFile } from '../../lib/api';
import DiffView from '../git/DiffView';
import Icon from '../Icon';

// Codex-style end-of-turn summary: uncommitted files with +/- counts,
// tap-through diffs, and commit-all right from the thread.
export default function ChangesCard({ cwd, files }: { cwd: string; files: ChangedFile[] }) {
  const [sel, setSel] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState('');
  const [committing, setCommitting] = useState(false);
  const [showCommit, setShowCommit] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState('');

  if (files.length === 0) return null;

  const totalAdd = files.reduce((n, f) => n + f.add, 0);
  const totalDel = files.reduce((n, f) => n + f.del, 0);

  const openDiff = async (f: ChangedFile) => {
    setSel(f);
    setDiff('');
    try {
      const r = await api.gitDiff(cwd, f.path);
      setDiff(r.diff || 'no diff available');
    } catch (e: any) {
      setDiff('failed to load diff: ' + e.message);
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-line bg-raised">
      <div className="flex items-center gap-2.5 border-b border-linesoft px-3.5 py-2.5">
        <Icon name="diff" size={14} className="text-coral" />
        <span className="text-[12.5px] font-semibold text-ink">
          {files.length} file{files.length > 1 ? 's' : ''} changed
        </span>
        <span className="mono text-[11px] text-grn">+{totalAdd}</span>
        <span className="mono text-[11px] text-rd">−{totalDel}</span>
        <span className="flex-1" />
        {done ? (
          <span className="mono flex items-center gap-1 text-[11px] text-grn">
            <Icon name="check" size={12} /> {done}
          </span>
        ) : (
          <button
            className="rounded-full bg-coral px-3 py-1 text-[11px] font-semibold text-bg"
            onClick={() => setShowCommit(!showCommit)}
          >
            Commit
          </button>
        )}
      </div>
      {files.map((f) => (
        <button
          key={f.path}
          className="flex w-full items-center gap-2.5 border-b border-linesoft/60 px-3.5 py-2 text-left last:border-b-0 active:bg-press"
          onClick={() => openDiff(f)}
        >
          <span
            className={
              'mono w-3.5 shrink-0 text-center text-[11px] font-semibold ' +
              (f.status === 'new' ? 'text-grn' : f.status === 'deleted' ? 'text-rd' : 'text-amb')
            }
          >
            {f.status === 'new' ? 'A' : f.status === 'deleted' ? 'D' : 'M'}
          </span>
          <span className="mono min-w-0 flex-1 truncate text-[11px] text-dim">{f.path}</span>
          {(f.add > 0 || f.del > 0) && (
            <span className="mono shrink-0 text-[10px] text-faint">
              <span className="text-grn">+{f.add}</span> <span className="text-rd">−{f.del}</span>
            </span>
          )}
          <Icon name="chevronR" size={12} className="shrink-0 text-faint" />
        </button>
      ))}

      {showCommit && !done && (
        <div className="border-t border-linesoft p-3">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message"
            className="w-full rounded-xl border border-line bg-card px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-faint focus:border-coral"
          />
          <button
            disabled={!message.trim() || committing}
            className="mt-2 w-full rounded-xl bg-coral py-2.5 text-[13px] font-semibold text-bg disabled:opacity-35"
            onClick={async () => {
              setCommitting(true);
              try {
                const r = await api.gitCommit(cwd, message.trim(), true);
                if (r.ok) {
                  setDone('committed');
                  setShowCommit(false);
                } else {
                  alert(r.out);
                }
              } catch (e: any) {
                alert(e.message);
              }
              setCommitting(false);
            }}
          >
            {committing ? 'Committing…' : 'Stage all + commit'}
          </button>
        </div>
      )}

      {sel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg">
          <div
            className="flex shrink-0 items-center gap-2 border-b border-linesoft bg-raised px-3 py-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
          >
            <Icon name="diff" size={14} className="shrink-0 text-coral" />
            <div className="mono min-w-0 flex-1 truncate text-[12px] text-ink">{sel.path}</div>
            <button className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-dim" onClick={() => setSel(null)}>
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DiffView diff={diff} />
          </div>
        </div>
      )}
    </div>
  );
}
