/**
 * The server makes links unclickable in what it forwards (api/_lib/notify.ts).
 * The site's own messages must come through exactly as written: weights,
 * prices, references, names and email addresses untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import { defangLinks } from '../../../../api/_lib/notify';

describe('link blocking and the site messages', () => {
  it('leaves every demo order and B2B message unchanged', async () => {
    vi.resetModules();
    const { db } = await import('@/data/demo/store');
    const logs = db.get().notifications;
    expect(logs.length).toBeGreaterThanOrEqual(10);
    for (const log of logs) {
      expect(defangLinks(log.body), log.subject).toBe(log.body);
      expect(defangLinks(log.subject)).toBe(log.subject);
    }
  });

  it('leaves customer details with an email address unchanged', () => {
    const text = 'Contact : Nadia Berrada (+212661440011)\nEmail : nadia.berrada@hotel-orangers.ma\nPoids : 12,5 kg · 0.25 kg · 1 250,00 DH';
    expect(defangLinks(text)).toBe(text);
  });
});
