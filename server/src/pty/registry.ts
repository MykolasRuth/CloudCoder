import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PtySession, TermProgram } from './ptySession.js';
import { createStore } from '../store.js';
import { DATA_DIR, PROJECTS_ROOT } from '../config.js';
import { sendPush } from '../notify.js';
import { resolveWithin } from '../paths.js';

export interface SessionMeta {
  id: string;
  kind: 'terminal' | 'chat';
  cwd: string;
  title: string;
  program?: TermProgram;
  permissionMode?: string;
  model?: string;
  goal?: string;
  claudeSessionId?: string;
  // set by /compact: an in-depth summary of the prior (now-reset) conversation,
  // injected into the next turn so a fresh Claude session keeps continuity
  pendingSummary?: string;
  createdAt: number;
  updatedAt?: number;
  status: 'running' | 'exited';
}

export const sessions = createStore<SessionMeta[]>(path.join(DATA_DIR, 'sessions.json'), []);

// PTYs don't survive a server restart — mark stale terminal sessions exited on boot.
for (const m of sessions.data) {
  if (m.kind === 'terminal') m.status = 'exited';
}
sessions.save();

const ptys = new Map<string, PtySession>();

export function getMeta(id: string): SessionMeta | undefined {
  return sessions.data.find((s) => s.id === id);
}

export function getPty(id: string): PtySession | undefined {
  return ptys.get(id);
}

export const PERMISSION_MODES = ['acceptEdits', 'bypassPermissions', 'plan', 'default'] as const;
export const DEFAULT_PERMISSION_MODE = 'acceptEdits';

// 'default' means "don't pass --model" (use the CLI/account default); the rest
// are exact Claude model IDs passed straight to `claude --model`.
export const MODELS = [
  'default',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-fable-5',
] as const;

export function validateCwd(cwd: string): string | null {
  const resolved = resolveWithin(PROJECTS_ROOT, cwd);
  if (!resolved) return null;
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

function onPtyEvent(ev: 'bell' | 'exit' | 'activity', pty: PtySession) {
  const meta = getMeta(pty.id);
  if (ev === 'activity') {
    if (meta) {
      meta.updatedAt = Date.now();
      sessions.save();
    }
    return;
  }
  const title = meta?.title || path.basename(pty.cwd);
  if (ev === 'exit') {
    if (meta) {
      meta.status = 'exited';
      sessions.save();
    }
    if (!pty.attached) {
      void sendPush({
        title: 'CloudCoder',
        body: `Session "${title}" exited`,
        data: { sessionId: pty.id },
      });
    }
  } else if (ev === 'bell') {
    void sendPush({
      title: 'Claude is waiting',
      body: `"${title}" needs your input`,
      data: { sessionId: pty.id },
    });
  }
}

export function createTerminalSession(cwd: string, program: TermProgram, title?: string): SessionMeta {
  const id = randomUUID();
  const meta: SessionMeta = {
    id,
    kind: 'terminal',
    cwd,
    title: title || path.basename(cwd),
    program,
    createdAt: Date.now(),
    status: 'running',
  };
  const pty = new PtySession(id, cwd, program, onPtyEvent);
  ptys.set(id, pty);
  sessions.data.push(meta);
  sessions.save();
  return meta;
}

export function killSession(id: string) {
  const pty = ptys.get(id);
  if (pty) {
    pty.kill();
    ptys.delete(id);
  }
  const i = sessions.data.findIndex((s) => s.id === id);
  if (i >= 0) {
    sessions.data.splice(i, 1);
    sessions.save();
  }
}

export function killAllPtys() {
  for (const pty of ptys.values()) pty.kill();
  ptys.clear();
}
