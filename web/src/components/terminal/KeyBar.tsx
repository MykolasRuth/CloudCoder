// Sticky helper row for keys the iOS keyboard doesn't have.
// pointerdown is prevented so taps never steal focus from the terminal.

const KEYS: [string, string][] = [
  ['esc', '\x1b'],
  ['tab', '\t'],
  ['^C', '\x03'],
  ['↑', '\x1b[A'],
  ['↓', '\x1b[B'],
  ['←', '\x1b[D'],
  ['→', '\x1b[C'],
  ['/', '/'],
  ['⏎', '\r'],
  ['\\⏎', '\\\r'],
];

export default function KeyBar({
  onKey,
  onCtrl,
  onPaste,
  ctrlOn,
}: {
  onKey: (seq: string) => void;
  onCtrl: () => void;
  onPaste: () => void;
  ctrlOn: boolean;
}) {
  return (
    <div
      className="rail flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-linesoft bg-raised px-2 py-1.5"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) / 2 + 6px)' }}
      onPointerDown={(e) => e.preventDefault()}
    >
      <button
        className={
          'mono shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ' +
          (ctrlOn
            ? 'border-coral bg-coral text-bg'
            : 'border-line bg-card text-dim active:bg-press')
        }
        onPointerDown={(e) => e.preventDefault()}
        onClick={onCtrl}
      >
        ctrl
      </button>
      <button
        className="mono shrink-0 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11px] font-medium text-dim active:bg-press"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onPaste}
      >
        paste
      </button>
      {KEYS.map(([label, seq]) => (
        <button
          key={label}
          className="mono shrink-0 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11px] font-medium text-dim active:bg-press"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onKey(seq)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
