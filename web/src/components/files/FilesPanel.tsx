import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import Panel from '../Panel';
import Icon from '../Icon';

const PDF_RE = /\.pdf$/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const PREVIEW_RE = /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

export default function FilesPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [pdfFull, setPdfFull] = useState(false);

  useEffect(() => {
    api.fileTree(cwd).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }, [cwd]);

  useEffect(() => {
    if (!sel) return;
    setContent(null);
    setBinary(false);
    setEditing(false);
    setSaveMsg('');
    setPdfFull(false);
    // PDFs/images are rendered straight from the raw endpoint, not read as text
    if (PREVIEW_RE.test(sel)) return;
    api
      .fileRead(cwd, sel)
      .then((r) => {
        setBinary(r.binary);
        setContent(r.content ?? '');
        setTruncated(!!r.truncated);
      })
      .catch(() => setContent('⚠ failed to read file'));
  }, [cwd, sel]);

  if (sel) {
    const isPdf = PDF_RE.test(sel);
    const isImage = IMG_RE.test(sel);
    const isMedia = isPdf || isImage;
    const rawUrl = api.fileRawUrl(cwd, sel);
    return (
      <>
      <Panel
        title={sel.split('/').pop() || sel}
        icon="file"
        onClose={() => setSel(null)}
        actions={
          !isMedia && !binary && !truncated && content != null ? (
            editing ? (
              <button
                className="rounded-full bg-coral px-3 py-1 text-[11px] font-semibold text-bg"
                onClick={async () => {
                  try {
                    await api.fileWrite(cwd, sel, draft);
                    setContent(draft);
                    setEditing(false);
                    setSaveMsg('saved');
                    setTimeout(() => setSaveMsg(''), 2000);
                  } catch (e: any) {
                    setSaveMsg('save failed: ' + e.message);
                  }
                }}
              >
                Save
              </button>
            ) : (
              <button
                className="rounded-full border border-line bg-card px-3 py-1 text-[11px] font-medium text-dim"
                onClick={() => {
                  setDraft(content);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )
          ) : undefined
        }
      >
        {saveMsg && (
          <div className="mono flex items-center gap-1.5 px-4 pt-2 text-[11px] text-grn">
            <Icon name="check" size={12} /> {saveMsg}
          </div>
        )}
        {isMedia ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-end px-4 py-1.5">
              {isPdf ? (
                <button
                  className="text-[11px] font-medium text-coral"
                  onClick={() => setPdfFull(true)}
                >
                  Fullscreen ⤢
                </button>
              ) : (
                <a href={rawUrl} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-coral">
                  Open ↗
                </a>
              )}
            </div>
            {isPdf ? (
              <iframe title={sel} src={rawUrl} className="min-h-0 w-full flex-1 border-0 bg-white" />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <img src={rawUrl} className="mx-auto max-w-full rounded-lg" />
              </div>
            )}
          </div>
        ) : (
          <>
            {content == null && <div className="p-5 text-[13px] text-faint">loading…</div>}
            {binary && <div className="p-5 text-[13px] text-faint">binary file</div>}
            {!binary && content != null && !editing && (
          <pre className="mono overflow-x-auto whitespace-pre-wrap break-all p-4 text-[11.5px] leading-relaxed text-dim">
            {content}
            {truncated && '\n…truncated'}
          </pre>
        )}
        {editing && (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="mono h-full w-full resize-none bg-bg p-4 text-[11.5px] leading-relaxed text-ink outline-none"
          />
        )}
          </>
        )}
      </Panel>
      {pdfFull && isPdf && (
        <div className="fixed inset-0 z-50 bg-black">
          <iframe title={sel} src={rawUrl} className="h-full w-full border-0 bg-white" />
          <button
            onClick={() => setPdfFull(false)}
            style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
            className="absolute right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white shadow-lg active:bg-black/85"
            aria-label="Exit fullscreen"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      )}
      </>
    );
  }

  const shown = filter ? files.filter((f) => f.toLowerCase().includes(filter.toLowerCase())) : files;

  return (
    <Panel title={cwd.split('\\').pop() || 'Files'} icon="file" onClose={onClose}>
      <div className="px-3 pt-3">
        <div className="relative">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-[13.5px] text-ink outline-none placeholder:text-faint focus:border-coral/60"
          />
        </div>
      </div>
      <div className="mx-3 mt-3 mb-8 overflow-hidden rounded-2xl border border-line bg-raised">
        {shown.map((f) => (
          <button
            key={f}
            className="flex w-full items-center gap-2.5 border-b border-linesoft/60 px-3.5 py-2.5 text-left last:border-b-0 active:bg-press"
            onClick={() => setSel(f)}
          >
            <Icon name="file" size={13} className="shrink-0 text-faint" />
            <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-dim">{f}</span>
            <Icon name="chevronR" size={12} className="shrink-0 text-faint" />
          </button>
        ))}
        {shown.length === 0 && <div className="px-4 py-4 text-[13px] text-faint">no files</div>}
      </div>
    </Panel>
  );
}
