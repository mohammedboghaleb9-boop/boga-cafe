/**
 * Admin calls are async (src/data/types.ts): a second click while the first
 * call is still saving must not send the same change twice.
 */
import { describe, expect, it } from 'vitest';
import { exclusive } from '../useAction';

describe('one admin call at a time', () => {
  it('ignores a click made while the previous call is saving, then takes the next one', async () => {
    const busy: boolean[] = [];
    const run = exclusive((b) => busy.push(b));
    let calls = 0;
    let finish = () => {};
    const slow = () =>
      new Promise<void>((resolve) => {
        calls++;
        finish = resolve;
      });

    const first = run(slow);
    const second = run(slow); // double click while the first is saving
    expect(calls).toBe(1);
    await second; // ignored at once, without waiting for the first
    finish();
    await first;
    expect(busy).toEqual([true, false]);

    await run(async () => {
      calls++;
    });
    expect(calls).toBe(2);
  });

  it('frees the button again when the call fails', async () => {
    const busy: boolean[] = [];
    const run = exclusive((b) => busy.push(b));
    await expect(
      run(async () => {
        throw new Error('server down');
      }),
    ).rejects.toThrow('server down');
    expect(busy).toEqual([true, false]);
    let ran = false;
    await run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
