import fs from 'node:fs';
import path from 'node:path';

// Single source of truth for "is p inside root" — used by session cwd
// validation and file routes alike. Resolves symlinks (realpath) so a link
// inside the projects root can't point the check somewhere else, and
// compares case-insensitively (Windows and default-APFS macOS filesystems).
export function resolveWithin(root: string, p: string): string | null {
  let real: string;
  let realRoot: string;
  try {
    real = fs.realpathSync(path.resolve(p));
    realRoot = fs.realpathSync(path.resolve(root));
  } catch {
    return null;
  }
  const a = real.toLowerCase();
  const b = realRoot.toLowerCase();
  if (a !== b && !a.startsWith(b + path.sep)) return null;
  return real;
}
