import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { validateCwd } from '../pty/registry.js';
import { resolveWithin } from '../paths.js';

export const filesRouter = Router();

// AgentHub walker pattern: skip heavy dirs, cap listing, sniff binaries, cap text size.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next',
  'coverage', '.cache', 'vendor', '__pycache__', '.venv', 'venv',
]);
const TEXT_CAP = 256 * 1024;
const FILE_LIMIT = 1000;

function walkFiles(dir: string, base = dir, out: string[] = []): string[] {
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (out.length >= FILE_LIMIT) break;
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else if (e.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function safeJoin(cwd: string, rel: string): string | null {
  return resolveWithin(cwd, path.resolve(cwd, rel));
}

filesRouter.get('/files/tree', (req, res) => {
  const cwd = validateCwd(String(req.query.cwd || ''));
  if (!cwd) {
    res.status(400).json({ error: 'invalid cwd' });
    return;
  }
  const files = walkFiles(cwd);
  res.json({ files, capped: files.length >= FILE_LIMIT });
});

filesRouter.get('/files/content', (req, res) => {
  const cwd = validateCwd(String(req.query.cwd || ''));
  const rel = String(req.query.path || '');
  const full = cwd && rel ? safeJoin(cwd, rel) : null;
  if (!full) {
    res.status(400).json({ error: 'invalid path' });
    return;
  }
  let buf: Buffer;
  try {
    buf = fs.readFileSync(full);
  } catch {
    res.status(404).json({ error: 'cannot read file' });
    return;
  }
  const head = buf.subarray(0, Math.min(buf.length, 8000));
  if (head.includes(0)) {
    res.json({ binary: true, size: buf.length });
    return;
  }
  let content = buf.toString('utf8');
  let truncated = false;
  if (content.length > TEXT_CAP) {
    content = content.slice(0, TEXT_CAP);
    truncated = true;
  }
  res.json({ binary: false, size: buf.length, content, truncated });
});

// Raw bytes for inline previews (images, and PDFs the user clicks to view).
// Restricted to known media types within the project (resolveWithin enforces
// the boundary). Served inline so the browser renders rather than downloads.
const PREVIEW_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

filesRouter.get('/files/raw', (req, res) => {
  const cwd = validateCwd(String(req.query.cwd || ''));
  const rel = String(req.query.path || '');
  const full = cwd && rel ? safeJoin(cwd, rel) : null;
  if (!full) {
    res.status(400).json({ error: 'invalid path' });
    return;
  }
  const mime = PREVIEW_MIME[path.extname(full).toLowerCase()];
  if (!mime) {
    res.status(415).json({ error: 'not previewable' });
    return;
  }
  if (!fs.existsSync(full)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.type(mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=300');
  fs.createReadStream(full).pipe(res);
});

filesRouter.put('/files/content', (req, res) => {
  const cwd = validateCwd(String(req.body?.cwd || ''));
  const rel = String(req.body?.path || '');
  // resolveWithin realpaths the target, so for a NEW file validate the parent dir instead
  let full = cwd && rel ? safeJoin(cwd, rel) : null;
  if (!full && cwd && rel) {
    const parent = resolveWithin(cwd, path.dirname(path.resolve(cwd, rel)));
    if (parent) full = path.join(parent, path.basename(rel));
  }
  if (!full || typeof req.body?.content !== 'string') {
    res.status(400).json({ error: 'invalid path or content' });
    return;
  }
  try {
    fs.writeFileSync(full, req.body.content, 'utf8');
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
