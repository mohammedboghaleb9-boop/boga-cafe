import { describe, expect, it } from 'vitest';
import { cleanProfileUrl, formatPhone, gmailComposeLink, socialHandle } from '../contact';

describe('contact helpers', () => {
  it('reads the handle from the links the owner shared', () => {
    expect(socialHandle('https://www.instagram.com/boga.cafe1?stkn=MTAydWs3ampkeHgxag==')).toBe('@boga.cafe1');
    expect(socialHandle('https://www.tiktok.com/@bogacafe795?_r=1&_t=ZG-9A5ggtzHTyz')).toBe('@bogacafe795');
    expect(socialHandle('https://www.instagram.com/')).toBe('');
    expect(socialHandle('')).toBe('');
    expect(socialHandle('not a url')).toBe('');
  });

  it('keeps the id of a Facebook profile and drops the rest', () => {
    const shared = 'https://web.facebook.com/profile.php?id=61594620729419&locale=ar_AR';
    expect(cleanProfileUrl(shared)).toBe('https://www.facebook.com/profile.php?id=61594620729419');
    expect(socialHandle(shared, 'BOGA CAFÉ')).toBe('BOGA CAFÉ');
    expect(socialHandle(shared)).toBe('');
    expect(cleanProfileUrl('https://m.facebook.com/bogacafe?ref=share')).toBe('https://www.facebook.com/bogacafe');
    expect(socialHandle('https://m.facebook.com/bogacafe?ref=share', 'BOGA CAFÉ')).toBe('@bogacafe');
    expect(cleanProfileUrl('https://www.facebook.com/profile.php')).toBe('https://www.facebook.com/profile.php');
    expect(socialHandle('https://www.facebook.com/profile.php', 'BOGA CAFÉ')).toBe(''); // id lost: hidden, not a broken link
  });

  it('drops tracking parameters from profile links', () => {
    expect(cleanProfileUrl('https://www.tiktok.com/@bogacafe795?_r=1&_t=ZG-9A5ggtzHTyz')).toBe('https://www.tiktok.com/@bogacafe795');
    expect(cleanProfileUrl('https://www.instagram.com/boga.cafe1?stkn=abc')).toBe('https://www.instagram.com/boga.cafe1');
  });

  it('groups Moroccan numbers however they are typed', () => {
    expect(formatPhone('+212 609-036378')).toBe('+212 6 09 03 63 78');
    expect(formatPhone('+212609036378')).toBe('+212 6 09 03 63 78');
    expect(formatPhone('0609036378')).toBe('+212 6 09 03 63 78');
    expect(formatPhone('+33 6 12 34 56 78')).toBe('+33612345678');
  });

  it('builds a Gmail compose link', () => {
    const link = new URL(gmailComposeLink('bogacafe1@gmail.com', 'BOGA CAFÉ — B2B'));
    expect(link.hostname).toBe('mail.google.com');
    expect(link.searchParams.get('to')).toBe('bogacafe1@gmail.com');
    expect(link.searchParams.get('su')).toBe('BOGA CAFÉ — B2B');
    const withBody = new URL(gmailComposeLink('bogacafe1@gmail.com', 'Échantillon SR-0004', 'Ligne 1\nLigne 2 & 50%'));
    expect(withBody.searchParams.get('body')).toBe('Ligne 1\nLigne 2 & 50%');
  });
});
