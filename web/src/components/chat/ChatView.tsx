import { useEffect, useRef, useState } from 'react';
import { api, ChangedFile, SessionMeta } from '../../lib/api';
import { fmtTokens } from '../../lib/format';
import { unlockAudio, stopVoice, playVoiceBlob, speakFallback } from '../../lib/voice';
import Markdown from './Markdown';
import ToolCard, { ToolItem } from './ToolCard';
import ChangesCard from './ChangesCard';
import Icon from '../Icon';

const MAX_IMAGES = 8;

// Built-in commands implemented natively for CloudCoder's headless model.
// Shown once a letter follows the "/" (a bare "/" lists skills + custom commands).
const BUILTIN_COMMANDS: { name: string; description: string; kind: string }[] = [
  { name: 'clear', description: 'Start a fresh conversation in this session', kind: 'builtin' },
  { name: 'compact', description: 'Summarize this thread and continue in a smaller, faster context', kind: 'builtin' },
  { name: 'cost', description: 'Show total cost and turns for this session', kind: 'builtin' },
  { name: 'goal', description: 'Set a goal sent with every turn (blank to clear)', kind: 'builtin' },
  { name: 'init', description: 'Analyze the project and write a CLAUDE.md', kind: 'builtin' },
  { name: 'review', description: 'Review the uncommitted changes for bugs', kind: 'builtin' },
];

const INIT_PROMPT =
  'Analyze this codebase and create (or improve, if one exists) a CLAUDE.md file at the project root. ' +
  'Document the project purpose, how to build/test/run it, the architecture and key directories, and any ' +
  'conventions a new contributor should follow. Keep it concise and accurate to what the code actually does.';

const REVIEW_PROMPT =
  'Review my uncommitted changes — run git to see the diff and any untracked files, then report bugs, ' +
  'correctness issues, and clear improvements. Group findings by file and be concise; skip pure style nits.';

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Downscale phone photos (often 12MP / several MB) to a sane size before
// base64-uploading them — keeps payloads small and well within Claude's vision
// resolution. Returns a JPEG data URL.
async function downscaleToDataUrl(file: File, max = 1568, quality = 0.82): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

type Item =
  | { kind: 'user'; text: string; images?: string[] }
  | { kind: 'text'; text: string }
  | ToolItem
  | { kind: 'changes'; files: ChangedFile[] }
  | { kind: 'result'; ok: boolean; cost: number; turns: number; durationMs: number; contextTokens?: number }
  | { kind: 'info'; text: string }
  | { kind: 'compact'; summary: string }
  | { kind: 'error'; message: string };

// Nudge the user to /compact once the context gets large — well before the
// zone where the thread starts timing out or the compaction itself could fail.
const COMPACT_SUGGEST_TOKENS = 120_000;

