/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the notification function (api/notify.ts). Empty in the prototype. */
  readonly VITE_NOTIFY_URL?: string;
  /** 'demo' = simulated card page (prototype only). Anything else: no card until CMI is connected. */
  readonly VITE_CARD_GATEWAY?: string;
}
