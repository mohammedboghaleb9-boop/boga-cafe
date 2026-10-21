/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'demo' = example data and the demo admin; 'supabase' = the live database (src/data/backend.ts); anything else: the real site in the browser. */
  readonly VITE_DATA_MODE?: string;
  /** Supabase project URL and publishable key: public values, required with VITE_DATA_MODE=supabase. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Cloudflare Turnstile site key (public), required with VITE_DATA_MODE=supabase (src/shared/ui/Captcha.tsx). */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /**
   * 'on' = with VITE_DATA_MODE=supabase, read the catalog shown without prices while the sales are closed
   * (showcase_catalog(), migration 20261021120000): only once that migration is on the database (src/data/supabase/showcase.ts).
   */
  readonly VITE_SHOWCASE?: string;
  /** URL of the notification function (api/notify.ts). Empty in the prototype. */
  readonly VITE_NOTIFY_URL?: string;
  /** 'demo' = simulated card page (prototype only). Anything else: no card until CMI is connected. */
  readonly VITE_CARD_GATEWAY?: string;
}
