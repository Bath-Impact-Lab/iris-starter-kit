export const SCROLLING_ATTR = 'data-scrolling';
export const SCROLL_IDLE_MS = 900;

interface ScrollTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Marks whichever element is scrolling with `data-scrolling` until it has been
 * idle for `idleMs`, so CSS can show its scrollbar only while in use.
 */
export function installScrollbarActivity(
  root: Pick<Document, 'addEventListener' | 'removeEventListener' | 'documentElement'> = document,
  idleMs = SCROLL_IDLE_MS
): () => void {
  const timers = new Map<ScrollTarget, ReturnType<typeof setTimeout>>();

  const onScroll = (event: Event): void => {
    // Scrolling the page itself targets the document, not an element.
    const raw = event.target as unknown;
    const el = (raw === root ? root.documentElement : raw) as ScrollTarget | null;
    if (!el || typeof el.setAttribute !== 'function') return;

    el.setAttribute(SCROLLING_ATTR, '');
    const pending = timers.get(el);
    if (pending) clearTimeout(pending);
    timers.set(
      el,
      setTimeout(() => {
        el.removeAttribute(SCROLLING_ATTR);
        timers.delete(el);
      }, idleMs)
    );
  };

  // scroll doesn't bubble, so listen in the capture phase to see every element.
  const options = { capture: true, passive: true };
  root.addEventListener('scroll', onScroll, options);

  return () => {
    root.removeEventListener('scroll', onScroll, options);
    for (const [el, timer] of timers) {
      clearTimeout(timer);
      el.removeAttribute(SCROLLING_ATTR);
    }
    timers.clear();
  };
}
