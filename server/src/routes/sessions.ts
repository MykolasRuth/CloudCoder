import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PROJECTS_ROOT } from '../config.js';
import {
  sessions,
  getMeta,
  getPty,
  createTerminalSession,
  killSession,
  validateCwd,
  SessionMeta,
  PERMISSION_MODES,
  DEFAULT_PERMISSION_MODE,
} from '../pty/registry.js';
import { getChat, dropChat } from '../chat/chatRunner.js';
import { git } from '../git.js';

export const sessionsRouter = Router();

// per-project git metadata is a handful of subprocess calls — cache briefly
let projectsCache: { t: number; body: any } | null = null;

sessionsRouter.get('/projects', async (_req, res) => {
  if (projectsCache && Date.now() - projectsCache.t < 15_000) {
    res.json(projectsCache.body);
    return;
  }
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      // _scratch holds projectless sessions; underscore/dot dirs are infrastructure
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {}
  const projects = await Promise.all(
    dirs.map(async (name) => {
      const cwd = path.join(PROJECTS_ROOT, name);
      const [branch, status] = await Promise.all([
        git(cwd, ['branch', '--show-current']), // works even on an unborn branch (repo with no commits)
        git(cwd, ['status', '--porcelain']),
      ]);
      const mine = sessions.data.filter((s) => s.cwd.toLowerCase() === cwd.toLowerCase());
      return {
        name,
        branch: branch.ok ? branch.out.trim() : null,
        dirty: status.ok ? status.out.split('\n').filter((l) => l.trim()).length : 0,
        sessions: mine.length,
        lastActiveAt: mine.reduce((m, s) => Math.max(m, s.updatedAt || s.createdAt), 0) || null,
      };
    }),
  );
  const body = { root: PROJECTS_ROOT, projects };
  projectsCache = { t: Date.now(), body };
  res.json(body);
});

function publicMeta(m: SessionMeta) {
  const pty = m.kind === 'terminal' ? getPty(m.id) : undefined;
  const chat = m.kind === 'chat' ? getChat(m.id) : undefined;
  return {
    ...m,
    status: m.kind === 'terminal' ? (pty?.status ?? 'exited') : 'running',
    busy: chat ? chat.running : undefined,
    attached: pty ? pty.attached : undefined,
  };
}

sessionsRouter.get('/sessions', (_req, res) => {
  res.json(sessions.data.map(publicMeta));
});

const SCRATCH_DIR = path.join(PROJECTS_ROOT, '_scratch');

sessionsRouter.post('/sessions', (req, res) => {
  const { kind, cwd, title, program, permissionMode, newProject, scratch } = req.body || {};

  // three targets: an existing project, a brand-new project folder, or a
  // projectless scratch workspace under _scratch/<slug>
  let valid: string | null = null;
  if (scratch) {
    const slug = Math.random().toString(36).slice(2, 8);
    try {
      fs.mkdirSync(path.join(SCRATCH_DIR, slug), { recursive: true });
    } catch {}
    valid = validateCwd(path.join(SCRATCH_DIR, slug));
  } else if (typeof newProject === 'string' && newProject.trim()) {
    const name = newProject.trim().replace(/[^\w.-]+/g, '-').replace(/^[-_.]+/, '').slice(0, 50);
    if (!name) {
      res.status(400).json({ error: 'invalid project name' });
      return;
    }
    try {
      fs.mkdirSync(path.join(PROJECTS_ROOT, name), { recursive: true });
    } catch {}
    valid = validateCwd(path.join(PROJECTS_ROOT, name));
    projectsCache = null; // new project should appear immediately
  } else {
    valid = validateCwd(String(cwd || ''));
  }
  if (!valid) {
    res.status(400).json({ error: 'cwd must be a directory under ' + PROJECTS_ROOT });
    return;
  }
  if (kind === 'terminal') {
    const prog = program === 'shell' ? 'shell' : 'claude';
    try {
      const meta = createTerminalSession(valid, prog, title || (scratch ? 'Scratch terminal' : undefined));
      res.json(publicMeta(meta));
    } catch (e: any) {
      res.status(500).json({ error: 'failed to spawn: ' + e.message });
    }
  } else if (kind === 'chat') {
    const meta: SessionMeta = {
      id: randomUUID(),
      kind: 'chat',
      cwd: valid,
      title: title || path.basename(valid),
      permissionMode: (PERMISSION_MODES as readonly string[]).includes(permissionMode)
        ? permissionMode
        : DEFAULT_PERMISSION_MODE,
      createdAt: Date.now(),
      status: 'running',
    };
    sessions.data.push(meta);
    sessions.save();
    res.json(publicMeta(meta));
  } else {
    res.status(400).json({ error: 'kind must be terminal or chat' });
  }
});

sessionsRouter.patch('/sessions/:id', (req, res) => {
  const meta = getMeta(req.params.id);
  if (!meta) {
    res.status(404).json({ error: 'no such session' });
    return;
  }
  if (typeof req.body?.title === 'string' && req.body.title.trim()) {
    meta.title = req.body.title.trim().slice(0, 60);
  }
  if (
    meta.kind === 'chat' &&
    (PERMISSION_MODES as readonly string[]).includes(req.body?.permissionMode)
  ) {
    meta.permissionMode = req.body.permissionMode;
  }
  sessions.save();
  res.json(publicMeta(meta));
});

sessionsRouter.delete('/sessions/:id', (req, res) => {
  const meta = getMeta(req.params.id);
  if (!meta) {
    res.status(404).json({ error: 'no such session' });
    return;
  }
  if (meta.kind === 'chat') dropChat(meta.id);
  killSession(meta.id);
  // a scratch workspace belongs to its session — remove it when the last
  // session using it is deleted
  const scratchPrefix = SCRATCH_DIR.toLowerCase() + path.sep;
  if (
    meta.cwd.toLowerCase().startsWith(scratchPrefix) &&
    !sessions.data.some((s) => s.cwd.toLowerCase() === meta.cwd.toLowerCase())
  ) {
    // the killed process may still hold the cwd for a moment (Windows EBUSY) —
    // retry the removal a few times in the background
    const tryRm = (attempt: number) => {
      try {
        fs.rmSync(meta.cwd, { recursive: true, force: true });
      } catch {
        if (attempt < 4) setTimeout(() => tryRm(attempt + 1), 3000);
      }
    };
    setTimeout(() => tryRm(0), 1500);
  }
  res.json({ ok: true });
});
