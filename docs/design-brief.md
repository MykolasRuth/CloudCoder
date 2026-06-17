# CloudCoder UI Redesign Brief

## The prompt

> Redesign CloudCoder's mobile PWA into a professional, native-feeling coding
> companion that visually fuses **Claude Code's terminal identity** with the
> **OpenAI Codex app's task-driven product design**. Kill every trace of
> generic slate-blue Tailwind. The app must feel like Anthropic shipped it.
>
> **Aesthetic — "warm terminal":** Claude Code's palette as design tokens —
> warm charcoal surfaces (#1F1E1B / #262522 / #2C2A26), cream text (#F0EEE4),
> the Claude coral accent (#D97757) used sparingly and sharply, hairline warm
> borders, the ✳ spark as brand mark. Typography: **Instrument Sans** for UI
> (bundled, offline-safe), **IBM Plex Mono** for paths/branches/labels/diffs.
> No emoji icons — a custom minimal SVG icon set (stroke 1.5, terminal-flavored).
> Motion: staggered list reveals on load, slide-up sheets, pulsing status dots,
> tab cross-fades. 100% dark, tuned for OLED iPhone, safe-area aware.
>
> **Information architecture — bottom tab bar (iOS-native feel):**
> 1. **Home** — greeting header, "Continue" rail of the most recent active
>    sessions, then recent session history grouped by day; every row resumes
>    its session on tap.
> 2. **Projects** — one card per repo: name, current branch (mono chip),
>    uncommitted-changes badge, session count, last activity. Tapping pushes a
>    **project screen**: actions (New task / Claude terminal / PowerShell),
>    tools (Git / Files / Preview), and that project's session history to
>    resume.
> 3. **＋ New** — center accent button opening a slide-up compose sheet:
>    project picker, permission-mode segmented control, task field, Start;
>    terminal shortcuts below.
> 4. **Settings** — push notifications, connection info, install hint.
>
> **Session screens:** refined header (back chevron, task title, project ·
> mode subline, live status dot). Chat: Codex-style turn layout — user
> messages as warm raised cards, assistant prose in cream, tool calls as
> collapsible mono rows with success ticks, end-of-turn **changes card** with
> +/− stats, tap-through diffs and in-thread commit. Terminal: xterm themed to
> the same charcoal, restyled key bar (mono keycaps with pressed states).
>
> Every existing feature keeps working: PTY replay, chat resume, preview
> proxy, git, files, push. Production-grade: typed, built, verified on a
> 390×760 viewport with screenshots of every screen.

## Design tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#1F1E1B` | app background |
| `--bg-raised` | `#262522` | bars, sheets |
| `--bg-card` | `#2C2A26` | cards, bubbles |
| `--border` | `#3A3833` | hairlines |
| `--text` | `#F0EEE4` | primary text |
| `--text-dim` | `#A8A396` | secondary |
| `--text-faint` | `#716D62` | tertiary |
| `--accent` | `#D97757` | Claude coral — actions, focus, brand |
| `--green` | `#3FB950` | diff add, success |
| `--red` | `#F47067` | diff del, errors |
| `--amber` | `#D9A946` | working / busy |

Fonts: `@fontsource-variable/instrument-sans`, `@fontsource/ibm-plex-mono` (400/500/600).