export default function ChatView({
  session,
  active,
  onContextTokens,
}: {
  session: SessionMeta;
  active: boolean;
  onContextTokens?: (n: number) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [draftText, setDraftText] = useState('');
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string[]>([]); // data URLs of attached images
  const [sendError, setSendError] = useState('');
  const [commands, setCommands] = useState<{ name: string; description: string; kind: string }[]>([]);
  const [menuIdx, setMenuIdx] = useState(0);
  const [dismissAt, setDismissAt] = useState<string | null>(null);
  const [goal, setGoal] = useState(session.goal || '');
  // context size reported by the last turn, and whether a /compact is underway
  const [contextTokens, setContextTokens] = useState(0);
  const [compacting, setCompacting] = useState(false);
  // read assistant replies aloud when on; preference is shared across sessions
  const [speak, setSpeak] = useState(() => {
    try {
      return localStorage.getItem('cc.tts') === '1';
    } catch {
      return false;
    }
  });
  const speakRef = useRef(speak);
  speakRef.current = speak;
  // report the live context size up to the app header (stable ref avoids re-run loops)
  const reportCtxRef = useRef(onContextTokens);
  reportCtxRef.current = onContextTokens;
  const activeRef = useRef(active);
  activeRef.current = active;
  // assistant text collected across the current turn, summarized & spoken at end
  const turnText = useRef<string[]>([]);
  const wasRunning = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // the newest message the user sent — target of the "jump to my message" button,
  // which appears only while that message is scrolled out of view
  const lastUserRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  const stickBottom = useRef(true);
  // deltas arrive many times per second — buffer and flush at ~12fps so the
  // phone isn't re-rendering (and re-parsing markdown) per token
  const deltaBuf = useRef('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When we send a message we add it to items immediately (optimistic UI).
  // The server echoes it back via SSE; skip that echo to avoid duplicates.
  const skipNextUserEvent = useRef(false);

  useEffect(() => {
    const flushDeltas = () => {
      flushTimer.current = null;
      if (deltaBuf.current) {
        const chunk = deltaBuf.current;
        deltaBuf.current = '';
        setDraftText((d) => d + chunk);
      }
    };
    const clearDraft = () => {
      deltaBuf.current = '';
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      setDraftText('');
    };

    // At end of turn: condense everything the assistant said into a one-line
    // summary, get it as real speech audio from the server, and play it as media
    // so it routes to wherever the device is connected (CarPlay/Bluetooth/etc).
    // If that fails, fall back to the on-device Web Speech voice.
    const speakTurnSummary = async () => {
      const full = turnText.current.join('\n\n').trim();
      turnText.current = [];
      if (!full || !speakRef.current || !activeRef.current) return;
      try {
        const { audio } = await api.chatVoice(session.id, full);
        // user may have toggled off or switched away during the await
        if (!speakRef.current || !activeRef.current) return;
        await playVoiceBlob(audio);
      } catch {
        if (speakRef.current && activeRef.current) speakFallback(full);
      }
    };

    const es = new EventSource(`/_cc/api/chat/${session.id}/events?after=0`);
    es.onmessage = (e) => {
      let ev: any;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.seq) {
        if (ev.seq <= lastSeq.current && ev.type !== 'status') return;
        lastSeq.current = Math.max(lastSeq.current, ev.seq);
      }
      switch (ev.type) {
        case 'cleared':
          clearDraft();
          setItems([]);
          turnText.current = [];
          setContextTokens(0);
          break;
        case 'user':
          if (skipNextUserEvent.current) {
            // already shown optimistically on send — consume the flag and skip
            skipNextUserEvent.current = false;
          } else {
            setItems((it) => [...it, { kind: 'user', text: ev.text, images: ev.images }]);
          }
          clearDraft();
          break;
        case 'text_delta':
          deltaBuf.current += ev.text;
          if (!flushTimer.current) flushTimer.current = setTimeout(flushDeltas, 80);
          break;
        case 'assistant_text':
          clearDraft();
          setItems((it) => [...it, { kind: 'text', text: ev.text }]);
          if (ev.text) turnText.current.push(ev.text);
          break;
        case 'tool_start':
          setItems((it) => [
            ...it,
            { kind: 'tool', toolId: ev.toolId, name: ev.name, label: ev.label, input: ev.input, done: false },
          ]);
          break;
        case 'tool_done':
          setItems((it) =>
            it.map((x) =>
              x.kind === 'tool' && x.toolId === ev.toolId
                ? { ...x, done: true, output: ev.output, isError: ev.isError }
                : x,
            ),
          );
          break;
        case 'changes':
          // only the latest changes card matters — replace any earlier one
          setItems((it) => [
            ...it.filter((x) => x.kind !== 'changes'),
            { kind: 'changes', files: ev.files || [] },
          ]);
          break;
        case 'result':
          clearDraft();
          setItems((it) => [
            ...it,
            {
              kind: 'result',
              ok: ev.ok,
              cost: ev.cost,
              turns: ev.turns,
              durationMs: ev.durationMs,
              contextTokens: ev.contextTokens,
            },
          ]);
          if (typeof ev.contextTokens === 'number' && ev.contextTokens > 0) setContextTokens(ev.contextTokens);
          break;
        case 'compact':
          clearDraft();
          setCompacting(false);
          setContextTokens(0);
          turnText.current = [];
          setItems((it) => [...it, { kind: 'compact', summary: ev.summary }]);
          break;
        case 'error':
          setCompacting(false);
          setItems((it) => [...it, { kind: 'error', message: ev.message }]);
          break;
        case 'status':
          setRunning(!!ev.running);
          if (ev.running) {
            // new turn beginning — drop any replayed/stale assistant text
            turnText.current = [];
          } else {
            clearDraft();
            // only speak on a real live turn→idle transition, not the status
            // event replayed on every (re)connect
            if (wasRunning.current) void speakTurnSummary();
          }
          wasRunning.current = !!ev.running;
          break;
      }
    };
    return () => {
      es.close();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [session.id]);

  // pin to bottom unless the user scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, draftText]);

  // Sessions stay mounted but hidden (display:none), so the pin-to-bottom above
  // runs while this view has no layout and can't actually scroll. When the
  // session becomes visible, jump to where the conversation left off (latest).
  useEffect(() => {
    if (!active) return;
    stickBottom.current = true;
    const el = scrollRef.current;
    if (!el) return;
    // wait for layout after display flips to block
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // bubble the current context size up to the app header
  useEffect(() => {
    reportCtxRef.current?.(contextTokens);
  }, [contextTokens]);

  // stop any in-progress playback when this session is hidden (or unmounts)
  useEffect(() => {
    if (!active) stopVoice();
    return () => stopVoice();
  }, [active]);

  // show the "jump to my message" button only while the last sent message is
  // scrolled out of the viewport
  useEffect(() => {
    const target = lastUserRef.current;
    const root = scrollRef.current;
    if (!target || !root) {
      setShowJump(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setShowJump(!e.isIntersecting), {
      root,
      threshold: 0.01,
    });
    io.observe(target);
    return () => io.disconnect();
  }, [items, active]);

  // load available slash commands (skills + custom commands) for this session
  useEffect(() => {
    api
      .chatCommands(session.id)
      .then((r) => setCommands(r.commands))
      .catch(() => {});
  }, [session.id]);

  // keep the goal banner in sync with the latest session metadata
  useEffect(() => setGoal(session.goal || ''), [session.goal]);

  // slash-command menu: open when the input is a bare "/query" with no space yet
  const slash = /^\/(\S*)$/.exec(input);
  const slashQuery = slash ? slash[1].toLowerCase() : null;
  // bare "/" → skills + custom commands only; once a letter is typed, also
  // fold in the built-in commands (filtered by the query)
  const pool =
    slashQuery && slashQuery.length > 0
      ? [...commands, ...BUILTIN_COMMANDS.filter((b) => !commands.some((c) => c.name === b.name))]
      : commands;
  const matches =
    slashQuery === null
      ? []
      : pool
          .filter((c) => c.name.toLowerCase().includes(slashQuery))
          .sort((a, b) => {
            const aw = a.name.toLowerCase().startsWith(slashQuery) ? 0 : 1;
            const bw = b.name.toLowerCase().startsWith(slashQuery) ? 0 : 1;
            return aw - bw || a.name.localeCompare(b.name);
          });
  const menuOpen = slashQuery !== null && matches.length > 0 && !running && input !== dismissAt;
  const menuIndex = Math.max(0, Math.min(menuIdx, matches.length - 1));

  const pickCommand = (name: string) => {
    setInput('/' + name + ' ');
    setMenuIdx(0);
    setDismissAt(null);
    taRef.current?.focus();
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    const room = MAX_IMAGES - pending.length;
    if (room <= 0) return;
    const urls = await Promise.all(imgs.slice(0, room).map((f) => downscaleToDataUrl(f).catch(() => '')));
    const ok = urls.filter(Boolean);
    if (ok.length) setPending((p) => [...p, ...ok].slice(0, MAX_IMAGES));
  };

  const addInfo = (text: string) => setItems((it) => [...it, { kind: 'info', text }]);

  // Kick off a /compact. The heavy work (summarize + reset) runs on the server
  // and streams back over SSE; here we just start it and show progress.
  const doCompact = async () => {
    if (running || compacting) return;
    setCompacting(true);
    setSendError('');
    try {
      await api.chatCompact(session.id);
    } catch (e: any) {
      setCompacting(false);
      addInfo('Could not compact: ' + e.message);
    }
  };

  // built-in commands handled natively here; returns true if it consumed the input
  const runBuiltin = async (text: string): Promise<boolean> => {
    const m = /^\/(clear|compact|cost|goal|init|review)\b\s*([\s\S]*)$/i.exec(text);
    if (!m) return false;
    const cmd = m[1].toLowerCase();
    const arg = m[2].trim();

    if (cmd === 'compact') {
      await doCompact();
      return true;
    }
    if (cmd === 'clear') {
      try {
        await api.chatClear(session.id);
        setItems([]);
        lastSeq.current = 0;
      } catch (e: any) {
        addInfo('Could not clear: ' + e.message);
      }
      return true;
    }
    if (cmd === 'cost') {
      const results = items.filter((i) => i.kind === 'result') as Extract<Item, { kind: 'result' }>[];
      if (!results.length) addInfo('No completed turns yet — nothing to total.');
      else {
        const cost = results.reduce((s, r) => s + (r.cost || 0), 0);
        const turns = results.reduce((s, r) => s + (r.turns || 0), 0);
        const secs = Math.round(results.reduce((s, r) => s + (r.durationMs || 0), 0) / 1000);
        addInfo(`Session total: $${cost.toFixed(2)} · ${turns} turns · ${secs}s · ${results.length} responses`);
      }
      return true;
    }
    if (cmd === 'goal') {
      try {
        await api.setSessionGoal(session.id, arg);
        setGoal(arg);
        addInfo(arg ? `Goal set — sent with every turn:\n${arg}` : 'Goal cleared.');
      } catch (e: any) {
        addInfo('Could not set goal: ' + e.message);
      }
      return true;
    }
    // init / review expand to a real prompt and go to Claude as a normal turn
    return false;
  };

  const send = async () => {
    const raw = input.trim();
    const imgs = pending;
    if ((!raw && imgs.length === 0) || running || compacting) return;

    // local commands (clear/cost/goal) don't go to Claude
    if (imgs.length === 0 && (await runBuiltin(raw))) {
      setInput('');
      setSendError('');
      return;
    }

    // init/review expand to a canned prompt; everything else passes through
    const initM = /^\/init\b/i.test(raw);
    const reviewM = /^\/review\b/i.test(raw);
    const text = initM ? INIT_PROMPT : reviewM ? REVIEW_PROMPT : raw;

    // Very large pastes (transcripts, docs, etc.) are saved as a .txt file so
    // Claude can read them without embedding megabytes in SSE or stdin.
    let displayText = text;
    let claudeText = text;
    if (text.length > 15_000) {
      try {
        const { path: filePath, name } = await api.uploadTextFile(session.id, text);
        const extra = text.length - 1000;
        displayText =
          text.slice(0, 1000) +
          `\n\n[…${extra.toLocaleString()} more characters — saved to ${name} for Claude to read]`;
        claudeText =
          `The user pasted a large document (${text.length.toLocaleString()} characters). ` +
          `It has been saved to:\n${filePath}\n\n` +
          `Please use the Read tool to read this file, then respond to its content.`;
      } catch {
        // fall through — send inline (SSE truncates preview but Claude still gets full text)
      }
    }

    // Show the message immediately so large pastes don't disappear on send.
    // The server echoes it back via SSE; skipNextUserEvent prevents duplicates.
    skipNextUserEvent.current = true;
    setItems((it) => [...it, { kind: 'user', text: displayText, images: imgs.length ? imgs : undefined }]);
    setInput('');
    setPending([]);
    setSendError('');
    try {
      await api.chatSend(session.id, claudeText, imgs.length ? imgs : undefined);
    } catch (e: any) {
      // send failed — roll back the optimistic message and restore input
      skipNextUserEvent.current = false;
      setItems((it) => {
        const last = it[it.length - 1];
        return last?.kind === 'user' && last.text === displayText ? it.slice(0, -1) : it;
      });
      setSendError(e.message);
      setInput(raw);
      setPending(imgs);
    }
  };

  let lastUserIdx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto px-3 py-2"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {items.length === 0 && !draftText && (
          <div className="mt-12 text-center text-[13px] text-faint">
            Working in
            <div className="mono mt-1 text-[11px]">{session.cwd}</div>
          </div>
        )}
        {items.map((item, i) => {
          if (item.kind === 'user')
            return (
              <div key={i} ref={i === lastUserIdx ? lastUserRef : undefined} className="my-2.5 flex justify-end">
                <div className="max-w-[88%] rounded-2xl rounded-br-md border border-line bg-card px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
                  {item.images && item.images.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {item.images.map((src, k) => (
                        <a key={k} href={src} target="_blank" rel="noreferrer">
                          <img src={src} className="max-h-44 rounded-lg border border-line object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {item.text && (
                    <div className={'whitespace-pre-wrap' + (item.images && item.images.length ? ' mt-2' : '')}>
                      {item.text}
                    </div>
                  )}
                </div>
              </div>
            );
          if (item.kind === 'text')
            return (
              <div key={i} className="my-2 text-ink">
                <Markdown text={item.text} />
              </div>
            );
          if (item.kind === 'tool') return <ToolCard key={item.toolId + i} tool={item} cwd={session.cwd} />;
          if (item.kind === 'changes') return <ChangesCard key={'ch' + i} cwd={session.cwd} files={item.files} />;
          if (item.kind === 'result')
            return (
              <div key={i} className="mono my-3 text-center text-[10.5px] text-faint">
                {item.ok ? '✓ done' : '✗ failed'} · ${item.cost.toFixed(2)} · {item.turns} turns ·{' '}
                {Math.round(item.durationMs / 1000)}s
                {item.contextTokens ? ` · ${fmtTokens(item.contextTokens)} ctx` : ''}
              </div>
            );
          if (item.kind === 'info')
            return (
              <div
                key={i}
                className="my-2.5 whitespace-pre-wrap rounded-xl border border-linesoft bg-raised px-3.5 py-2 text-center text-[11.5px] text-dim"
              >
                {item.text}
              </div>
            );
          if (item.kind === 'compact')
            return (
              <div key={i} className="my-3 rounded-xl border border-coral/30 bg-coral/8 px-3.5 py-3">
                <div className="mono mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-coral">
                  <Icon name="spark" size={12} />
                  conversation compacted — continuing with this summary
                </div>
                <div className="text-[13px] text-ink">
                  <Markdown text={item.summary} />
                </div>
              </div>
            );
          return (
            <div key={i} className="my-2 rounded-xl border border-rd/30 bg-rd/8 px-3.5 py-2.5 text-[12px] text-rd">
              {(item as any).message}
            </div>
          );
        })}
        {draftText && (
          <div className="my-2 text-ink">
            <Markdown text={draftText} />
            <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse rounded-[2px] bg-coral align-middle" />
          </div>
        )}
        {running && !draftText && (
          <div className="my-3 flex items-center gap-2.5 text-[12px] text-faint">
            <span className="spin h-3.5 w-3.5 rounded-full border-[1.5px] border-coral border-t-transparent" />
            {compacting ? 'Compacting the conversation — writing a summary…' : 'Claude is working…'}
          </div>
        )}
      </div>
        {showJump && (
          <button
            onClick={() => lastUserRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="mono absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-line bg-card/95 px-3 py-1.5 text-[11px] text-dim shadow-lg backdrop-blur active:bg-press"
          >
            <Icon name="arrowUp" size={13} />
            my last message
          </button>
        )}
      </div>

      {contextTokens >= COMPACT_SUGGEST_TOKENS && !running && !compacting && (
        <div className="flex shrink-0 items-center gap-2 border-t border-amb/30 bg-amb/10 px-3.5 py-2">
          <Icon name="spark" size={13} className="shrink-0 text-amb" />
          <span className="min-w-0 flex-1 text-[11.5px] text-dim">
            This thread is getting long (~{Math.round(contextTokens / 1000)}k tokens). Compact it to stay fast
            and avoid stalls.
          </span>
          <button
            className="mono shrink-0 rounded-lg border border-amb/50 bg-amb/15 px-2.5 py-1 text-[11px] font-medium text-amb active:bg-amb/25"
            onClick={doCompact}
          >
            compact
          </button>
        </div>
      )}

      {goal && (
        <div className="flex shrink-0 items-center gap-2 border-t border-linesoft bg-raised/60 px-3.5 py-1.5">
          <Icon name="spark" size={12} className="shrink-0 text-coral" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-dim">{goal}</span>
          <button
            className="shrink-0 text-faint active:text-ink"
            aria-label="Clear goal"
            onClick={async () => {
              setGoal('');
              try {
                await api.setSessionGoal(session.id, '');
              } catch {
                /* refetch will resync */
              }
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {sendError && <div className="px-4 py-1 text-[12px] text-rd">{sendError}</div>}

      <div
        className="shrink-0 border-t border-linesoft bg-raised p-2.5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}
      >
        {menuOpen && (
          <div className="mb-2 max-h-56 overflow-y-auto rounded-xl border border-line bg-card">
            {matches.map((c, k) => (
              <button
                key={c.name}
                className={
                  'flex w-full flex-col items-start gap-0.5 border-b border-linesoft px-3 py-2 text-left last:border-0 ' +
                  (k === menuIndex ? 'bg-press' : '')
                }
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickCommand(c.name)}
              >
                <span className="mono text-[12.5px]">
                  <span
                    className={
                      c.kind === 'skill'
                        ? 'text-[#e6a482]' // skill — tinted coral to differentiate from commands
                        : 'text-coral' // command (custom or built-in) — all function here
                    }
                  >
                    /{c.name}
                  </span>
                  <span className="ml-1.5 text-[9px] uppercase tracking-wider text-faint">{c.kind}</span>
                </span>
                {c.description && <span className="w-full truncate text-[11px] text-faint">{c.description}</span>}
              </button>
            ))}
          </div>
        )}
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((src, k) => (
              <div key={k} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
                <img src={src} className="h-full w-full object-cover" />
                <button
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-ink"
                  onClick={() => setPending((p) => p.filter((_, j) => j !== k))}
                >
                  <Icon name="x" size={12} strokeWidth={2.4} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-card text-dim disabled:opacity-35"
            disabled={pending.length >= MAX_IMAGES}
            onClick={() => fileRef.current?.click()}
            aria-label="Attach image"
          >
            <Icon name="image" size={18} />
          </button>
          <button
            className={
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ' +
              (speak ? 'border-coral bg-coral/15 text-coral' : 'border-line bg-card text-dim')
            }
            onClick={() => {
              const next = !speak;
              setSpeak(next);
              try {
                localStorage.setItem('cc.tts', next ? '1' : '0');
              } catch {
                /* ignore */
              }
              if (next) {
                // this tap is the user gesture iOS needs to unlock media audio
                unlockAudio();
              } else {
                stopVoice();
              }
            }}
            aria-label={speak ? 'Turn off read-aloud' : 'Read replies aloud'}
            aria-pressed={speak}
          >
            <Icon name={speak ? 'volume' : 'volumeOff'} size={18} />
          </button>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.items || [])
                .filter((it) => it.type.startsWith('image/'))
                .map((it) => it.getAsFile())
                .filter((f): f is File => !!f);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            placeholder={running ? 'Claude is working…' : 'Follow up…'}
            rows={Math.min(4, Math.max(1, input.split('\n').length))}
            className="min-h-0 flex-1 resize-none rounded-2xl border border-line bg-card px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-faint focus:border-coral/60"
            onFocus={() => {
              // keyboard opens → the message list shrinks; keep the latest message
              // pinned just above the keyboard (after the resize settles)
              if (stickBottom.current)
                setTimeout(() => {
                  const el = scrollRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }, 300);
            }}
            onKeyDown={(e) => {
              if (menuOpen) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMenuIdx(Math.min(menuIndex + 1, matches.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMenuIdx(Math.max(menuIndex - 1, 0));
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  pickCommand(matches[menuIndex].name);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setDismissAt(input);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rd/40 bg-rd/15 text-rd"
              onClick={() => api.chatStop(session.id)}
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coral text-bg disabled:opacity-35"
              disabled={!input.trim() && pending.length === 0}
              onClick={send}
            >
              <Icon name="send" size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
