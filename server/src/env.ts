// Settings that shouldn't be public (PIN, allowed logins, push contact) live in .env at the
// repo root, which is gitignored. Copy .env.example to .env and fill it in. Variables already
// set in the environment (for example by a LaunchAgent) win over the file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src (dev via tsx) or server/dist (built) -> repo root
const envFile = path.resolve(here, '..', '..', '.env');

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    const [, key, raw] = match;
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
