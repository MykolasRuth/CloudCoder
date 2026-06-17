import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { CLAUDE_PATH, DATA_DIR } from '../config.js';
import { mapLine, ChatEvent } from './streamJson.js';
import { getMeta, sessions, DEFAULT_PERMISSION_MODE } from '../pty/registry.js';
import { sendPush } from '../notify.js';
import { workingTreeChanges } from '../git.js';

type SeqEvent = ChatEvent & { seq: number; ts: number };

// Events not worth persisting or replaying after the turn ends.
const EPHEMERAL = new Set(['text_delta', 'status']);

const chats = new Map<string, ChatSession>();

export function getChat(id: string): ChatSession | undefined {
  const meta = getMeta(id);
  if (!meta || meta.kind !== 'chat') return undefined;
  let c = chats.get(id);
  if (!c) {
    c = new ChatSession(id);
    chats.set(id, c);
  }
  return c;
}

export function dropChat(id: string) {
  const c = chats.get(id);
  if (c) {
    c.dropped = true; // emit() no-ops from here on — the dying child's close handler must not resurrect the transcript
    c.stop();
  }
  chats.delete(id);
  try {
    fs.unlinkSync(path.join(DATA_DIR, 'chat', id + '.jsonl'));
  } catch {}
}

export function stopAllChats() {
  for (const c of chats.values()) c.stop();
}

export class ChatSession {
  readonly id: string;
  running = false;
  dropped = false;
  private events: SeqEvent[] = [];
  private seq = 0;
  private listeners = new Set<Response>();
  private child: ChildProcess | null = null;
  private transcriptPath: string;

  constructor(id: string) {
    this.id = id;
    this.transcriptPath = path.join(DATA_DIR, 'chat', id + '.jsonl');
    let loaded = false;
    try {
      const lines = fs.readFileSync(this.transcriptPath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as SeqEvent;
          this.events.push(ev);
          this.seq = Math.max(this.seq, ev.seq);
          loaded = true;
        } catch {}
      }
    } catch {}
    // ephemeral deltas consumed seqs that were never persisted — jump well past
    // them so a reconnecting client's seq-dedup can't swallow new events
    if (loaded) this.seq += 100_000;
  }

  private transcript: fs.WriteStream | null = null;

  private emit(ev: ChatEvent) {
    if (this.dropped) return;
    const se: SeqEvent = { ...ev, seq: ++this.seq, ts: Date.now() };
    this.events.push(se);
    if (!EPHEMERAL.has(ev.type)) {
      try {
        if (!this.transcript) {
          this.transcript = fs.createWriteStream(this.transcriptPath, { flags: 'a' });
          this.transcript.on('error', () => {});
        }
        this.transcript.write(JSON.stringify(se) + '\n');
      } catch {}
    }
    const payload = `data: ${JSON.stringify(se)}\n\n`;
    for (const res of this.listeners) {
      try {
        res.write(payload);
      } catch {}
    }
  }

  // deltas are only needed while their turn is streaming; finalized
  // assistant_text supersedes them, so purge them when the turn ends —
  // durable events stay in memory and seq-based replay never has gaps
  private purgeDeltas() {
    this.events = this.events.filter((e) => !EPHEMERAL.has(e.type));
  }

  attach(res: Response, after: number) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    for (const ev of this.events) {
      if (ev.seq > after) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'status', running: this.running, seq: this.seq, ts: Date.now() })}\n\n`);
    this.listeners.add(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 25000);
    res.on('close', () => {
      clearInterval(ping);
      this.listeners.delete(res);
    });
  }

  send(text: string): { ok: boolean; error?: string } {
    if (this.running) return { ok: false, error: 'a turn is already running' };
    const meta = getMeta(this.id);
    if (!meta) return { ok: false, error: 'no such session' };

    this.running = true;
    meta.updatedAt = Date.now();
    // first task names the thread (Codex-style) when the title is still the project default
    if (meta.title === path.basename(meta.cwd) && this.events.every((e) => e.type !== 'user')) {
      meta.title = text.replace(/\s+/g, ' ').trim().slice(0, 48);
      sessions.save();
    }
    this.emit({ type: 'user', text });
    this.emit({ type: 'status', running: true });

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      meta.permissionMode || DEFAULT_PERMISSION_MODE,
    ];
    if (meta.claudeSessionId) args.push('--resume', meta.claudeSessionId);

    const p = spawn(CLAUDE_PATH, args, { cwd: meta.cwd });
    this.child = p;
    let buf = '';
    let err = '';
    let turnResult: { ok: boolean; cost: number; turns: number } | null = null;

    p.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        for (const ev of mapLine(line)) {
          if (ev.type === 'init') {
            meta.claudeSessionId = ev.claudeSessionId;
            sessions.save();
          }
          if (ev.type === 'result') turnResult = { ok: ev.ok, cost: ev.cost, turns: ev.turns };
          this.emit(ev);
        }
      }
    });
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', (e) => {
      this.emit({ type: 'error', message: 'failed to start claude: ' + e.message });
    });
    p.on('close', async () => {
      this.child = null;
      this.running = false;
      if (!turnResult) {
        this.emit({
          type: 'error',
          message: err ? 'claude error: ' + err.slice(0, 300) : 'claude exited without a result',
        });
      }
      // Codex-style end-of-turn summary: what's uncommitted in the repo now
      try {
        const files = await workingTreeChanges(meta.cwd);
        this.emit({ type: 'changes', files });
      } catch {}
      this.emit({ type: 'status', running: false });
      this.purgeDeltas();
      if (this.listeners.size === 0 && !this.dropped) {
        const title = meta.title || path.basename(meta.cwd);
        void sendPush({
          title: (turnResult ? 'Task finished — ' : 'Task stopped — ') + title,
          body: turnResult
            ? `$${(turnResult.cost || 0).toFixed(2)} · ${turnResult.turns} turns` +
              (turnResult.ok ? '' : ' · failed')
            : 'Claude exited without finishing',
          data: { sessionId: this.id },
        });
      }
    });
    // a failed spawn (ENOENT etc.) destroys the stdin pipe asynchronously —
    // without an error listener that's an uncaughtException taking the server down
    p.stdin.on('error', () => {});
    try {
      p.stdin.write(text);
      p.stdin.end();
    } catch {}
    return { ok: true };
  }

  stop() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
    }
  }
}
