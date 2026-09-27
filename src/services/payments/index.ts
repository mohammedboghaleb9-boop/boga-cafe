/**
 * Payment service. Each method is an adapter so a new one (another gateway,
 * a wallet...) can be added without touching the checkout page.
 * There is no Cash on Delivery: every order is paid before preparation.
 *
 * - card          → CMI hosted payment page (3-D Secure). The server signs the
 *                   form, the browser posts it to CMI, CMI calls our callback URL.
 * - cashplus      → offline: customer pays in a Cash Plus agency, sends the receipt,
 *                   the admin marks the order as paid.
 * - bank_transfer → offline: same flow with the bank RIB.
 */
import type { Order, PaymentMethodId } from '@/core/types';

export type PaymentNextStep =
  /** Production: auto-submitted form to the CMI gateway (fields signed by the server). */
  | { type: 'form-post'; action: string; fields: Record<string, string> }
  /** Prototype: simulated card page inside the site. */
  | { type: 'demo-gateway'; orderId: string }
  /** Offline methods: show instructions + reference. */
  | { type: 'instructions'; method: Exclude<PaymentMethodId, 'card'>; reference: string };

export interface PaymentAdapter {
  id: PaymentMethodId;
  /** true = paid immediately online, false = verified manually by the admin. */
  online: boolean;
  start(order: Order): PaymentNextStep;
}

const demoCard: PaymentAdapter = {
  id: 'card',
  online: true,
  start: (order) => ({ type: 'demo-gateway', orderId: order.id }),
};

const cashplus: PaymentAdapter = {
  id: 'cashplus',
  online: false,
  start: (order) => ({ type: 'instructions', method: 'cashplus', reference: order.number }),
};

const bankTransfer: PaymentAdapter = {
  id: 'bank_transfer',
  online: false,
  start: (order) => ({ type: 'instructions', method: 'bank_transfer', reference: order.number }),
};

const adapters: Record<PaymentMethodId, PaymentAdapter> = {
  card: demoCard,
  cashplus,
  bank_transfer: bankTransfer,
};

export const paymentAdapter = (id: PaymentMethodId) => adapters[id];
