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
  claudeSessionId?: string;
  createdAt: number;
  updatedAt?: number;
  status: 'running' | 'exited';
  busy?: boolean;
  attached?: boolean;
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
  chatSend: (id: string, text: string) =>
    fetch(`/_cc/api/chat/${id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then((r) => j(r)),
  chatStop: (id: string) => fetch(`/_cc/api/chat/${id}/stop`, { method: 'POST' }).then((r) => j(r)),
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
