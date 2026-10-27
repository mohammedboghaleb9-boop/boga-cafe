/**
 * The outbox sender (src/server/outbox.ts): which channels it uses, what it sends, what it reports, and what it never
 * puts in a log or a report. Fake database and fake senders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredChannels, runOutbox, sendRow, type Mail, type OutboxRow } from '../outbox';

const KEY = 'cmb-secret-key-123';
const PASSWORD = 'abcd efgh ijkl mnop';
const ENV = { GMAIL_USER: 'team@example.test', GMAIL_APP_PASSWORD: PASSWORD, CALLMEBOT_APIKEY: KEY };

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 1,
  channel: 'whatsapp',
  event: 'order.created',
  recipient: '212600000000',
  subject: '[BOGA CAFÉ] Commande BC-2026-0001 - Amina',
  body: 'Nouvelle commande BC-2026-0001\nAmina · 0611223344\n2 kg',
  attempts: 1,
  ...over,
});

/** A database that answers claim_outbox with `rows` and records every call. */
function fakeDb(rows: OutboxRow[], failing: 'claim' | 'finish' | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === 'claim_outbox') return failing === 'claim' ? { data: null, error: { code: '42501' } } : { data: rows, error: null };
    return failing === 'finish' ? { data: null, error: { code: '57014' } } : { data: null, error: null };
  });
  return { db: { rpc } as never, calls };
}

const answering = (text: string, status = 200) => vi.fn(async () => new Response(text, { status }));
const sentMails: Mail[] = [];
const sendMail = vi.fn(async (m: Mail) => void sentMails.push(m));

