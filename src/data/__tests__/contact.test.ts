import { describe, expect, it } from 'vitest';
import { BOGA_CONTACT } from '../contact';
import { seedSettings } from '../seed/config';

describe('contact details of the "coming soon" page', () => {
  it('are the same as the site settings (one source the owner approved, kept twice for scripts/seed-sql.mjs)', () => {
    expect(BOGA_CONTACT).toEqual(seedSettings.contact);
  });
});
