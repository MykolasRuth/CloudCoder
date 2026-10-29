import { spawn } from 'node:child_process';
import os from 'node:os';
import { CLAUDE_PATH } from '../config.js';

// Turn a full assistant reply into a short spoken-word update for text-to-speech.
// Uses a fast Haiku one-shot through the same CLI the chat runner uses (so it
// shares the machine's existing auth). Runs in a neutral cwd — we don't want it
// loading the project's CLAUDE.md/skills/MCP, which would add latency and cost
// for what is just a one-line summary.

const MAX_INPUT = 8000; // long replies are truncated — the gist is up top anyway

const INSTRUCTIONS =
  "You convert an AI coding assistant's reply into a brief spoken update for text-to-speech. " +
  'Respond with 1 to 2 plain sentences, at most about 40 words. ' +
  'No markdown, no code, no file paths, no lists — just natural conversational speech. ' +
  'Say what was done or the single most important point. ' +
  'If the reply asks the user a question, include that question at the end. ' +
  'If there is nothing meaningful to say aloud, reply with just: Done.';

export function summarizeForSpeech(reply: string): Promise<string> {
  const text = reply.length > MAX_INPUT ? reply.slice(0, MAX_INPUT) : reply;
  const prompt = `${INSTRUCTIONS}\n\nReply to summarize:\n<<<\n${text}\n>>>`;

  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE_PATH, ['-p', '--model', 'haiku'], { cwd: os.tmpdir() });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        p.kill();
      } catch {}
      reject(new Error('summary timed out'));
    }, 20000);

    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      const s = out.trim();
      if (s) resolve(s);
      else reject(new Error(err.trim() || `claude exited ${code} with no output`));
    });

    // failed spawns destroy the stdin pipe asynchronously — swallow that error
    p.stdin.on('error', () => {});
    try {
      const end = () => {
        try {
          p.stdin.end();
        } catch {}
      };
      if (!p.stdin.write(prompt)) p.stdin.once('drain', end);
      else end();
    } catch {
      try {
        p.stdin.end();
      } catch {}
    }
  });
}