beforeEach(() => {
  sentMails.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('channels', () => {
  it('a channel needs all its secrets', () => {
    expect(configuredChannels({})).toEqual([]);
    expect(configuredChannels({ GMAIL_USER: 'a@b.test' })).toEqual([]);
    expect(configuredChannels({ CALLMEBOT_APIKEY: KEY })).toEqual(['whatsapp']);
    expect(configuredChannels(ENV)).toEqual(['whatsapp', 'email']);
  });

  it('with no secret nothing is taken: the messages wait, they do not use up their attempts', async () => {
    const { db, calls } = fakeDb([row()]);
    const summary = await runOutbox({ db, env: {}, sendMail, fetch: answering('') });
    expect(summary).toEqual({ channels: [], taken: 0, sent: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it('asks only for the channels it can send, three messages at a time', async () => {
    const { db, calls } = fakeDb([]);
    await runOutbox({ db, env: { CALLMEBOT_APIKEY: KEY }, sendMail, fetch: answering('') });
    expect(calls[0]).toEqual({ fn: 'claim_outbox', args: { p_limit: 3, p_channels: ['whatsapp'] } });
  });
});

describe('WhatsApp (CallMeBot)', () => {
  it('sends to the row\'s number with the key, links made unclickable, and reports ok', async () => {
    const { db, calls } = fakeDb([row({ recipient: '+212 600 000 000', body: 'Commande\nvoir https://evil.example/pay' })]);
    const fetcher = answering('<html>Message queued. You will receive it in a few seconds.</html>');
    const summary = await runOutbox({ db, env: ENV, sendMail, fetch: fetcher });
    expect(summary).toMatchObject({ taken: 1, sent: 1, failed: 0 });
    const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe('https://api.callmebot.com/whatsapp.php');
    expect(url.searchParams.get('phone')).toBe('212600000000');
    expect(url.searchParams.get('apikey')).toBe(KEY);
    const text = url.searchParams.get('text')!;
    expect(text).toContain('hxxps://evil[.]example/pay');
    expect(text).not.toContain('https://');
    expect(text).toContain('ne prouve jamais un paiement');
    expect(calls.at(-1)).toEqual({ fn: 'finish_outbox', args: { p_id: 1, p_ok: true, p_error: undefined } });
  });

  it('only CallMeBot\'s confirmation counts: a 200 page about a wrong key is a failure', async () => {
    for (const page of ['<p>APIKey is invalid.</p>', '<p>Please read the instructions. error in phone</p>', 'Message not queued']) {
      const result = await sendRow(row(), { env: ENV, sendMail, fetch: answering(page) });
      expect(result).toEqual({ ok: false, error: 'callmebot_unconfirmed' });
    }
    expect(await sendRow(row(), { env: ENV, sendMail, fetch: answering('Message queued', 500) })).toEqual({ ok: false, error: 'callmebot_unconfirmed' });
  });

  it('a timeout and a network error are told apart, and neither says anything about the request', async () => {
    const timeout = vi.fn(async () => Promise.reject(Object.assign(new Error(`took too long ${KEY}`), { name: 'TimeoutError' })));
    const network = vi.fn(async () => Promise.reject(new TypeError(`fetch failed for apikey=${KEY}`)));
    expect(await sendRow(row(), { env: ENV, sendMail, fetch: timeout })).toEqual({ ok: false, error: 'callmebot_timeout' });
    expect(await sendRow(row(), { env: ENV, sendMail, fetch: network })).toEqual({ ok: false, error: 'callmebot_error' });
  });

  it('a recipient that is not a phone number is refused without calling CallMeBot', async () => {
    const fetcher = answering('Message queued');
    expect(await sendRow(row({ recipient: 'not a number' }), { env: ENV, sendMail, fetch: fetcher })).toEqual({ ok: false, error: 'bad_recipient' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('a very long text is cut for the URL, and the line saying a message proves no payment is never the part cut', async () => {
    const fetcher = answering('Message queued');
    await sendRow(row({ body: 'x'.repeat(5_000) }), { env: ENV, sendMail, fetch: fetcher });
    const text = new URL(String((fetcher.mock.calls[0] as unknown[])[0])).searchParams.get('text')!;
    expect(text.length).toBeLessThanOrEqual(1_500);
    expect(text).toContain('Un message ne prouve jamais un paiement');
    expect(text.endsWith('vérifiez-le à la banque ou au CMI.')).toBe(true);
  });
});

describe('email (Gmail)', () => {
  const mail = (over: Partial<OutboxRow> = {}) => row({ channel: 'email', recipient: 'owner@example.test', ...over });

  it('sends from the Gmail address to the row\'s recipient, one-line subject, links made unclickable', async () => {
    const { db, calls } = fakeDb([mail({ subject: '[BOGA CAFÉ] Demande\nB2B https://evil.example', body: 'Contact: bob@evil.example\nsee www.evil.example/pay' })]);
    const summary = await runOutbox({ db, env: ENV, sendMail, fetch: answering('') });
    expect(summary).toMatchObject({ taken: 1, sent: 1, failed: 0 });
    expect(sentMails).toHaveLength(1);
    const [m] = sentMails;
    expect(m.from).toBe('"BOGA CAFÉ" <team@example.test>');
    expect(m.to).toBe('owner@example.test');
    expect(m.subject).not.toMatch(/\n/);
    expect(m.subject).toContain('hxxps://evil[.]example');
    expect(m.text).toContain('bob@evil.example'); // an address the team can answer stays
    expect(m.text).toContain('www[.]evil[.]example/pay');
    expect(m.text).toContain('ne prouve jamais un paiement');
    expect(calls.at(-1)?.args).toMatchObject({ p_id: 1, p_ok: true });
  });

  it('a refusal by Gmail is reported as a class; its text (which can hold the password) is never kept or logged', async () => {
    const refusing = vi.fn(async () => Promise.reject(new Error(`535 5.7.8 Username and Password not accepted ${PASSWORD}`)));
    const { db, calls } = fakeDb([mail()]);
    const summary = await runOutbox({ db, env: ENV, sendMail: refusing, fetch: answering('') });
    expect(summary).toMatchObject({ taken: 1, sent: 0, failed: 1 });
    expect(calls.at(-1)).toEqual({ fn: 'finish_outbox', args: { p_id: 1, p_ok: false, p_error: 'gmail_refused' } });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain('Username');
    expect(JSON.stringify(calls)).not.toContain(PASSWORD);
  });

  it('a recipient that is not an address is refused without calling Gmail', async () => {
    // a list of addresses would reach Gmail as several recipients
    for (const recipient of ['', 'nobody', 'a b@c.d', 'x@y', 'a@b.co,c@d.co', 'a@b.co;c@d.co']) {
      expect(await sendRow(mail({ recipient }), { env: ENV, sendMail, fetch: answering('') })).toEqual({ ok: false, error: 'bad_recipient' });
    }
    expect(sentMails).toEqual([]);
  });
});

describe('a run', () => {
  it('sends each taken message on its own channel and reports each, whatever the others did', async () => {
    const rows = [row({ id: 1 }), row({ id: 2, channel: 'email', recipient: 'owner@example.test' }), row({ id: 3, channel: 'sms' })];
    const { db, calls } = fakeDb(rows);
    const summary = await runOutbox({ db, env: ENV, sendMail, fetch: answering('Message queued') });
    expect(summary).toEqual({ channels: ['whatsapp', 'email'], taken: 3, sent: 2, failed: 1 });
    expect(calls.filter((c) => c.fn === 'finish_outbox').map((c) => c.args)).toEqual([
      { p_id: 1, p_ok: true, p_error: undefined },
      { p_id: 2, p_ok: true, p_error: undefined },
      { p_id: 3, p_ok: false, p_error: 'unknown_channel' },
    ]);
  });

  it('a failed take stops the run (nothing is sent) and says so', async () => {
    const { db } = fakeDb([row()], 'claim');
    const fetcher = answering('Message queued');
    await expect(runOutbox({ db, env: ENV, sendMail, fetch: fetcher })).rejects.toThrow('claim_failed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('a failed report does not stop the others: the message stays pending and is sent again at its next attempt', async () => {
    const { db } = fakeDb([row({ id: 1 }), row({ id: 2 })], 'finish');
    const summary = await runOutbox({ db, env: ENV, sendMail, fetch: answering('Message queued') });
    expect(summary).toMatchObject({ taken: 2, sent: 2 });
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('report failed');
  });

  it('the logs hold channels and classes only, never a message text or a number', async () => {
    const { db } = fakeDb([row({ body: 'secret customer text 0611223344' })]);
    await runOutbox({ db, env: ENV, sendMail, fetch: answering('APIKey is invalid') });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('callmebot_unconfirmed');
    expect(logged).not.toContain('secret customer text');
    expect(logged).not.toContain('0611223344');
    expect(logged).not.toContain('212600000000');
    expect(logged).not.toContain(KEY);
  });
});
