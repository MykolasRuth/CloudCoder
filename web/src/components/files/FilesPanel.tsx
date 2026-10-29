import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import Panel from '../Panel';
import Icon from '../Icon';
import PdfView from './PdfView';

const PDF_RE = /\.pdf$/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const PREVIEW_RE = /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

// the download endpoint streams octet-stream (so iOS saves rather than previews);
// re-attach a real MIME on the shared File so the iOS sheet shows e.g. "PDF Document"
const SHARE_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  zip: 'application/zip',
};

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
  const [sharing, setSharing] = useState<string | null>(null);

  useEffect(() => {
    api.fileTree(cwd).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }, [cwd]);

  // Tapping the button hands iOS the file via the Web Share API so the native
  // share sheet opens with "Save to Files", AirDrop, etc. We share ONLY the file
  // — no title/text/url — so nothing but the document shows up in the sheet.
  //
  // Web Share with files only exists in a secure context (HTTPS). Over plain
  // http:// it's unavailable, so we fall back to a forced download (the server
  // sends octet-stream + attachment, which iOS Safari saves to Files). We never
  // create a blob: URL, so a stray blob link can't leak into a manual share.
  async function shareFile(f: string) {
    if (sharing) return;
    const name = f.split('/').pop() || f;
    const url = api.fileDownloadUrl(cwd, f);
    const nav = navigator as any;
    if (typeof nav.canShare === 'function' && typeof nav.share === 'function') {
      setSharing(f);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const ext = (name.split('.').pop() || '').toLowerCase();
        const file = new File([blob], name, { type: SHARE_MIME[ext] || blob.type || 'application/octet-stream' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file] });
          return;
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // user dismissed the share sheet
        console.warn('share failed', e);
      } finally {
        setSharing(null);
      }
    }
    // fallback: plain download (desktop, or http:// where Web Share is disabled)
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  useEffect(() => {
    if (!sel) return;
    setContent(null);
    setBinary(false);
    setEditing(false);
    setSaveMsg('');
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
    // PDFs open straight into the full-screen reader (pinch-zoom + native scroll);
    // the inline <iframe> only ever showed page one on iOS.
    if (isPdf) return <PdfView url={rawUrl} onClose={() => setSel(null)} />;
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
              <a href={rawUrl} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-coral">
                Open ↗
              </a>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <img src={rawUrl} className="mx-auto max-w-full rounded-lg" />
            </div>
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
          <div
            key={f}
            className="flex items-center border-b border-linesoft/60 last:border-b-0"
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2.5 text-left active:bg-press"
              onClick={() => setSel(f)}
            >
              <Icon name="file" size={13} className="shrink-0 text-faint" />
              <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-dim">{f}</span>
            </button>
            <button
              onClick={() => shareFile(f)}
              disabled={sharing === f}
              aria-label={'Share ' + f}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-faint active:text-coral disabled:opacity-40"
            >
              <Icon name="share" size={16} />
            </button>
          </div>
        ))}
        {shown.length === 0 && <div className="px-4 py-4 text-[13px] text-faint">no files</div>}
      </div>
    </Panel>
  );
}
