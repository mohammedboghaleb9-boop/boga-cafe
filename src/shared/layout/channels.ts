import type { Settings } from '@/core/types';
import { whatsappLink } from '@/services/notifications';
import { cleanProfileUrl, formatPhone, gmailComposeLink, socialHandle } from '../contact';
import type { Brand } from '../ui/BrandIcon';

export interface Channel {
  brand: Brand;
  href: string;
  /** what the visitor reads: @handle, number or address */
  handle: string;
  /** what the copy button copies */
  copy: string;
}

/**
 * The contact channels in display order (messaging first, then social media),
 * from Admin → Settings → Contact.
 * A channel without a value (e.g. no Facebook page yet) is left out.
 */
export function contactChannels(contact: Settings['contact'], text: { whatsapp: string; emailSubject: string }): Channel[] {
  const list: (Channel | null)[] = [
    contact.whatsapp
      ? {
          brand: 'whatsapp',
          href: whatsappLink(contact.whatsapp, text.whatsapp),
          handle: formatPhone(contact.whatsapp),
          copy: formatPhone(contact.whatsapp),
        }
      : null,
    contact.email
      ? { brand: 'gmail', href: gmailComposeLink(contact.email, text.emailSubject), handle: contact.email, copy: contact.email }
      : null,
    social('instagram', contact.instagram),
    social('tiktok', contact.tiktok),
    social('facebook', contact.facebook),
  ];
  return list.filter((c): c is Channel => c !== null);
}

function social(brand: Brand, url: string): Channel | null {
  const href = cleanProfileUrl(url);
  const handle = socialHandle(url, 'BOGA CAFÉ');
  return href && handle ? { brand, href, handle, copy: href } : null;
}
