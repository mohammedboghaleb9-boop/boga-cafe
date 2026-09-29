/**
 * Messages sent to the administration (WhatsApp + email).
 * Pure functions: the server uses the same templates in production.
 * Admin messages are written in French; change the wording here only.
 */
import { formatKg, formatNumber, formatSize } from '@/core/format';
import type { BusinessType, Order, OrderLine, Origin, PaymentStatus, QuoteRequest, SampleRequest, ShippingRate, Product } from '@/core/types';

export interface TemplateContext {
  origins: Origin[];
  products: Product[];
  shippingRates: ShippingRate[];
  paymentLabel: (id: Order['paymentMethod']) => string;
}

export interface MessageDraft {
  subject: string;
  whatsapp: string;
  email: string;
}

const dh = (n: number) => `${formatNumber(n)} DH`;

const BUSINESS: Record<BusinessType, string> = {
  cafe: 'Café',
  hotel: 'Hôtel',
  restaurant: 'Restaurant',
  company: 'Entreprise',
  individual: 'Particulier',
  other: 'Autre',
};
const establishment = (company: string, type: BusinessType) =>
  company.trim() ? `${company.trim()} (${BUSINESS[type]})` : BUSINESS[type];

/**
 * Messages are plain text read in WhatsApp and Gmail: remove the invisible
 * direction marks the site uses around numbers in Arabic pages.
 */
const plain = (d: MessageDraft): MessageDraft => {
  const clean = (x: string) => x.replace(/[\u2066-\u2069\u200e\u200f]/g, '');
  // stay under what WhatsApp links and the notification function accept (api/_lib/notify.ts)
  const fit = (x: string, max: number, more: string) => (x.length <= max ? x : `${x.slice(0, max - more.length - 2)}…\n${more}`);
  return {
    subject: fit(clean(d.subject), 190, ''),
    whatsapp: fit(clean(d.whatsapp), 3_800, '(suite dans l’email)'),
    email: fit(clean(d.email), 11_500, '(message raccourci)'),
  };
};
const cityName = (ctx: TemplateContext, id: string) =>
  ctx.shippingRates.find((r) => r.id === id)?.city.fr ?? id;
const originName = (ctx: TemplateContext, id: string) =>
  ctx.origins.find((o) => o.id === id)?.name.fr ?? id;

export function describeLine(line: OrderLine, ctx: TemplateContext): string {
  const head = `${line.name.fr} ${formatSize(line.size)} x${line.qty}`;
  if (line.kind === 'product') return `${head} = ${dh(line.lineTotal)}`;
  const recipe = line.composition.map((c) => `${originName(ctx, c.originId)} ${c.percent}%`).join(' / ');
  return `${head} (${recipe}) = ${dh(line.lineTotal)}`;
}

/** Where the money stands, as the team reads it (never a proof: see api/_lib/notify.ts). */
const PAYMENT_STATE: Record<PaymentStatus, string> = {
  pending: 'en attente',
  failed: 'échoué, en attente',
  awaiting_verification: 'signalé par le client, à vérifier',
  paid: 'payé',
  refunded: 'remboursé',
};

/** Who orders and where it goes: in both messages, WhatsApp may be the only one the team reads. */
function customerLines(order: Order, ctx: TemplateContext): string[] {
  const c = order.customer;
  return [
    `Client : ${c.fullName} (${c.phone})`,
    `Ville : ${cityName(ctx, c.cityId)}`,
    `Adresse : ${c.address}`,
    c.email ? `Email : ${c.email}` : '',
    c.notes ? `Note : ${c.notes}` : '',
  ].filter(Boolean);
}

export function orderMessage(order: Order, ctx: TemplateContext): MessageDraft {
  const lines = order.lines.map((l) => `- ${describeLine(l, ctx)}`);
  const head = [`Nouvelle commande ${order.number}`, ...customerLines(order, ctx)];
  const foot = [
    `Poids : ${formatKg(order.weightKg)}`,
    `Livraison : ${dh(order.shippingFee)}`,
    `Total : ${dh(order.total)}`,
    `Paiement : ${ctx.paymentLabel(order.paymentMethod)} (${PAYMENT_STATE[order.paymentStatus]})`,
  ];
  return plain({
    subject: `[BOGA CAFÉ] Commande ${order.number} - ${dh(order.total)}`,
    whatsapp: [...head, ...lines, ...foot].join('\n'),
    email: [
      ...head,
      '',
      'Articles :',
      ...lines,
      '',
      `Sous-total : ${dh(order.subtotal)}`,
      ...foot,
      '',
      'Détail des grammes par origine (par sachet) :',
      ...order.lines.map(
        (l) =>
          `- ${l.name.fr} ${formatSize(l.size)} : ` +
          l.composition.map((x) => `${originName(ctx, x.originId)} ${formatNumber(x.grams, 1)} g`).join(', '),
      ),
    ]
      .filter((x) => x !== '')
      .join('\n'),
  });
}

