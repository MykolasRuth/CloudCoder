import { Router } from 'express';
import { validateCwd } from '../pty/registry.js';
import { git } from '../git.js';

export const gitRouter = Router();

function cwdOr400(req: any, res: any): string | null {
  const valid = validateCwd(String(req.query.cwd || req.body?.cwd || ''));
  if (!valid) {
    res.status(400).json({ error: 'invalid cwd' });
    return null;
  }
  return valid;
}

gitRouter.get('/git/status', async (req, res) => {
  const cwd = cwdOr400(req, res);
  if (!cwd) return;
  const r = await git(cwd, ['status', '--porcelain=v2', '-b']);
  if (!r.ok) {
    res.json({ isRepo: false, error: r.err.slice(0, 200) });
    return;
  }
  let branch = '';
  let ahead = 0;
  let behind = 0;
  const files: { path: string; status: string; staged: boolean }[] = [];
  for (const line of r.out.split('\n')) {
    if (line.startsWith('# branch.head')) branch = line.split(' ')[2] || '';
    else if (line.startsWith('# branch.ab')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const p = line.startsWith('2 ') ? line.split('\t')[0].split(' ').slice(9).join(' ') : parts.slice(8).join(' ');
      files.push({ path: p, status: xy, staged: xy[0] !== '.' });
    } else if (line.startsWith('? ')) {
      files.push({ path: line.slice(2), status: '??', staged: false });
    }
  }
  res.json({ isRepo: true, branch, ahead, behind, files });
});

gitRouter.get('/git/diff', async (req, res) => {
  const cwd = cwdOr400(req, res);
  if (!cwd) return;
  const args = ['diff'];
  if (req.query.staged === '1') args.push('--cached');
  if (req.query.path) args.push('--', String(req.query.path));
  const r = await git(cwd, args);
  // untracked files have no diff — synthesize one so the UI can show content.
  // Only for genuinely untracked paths: a fully-staged tracked file also has an
  // empty unstaged diff, and must show its staged hunks instead.
  if (r.ok && !r.out.trim() && req.query.path && req.query.staged !== '1') {
    const st = await git(cwd, ['status', '--porcelain', '--', String(req.query.path)]);
    if (st.ok && st.out.startsWith('??')) {
      const nf = await git(cwd, ['diff', '--no-index', '--', 'NUL', String(req.query.path)]);
      res.json({ ok: true, diff: nf.out });
      return;
    }
    const staged = await git(cwd, ['diff', '--cached', '--', String(req.query.path)]);
    res.json({ ok: staged.ok, diff: staged.out });
    return;
  }
  res.json({ ok: r.ok, diff: r.out, error: r.ok ? undefined : r.err.slice(0, 200) });
});

gitRouter.get('/git/log', async (req, res) => {
  const cwd = cwdOr400(req, res);
  if (!cwd) return;
  const r = await git(cwd, ['log', '--oneline', '-20']);
  res.json({ ok: r.ok, log: r.out, error: r.ok ? undefined : r.err.slice(0, 200) });
});

gitRouter.post('/git/commit', async (req, res) => {
  const cwd = cwdOr400(req, res);
  if (!cwd) return;
  const message = String(req.body?.message || '').trim();
  if (!message) {
    res.status(400).json({ error: 'commit message required' });
    return;
  }
  if (req.body?.stageAll) {
    const add = await git(cwd, ['add', '-A']);
    if (!add.ok) {
      res.status(500).json({ error: 'git add failed: ' + add.err.slice(0, 200) });
      return;
    }
  }
  const r = await git(cwd, ['commit', '-m', message]);
  res.json({ ok: r.ok, out: (r.out + r.err).slice(0, 500) });
});
