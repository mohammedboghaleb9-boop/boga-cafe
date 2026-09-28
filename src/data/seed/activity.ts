/**
 * Example activity so the Admin Panel opens with realistic data:
 * a few orders in different states, B2B sample requests and one +10 kg request.
 * Orders are built with the real `buildOrder` rules, so totals are consistent.
 * Seed stock figures are "after" these orders, so they are not deducted again.
 */
import { summarizeCart } from '@/core/cart';
import { buildOrder } from '@/core/order';
import type {
  CartItem,
  CustomerInfo,
  Order,
  OrderStatus,
  PaymentMethodId,
  PaymentStatus,
  QuoteRequest,
  SampleRequest,
  StockMovement,
} from '@/core/types';
import { checkoutContext } from '../context';
import { reference, uid } from '../ids';
import type { DbState } from '../state';

/**
 * The demo history is written on fixed dates and replayed relative to today:
 * its latest event is shown one hour ago, so the demo never looks stale and
 * time-based rules (unpaid orders cancelled after 48 h) behave as in real use.
 */
const LATEST = Date.parse('2026-09-27T08:40:00Z');
const ago = (iso: string) => new Date(Date.now() - 3_600_000 - (LATEST - Date.parse(iso))).toISOString();

const customer = (fullName: string, phone: string, cityId: string, address: string): CustomerInfo => ({
  fullName,
  phone,
  email: '',
  cityId,
  address,
  company: '',
  notes: '',
});

const p = (productId: string, size: 250 | 500 | 1000, qty: number): CartItem => ({
  id: uid(),
  type: 'product',
  productId,
  size,
  qty,
});

interface DemoOrder {
  at: string;
  customer: CustomerInfo;
  items: CartItem[];
  payment: PaymentMethodId;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  history: string[];
}

const demoOrders: DemoOrder[] = [
  {
    at: ago('2026-09-20T10:12:00Z'),
    customer: customer('Salma Bennani', '0661234501', 'casablanca', 'Rue Ibnou Mounir, Maârif, Casablanca'),
    items: [p('boga-signature', 1000, 1), p('douceur-arabica', 250, 2)],
    payment: 'card',
    paymentStatus: 'paid',
    status: 'delivered',
    history: ['payment.paid', 'status.in_production', 'status.shipped', 'status.delivered'],
  },
  {
    at: ago('2026-09-23T15:40:00Z'),
    customer: customer('Youssef El Idrissi', '0677889902', 'oujda', 'Hay Al Qods, rue 12, Oujda'),
    items: [
      {
        id: uid(),
        type: 'custom',
        qty: 2,
        blend: {
          size: 500,
          lines: [
            { originId: 'brazil', percent: 60 },
            { originId: 'colombia', percent: 25 },
            { originId: 'vietnam', percent: 15 },
          ],
        },
      },
    ],
    payment: 'bank_transfer',
    paymentStatus: 'paid',
    status: 'in_production',
    history: ['payment.paid', 'status.in_production'],
  },
  {
    at: ago('2026-09-24T09:05:00Z'),
    customer: customer('Mehdi Tazi', '0612457803', 'rabat', 'Avenue Fal Ould Oumeir, Agdal, Rabat'),
    items: [p('so-colombia', 250, 1), p('boga-signature', 500, 1)],
    payment: 'card',
    paymentStatus: 'paid',
    status: 'shipped',
    history: ['payment.paid', 'status.in_production', 'status.shipped'],
  },
  {
    at: ago('2026-09-25T18:22:00Z'),
    customer: customer('Hajar Amrani', '0708112204', 'fes', 'Route d’Imouzzer, résidence Nour, Fès'),
    items: [p('oriental-intense', 1000, 2)],
    payment: 'cashplus',
    paymentStatus: 'awaiting_verification',
    status: 'new',
    history: ['payment.reported'],
  },
  {
    at: ago('2026-09-26T11:48:00Z'),
    customer: customer('Karim Ouazzani', '0655001205', 'nador', 'Boulevard Al Massira, Nador'),
    items: [p('horeca-espresso-bar', 1000, 5)],
    payment: 'bank_transfer',
    paymentStatus: 'pending',
    status: 'new',
    history: [],
  },
  {
    at: ago('2026-09-27T08:40:00Z'),
    customer: customer('Imane Chraibi', '0661908806', 'marrakech', 'Quartier Guéliz, rue de la Liberté, Marrakech'),
    items: [
      {
        id: uid(),
        type: 'custom',
        qty: 1,
        blend: {
          size: 1000,
          lines: [
            { originId: 'honduras', percent: 50 },
            { originId: 'brazil', percent: 30 },
            { originId: 'uganda', percent: 20 },
          ],
        },
      },
    ],
    payment: 'card',
    paymentStatus: 'paid',
    status: 'confirmed',
    history: ['payment.paid'],
  },
];

