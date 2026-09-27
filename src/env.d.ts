/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the notification function (api/notify.ts). Empty in the prototype. */
  readonly VITE_NOTIFY_URL?: string;
}
