/**
 * Longest text accepted in each customer field. The forms enforce them, and
 * they keep every message to BOGA within what WhatsApp and the notification
 * function accept (see api/_lib/notify.ts LIMITS).
 */
export const TEXT_MAX = {
  name: 80,
  company: 80,
  email: 120,
  phone: 24,
  address: 200,
  notes: 500,
} as const;
