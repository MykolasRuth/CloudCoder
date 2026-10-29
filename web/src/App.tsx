import { useCallback, useEffect, useState } from 'react';
import { api, ProjectInfo, SessionMeta } from './lib/api';
import { useVisualViewport } from './lib/viewport';
import { projectName, sessionDot, fmtTokens } from './lib/format';
import Icon from './components/Icon';
import HomeTab from './components/tabs/HomeTab';
import ProjectsTab from './components/tabs/ProjectsTab';
import ProjectScreen from './components/tabs/ProjectScreen';
import WorkflowsTab from './components/tabs/WorkflowsTab';
import SettingsTab from './components/tabs/SettingsTab';
import ComposeSheet from './components/ComposeSheet';
import TermView from './components/terminal/TermView';
import ChatView from './components/chat/ChatView';
import GitPanel from './components/git/GitPanel';
import FilesPanel from './components/files/FilesPanel';
import PreviewPanel from './components/preview/PreviewPanel';

type Tab = 'home' | 'projects' | 'workflows' | 'settings';
type Panel = null | 'preview' | 'git' | 'files';

export default function App() {
  const { height, offsetTop } = useVisualViewport();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [root, setRoot] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelCwd, setPanelCwd] = useState('');
  const [compose, setCompose] = useState<null | { project?: string }>(null);
  const [pinRequired, setPinRequired] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  // live context-window size per chat session, reported up from ChatView
  const [ctxBySession, setCtxBySession] = useState<Record<string, number>>({});
  const reportCtx = useCallback(
    (id: string, n: number) => setCtxBySession((m) => (m[id] === n ? m : { ...m, [id]: n })),
    [],
  );

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const [list, proj] = await Promise.all([api.sessions(), api.projects()]);
      setSessions(list);
      setProjects(proj.projects);
      setRoot(proj.root);
      setActiveId((cur) => (cur && !list.some((s) => s.id === cur) ? null : cur));
      setPinRequired(false);
    } catch (e: any) {
      if (String(e.message).includes('unauthorized')) setPinRequired(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 8000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  // deep link from a push notification: /#session=<id>
  useEffect(() => {
    const applyHash = () => {
      const m = /session=([\w-]+)/.exec(location.hash);
      if (m) {
        setActiveId(m[1]);
        setPanel(null);
        history.replaceState(null, '', location.pathname);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const project = projects.find((p) => p.name === openProject) ?? null;

  const closeSession = async (id: string) => {
    await api.deleteSession(id);
    if (activeId === id) setActiveId(null);
    await refresh();
  };

  const openTool = (tool: Exclude<Panel, null>, cwd: string) => {
    setPanelCwd(cwd);
    setPanel(tool);
  };

  // permission mode / model apply to the next turn; update optimistically
  const changeMode = async (id: string, mode: string) => {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, permissionMode: mode } : s)));
    try {
      await api.setSessionMode(id, mode);
    } catch {
      refresh();
    }
  };
  const changeModel = async (id: string, model: string) => {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, model } : s)));
    try {
      await api.setSessionModel(id, model);
    } catch {
      refresh();
    }
  };

  if (pinRequired) {
    return (
      <div style={{ top: offsetTop, height }} className="fixed inset-x-0 flex flex-col items-center justify-center gap-4 p-6">
        <Icon name="spark" size={28} className="text-coral" />
        <div className="text-[17px] font-semibold tracking-tight">CloudCoder</div>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="mono w-40 rounded-xl border border-line bg-card px-3 py-2.5 text-center text-lg text-ink outline-none focus:border-coral"
        />
        {pinError && <div className="text-[13px] text-rd">{pinError}</div>}
        <button
          className="rounded-full bg-coral px-7 py-2.5 text-[14px] font-semibold text-bg"
          onClick={async () => {
            try {
              await api.login(pin);
              setPinError('');
              await refresh();
            } catch {
              setPinError('wrong PIN');
            }
          }}
        >
          Unlock
        </button>
      </div>
    );
  }

  const inSession = !!active;

  return (
    <div style={{ top: offsetTop, height }} className="fixed inset-x-0 flex flex-col overflow-hidden bg-bg">
      {/* session header */}
      {active && (
        <header
          className="flex shrink-0 items-center gap-1 border-b border-linesoft bg-raised/85 px-2 py-1.5 backdrop-blur"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6px)' }}
        >
          <button
            className="flex h-8 w-8 items-center justify-center text-dim"
            onClick={() => {
              setActiveId(null);
              setPanel(null);
            }}
          >
            <Icon name="chevronL" size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold tracking-tight text-ink">{active.title}</div>
            <div className="mono truncate text-[9.5px] text-faint">
              {projectName(active.cwd)}
              {active.kind === 'chat' ? (
                ctxBySession[active.id] > 0 ? (
                  <>
                    {' · '}
                    <span className={ctxBySession[active.id] >= 120_000 ? 'text-amb' : 'text-dim'}>
                      {fmtTokens(ctxBySession[active.id])} ctx
                    </span>
                  </>
                ) : (
                  ''
                )
              ) : active.program === 'shell' ? (
                ' · powershell'
              ) : (
                ' · claude code'
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {active.kind === 'chat' && (
              <>
                <select
                  value={active.model || 'default'}
                  onChange={(e) => changeModel(active.id, e.target.value)}
                  className="mono mr-1 rounded-md border border-line bg-card px-1.5 py-1 text-[10.5px] text-dim outline-none focus:border-coral/60"
                  aria-label="Model"
                >
                  <option value="default">Default model</option>
                  <option value="claude-opus-4-8">Opus 4.8 · 1M</option>
                  <option value="claude-opus-4-7">Opus 4.7 · 1M</option>
                  <option value="claude-opus-4-6">Opus 4.6 · 1M</option>
                  <option value="claude-sonnet-4-6">Sonnet 4.6 · 1M</option>
                  <option value="claude-haiku-4-5">Haiku 4.5 · 200K</option>
                  <option value="claude-fable-5">Fable 5 · 1M</option>
                </select>
                <select
                  value={active.permissionMode || 'acceptEdits'}
                  onChange={(e) => changeMode(active.id, e.target.value)}
                  className="mono mr-1 rounded-md border border-line bg-card px-1.5 py-1 text-[10.5px] text-dim outline-none focus:border-coral/60"
                  aria-label="Permission mode"
                >
                  <option value="plan">Plan</option>
                  <option value="acceptEdits">Auto</option>
                  <option value="bypassPermissions">Bypass</option>
                  <option value="default">Default</option>
                </select>
              </>
            )}
            {(
              [
                ['git', 'branch'],
                ['files', 'file'],
                ['preview', 'play'],
              ] as const
            ).map(([tool, icon]) => (
              <button
                key={tool}
                className={
                  'flex h-8 w-8 items-center justify-center rounded-lg ' +
                  (panel === tool ? 'bg-press text-coral' : 'text-faint')
                }
                onClick={() => (panel === tool ? setPanel(null) : openTool(tool, active.cwd))}
              >
                <Icon name={icon} size={16} />
              </button>
            ))}
            <span className={'mx-1.5 dot dot-' + sessionDot(active)} />
          </div>
        </header>
      )}

      <main className="relative min-h-0 flex-1">
        {/* sessions stay mounted so terminals stay connected */}
        {sessions.map((s) => (
          <div key={s.id} className="absolute inset-0" style={{ display: s.id === activeId ? 'block' : 'none' }}>
            {s.kind === 'terminal' ? (
              <TermView session={s} active={s.id === activeId && !panel} />
            ) : (
              <ChatView
                session={s}
                active={s.id === activeId}
                onContextTokens={(n) => reportCtx(s.id, n)}
              />
            )}
          </div>
        ))}

        {!inSession && (
          <>
            {tab === 'home' && (
              <HomeTab
                sessions={sessions}
                onOpen={setActiveId}
                onDelete={closeSession}
                onCompose={() => setCompose({})}
              />
            )}
            {tab === 'projects' && !openProject && (
              <ProjectsTab projects={projects} onOpen={setOpenProject} />
            )}
            {tab === 'projects' && project && (
              <ProjectScreen
                project={project}
                sessions={sessions.filter(
                  (s) => projectName(s.cwd).toLowerCase() === project.name.toLowerCase(),
                )}
                onBack={() => setOpenProject(null)}
                onOpen={setActiveId}
                onDelete={closeSession}
                onCompose={() => setCompose({ project: project.name })}
                onTool={(t) => openTool(t, root + '\\' + project.name)}
              />
            )}
            {tab === 'workflows' && <WorkflowsTab />}
            {tab === 'settings' && <SettingsTab />}
          </>
        )}

        {panel === 'preview' && <PreviewPanel onClose={() => setPanel(null)} />}
        {panel === 'git' && panelCwd && <GitPanel cwd={panelCwd} onClose={() => setPanel(null)} />}
        {panel === 'files' && panelCwd && <FilesPanel cwd={panelCwd} onClose={() => setPanel(null)} />}
      </main>

      {/* bottom tab bar — hidden inside a session (session has its own footer) */}
      {!inSession && (
        <nav
          className="flex shrink-0 items-end justify-around border-t border-linesoft bg-raised/90 backdrop-blur"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {(
            [
              ['home', 'home', 'Home'],
              ['projects', 'folder', 'Projects'],
              ['workflows', 'workflow', 'Workflows'],
            ] as [Tab, string, string][]
          ).map(([key, icon, label]) => (
            <button
              key={key}
              className={
                'flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium ' +
                (tab === key && !openProject ? 'text-coral' : 'text-faint')
              }
              onClick={() => {
                setTab(key);
                if (key !== 'projects') setOpenProject(null);
              }}
            >
              <Icon name={icon} size={20} strokeWidth={tab === key ? 1.9 : 1.5} />
              {label}
            </button>
          ))}
          <button className="flex flex-1 flex-col items-center pb-1.5 pt-1" onClick={() => setCompose({ project: openProject || undefined })}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-coral text-bg shadow-[0_4px_18px_var(--accent-glow)]">
              <Icon name="plus" size={20} strokeWidth={2.2} />
            </span>
          </button>
          <button
            className={
              'flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium ' +
              (tab === 'settings' ? 'text-coral' : 'text-faint')
            }
            onClick={() => setTab('settings')}
          >
            <Icon name="gear" size={20} strokeWidth={tab === 'settings' ? 1.9 : 1.5} />
            Settings
          </button>
        </nav>
      )}

      {compose && (
        <ComposeSheet
          root={root}
          projects={projects}
          initialProject={compose.project}
          onClose={() => setCompose(null)}
          onCreated={async (id) => {
            setCompose(null);
            await refresh();
            setActiveId(id);
          }}
        />
      )}
    </div>
  );
}
