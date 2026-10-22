import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Icon } from '../ui/Icon';

/** Something to tap: a control, or the part of a large card link that reads as its button. */
const CONTROL = 'a[href], button, input, select, textarea, summary, [role="button"]';
const BUTTON_PART = '.btn, [data-button]';
/** A link larger than this (px²) is a card: the visitor taps it beside the WhatsApp button. */
const CARD_AREA = 15000;
/** The button stays put on screens wider than this (phones only). */
const PHONE = '(max-width: 699px)';
/** Back only once the spot has stayed clear this long (ms): no blinking over a list of buttons. */
const CLEAR_FOR = 150;

/** Whether a control of the page lies under the round button: its centre and twelve points just outside its rim. */
function coversControl(fab: HTMLElement): boolean {
  const r = fab.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const rim = r.width / 2 + 2;
  const points = [[cx, cy], ...Array.from({ length: 12 }, (_, i) => [cx + rim * Math.cos((i * Math.PI) / 6), cy + rim * Math.sin((i * Math.PI) / 6)])];
  return points.some(([x, y]) => {
    const under = document.elementsFromPoint(x, y).find((el) => !fab.contains(el));
    const control = under?.closest(CONTROL);
    if (!under || !control) return false;
    const box = control.getBoundingClientRect();
    return !control.matches('a[href]') || box.width * box.height <= CARD_AREA || !!under.closest(BUTTON_PART);
  });
}

/**
 * The floating WhatsApp button. On phones it steps aside while one of the page's buttons is under it
 * (owner 2026-10-22: it never covers a button) and comes back once the spot is clear.
 */
export function WhatsAppButton({ href }: { href: string }) {
  const fab = useRef<HTMLAnchorElement>(null);
  const check = useRef<() => void>(() => {});
  const { key } = useLocation();
  // phones start with it aside: it shows once its spot is found clear, never appears then fades on load
  const [aside, setAside] = useState(() => window.matchMedia(PHONE).matches);

  useEffect(() => {
    const el = fab.current;
    if (!el) return;
    const phone = window.matchMedia(PHONE);
    let frame = 0;
    let back = 0;
    const decide = () => {
      frame = 0;
      if (phone.matches && !el.matches(':focus-visible') && coversControl(el)) {
        window.clearTimeout(back);
        back = 0;
        setAside(true);
      } else if (!back) {
        back = window.setTimeout(() => {
          back = 0;
          setAside(false);
        }, CLEAR_FOR);
      }
    };
    // once per frame at most: on scroll, resize, a new page, and when the page's height changes
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(decide);
    };
    check.current = soon;
    soon();
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    phone.addEventListener('change', soon);
    const grows = new ResizeObserver(soon);
    grows.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(back);
      window.removeEventListener('scroll', soon);
      window.removeEventListener('resize', soon);
      phone.removeEventListener('change', soon);
      grows.disconnect();
    };
  }, []);

  // a new page puts other content under the button
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- runs again on each new page, on purpose
  useEffect(() => check.current(), [key]);

  return (
    <a ref={fab} className={aside ? 'wa-fab is-aside' : 'wa-fab'} href={href} target="_blank" rel="noreferrer" aria-label="WhatsApp">
      <Icon name="whatsapp" size={26} />
    </a>
  );
}
