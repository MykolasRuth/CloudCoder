import { createRequire } from 'node:module';
import type { WebSocket } from 'ws';
import { CLAUDE_PATH } from '../config.js';

const require = createRequire(import.meta.url);

// node-pty is CJS native; load via require so the import style works under ESM,
// and so we can swap in @lydell/node-pty prebuilds if node-gyp fails on this box.
type PtyModule = {
  spawn: (file: string, args: string[], opts: any) => any;
};
function loadPty(): PtyModule {
  try {
    return require('node-pty');
  } catch (e: any) {
    try {
      return require('@lydell/node-pty');
    } catch {
      throw new Error('node-pty failed to load: ' + e.message);
    }
  }
}
const pty = loadPty();

const BUFFER_CAP = 1_000_000; // ~1MB of raw ANSI scrollback per session — ConPTY repaints the live screen on resize anyway
const BELL_DEBOUNCE_MS = 30_000;

export type TermProgram = 'claude' | 'shell';

// BEL terminates OSC sequences (e.g. window-title updates: ESC ] 0 ; ... BEL),
// which Claude Code emits constantly. Only a BEL *outside* an OSC sequence is
// a real attention ring worth a push notification. OSC sequences can be split
// across PTY data chunks, so the scanner carries its state between calls.
export class BellScanner {
  private inOsc = false;
  scan(d: string): boolean {
    let bell = false;
    for (let i = 0; i < d.length; i++) {
      const c = d.charCodeAt(i);
      if (!this.inOsc && c === 0x1b && d.charCodeAt(i + 1) === 0x5d /* ] */) {
        this.inOsc = true;
        i++;
      } else if (c === 0x07) {
        if (!this.inOsc) bell = true;
        this.inOsc = false;
      } else if (this.inOsc && c === 0x1b && d.charCodeAt(i + 1) === 0x5c /* \ */) {
        this.inOsc = false;
        i++;
      }
    }
    return bell;
  }
}

export class PtySession {
  readonly id: string;
  readonly cwd: string;
  readonly program: TermProgram;
  status: 'running' | 'exited' = 'running';
  exitCode: number | null = null;

  private proc: any;
  private chunks: string[] = [];
  private bytes = 0;
  private replayCache: string | null = null;
  private sockets = new Set<WebSocket>();
  private bellScanner = new BellScanner();
  private lastBellNotify = 0;
  private cols = 80;
  private rows = 24;

  private lastActivityMark = 0;

  constructor(
    id: string,
    cwd: string,
    program: TermProgram,
    private onEvent: (ev: 'bell' | 'exit' | 'activity', session: PtySession) => void,
  ) {
    this.id = id;
    this.cwd = cwd;
    this.program = program;
    const file = program === 'claude' ? CLAUDE_PATH : 'powershell.exe';
    const args = program === 'claude' ? [] : ['-NoLogo'];
    this.proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd,
      env: { ...process.env, CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' },
      useConpty: true,
    });
    this.proc.onData((d: string) => {
      this.push(d);
      const now = Date.now();
      if (now - this.lastActivityMark > 10_000) {
        this.lastActivityMark = now;
        this.onEvent('activity', this);
      }
      for (const ws of this.sockets) {
        try {
          ws.send(JSON.stringify({ t: 'out', d }));
        } catch {}
      }
      // scan every chunk (state must advance even while attached); only notify when detached
      const bell = this.bellScanner.scan(d);
      if (bell && this.sockets.size === 0) {
        const now = Date.now();
        if (now - this.lastBellNotify > BELL_DEBOUNCE_MS) {
          this.lastBellNotify = now;
          this.onEvent('bell', this);
        }
      }
    });
    this.proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.status = 'exited';
      this.exitCode = exitCode;
      for (const ws of this.sockets) {
        try {
          ws.send(JSON.stringify({ t: 'exit', code: exitCode }));
        } catch {}
      }
      this.onEvent('exit', this);
    });
  }

  private push(d: string) {
    this.chunks.push(d);
    this.bytes += d.length;
    this.replayCache = null;
    while (this.bytes > BUFFER_CAP && this.chunks.length > 1) {
      this.bytes -= this.chunks[0].length;
      this.chunks.shift();
    }
  }

  attach(ws: WebSocket) {
    this.sockets.add(ws);
    if (this.replayCache === null) this.replayCache = this.chunks.join('');
    try {
      ws.send(JSON.stringify({ t: 'replay', d: this.replayCache }));
      if (this.status === 'exited') ws.send(JSON.stringify({ t: 'exit', code: this.exitCode }));
    } catch {}
    ws.on('close', () => this.sockets.delete(ws));
  }

  get attached() {
    return this.sockets.size > 0;
  }

  write(d: string) {
    if (this.status === 'running') this.proc.write(d);
  }

  resize(cols: number, rows: number) {
    cols = Math.max(2, Math.min(500, Math.floor(cols)));
    rows = Math.max(2, Math.min(500, Math.floor(rows)));
    if (cols === this.cols && rows === this.rows) {
      // ConPTY repaints the visible screen on a real resize; nudge it so a
      // reattaching client gets a clean repaint even at identical dimensions.
      if (this.status === 'running') {
        try {
          this.proc.resize(cols, Math.max(2, rows - 1));
          this.proc.resize(cols, rows);
        } catch {}
      }
      return;
    }
    this.cols = cols;
    this.rows = rows;
    if (this.status === 'running') {
      try {
        this.proc.resize(cols, rows);
      } catch {}
    }
  }

  kill() {
    try {
      this.proc.kill();
    } catch {}
    this.status = 'exited';
    // tell attached clients explicitly — onExit may never fire for a killed ConPTY
    for (const ws of this.sockets) {
      try {
        ws.send(JSON.stringify({ t: 'exit', code: -1 }));
        ws.close();
      } catch {}
    }
    this.sockets.clear();
  }
}
