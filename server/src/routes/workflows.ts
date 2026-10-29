import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Surfaces Claude Code workflow runs — the same data the `/workflows` command
// shows. Claude writes one run-state file per run to
//   ~/.claude/projects/<encoded-cwd>/<sessionId>/workflows/wf_*.json
// with live-updated status, phases, progress, logs, and result.

export const workflowsRouter = Router();

const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const MAX_RUNS = 80;

// The project dir name is the cwd with path separators replaced by '-'
// (e.g. C--Users-devserver-Projects-Sports-Better). Recover a readable name.
function projectFromDir(dirName: string): string {
  const idx = dirName.indexOf('-Projects-');
  if (idx >= 0) return dirName.slice(idx + '-Projects-'.length);
  return dirName;
}

interface RunFile {
  file: string;
  dir: string;
  session: string;
  mtime: number;
}

function collectRunFiles(): RunFile[] {
  const out: RunFile[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(CLAUDE_PROJECTS, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const pe of projects) {
    if (!pe.isDirectory()) continue;
    const projDir = path.join(CLAUDE_PROJECTS, pe.name);
    let sessionDirs: fs.Dirent[];
    try {
      sessionDirs = fs.readdirSync(projDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const se of sessionDirs) {
      if (!se.isDirectory()) continue;
      const wfDir = path.join(projDir, se.name, 'workflows');
      let files: fs.Dirent[];
      try {
        files = fs.readdirSync(wfDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.startsWith('wf_') || !f.name.endsWith('.json')) continue;
        const full = path.join(wfDir, f.name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {}
        out.push({ file: full, dir: pe.name, session: se.name, mtime });
      }
    }
  }
  return out;
}

function summarizeRun(j: any, rf: RunFile) {
  const progress = Array.isArray(j.workflowProgress) ? j.workflowProgress : [];
  const phaseEvents = progress.filter((p: any) => p && p.type === 'workflow_phase');
  const current = phaseEvents.length ? phaseEvents[phaseEvents.length - 1] : null;
  const hasError = j.result && typeof j.result === 'object' && 'error' in j.result;
  return {
    runId: j.runId || path.basename(rf.file, '.json'),
    name: j.workflowName || j.runId || 'workflow',
    status: j.status || 'unknown',
    project: projectFromDir(rf.dir),
    startTime: j.startTime || (j.timestamp ? Date.parse(j.timestamp) : 0) || rf.mtime,
    updatedAt: rf.mtime,
    durationMs: j.durationMs || 0,
    agentCount: j.agentCount || 0,
    totalTokens: j.totalTokens || 0,
    totalToolCalls: j.totalToolCalls || 0,
    phaseCount: Array.isArray(j.phases) ? j.phases.length : 0,
    currentPhase: current ? { index: current.index, title: current.title } : null,
    summary: typeof j.summary === 'string' ? j.summary : '',
    hasError: !!hasError,
  };
}

workflowsRouter.get('/workflows', (_req, res) => {
  const files = collectRunFiles()
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_RUNS);
  const runs = [];
  for (const rf of files) {
    try {
      const j = JSON.parse(fs.readFileSync(rf.file, 'utf8'));
      runs.push(summarizeRun(j, rf));
    } catch {}
  }
  res.json({ runs });
});

workflowsRouter.get('/workflows/:runId', (req, res) => {
  const runId = req.params.runId;
  if (!/^wf_[\w-]+$/.test(runId)) {
    res.status(400).json({ error: 'bad runId' });
    return;
  }
  const match = collectRunFiles().find((f) => path.basename(f.file) === runId + '.json');
  if (!match) {
    res.status(404).json({ error: 'no such workflow' });
    return;
  }
  let j: any;
  try {
    j = JSON.parse(fs.readFileSync(match.file, 'utf8'));
  } catch {
    res.status(500).json({ error: 'unreadable workflow file' });
    return;
  }
  let result = '';
  try {
    result = j.result != null ? JSON.stringify(j.result, null, 2) : '';
  } catch {}
  res.json({
    ...summarizeRun(j, match),
    defaultModel: j.defaultModel || '',
    phases: Array.isArray(j.phases) ? j.phases : [],
    progress: Array.isArray(j.workflowProgress) ? j.workflowProgress : [],
    logs: Array.isArray(j.logs) ? j.logs.map((l: any) => String(l)) : [],
    result,
    scriptPath: j.scriptPath || '',
    script: typeof j.script === 'string' ? j.script.slice(0, 8000) : '',
  });
});
