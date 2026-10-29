export interface ChangedFile {
  path: string;
  add: number;
  del: number;
  status: 'modified' | 'new' | 'deleted';
}

export interface SessionMeta {
  id: string;
  kind: 'terminal' | 'chat';
  cwd: string;
  title: string;
  program?: 'claude' | 'shell';
  permissionMode?: string;
  model?: string;
  goal?: string;
  claudeSessionId?: string;
  createdAt: number;
  updatedAt?: number;
  status: 'running' | 'exited';
  busy?: boolean;
  attached?: boolean;
}

export interface WorkflowRun {
  runId: string;
  name: string;
  status: string;
  project: string;
  startTime: number;
  updatedAt: number;
  durationMs: number;
  agentCount: number;
  totalTokens: number;
  totalToolCalls: number;
  phaseCount: number;
  currentPhase: { index: number; title: string } | null;
  summary: string;
  hasError: boolean;
}

export interface WorkflowDetail extends WorkflowRun {
  defaultModel: string;
  phases: { title: string; detail?: string }[];
  progress: { type: string; index?: number; title?: string; [k: string]: unknown }[];
  logs: string[];
  result: string;
  scriptPath: string;
  script: string;
}

export interface ProjectInfo {
  name: string;
  branch: string | null;
  dirty: number;
  sessions: number;
  lastActiveAt: number | null;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => fetch('/_cc/api/health').then((r) => j<{ ok: boolean; pinRequired: boolean }>(r)),
  login: (pin: string) =>
    fetch('/_cc/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }).then((r) => j<{ ok: boolean }>(r)),
  projects: () => fetch('/_cc/api/projects').then((r) => j<{ root: string; projects: ProjectInfo[] }>(r)),
  sessions: () => fetch('/_cc/api/sessions').then((r) => j<SessionMeta[]>(r)),
  createSession: (body: {
    kind: 'terminal' | 'chat';
    cwd?: string;
    newProject?: string;
    scratch?: boolean;
    title?: string;
    program?: string;
    permissionMode?: string;
  }) =>
    fetch('/_cc/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<SessionMeta>(r)),
  deleteSession: (id: string) => fetch('/_cc/api/sessions/' + id, { method: 'DELETE' }).then((r) => j(r)),
  renameSession: (id: string, title: string) =>
    fetch('/_cc/api/sessions/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).then((r) => j(r)),
  setSessionMode: (id: string, permissionMode: string) =>
    fetch('/_cc/api/sessions/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionMode }),
    }).then((r) => j<SessionMeta>(r)),
  setSessionModel: (id: string, model: string) =>
    fetch('/_cc/api/sessions/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }).then((r) => j<SessionMeta>(r)),
  uploadTextFile: (id: string, text: string) =>
    fetch(`/_cc/api/chat/${id}/text-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then((r) => j<{ ok: boolean; path: string; name: string }>(r)),
  chatSend: (id: string, text: string, images?: string[]) =>
    fetch(`/_cc/api/chat/${id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, images }),
    }).then((r) => j(r)),
  // Summarize a reply and return spoken audio (WAV) for it, plus the summary
  // text. The audio is played as media so it follows the device output route.
  chatVoice: async (id: string, text: string): Promise<{ audio: Blob; summary: string }> => {
    const res = await fetch(`/_cc/api/chat/${id}/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try {
        const body = await res.json();
        if (body.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    const audio = await res.blob();
    let summary = '';
    try {
      summary = decodeURIComponent(res.headers.get('X-Summary') || '');
    } catch {}
    return { audio, summary };
  },
  chatStop: (id: string) => fetch(`/_cc/api/chat/${id}/stop`, { method: 'POST' }).then((r) => j(r)),
  chatClear: (id: string) => fetch(`/_cc/api/chat/${id}/clear`, { method: 'POST' }).then((r) => j(r)),
  chatCompact: (id: string) => fetch(`/_cc/api/chat/${id}/compact`, { method: 'POST' }).then((r) => j(r)),
  setSessionGoal: (id: string, goal: string) =>
    fetch('/_cc/api/sessions/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    }).then((r) => j<SessionMeta>(r)),
  chatCommands: (id: string) =>
    fetch(`/_cc/api/chat/${id}/commands`).then((r) =>
      j<{ commands: { name: string; description: string; kind: 'skill' | 'command' }[] }>(r),
    ),
  workflows: () => fetch('/_cc/api/workflows').then((r) => j<{ runs: WorkflowRun[] }>(r)),
  workflow: (runId: string) => fetch('/_cc/api/workflows/' + runId).then((r) => j<WorkflowDetail>(r)),
  gitStatus: (cwd: string) =>
    fetch('/_cc/api/git/status?cwd=' + encodeURIComponent(cwd)).then((r) =>
      j<{ isRepo: boolean; branch?: string; ahead?: number; behind?: number; files?: { path: string; status: string; staged: boolean }[]; error?: string }>(r),
    ),
  gitDiff: (cwd: string, filePath?: string, staged?: boolean) =>
    fetch(
      '/_cc/api/git/diff?cwd=' +
        encodeURIComponent(cwd) +
        (filePath ? '&path=' + encodeURIComponent(filePath) : '') +
        (staged ? '&staged=1' : ''),
    ).then((r) => j<{ ok: boolean; diff: string; error?: string }>(r)),
  gitLog: (cwd: string) =>
    fetch('/_cc/api/git/log?cwd=' + encodeURIComponent(cwd)).then((r) => j<{ ok: boolean; log: string }>(r)),
  gitCommit: (cwd: string, message: string, stageAll: boolean) =>
    fetch('/_cc/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, message, stageAll }),
    }).then((r) => j<{ ok: boolean; out: string }>(r)),
  fileTree: (cwd: string) =>
    fetch('/_cc/api/files/tree?cwd=' + encodeURIComponent(cwd)).then((r) => j<{ files: string[]; capped: boolean }>(r)),
  fileRead: (cwd: string, filePath: string) =>
    fetch(
      '/_cc/api/files/content?cwd=' + encodeURIComponent(cwd) + '&path=' + encodeURIComponent(filePath),
    ).then((r) => j<{ binary: boolean; size: number; content?: string; truncated?: boolean }>(r)),
  fileRawUrl: (cwd: string, filePath: string) =>
    '/_cc/api/files/raw?cwd=' + encodeURIComponent(cwd) + '&path=' + encodeURIComponent(filePath),
  fileDownloadUrl: (cwd: string, filePath: string) =>
    '/_cc/api/files/raw?cwd=' +
    encodeURIComponent(cwd) +
    '&path=' +
    encodeURIComponent(filePath) +
    '&download=1',
  fileWrite: (cwd: string, filePath: string, content: string) =>
    fetch('/_cc/api/files/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, path: filePath, content }),
    }).then((r) => j(r)),
  setPreview: (port: number) => fetch(`/p/${port}?redirect=0`).then((r) => j<{ ok: boolean }>(r)),
  vapid: () => fetch('/_cc/api/push/vapid').then((r) => j<{ key: string; subscriptions: number }>(r)),
  pushSubscribe: (subscription: PushSubscription) =>
    fetch('/_cc/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    }).then((r) => j(r)),
  pushUnsubscribe: (endpoint: string) =>
    fetch('/_cc/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).then((r) => j(r)),
  pushTest: () => fetch('/_cc/api/push/test', { method: 'POST' }).then((r) => j(r)),
};
