/**
 * Cloudflare Turnstile ("I am not a robot", most visitors just see a tick) on the
 * two public forms of the live site (VITE_DATA_MODE=supabase): checkout and the
 * B2B request. The storefront function refuses any form without a valid token
 * (src/server/storefront.ts). Off everywhere else: the demo and the browser-only
 * site have no server to check a token. Ported from map-test (f9ba067).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SERVER_DATA } from '@/data/mode';
import { useI18n } from '@/i18n';
import './captcha.css';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
/** vite.config.ts refuses a supabase build without the site key. */
export const CAPTCHA_ON = SERVER_DATA;

/** The documented widget widths: 'flexible' needs 300 px, 'compact' is 150 px wide and 140 px tall. */
const FLEXIBLE_MIN_PX = 300;

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let script: Promise<TurnstileApi> | undefined;
function loadTurnstile(): Promise<TurnstileApi> {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing'))));
    s.addEventListener('error', () => {
      // a blocker or a lost connection: the next form shown tries again
      script = undefined;
      s.remove();
      reject(new Error('turnstile blocked'));
    });
    document.head.appendChild(s);
  });
  return script;
}

export interface Captcha {
  /** Token to send with the form; '' while not solved, and always '' when Turnstile is off. */
  token: string;
  /** true while Turnstile is on and not solved yet: the form shows 'captcha' instead of sending. */
  missing: boolean;
  /** Place it inside the form, above the submit button. */
  widget: ReactNode;
  /** A token works once: call after each answer from the server. */
  reset(): void;
}

export function useCaptcha(): Captcha {
  const { t, locale } = useI18n();
  // The form can unmount its fields and show them again: a callback ref renders
  // a widget in whichever element is currently on screen.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const id = useRef<string | null>(null);
  const [token, setToken] = useState('');
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!CAPTCHA_ON || !el) return;
    let live = true;
    loadTurnstile()
      .then((ts) => {
        if (!live) return;
        id.current = ts.render(el, {
          sitekey: SITE_KEY,
          language: locale,
          theme: 'auto',
          // a 320 px phone leaves less than 300 px inside the form
          size: el.clientWidth >= FLEXIBLE_MIN_PX ? 'flexible' : 'compact',
          callback: (solved: string) => setToken(solved),
          // a token lasts 5 minutes; the widget gets a new one by itself
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        });
      })
      .catch((e) => {
        console.error(e);
        if (live) setBlocked(true);
      });
    return () => {
      live = false;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
      // the token belonged to the widget just removed
      setToken('');
    };
  }, [el, locale]);

  const reset = useCallback(() => {
    setToken('');
    if (id.current) window.turnstile?.reset(id.current);
  }, []);

  return {
    token,
    missing: CAPTCHA_ON && token === '',
    widget: CAPTCHA_ON ? (
      <div className="captcha span-all">
        {blocked ? (
          <p className="notice notice-bad small" role="alert">
            {t.checkout.captchaBlocked}
          </p>
        ) : (
          <div ref={setEl} className="captcha-box" />
        )}
      </div>
    ) : null,
    reset,
  };
}
