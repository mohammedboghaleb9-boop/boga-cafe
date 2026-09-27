/**
 * Messages sent to the administration (WhatsApp + email).
 * Pure functions: the server uses the same templates in production.
 * Admin messages are written in French; change the wording here only.
 */
import { formatKg, formatNumber, formatSize } from '@/core/format';
import type { Order, OrderLine, Origin, QuoteRequest, SampleRequest, ShippingRate, Product } from '@/core/types';

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

export function orderMessage(order: Order, ctx: TemplateContext): MessageDraft {
  const c = order.customer;
  const lines = order.lines.map((l) => `- ${describeLine(l, ctx)}`);
  const head = [
    `Nouvelle commande ${order.number}`,
    `Client : ${c.fullName} (${c.phone})`,
    `Ville : ${cityName(ctx, c.cityId)}`,
  ];
  const foot = [
    `Poids : ${formatKg(order.weightKg)}`,
    `Livraison : ${dh(order.shippingFee)}`,
    `Total : ${dh(order.total)}`,
    `Paiement : ${ctx.paymentLabel(order.paymentMethod)} (en attente)`,
  ];
  return {
    subject: `[BOGA CAFÉ] Commande ${order.number} - ${dh(order.total)}`,
    whatsapp: [...head, ...lines, ...foot].join('\n'),
    email: [
      ...head,
      `Adresse : ${c.address}`,
      c.email ? `Email : ${c.email}` : '',
      c.notes ? `Note : ${c.notes}` : '',
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
  };
}

export function sampleMessage(s: SampleRequest, ctx: TemplateContext): MessageDraft {
  const product = ctx.products.find((p) => p.id === s.productId)?.name.fr ?? s.productId;
  const body = [
    `Demande d'échantillon ${s.number}`,
    `${s.company || '-'} (${s.businessType})`,
    `Contact : ${s.contactName} (${s.phone})`,
    `Ville : ${cityName(ctx, s.cityId)}`,
    `Blend : ${product} - 500 g`,
    `Consommation estimée : ${s.estMonthlyKg} kg / mois`,
    s.notes ? `Note : ${s.notes}` : '',
  ].filter(Boolean);
  return {
    subject: `[BOGA CAFÉ] Échantillon B2B ${s.number} - ${s.company || s.contactName}`,
    whatsapp: body.join('\n'),
    email: body.join('\n'),
  };
}

export function quoteMessage(q: QuoteRequest, ctx: TemplateContext): MessageDraft {
  const body = [
    `Commande B2B (+10 kg) ${q.number}`,
    `${q.company || '-'} - ${q.contactName} (${q.phone})`,
    `Ville : ${cityName(ctx, q.cityId)}`,
    ...q.lines.map((l) => `- ${describeLine(l, ctx)}`),
    `Poids total : ${formatKg(q.weightKg)}`,
    `Prix site (indicatif) : ${dh(q.indicativeTotal)}`,
    q.notes ? `Note : ${q.notes}` : '',
  ].filter(Boolean);
  return {
    subject: `[BOGA CAFÉ] Demande B2B ${q.number} - ${formatKg(q.weightKg)}`,
    whatsapp: body.join('\n'),
    email: body.join('\n'),
  };
}

export function lowStockMessage(origin: Origin): MessageDraft {
  const text = `Stock bas : ${origin.name.fr} - ${formatKg(origin.stockKg)} restant (seuil ${formatKg(origin.lowStockKg)})`;
  return { subject: `[BOGA CAFÉ] ${text}`, whatsapp: text, email: text };
}
