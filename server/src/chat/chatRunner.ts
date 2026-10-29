import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { CLAUDE_PATH, DATA_DIR } from '../config.js';
import { mapLine, contextTokensFromLine, ChatEvent } from './streamJson.js';
import { getMeta, sessions, DEFAULT_PERMISSION_MODE, SessionMeta } from '../pty/registry.js';
import { sendPush } from '../notify.js';
import { workingTreeChanges } from '../git.js';

type SeqEvent = ChatEvent & { seq: number; ts: number };

// Events not worth persisting or replaying after the turn ends.
const EPHEMERAL = new Set(['text_delta', 'status']);

// iOS Safari's EventSource implementation breaks on very large SSE payloads
// (10KB+ single data: lines). Cap user-message text in SSE; full text still
// goes to Claude via stdin and is stored in the transcript.
const SSE_TEXT_LIMIT = 5000;

// Prompt used by /compact: ask the current session to write a thorough handoff
// summary of itself. This runs against the existing (large) session, so it must
// be run before the context gets so big the resume itself fails — the UI nudges
// the user to compact well before that point.
const COMPACT_PROMPT =
  'We are compacting this conversation to continue in a fresh, smaller context. ' +
  'Write an in-depth handoff summary so no important context is lost. Cover: ' +
  '(1) the overall goal and what this project/session is about; ' +
  '(2) key decisions, designs, and conventions established; ' +
  '(3) what has actually been done and verified so far; ' +
  '(4) the current state — what works, what is broken, what is in progress; ' +
  '(5) important file paths, commands, and gotchas worth remembering; ' +
  '(6) the concrete next steps. ' +
  'If a session-handoff markdown file exists in the repo, read it and fold it in. ' +
  'Write it as durable notes for your future self — be specific and complete, not brief. ' +
  'Do not make any code changes; only read what you need and produce the summary.';

