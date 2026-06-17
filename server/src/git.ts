import { execFile } from 'node:child_process';

export function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (e, stdout, stderr) =>
        resolve({ ok: !e, out: String(stdout || ''), err: String(stderr || (e ? e.message : '')) }),
    );
  });
}

export interface ChangedFile {
  path: string;
  add: number;
  del: number;
  status: 'modified' | 'new' | 'deleted';
}

// Snapshot of uncommitted work in a repo: tracked changes via numstat,
// untracked files counted as all-new. Returns [] for non-repos.
export async function workingTreeChanges(cwd: string): Promise<ChangedFile[]> {
  const status = await git(cwd, ['status', '--porcelain']);
  if (!status.ok) return [];
  const untracked: string[] = [];
  const deleted = new Set<string>();
  for (const line of status.out.split('\n')) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    const p = line.slice(3).trim();
    if (xy === '??') untracked.push(p);
    else if (xy.includes('D')) deleted.add(p);
  }
  const out: ChangedFile[] = [];
  const numstat = await git(cwd, ['diff', 'HEAD', '--numstat']);
  if (numstat.ok) {
    for (const line of numstat.out.split('\n')) {
      if (!line.trim()) continue;
      const [a, d, ...rest] = line.split('\t');
      const p = rest.join('\t');
      if (!p) continue;
      out.push({
        path: p,
        add: a === '-' ? 0 : Number(a),
        del: d === '-' ? 0 : Number(d),
        status: deleted.has(p) ? 'deleted' : 'modified',
      });
    }
  }
  // numstat doesn't cover untracked files — count their lines (capped, text only)
  const counted = await Promise.all(
    untracked.slice(0, 20).map(async (p) => {
      const n = await git(cwd, ['diff', '--no-index', '--numstat', '--', 'NUL', p]);
      const m = /^(\d+)\t/.exec(n.out);
      return { path: p, add: m ? Number(m[1]) : 0, del: 0, status: 'new' as const };
    }),
  );
  out.push(...counted);
  for (const p of untracked.slice(20)) out.push({ path: p, add: 0, del: 0, status: 'new' });
  return out.slice(0, 100);
}