export function buildDemoActivity(base: DbState): DbState {
  const ctx = checkoutContext(base);
  const orders: Order[] = [];
  const movements: StockMovement[] = [];

  demoOrders.forEach((d, i) => {
    const number = reference('BC', i + 1, 2026);
    const r = buildOrder(
      { items: d.items, customer: d.customer, paymentMethod: d.payment, locale: 'fr' },
      ctx,
      { id: uid(), number, now: d.at },
    );
    if (!r.ok) throw new Error(`Demo order ${number} is invalid: ${r.errors.join(', ')}`);
    const at = new Date(d.at).getTime();
    orders.unshift({
      ...r.order,
      paymentStatus: d.paymentStatus,
      status: d.status,
      paymentRef: d.paymentStatus === 'awaiting_verification' ? 'CP-88412093' : undefined,
      history: [
        ...r.order.history,
        ...d.history.map((label, k) => ({
          // a few hours after the order, never in the future
          at: new Date(Math.min(at + (k + 1) * 5 * 3600_000, Date.now() - (d.history.length - k) * 600_000)).toISOString(),
          label,
        })),
      ],
    });
    for (const s of r.order.stockDeductions) {
      movements.unshift({ id: uid(), at: d.at, originId: s.originId, deltaKg: -s.kg, reason: 'order', ref: number, note: '' });
    }
  });

  movements.unshift(
    { id: uid(), at: ago('2026-09-26T08:00:00Z'), originId: 'vietnam', deltaKg: 20, reason: 'restock', ref: '', note: 'Livraison torréfacteur' },
    { id: uid(), at: ago('2026-09-26T08:05:00Z'), originId: 'colombia', deltaKg: -0.4, reason: 'correction', ref: '', note: 'Inventaire physique' },
  );

  const samples: SampleRequest[] = [
    {
      id: uid(),
      number: reference('SR', 1, 2026),
      createdAt: ago('2026-09-22T13:30:00Z'),
      businessType: 'hotel',
      company: 'Hôtel Les Orangers',
      contactName: 'Nadia Berrada',
      phone: '+212661440011',
      email: '',
      cityId: 'berkane',
      productId: 'horeca-premium-arabica',
      estMonthlyKg: 25,
      notes: 'Petit-déjeuner buffet + bar du lobby.',
      status: 'approved',
      free: true,
      deliveryFee: 25,
      adminNotes: 'Échantillon offert, livraison payée par le client.',
    },
    {
      id: uid(),
      number: reference('SR', 2, 2026),
      createdAt: ago('2026-09-25T10:10:00Z'),
      businessType: 'restaurant',
      company: 'Restaurant Al Bahr',
      contactName: 'Omar Haddou',
      phone: '+212670223344',
      email: '',
      cityId: 'nador',
      productId: 'horeca-crema-forte',
      estMonthlyKg: 15,
      notes: '',
      status: 'contacted',
      free: null,
      deliveryFee: 30,
      adminNotes: 'Rappeler lundi.',
    },
    {
      id: uid(),
      number: reference('SR', 3, 2026),
      createdAt: ago('2026-09-27T07:55:00Z'),
      businessType: 'cafe',
      company: 'Café Zellige',
      contactName: 'Rachid Benali',
      phone: '+212662778899',
      email: '',
      cityId: 'oujda',
      productId: 'horeca-espresso-bar',
      estMonthlyKg: 40,
      notes: 'Machine 2 groupes, environ 250 tasses / jour.',
      status: 'new',
      free: null,
      deliveryFee: 20,
      adminNotes: '',
    },
  ];

  const quoteCart = summarizeCart([p('boga-signature', 1000, 15), p('horeca-espresso-bar', 1000, 10)], ctx.catalog, base.settings);
  const quotes: QuoteRequest[] = [
    {
      id: uid(),
      number: reference('QR', 1, 2026),
      createdAt: ago('2026-09-26T16:20:00Z'),
      businessType: 'company',
      company: 'Bureau Nord SARL',
      contactName: 'Anas Mansouri',
      phone: '+212661556677',
      email: '',
      cityId: 'oujda',
      lines: quoteCart.lines.map((l) => l.line!),
      weightKg: quoteCart.weightKg,
      indicativeTotal: quoteCart.subtotal,
      notes: 'Commande mensuelle pour les bureaux (3 étages).',
      status: 'negotiating',
      finalPrice: null,
      adminNotes: 'Proposer -8 % et livraison offerte.',
    },
  ];

  return {
    ...base,
    orders,
    samples: samples.reverse(),
    quotes,
    stockMovements: movements,
    counters: { order: orders.length, sample: samples.length, quote: quotes.length },
  };
}