function toSsePayload(se: SeqEvent): string {
  if (se.type === 'user' && typeof (se as any).text === 'string' && (se as any).text.length > SSE_TEXT_LIMIT) {
    const full = (se as any).text as string;
    const short = { ...se, text: full.slice(0, SSE_TEXT_LIMIT) + `\n\n[…${full.length - SSE_TEXT_LIMIT} more characters]` };
    return `data: ${JSON.stringify(short)}\n\n`;
  }
  // Summaries can be long; cap the *displayed* copy so iOS EventSource doesn't
  // choke on a huge single data: line. The full summary still seeds the next
  // turn server-side (meta.pendingSummary), so nothing is lost to the model.
  if (se.type === 'compact' && typeof (se as any).summary === 'string' && (se as any).summary.length > SSE_TEXT_LIMIT) {
    const full = (se as any).summary as string;
    const short = {
      ...se,
      summary: full.slice(0, SSE_TEXT_LIMIT) + `\n\n[…summary continues — full version carried into the next turn]`,
    };
    return `data: ${JSON.stringify(short)}\n\n`;
  }
  return `data: ${JSON.stringify(se)}\n\n`;
}

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
  try {
    fs.rmSync(path.join(DATA_DIR, 'chat', 'uploads', id), { recursive: true, force: true });
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
    const payload = toSsePayload(se);
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
      if (ev.seq > after) res.write(toSsePayload(ev));
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

  send(text: string, images: { path: string; url: string }[] = []): { ok: boolean; error?: string } {
    if (this.running) return { ok: false, error: 'a turn is already running' };
    const meta = getMeta(this.id);
    if (!meta) return { ok: false, error: 'no such session' };

    this.running = true;
    meta.updatedAt = Date.now();
    // first task names the thread (Codex-style) when the title is still the project default
    if (meta.title === path.basename(meta.cwd) && this.events.every((e) => e.type !== 'user')) {
      const trimmed = text.replace(/\s+/g, ' ').trim();
      meta.title = (trimmed || (images.length ? `${images.length} image${images.length > 1 ? 's' : ''}` : '')).slice(0, 48);
      sessions.save();
    }
    this.emit({ type: 'user', text, images: images.length ? images.map((i) => i.url) : undefined });
    this.emit({ type: 'status', running: true });

    // Claude Code reads images off disk: reference the saved paths in the prompt
    // and tell it to view them with the Read tool (which renders images).
    let prompt = text;
    if (images.length) {
      const paths = images.map((i) => i.path.replace(/\\/g, '/')).join('\n');
      const noun = images.length > 1 ? 'images' : 'an image';
      prompt =
        (text ? text + '\n\n' : '') +
        `[The user attached ${noun}. View ${images.length > 1 ? 'each one' : 'it'} with the Read tool before responding:\n${paths}]`;
    }
    // right after a /compact, seed the fresh Claude session with the summary of
    // everything that came before so continuity is preserved (used once)
    if (meta.pendingSummary) {
      prompt =
        `[This conversation was compacted to keep it fast. Below is an in-depth summary ` +
        `of everything so far — treat it as established context and continue from it:\n\n` +
        `${meta.pendingSummary}]\n\n${prompt}`;
      meta.pendingSummary = undefined;
      sessions.save();
    }
    // a persistent session goal (set via /goal) rides along on every turn
    if (meta.goal) {
      prompt = `[Ongoing goal for this session — keep it in mind: ${meta.goal}]\n\n${prompt}`;
    }

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      meta.permissionMode || DEFAULT_PERMISSION_MODE,
      // Each turn is a one-shot headless process with stdin closed, so the
      // interactive AskUserQuestion tool can't be answered — Claude Code would
      // silently auto-skip it. Disabling it makes Claude ask clarifying
      // questions as plain text instead; the turn ends and the user answers in
      // their next message (which resumes the session).
      '--disallowedTools',
      'AskUserQuestion',
    ];
    if (meta.model && meta.model !== 'default') args.push('--model', meta.model);
    if (meta.claudeSessionId) args.push('--resume', meta.claudeSessionId);

    const p = spawn(CLAUDE_PATH, args, { cwd: meta.cwd });
    this.child = p;
    let buf = '';
    let err = '';
    let turnResult: { ok: boolean; cost: number; turns: number } | null = null;

    let lastContextTokens = 0;
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ctx = contextTokensFromLine(line);
        if (ctx) lastContextTokens = ctx;
        for (const ev of mapLine(line)) {
          if (ev.type === 'init') {
            meta.claudeSessionId = ev.claudeSessionId;
            sessions.save();
          }
          if (ev.type === 'result') {
            turnResult = { ok: ev.ok, cost: ev.cost, turns: ev.turns };
            if (lastContextTokens) ev.contextTokens = lastContextTokens;
          }
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
    // For large prompts the pipe buffer fills up; wait for drain before
    // signalling EOF so the child sees the complete message.
    try {
      const endStdin = () => { try { p.stdin.end(); } catch {} };
      if (!p.stdin.write(prompt)) {
        p.stdin.once('drain', endStdin);
      } else {
        endStdin();
      }
    } catch {
      try { p.stdin.end(); } catch {}
    }
    return { ok: true };
  }

  stop() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
    }
  }

  // Reset the conversation (/clear): drop the transcript and start a fresh
  // claude session on the next turn, while keeping the session itself.
  clear(): { ok: boolean; error?: string } {
    if (this.running) return { ok: false, error: 'a turn is running' };
    this.events = [];
    try {
      this.transcript?.end();
    } catch {}
    this.transcript = null;
    try {
      fs.writeFileSync(this.transcriptPath, '');
    } catch {}
    const meta = getMeta(this.id);
    if (meta) {
      meta.claudeSessionId = undefined;
      sessions.save();
    }
    // bump seq past anything clients have seen, then tell them to reset
    const ev = { type: 'cleared', seq: ++this.seq, ts: Date.now() };
    const payload = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.listeners) {
      try {
        res.write(payload);
      } catch {}
    }
    return { ok: true };
  }

  private broadcast(ev: object) {
    const payload = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.listeners) {
      try {
        res.write(payload);
      } catch {}
    }
  }

  // /compact: ask the current (large) Claude session to write a thorough
  // handoff summary, then reset — the on-phone log is cleared to a single
  // summary card and the next turn starts a fresh Claude session seeded with
  // that summary. Fixes both the UI lag and the context-too-big hang, while
  // keeping the thread going. Kicks off async work and returns immediately;
  // progress and the result are delivered over SSE.
  compact(): { ok: boolean; error?: string } {
    if (this.running) return { ok: false, error: 'a turn is running' };
    const meta = getMeta(this.id);
    if (!meta) return { ok: false, error: 'no such session' };
    if (!meta.claudeSessionId) return { ok: false, error: 'nothing to compact yet' };
    this.running = true;
    this.emit({ type: 'status', running: true });
    void this.runCompact(meta, meta.claudeSessionId);
    return { ok: true };
  }

  private async runCompact(meta: SessionMeta, prevSession: string) {
    let summary = '';
    try {
      summary = await this.summarizeSession(meta, prevSession);
    } catch (e: any) {
      this.running = false;
      this.emit({ type: 'error', message: 'Compact failed: ' + (e?.message || String(e)) });
      this.emit({ type: 'status', running: false });
      return;
    }

    // archive the old transcript (recoverable) and start a fresh, tiny one
    try {
      this.transcript?.end();
    } catch {}
    this.transcript = null;
    try {
      if (fs.existsSync(this.transcriptPath)) {
        fs.renameSync(this.transcriptPath, this.transcriptPath.replace(/\.jsonl$/, `.pre-compact-${Date.now()}.jsonl`));
      }
    } catch {}
    this.events = [];

    // fresh Claude session next turn, seeded with the summary
    meta.claudeSessionId = undefined;
    meta.pendingSummary = summary;
    sessions.save();

    // tell clients to wipe their view, then hand them the summary card
    this.broadcast({ type: 'cleared', seq: ++this.seq, ts: Date.now() });
    this.running = false;
    this.emit({ type: 'compact', summary });
    this.emit({ type: 'status', running: false });
  }

  // One-shot resume of the existing session to produce the handoff summary.
  private summarizeSession(meta: SessionMeta, prevSession: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--permission-mode',
        meta.permissionMode || DEFAULT_PERMISSION_MODE,
        '--disallowedTools',
        'AskUserQuestion',
        '--resume',
        prevSession,
      ];
      if (meta.model && meta.model !== 'default') args.push('--model', meta.model);

      const p = spawn(CLAUDE_PATH, args, { cwd: meta.cwd });
      this.child = p;
      let buf = '';
      let err = '';
      let acc = '';
      let resultText = '';
      const timer = setTimeout(() => {
        try {
          p.kill();
        } catch {}
      }, 300000); // 5 min hard cap

      p.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          for (const ev of mapLine(line)) {
            // stream the summary as it's written so the user sees progress
            if (ev.type === 'text_delta') this.emit(ev);
            else if (ev.type === 'assistant_text') acc += (acc ? '\n\n' : '') + ev.text;
            else if (ev.type === 'result') resultText = ev.text;
          }
        }
      });
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', (e) => {
        clearTimeout(timer);
        this.child = null;
        reject(e);
      });
      p.on('close', () => {
        clearTimeout(timer);
        this.child = null;
        const text = (resultText || acc).trim();
        if (text) resolve(text);
        else reject(new Error(err.slice(0, 300) || 'no summary produced'));
      });

      p.stdin.on('error', () => {});
      try {
        const endStdin = () => {
          try {
            p.stdin.end();
          } catch {}
        };
        if (!p.stdin.write(COMPACT_PROMPT)) p.stdin.once('drain', endStdin);
        else endStdin();
      } catch {
        try {
          p.stdin.end();
        } catch {}
      }
    });
  }
}
