import { useEffect, useRef, useState } from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Icon from '../Icon';

// Full-screen PDF reader with its own gesture engine. The app viewport disables
// browser pinch-zoom (user-scalable=no) and iOS won't scroll a PDF inside an
// <iframe>, so we render every page with PDF.js into a vertical stack of
// canvases and drive pan / pinch-zoom / inertial scroll ourselves via pointer
// events. Nothing here depends on the global viewport meta, so it behaves the
// same in Safari, standalone PWA, and desktop.
//
// Transform model: a single `content` element is translated + scaled with
// transform-origin at its top-left. `s` is the zoom, `tx`/`ty` the translation
// in CSS px. Pages render lazily based on a manual visibility calculation and
// re-render at a sharper resolution once you zoom in and the gesture settles.

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const GAP = 18; // black gap between pages (unscaled px)
const SIDE = 12; // horizontal margin so each page floats as a card
const FRICTION = 0.95; // inertia decay per ~16ms frame
const MAX_CANVAS_PX = 2800; // cap rendered canvas width to stay within iOS limits

type Slot = {
  el: HTMLDivElement;
  page: number;
  aspect: number; // height / width
  top: number; // unscaled offset from content top
  h: number; // unscaled height
  renderedQ: number; // resolution multiplier the current canvas was drawn at (0 = none)
  rendering: boolean;
};

