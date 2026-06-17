import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.CLOUDCODER_PORT || 4060);
export const CLAUDE_PATH = process.env.CLOUDCODER_CLAUDE || 'C:/Users/devserver/.local/bin/claude.exe';
export const PROJECTS_ROOT = process.env.CLOUDCODER_PROJECTS || 'C:/Users/devserver/Projects';
export const PIN = process.env.CLOUDCODER_PIN || '';

// server/src -> server/data (dev via tsx) or server/dist -> server/data (built)
export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'chat'), { recursive: true });
