/**
 * No fake bank page on the real site (review after the merge): the card is
 * offered only when the build has a gateway behind it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/core/types';

async function build(gateway: string | undefined) {
  vi.resetModules();
  if (gateway !== undefined) vi.stubEnv('VITE_CARD_GATEWAY', gateway);
  return import('../index');
}

afterEach(() => vi.unstubAllEnvs());

const order = { id: 'o1', number: 'BC-2026-7K4M2Q' } as Order;

describe('card payments', () => {
  it('are off unless the build says "demo" (the prototype)', async () => {
    for (const g of [undefined, '', 'cmi', 'DEMO', 'on']) {
      const p = await build(g);
      expect(p.cardGateway, String(g)).toBe('off');
      expect(p.paymentAdapter('card').start(order)).toEqual({ type: 'unavailable' });
    }
    const demo = await build('demo');
    expect(demo.cardGateway).toBe('demo');
    expect(demo.paymentAdapter('card').start(order)).toEqual({ type: 'demo-gateway', orderId: 'o1' });
  });

  it('never block Cash Plus or bank transfer, and respect the admin switch', async () => {
    const { methodAvailable } = await build(undefined);
    expect(methodAvailable({ id: 'card', enabled: true }, 'off')).toBe(false);
    expect(methodAvailable({ id: 'card', enabled: true }, 'demo')).toBe(true);
    expect(methodAvailable({ id: 'card', enabled: false }, 'demo')).toBe(false);
    for (const id of ['cashplus', 'bank_transfer'] as const) {
      expect(methodAvailable({ id, enabled: true }, 'off')).toBe(true);
      expect(methodAvailable({ id, enabled: false }, 'off')).toBe(false);
    }
  });
});