export default function PdfView({ url, onClose }: { url: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pageLabel, setPageLabel] = useState('');

  useEffect(() => {
    if (!containerRef.current || !contentRef.current) return;
    const container = containerRef.current!;
    const content = contentRef.current!;

    let cancelled = false;
    let pdfDoc: any = null;
    let slots: Slot[] = [];
    let numPages = 0;

    // ---- transform state -------------------------------------------------
    let s = 1;
    let tx = 0;
    let ty = 0;
    let pageW = container.clientWidth;
    let contentH = 0;
    // Extra in-content gaps measured in screen px (applied via the ty clamp so
    // they stay constant under zoom). The safe-area insets themselves (notch /
    // Dynamic Island, home indicator) are handled in CSS by positioning the
    // scroll container inside them — see the JSX — so these stay at 0.
    let topInset = 0;
    let bottomInset = 0;

    // ---- gesture state ---------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch:
      | { startDist: number; cx: number; cy: number; startS: number; startTx: number; startTy: number }
      | null = null;
    let pan: { lastX: number; lastY: number; vx: number; vy: number; lastT: number } | null = null;
    let down: { x: number; y: number; t: number; moved: boolean } | null = null;
    let lastTapT = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let raf = 0; // inertia / animation frame id
    let lastPageLabel = '';
    // The container is inset below the safe area (CSS), so it no longer starts at
    // the viewport origin — track its offset to convert pointer coords to local.
    let cOffX = 0;
    let cOffY = 0;
    const refreshOffset = () => {
      const r = container.getBoundingClientRect();
      cOffX = r.left;
      cOffY = r.top;
    };

    const now = () => performance.now();
    const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

    // ---- layout ----------------------------------------------------------
    function recomputeLayout() {
      let top = 0; // insets live in the clamp; pages are absolutely placed so the
      for (const slot of slots) {
        // DOM layout matches the math exactly and the GAP shows as a real divider
        slot.h = Math.round(pageW * slot.aspect);
        slot.top = top;
        slot.el.style.top = top + 'px';
        slot.el.style.height = slot.h + 'px';
        top += slot.h + GAP;
      }
      contentH = Math.max(0, top - GAP); // drop the trailing gap
      content.style.width = pageW + 'px';
      content.style.height = contentH + 'px';
    }

    function clampTransform() {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const scaledW = pageW * s;
      const scaledH = contentH * s;
      // horizontal: center when content is narrower than the viewport
      if (scaledW <= cw) tx = (cw - scaledW) / 2;
      else tx = clampN(tx, cw - scaledW, 0);
      // vertical: ty is screen-space (applied after scale). The resting top is
      // topInset, so page one always sits below the island; scrolling down stops
      // once the last page bottom reaches the bottom inset.
      const maxTy = topInset;
      const minTy = ch - bottomInset - scaledH;
      ty = clampN(ty, Math.min(minTy, maxTy), maxTy);
    }

    function apply() {
      content.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
      updateVisible();
      updatePageLabel();
    }

    function updatePageLabel() {
      if (!slots.length) return;
      const center = (container.clientHeight / 2 - ty) / s; // content-space y at viewport center
      let cur = 1;
      for (const slot of slots) {
        if (center >= slot.top) cur = slot.page;
        else break;
      }
      const label = `${cur} / ${numPages}`;
      if (label !== lastPageLabel) {
        lastPageLabel = label;
        setPageLabel(label);
      }
    }

    // ---- rendering -------------------------------------------------------
    async function renderSlot(slot: Slot, quality: number) {
      if (cancelled || slot.rendering || !pdfDoc) return;
      slot.rendering = true;
      try {
        const page = await pdfDoc.getPage(slot.page);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const aspect = base.height / base.width;
        // self-correct the placeholder height if this page differs from page 1
        if (Math.abs(aspect - slot.aspect) > 0.005) {
          slot.aspect = aspect;
          recomputeLayout();
          clampTransform();
          content.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
        }
        const scale = (pageW / base.width) * quality;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        const ctx = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
        if (cancelled) return;
        slot.el.replaceChildren(canvas);
        slot.renderedQ = quality;
      } catch {
        /* leave the placeholder for a page that fails to render */
      } finally {
        slot.rendering = false;
      }
    }

    function freeSlot(slot: Slot) {
      if (slot.renderedQ === 0) return;
      slot.el.replaceChildren();
      slot.renderedQ = 0;
    }

    function updateVisible() {
      if (!slots.length) return;
      const ch = container.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const near = ch; // preload one screen above & below
      const far = ch * 3; // free pages beyond three screens
      // While a gesture or fling is in flight, only fill blank pages at base
      // resolution — the sharper upscale is deferred to settle() so pinching
      // never triggers a wave of expensive re-renders mid-frame.
      const active = pointers.size > 0 || raf !== 0;
      const maxQ = MAX_CANVAS_PX / pageW; // cap rendered canvas width
      const wantQ = clampN(dpr * s, dpr, Math.max(dpr, maxQ));
      for (const slot of slots) {
        const screenTop = slot.top * s + ty;
        const screenBottom = (slot.top + slot.h) * s + ty;
        const visible = screenBottom > -near && screenTop < ch + near;
        const distant = screenBottom < -far || screenTop > ch + far;
        if (visible) {
          if (slot.renderedQ === 0) renderSlot(slot, active ? dpr : wantQ);
          else if (!active && wantQ > slot.renderedQ * 1.15) renderSlot(slot, wantQ);
        } else if (distant) {
          freeSlot(slot);
        }
      }
    }

    // ---- gesture helpers -------------------------------------------------
    function stopInertia() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    function twoPoints() {
      const it = pointers.values();
      const a = it.next().value as { x: number; y: number };
      const b = it.next().value as { x: number; y: number };
      return [a, b] as const;
    }

    function zoomAnchored(newS: number, ax: number, ay: number) {
      newS = clampN(newS, MIN_SCALE, MAX_SCALE);
      const cx = (ax - tx) / s;
      const cy = (ay - ty) / s;
      s = newS;
      tx = ax - cx * s;
      ty = ay - cy * s;
    }

    function startInertia() {
      if (!pan) return;
      let vx = pan.vx;
      let vy = pan.vy;
      pan = null;
      if (Math.hypot(vx, vy) < 0.02) {
        settle();
        return;
      }
      let prev = now();
      const step = () => {
        const t = now();
        const dt = Math.min(t - prev, 32);
        prev = t;
        const decay = Math.pow(FRICTION, dt / 16);
        vx *= decay;
        vy *= decay;
        const beforeX = tx;
        const beforeY = ty;
        tx += vx * dt;
        ty += vy * dt;
        clampTransform();
        if (tx === beforeX) vx = 0; // hit a horizontal bound
        if (ty === beforeY) vy = 0; // hit a vertical bound
        apply();
        if (Math.hypot(vx, vy) < 0.02) {
          raf = 0;
          settle();
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    // re-render visible pages crisply once a gesture finishes
    function settle() {
      updateVisible();
    }

    function animateTo(targetS: number, ax: number, ay: number) {
      stopInertia();
      const cx = (ax - tx) / s;
      const cy = (ay - ty) / s;
      const fromS = s;
      const fromTx = tx;
      const fromTy = ty;
      targetS = clampN(targetS, MIN_SCALE, MAX_SCALE);
      const toTx = ax - cx * targetS;
      const toTy = ay - cy * targetS;
      const start = now();
      const dur = 220;
      const ease = (p: number) => 1 - Math.pow(1 - p, 3);
      const step = () => {
        const p = clampN((now() - start) / dur, 0, 1);
        const k = ease(p);
        s = fromS + (targetS - fromS) * k;
        tx = fromTx + (toTx - fromTx) * k;
        ty = fromTy + (toTy - fromTy) * k;
        clampTransform();
        apply();
        if (p < 1) raf = requestAnimationFrame(step);
        else {
          raf = 0;
          settle();
        }
      };
      raf = requestAnimationFrame(step);
    }

    // ---- pointer handlers ------------------------------------------------
    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // capture on the container (stable) — a canvas child can be replaced mid-gesture
      container.setPointerCapture?.(e.pointerId);
      if (pointers.size === 0) refreshOffset();
      const x = e.clientX - cOffX;
      const y = e.clientY - cOffY;
      pointers.set(e.pointerId, { x, y });
      stopInertia();
      if (pointers.size === 1) {
        pan = { lastX: x, lastY: y, vx: 0, vy: 0, lastT: now() };
        down = { x, y, t: now(), moved: false };
      } else if (pointers.size === 2) {
        const [a, b] = twoPoints();
        pinch = {
          startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          startS: s,
          startTx: tx,
          startTy: ty,
        };
        pan = null;
        down = null;
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return;
      const ex = e.clientX - cOffX;
      const ey = e.clientY - cOffY;
      pointers.set(e.pointerId, { x: ex, y: ey });
      if (pointers.size >= 2 && pinch) {
        const [a, b] = twoPoints();
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const newS = clampN((pinch.startS * dist) / pinch.startDist, MIN_SCALE, MAX_SCALE);
        // keep the content point under the gesture's start midpoint pinned to the
        // current midpoint, so the pinch both zooms and pans naturally
        const cx = (pinch.cx - pinch.startTx) / pinch.startS;
        const cy = (pinch.cy - pinch.startTy) / pinch.startS;
        s = newS;
        tx = midX - cx * newS;
        ty = midY - cy * newS;
        clampTransform();
        apply();
      } else if (pointers.size === 1 && pan) {
        const dx = ex - pan.lastX;
        const dy = ey - pan.lastY;
        const t = now();
        const dt = Math.max(t - pan.lastT, 1);
        // exponential moving average smooths out jitter for inertia
        pan.vx = pan.vx * 0.4 + (dx / dt) * 0.6;
        pan.vy = pan.vy * 0.4 + (dy / dt) * 0.6;
        pan.lastX = ex;
        pan.lastY = ey;
        pan.lastT = t;
        tx += dx;
        ty += dy;
        clampTransform();
        apply();
        if (down && (Math.abs(ex - down.x) > 8 || Math.abs(ey - down.y) > 8)) down.moved = true;
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      container.releasePointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        // dropped from a pinch to a single finger — rebase the pan
        pinch = null;
        const [p] = [...pointers.values()];
        pan = { lastX: p.x, lastY: p.y, vx: 0, vy: 0, lastT: now() };
        down = null;
        return;
      }
      if (pointers.size > 0) return;
      if (pinch) {
        pinch = null;
        settle();
        return;
      }
      // single-finger release: detect tap / double-tap, else fling
      const ux = e.clientX - cOffX;
      const uy = e.clientY - cOffY;
      if (down && !down.moved && now() - down.t < 250) {
        const isDouble = now() - lastTapT < 320 && Math.hypot(ux - lastTapX, uy - lastTapY) < 40;
        if (isDouble) {
          lastTapT = 0;
          animateTo(s > 1.5 ? MIN_SCALE : 2.6, ux, uy);
          pan = null;
          down = null;
          return;
        }
        lastTapT = now();
        lastTapX = ux;
        lastTapY = uy;
      }
      down = null;
      startInertia();
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      stopInertia();
      refreshOffset();
      const ax = e.clientX - cOffX;
      const ay = e.clientY - cOffY;
      if (e.ctrlKey) {
        // trackpad pinch / ctrl+wheel → zoom at the cursor
        zoomAnchored(s * Math.exp(-e.deltaY * 0.01), ax, ay);
      } else {
        tx -= e.deltaX;
        ty -= e.deltaY;
      }
      clampTransform();
      apply();
    }

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    let ro: ResizeObserver | null = null;

    // ---- load ------------------------------------------------------------
    (async () => {
      try {
        const pdfjs: any = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // the raw endpoint streams the whole file with no range support, so let
        // PDF.js download it in one shot rather than probing with byte ranges
        pdfDoc = await pdfjs.getDocument({ url, disableRange: true, disableStream: true }).promise;
        if (cancelled) return;
        numPages = pdfDoc.numPages;

        pageW = Math.max(120, (container.clientWidth || window.innerWidth) - SIDE * 2);
        const first = await pdfDoc.getPage(1);
        const fv = first.getViewport({ scale: 1 });
        const aspect = fv.height / fv.width;

        for (let n = 1; n <= numPages; n++) {
          const el = document.createElement('div');
          // each page is an absolutely-placed white card with rounded corners +
          // shadow, separated by the dark GAP so pages read as individual sheets
          el.className = 'absolute left-0 w-full overflow-hidden rounded-lg bg-white shadow-xl';
          content.appendChild(el);
          slots.push({ el, page: n, aspect, top: 0, h: 0, renderedQ: 0, rendering: false });
        }
        refreshOffset();
        recomputeLayout();
        clampTransform();
        setStatus('ready');
        apply();

        ro = new ResizeObserver(() => {
          if (cancelled || !slots.length) return;
          pageW = Math.max(120, (container.clientWidth || window.innerWidth) - SIDE * 2);
          refreshOffset();
          recomputeLayout();
          clampTransform();
          apply();
        });
        ro.observe(container);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      stopInertia();
      ro?.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('wheel', onWheel);
      try {
        pdfDoc?.destroy?.();
      } catch {
        /* noop */
      }
    };
  }, [url]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* The scroll viewport is inset below the notch / Dynamic Island and above
          the home indicator using CSS env() — the browser computes the offset
          (same as the close button), so a page can never render under the island.
          52px of top clearance also keeps page one below the floating close
          button (whose bottom sits at inset + 48px). bg-black so the gaps between
          pages read as the backdrop and each page stands alone. */}
      <div
        ref={containerRef}
        style={{
          top: 'calc(env(safe-area-inset-top) + 52px)',
          bottom: 'env(safe-area-inset-bottom)',
        }}
        className="absolute inset-x-0 overflow-hidden overscroll-none touch-none select-none bg-black"
      >
        <div ref={contentRef} className="absolute left-0 top-0 origin-top-left will-change-transform" />
      </div>

      <button
        onClick={onClose}
        aria-label="Close PDF"
        style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
        className="absolute right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white shadow-lg ring-1 ring-white/10 active:bg-white/25"
      >
        <Icon name="x" size={18} />
      </button>

      {status === 'ready' && pageLabel && (
        <div
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
          className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-[12px] font-medium tabular-nums text-white/90 shadow-lg ring-1 ring-white/15"
        >
          {pageLabel}
        </div>
      )}

      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-white/70">
          {status === 'loading' ? 'loading PDF…' : "couldn't render this PDF"}
        </div>
      )}
    </div>
  );
}