/**
 * The customer says they paid by Cash Plus or transfer. The message carries the
 * whole order, so it is enough on its own even if the order message never left.
 */
export function paymentReportMessage(order: Order, ctx: TemplateContext): MessageDraft {
  const lines = order.lines.map((l) => `- ${describeLine(l, ctx)}`);
  const body = [
    `Paiement signalé ${order.number}`,
    `Moyen : ${ctx.paymentLabel(order.paymentMethod)}`,
    `Montant attendu : ${dh(order.total)}`,
    `Référence donnée par le client : ${order.paymentRef ?? '-'}`,
    'À vérifier sur le compte avant de préparer la commande.',
    '',
    ...customerLines(order, ctx),
    ...lines,
  ];
  return plain({
    subject: `[BOGA CAFÉ] Paiement signalé ${order.number} - ${dh(order.total)}`,
    whatsapp: body.join('\n'),
    email: body.join('\n'),
  });
}

/**
 * What the order page asks the customer to send to BOGA: the order itself,
 * or, once they reported a Cash Plus / transfer payment, that report (it
 * carries the whole order). Nothing once the order is closed.
 */
export function orderHandoff(
  order: Order,
  ctx: TemplateContext,
): { event: 'order.created' | 'payment.reported'; draft: MessageDraft } | null {
  if (order.status === 'cancelled' || order.status === 'delivered') return null;
  return order.paymentStatus === 'awaiting_verification'
    ? { event: 'payment.reported', draft: paymentReportMessage(order, ctx) }
    : { event: 'order.created', draft: orderMessage(order, ctx) };
}

export function sampleMessage(s: SampleRequest, ctx: TemplateContext): MessageDraft {
  const product = ctx.products.find((p) => p.id === s.productId)?.name.fr ?? s.productId;
  const body = [
    `Demande d'échantillon ${s.number}`,
    `Établissement : ${establishment(s.company, s.businessType)}`,
    `Contact : ${s.contactName} (${s.phone})`,
    s.email ? `Email : ${s.email}` : '',
    `Ville : ${cityName(ctx, s.cityId)}`,
    `Blend : ${product} - 500 g`,
    `Consommation estimée : ${s.estMonthlyKg} kg / mois`,
    s.notes ? `Note : ${s.notes}` : '',
  ].filter(Boolean);
  return plain({
    subject: `[BOGA CAFÉ] Échantillon B2B ${s.number} - ${s.company.trim() || s.contactName}`,
    whatsapp: body.join('\n'),
    email: body.join('\n'),
  });
}

export function quoteMessage(q: QuoteRequest, ctx: TemplateContext): MessageDraft {
  const body = [
    `Commande B2B (+10 kg) ${q.number}`,
    `Établissement : ${establishment(q.company, q.businessType)}`,
    `Contact : ${q.contactName} (${q.phone})`,
    q.email ? `Email : ${q.email}` : '',
    `Ville : ${cityName(ctx, q.cityId)}`,
    ...q.lines.map((l) => `- ${describeLine(l, ctx)}`),
    `Poids total : ${formatKg(q.weightKg)}`,
    `Prix site (indicatif) : ${dh(q.indicativeTotal)}`,
    q.notes ? `Note : ${q.notes}` : '',
  ].filter(Boolean);
  return plain({
    subject: `[BOGA CAFÉ] Demande B2B ${q.number} - ${formatKg(q.weightKg)}`,
    whatsapp: body.join('\n'),
    email: body.join('\n'),
  });
}

export function lowStockMessage(origin: Origin): MessageDraft {
  const text = `Stock bas : ${origin.name.fr} - ${formatKg(origin.stockKg)} restant (seuil ${formatKg(origin.lowStockKg)})`;
  return plain({ subject: `[BOGA CAFÉ] ${text}`, whatsapp: text, email: text });
}
