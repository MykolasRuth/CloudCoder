# CloudCoder

Claude Code on your homelab, from your phone. A self-hosted PWA you open on
your iPhone over Tailscale to run real Claude Code sessions on this Windows
machine — terminal or chat, with live dev-server previews, git review, a file
browser, and push notifications when Claude finishes or needs you.

## Quick start

```powershell
npm install
npm run build          # builds web/dist
npx tsx server/src/index.ts    # or: .\scripts\start.ps1
```

Server: `http://127.0.0.1:4060` (loopback only; reach it through
`tailscale serve`).

**For the iPhone (one-time):** set up HTTPS via Tailscale — see
[`scripts/tailscale-serve.md`](scripts/tailscale-serve.md) — then on the phone
open `https://your-pc.your-tailnet.ts.net`, Share → **Add to Home
Screen**, launch from the icon, and enable push in Settings ⚙︎.

Auto-start on boot: `.\scripts\start.ps1 -Install` (registers a Scheduled Task).

## What's inside

A Codex-style tabbed app in Claude Code's visual language (warm charcoal,
coral accent, Instrument Sans + IBM Plex Mono):

- **Home** — greeting, a "Continue" rail of active sessions, and session
  history grouped by day; tap anything to resume it.
- **Projects** — every repo with branch, uncommitted-change count, and last
  activity; a project screen offers New task / terminals / Git / Files /
  Preview plus that project's sessions.
- **＋** — slide-up composer: describe a task, pick project + permission mode,
  Start. The thread is named after the task.
- **Settings** — push notifications and connection info.

| Surface | What it does |
|---|---|
| **Task thread** | Headless `claude -p --output-format stream-json` per turn with `--resume` continuity (survives server restarts). Streaming markdown, collapsible tool cards, cost footer, Stop button, and an end-of-turn **changes card** — every modified file with +/- counts, tap-through diffs, and stage-all + commit right in the thread. |
| **Terminal session** | Real ConPTY running the interactive Claude Code TUI (or PowerShell), streamed over WebSocket into xterm.js. Sessions live on the server — lock your phone, come back, the full screen replays. KeyBar adds esc/tab/ctrl/arrows/^C for the iOS keyboard. |
| **Preview ▶** | Enter a port (5173, 3000, …) and the dev server is proxied *through* CloudCoder — absolute asset paths and HMR websockets work. CloudCoder keeps all its own routes under `/_cc/`, so previewed apps can use `/api`, `/assets`, or any normal path. One preview port at a time (cookie-keyed). |
| **Git ⎇** | status / per-file diffs (mobile-friendly colored unified view) / stage-all+commit / recent log, per project. |
| **Files 🗂** | Browse, view, and light-edit project files. |
| **Push** | Web Push (VAPID): task finished while app closed, Claude rings the terminal bell waiting for input, session exited. Tap the notification to jump to that session. |

## Development

```powershell
npm run dev        # server with tsx watch on :4060
npm run dev:web    # Vite dev server on :4061 (proxies /api, /ws to :4060)
```

## Configuration (env vars)

| Var | Default | |
|---|---|---|
| `CLOUDCODER_PORT` | `4060` | server port |
| `CLOUDCODER_HOST` | `127.0.0.1` | listen address; `0.0.0.0` exposes it to the LAN |
| `CLOUDCODER_ALLOWED_LOGINS` | *(unset)* | comma-separated Tailscale logins allowed through `tailscale serve`; unset = no identity check |
| `CLOUDCODER_CLAUDE` | `C:/Users/devserver/.local/bin/claude.exe` | claude CLI path |
| `CLOUDCODER_PROJECTS` | `C:/Users/devserver/Projects` | projects root (sessions/files/git are restricted to it) |
| `CLOUDCODER_PIN` | *(unset)* | optional PIN gate; unset = open (Tailscale is the perimeter) |

## Architecture

```
server/  Node + TS + express + ws       (all routes under /_cc/api, WS under /_cc/ws)
  pty/        node-pty (ConPTY) sessions; 1MB ANSI ring buffer; replay-on-attach;
              PTY lifetime is decoupled from websocket lifetime
  chat/       claude -p stream-json runner; NDJSON -> typed events; SSE to client;
              transcripts in server/data/chat/<id>.jsonl; emits a 'changes'
              (working-tree summary) event after every turn
  preview/    cookie-keyed catch-all proxy (path untouched) + WS upgrade passthrough
  routes/     sessions, chat, git, files, push
web/     Vite + React + TS + Tailwind + @xterm/xterm  (built with base /_cc/)
  PWA: manifest + service worker (network-first shell, cache-first assets,
  never intercepts /_cc/api, /_cc/ws, or preview paths) + push handlers
```

Notes & limits (v1):

- Terminal scrollback lives in memory: a **server** restart ends terminal
  sessions (chat sessions resume fine). Reconnects/replays are unlimited.
- Push requires the HTTPS origin **and** the app installed to the Home Screen
  (iOS 16.4+ rule).
- Preview proxies one port at a time; an app that itself serves `/api/...`
  would collide with CloudCoder's namespace (workaround in
  `scripts/tailscale-serve.md`).
