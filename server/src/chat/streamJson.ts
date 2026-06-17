// Maps claude CLI stream-json NDJSON lines to UI-facing chat events.
// Shapes verified against claude.exe 2.1.172 and AgentHub's proven parser.

import type { ChangedFile } from '../git.js';

export type ChatEvent =
  | { type: 'user'; text: string; images?: string[] }
  | { type: 'changes'; files: ChangedFile[] }
  | { type: 'init'; claudeSessionId: string; model: string }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_start'; toolId: string; name: string; label: string; input: string }
  | { type: 'tool_done'; toolId: string; output: string; isError: boolean }
  | { type: 'result'; ok: boolean; cost: number; turns: number; durationMs: number; text: string }
  | { type: 'status'; running: boolean }
  | { type: 'error'; message: string };

const INPUT_CAP = 8000;
const OUTPUT_CAP = 2000;

// Ported from AgentHub server.js describeTool() — short human label per tool_use.
export function describeTool(name: string, input: any): string {
  const i = input || {};
  const base = (f: any) => String(f || '').split(/[\\/]/).pop() || '';
  if (name === 'Write') return 'writing ' + base(i.file_path);
  if (name === 'Edit' || name === 'MultiEdit') return 'editing ' + base(i.file_path);
  if (name === 'Read') return 'reading ' + base(i.file_path);
  if (name === 'NotebookEdit') return 'editing ' + base(i.notebook_path);
  if (name === 'Bash' || name === 'PowerShell')
    return '$ ' + String(i.command || '').replace(/\s+/g, ' ').slice(0, 70);
  if (name === 'Glob' || name === 'Grep') return 'searching ' + (i.pattern || i.query || '');
  if (/web|fetch/i.test(name)) return 'fetching ' + String(i.url || i.query || '').slice(0, 50);
  if (name === 'TodoWrite' || name === 'TaskCreate' || name === 'TaskUpdate') return 'updating plan';
  if (name === 'Task' || name === 'Agent') return 'sub-agent: ' + String(i.description || '').slice(0, 50);
  return name;
}

function extractResultText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((c: any) => (c && c.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  return '';
}

// One NDJSON line -> zero or more chat events.
export function mapLine(line: string): ChatEvent[] {
  let j: any;
  try {
    j = JSON.parse(line);
  } catch {
    return [];
  }
  const out: ChatEvent[] = [];

  if (j.type === 'system' && j.subtype === 'init') {
    out.push({ type: 'init', claudeSessionId: j.session_id, model: j.model || '' });
  } else if (j.type === 'stream_event') {
    const ev = j.event || {};
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      out.push({ type: 'text_delta', text: ev.delta.text });
    }
  } else if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
    for (const c of j.message.content) {
      if (c.type === 'text' && c.text && c.text.trim()) {
        out.push({ type: 'assistant_text', text: c.text });
      } else if (c.type === 'tool_use') {
        let input = '';
        try {
          input = JSON.stringify(c.input, null, 2);
        } catch {}
        if (input.length > INPUT_CAP) input = input.slice(0, INPUT_CAP) + '\n…truncated';
        out.push({
          type: 'tool_start',
          toolId: c.id,
          name: c.name,
          label: describeTool(c.name, c.input),
          input,
        });
      }
    }
  } else if (j.type === 'user' && j.message && Array.isArray(j.message.content)) {
    for (const c of j.message.content) {
      if (c.type === 'tool_result') {
        let output = extractResultText(c.content);
        if (output.length > OUTPUT_CAP) output = output.slice(0, OUTPUT_CAP) + '\n…truncated';
        out.push({ type: 'tool_done', toolId: c.tool_use_id, output, isError: !!c.is_error });
      }
    }
  } else if (j.type === 'result') {
    out.push({
      type: 'result',
      ok: !j.is_error,
      cost: j.total_cost_usd || j.cost_usd || 0,
      turns: j.num_turns || 0,
      durationMs: j.duration_ms || 0,
      text: j.result != null ? String(j.result) : '',
    });
  }
  return out;
}
