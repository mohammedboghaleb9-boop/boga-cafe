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
    // a blocker or a lost connection: "try again" loads it anew
    const fail = (why: string) => {
      script = undefined;
      s.remove();
      reject(new Error(why));
    };
    s.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : fail('turnstile missing')));
    s.addEventListener('error', () => fail('turnstile blocked'));
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
  // the script did not load, or the widget reports an error it does not get over by itself
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!CAPTCHA_ON || !el) return;
    let live = true;
    // a 320 px phone leaves less than 300 px inside the form
    const size = el.clientWidth >= FLEXIBLE_MIN_PX ? 'flexible' : 'compact';
    loadTurnstile()
      .then((ts) => {
        if (!live) return;
        id.current = ts.render(el, {
          sitekey: SITE_KEY,
          language: locale,
          // the storefront is dark whatever the device theme (styles/tokens.css)
          theme: 'dark',
          size,
          callback: (solved: string) => {
            setToken(solved);
            setFailed(false);
          },
          // a token lasts 5 minutes; the widget gets a new one by itself
          'expired-callback': () => setToken(''),
          'error-callback': () => {
            setToken('');
            setFailed(true);
          },
        });
      })
      .catch((e) => {
        console.error(e);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
      // the token belonged to the widget just removed
      setToken('');
    };
  }, [el, locale]);

  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  const reset = useCallback(() => {
    setToken('');
    if (id.current) window.turnstile?.reset(id.current);
  }, []);

  return {
    token,
    missing: CAPTCHA_ON && token === '',
    widget: CAPTCHA_ON ? (
      // data-solved: the token has reached the form (what the browser tests wait for before sending)
      <div className="captcha span-all" data-solved={token !== '' || undefined}>
        {/* a new box on "try again": the effect renders a new widget in it */}
        <div key={attempt} ref={setEl} className="captcha-box" hidden={failed} />
        {failed && (
          <div className="notice notice-bad small stack" role="alert">
            <p>{t.checkout.captchaBlocked}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
              {t.common.retry}
            </button>
          </div>
        )}
      </div>
    ) : null,
    reset,
  };
}
