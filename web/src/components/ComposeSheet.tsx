import { useState } from 'react';
import { api, ProjectInfo } from '../lib/api';
import Icon from './Icon';

const MODES = [
  ['acceptEdits', 'Accept edits'],
  ['bypassPermissions', 'Bypass'],
  ['plan', 'Plan'],
] as const;

type Where = 'existing' | 'new' | 'none';

export default function ComposeSheet({
  root,
  projects,
  initialProject,
  onCreated,
  onClose,
}: {
  root: string;
  projects: ProjectInfo[];
  initialProject?: string;
  onCreated: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [where, setWhere] = useState<Where>('existing');
  const [project, setProject] = useState(
    initialProject || localStorage.getItem('cc_project') || projects[0]?.name || '',
  );
  const [newName, setNewName] = useState('');
  const [task, setTask] = useState('');
  const [mode, setMode] = useState(() => localStorage.getItem('cc_mode') || 'acceptEdits');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = where === 'existing' ? !!project : where === 'new' ? !!newName.trim() : true;

  const target = () =>
    where === 'none'
      ? { scratch: true as const }
      : where === 'new'
        ? { newProject: newName.trim() }
        : { cwd: root + '\\' + project };

  const remember = () => {
    if (where === 'existing') localStorage.setItem('cc_project', project);
    localStorage.setItem('cc_mode', mode);
  };

  const startTask = async () => {
    const text = task.trim();
    if (!text || !ready || busy) return;
    setBusy(true);
    setError('');
    try {
      remember();
      const meta = await api.createSession({ kind: 'chat', ...target(), permissionMode: mode });
      await api.chatSend(meta.id, text);
      await onCreated(meta.id);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const startTerminal = async (program: 'claude' | 'shell') => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      remember();
      const meta = await api.createSession({ kind: 'terminal', ...target(), program });
      await onCreated(meta.id);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="scrim fixed inset-0 z-50 flex items-end bg-black/65" onClick={onClose}>
      <div
        className="sheet w-full rounded-t-3xl border-t border-line bg-raised px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />

        <div className="mb-3 flex items-center gap-2">
          <Icon name="spark" size={15} className="text-coral" />
          <span className="text-[15px] font-semibold tracking-tight">New session</span>
        </div>

        {/* where do the files live */}
        <div className="flex rounded-xl border border-line bg-card p-1">
          {(
            [
              ['existing', 'folder', 'Project'],
              ['new', 'plus', 'New project'],
              ['none', 'spark', 'No project'],
            ] as [Where, string, string][]
          ).map(([v, icon, label]) => (
            <button
              key={v}
              onClick={() => setWhere(v)}
              className={
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11.5px] font-medium transition-colors ' +
                (where === v ? 'bg-press text-ink' : 'text-faint')
              }
            >
              <Icon name={icon} size={12} />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-2.5 rounded-2xl border border-line bg-card p-3">
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe a task for Claude…"
            rows={Math.min(5, Math.max(2, task.split('\n').length))}
            autoFocus
            className="w-full resize-none bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <div className="mt-2 flex items-center gap-2">
            {where === 'existing' && (
              <div className="relative min-w-0 flex-1">
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="mono w-full appearance-none truncate rounded-lg border border-line bg-raised py-1.5 pl-7 pr-2 text-[11px] text-dim outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Icon name="folder" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
              </div>
            )}
            {where === 'new' && (
              <div className="relative min-w-0 flex-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="project-name"
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="mono w-full rounded-lg border border-line bg-raised py-1.5 pl-7 pr-2 text-[11px] text-ink outline-none placeholder:text-faint focus:border-coral/60"
                />
                <Icon name="plus" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
              </div>
            )}
            {where === 'none' && (
              <div className="mono min-w-0 flex-1 truncate py-1.5 text-[10.5px] text-faint">
                files go to a scratch workspace on the homelab
              </div>
            )}
            <button
              disabled={!task.trim() || !ready || busy}
              onClick={startTask}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-coral text-bg disabled:opacity-35"
            >
              {busy ? <span className="spin h-4 w-4 rounded-full border-2 border-bg border-t-transparent" /> : <Icon name="send" size={17} strokeWidth={2} />}
            </button>
          </div>
        </div>

        <div className="mt-3 flex rounded-xl border border-line bg-card p-1">
          {MODES.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              className={
                'flex-1 rounded-lg py-1.5 text-[12px] font-medium transition-colors ' +
                (mode === v ? 'bg-press text-ink' : 'text-faint')
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            disabled={busy || !ready}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-card py-2.5 text-[12.5px] font-medium text-dim active:bg-press disabled:opacity-40"
            onClick={() => startTerminal('claude')}
          >
            <Icon name="terminal" size={15} className="text-coral" /> Claude terminal
          </button>
          <button
            disabled={busy || !ready}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-card py-2.5 text-[12.5px] font-medium text-dim active:bg-press disabled:opacity-40"
            onClick={() => startTerminal('shell')}
          >
            <Icon name="terminal" size={15} /> PowerShell
          </button>
        </div>

        {error && <div className="mt-2 text-[12px] text-rd">{error}</div>}
      </div>
    </div>
  );
}
