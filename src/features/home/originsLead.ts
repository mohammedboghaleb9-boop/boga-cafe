import { fmt } from '@/i18n';
import type { Dict } from '@/i18n/dictionaries/en';

/**
 * The sentence under the origins title, with the real number of origins on show:
 * one origin, 3 to 10 (the Darija plural "{n} مصادر"), or any other count.
 * Nothing on show: no sentence (the section shows its own empty message).
 */
export function originsLead(t: Dict, n: number): string | null {
  if (n <= 0) return null;
  if (n === 1) return t.home.originsTextOne;
  return fmt(n >= 3 && n <= 10 ? t.home.originsText : t.home.originsTextPlain, { n });
}
