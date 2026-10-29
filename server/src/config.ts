import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.CLOUDCODER_PORT || 4060);
// Loopback only by default: `tailscale serve` is the way in (see
// scripts/tailscale-serve.md). CLOUDCODER_HOST=0.0.0.0 opens it to the LAN.
export const HOST = process.env.CLOUDCODER_HOST || '127.0.0.1';

// Resolve the Claude Code binary for this machine. Env var wins; otherwise
// try the usual install locations for the current platform, then fall back
// to whatever `claude` on PATH resolves to at spawn time.
function defaultClaudePath(): string {
  if (process.env.CLOUDCODER_CLAUDE) return process.env.CLOUDCODER_CLAUDE;
  const home = os.homedir();
  const candidates =
    process.platform === 'win32'
      ? [path.join(home, '.local', 'bin', 'claude.exe')]
      : [
          path.join(home, '.local', 'bin', 'claude'),
          '/opt/homebrew/bin/claude',
          '/usr/local/bin/claude',
        ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {}
  }
  return 'claude'; // hope PATH has it
}

export const CLAUDE_PATH = defaultClaudePath();
export const PROJECTS_ROOT =
  process.env.CLOUDCODER_PROJECTS || path.join(os.homedir(), 'Projects');
export const PIN = process.env.CLOUDCODER_PIN || '';
// Tailscale logins (comma-separated, e.g. you@github) allowed in through
// `tailscale serve`. Unset = no identity check.
export const ALLOWED_LOGINS = (process.env.CLOUDCODER_ALLOWED_LOGINS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// server/src -> server/data (dev via tsx) or server/dist -> server/data (built)
export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'chat'), { recursive: true });
