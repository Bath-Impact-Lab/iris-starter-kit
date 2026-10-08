import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installScrollbarActivity, SCROLLING_ATTR } from './scrollbarActivity';

class FakeEl {
  attrs = new Set<string>();
  setAttribute(name: string): void { this.attrs.add(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
}

function makeRoot() {
  const target = new EventTarget();
  const documentElement = new FakeEl();
  const root = Object.assign(target, { documentElement }) as unknown as Document;
  const scroll = (el: unknown): void => {
    const event = new Event('scroll');
    Object.defineProperty(event, 'target', { value: el });
    target.dispatchEvent(event);
  };
  return { root, documentElement, scroll };
}

describe('installScrollbarActivity', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('marks the scrolling element until it has been idle', () => {
    const { root, scroll } = makeRoot();
    const el = new FakeEl();
    installScrollbarActivity(root, 900);

    scroll(el);
    expect(el.attrs.has(SCROLLING_ATTR)).toBe(true);

    vi.advanceTimersByTime(600);
    scroll(el);
    vi.advanceTimersByTime(600);
    expect(el.attrs.has(SCROLLING_ATTR)).toBe(true);

    vi.advanceTimersByTime(300);
    expect(el.attrs.has(SCROLLING_ATTR)).toBe(false);
  });

  it('maps document scrolls to the root element', () => {
    const { root, documentElement, scroll } = makeRoot();
    installScrollbarActivity(root, 900);

    scroll(root);
    expect(documentElement.attrs.has(SCROLLING_ATTR)).toBe(true);
  });

  it('clears marks and stops listening when uninstalled', () => {
    const { root, scroll } = makeRoot();
    const el = new FakeEl();
    const uninstall = installScrollbarActivity(root, 900);

    scroll(el);
    uninstall();
    expect(el.attrs.has(SCROLLING_ATTR)).toBe(false);

    scroll(el);
    expect(el.attrs.has(SCROLLING_ATTR)).toBe(false);
  });
});
