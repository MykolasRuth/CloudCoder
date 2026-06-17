import { useEffect, useState } from 'react';

export interface ViewportFit {
  height: number;
  offsetTop: number;
}

// iOS Safari / standalone PWA: the on-screen keyboard shrinks the *visual*
// viewport, not the layout viewport, and Safari scrolls the layout viewport up
// to keep the focused field visible — which slides the whole app off the top of
// the screen. We instead pin the app to the visual viewport: size it to
// visualViewport.height and offset it by visualViewport.offsetTop so it always
// sits exactly over the visible region, right above the keyboard. The document
// itself is locked from scrolling (see `body` rule in styles.css) so the only
// thing that moves is this measured offset, which returns to 0 / full height
// when the keyboard collapses.
export function useVisualViewport(): ViewportFit {
  const read = (): ViewportFit => ({
    height: Math.round(window.visualViewport?.height ?? window.innerHeight),
    offsetTop: Math.round(window.visualViewport?.offsetTop ?? 0),
  });
  const [vp, setVp] = useState<ViewportFit>(read);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setVp((prev) => {
        const next = read();
        // bail out of setState when nothing meaningful changed (e.g. pixel
        // jitter on scroll) so we don't re-render the whole app per event
        return prev.height === next.height && prev.offsetTop === next.offsetTop ? prev : next;
      });
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return vp;
}
