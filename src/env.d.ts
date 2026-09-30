/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'demo' = example data and the demo admin (src/data/mode.ts). Anything else: the real site. */
  readonly VITE_DATA_MODE?: string;
  /** URL of the notification function (api/notify.ts). Empty in the prototype. */
  readonly VITE_NOTIFY_URL?: string;
  /** 'demo' = simulated card page (prototype only). Anything else: no card until CMI is connected. */
  readonly VITE_CARD_GATEWAY?: string;
}
