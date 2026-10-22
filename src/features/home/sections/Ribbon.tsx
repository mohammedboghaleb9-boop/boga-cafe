import { useI18n } from '@/i18n';
import { Icon, type IconName } from '@/shared/ui/Icon';

/** Copies of the list side by side: the track slides by one copy (hero.css @keyframes ribbon: 100% / 5), so the loop never shows a gap. */
const COPIES = 5;

/** The 8-point star of the zellige, between the facts. */
function Star() {
  return (
    <svg className="ribbon-star" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
      <path d="M12 1.8l2.6 4.1 4.6-1.1-1.1 4.6 4.1 2.6-4.1 2.6 1.1 4.6-4.6-1.1L12 22.2l-2.6-4.1-4.6 1.1 1.1-4.6L1.8 12l4.1-2.6-1.1-4.6 4.6 1.1z" fill="currentColor" />
    </svg>
  );
}

/**
 * Confirmed facts only (owner 2026-10-21), sliding slowly right to left in every language; it stops
 * under the pointer and stands still for visitors who ask for less motion. Screen readers get the
 * facts once, as a plain list; the moving copies are decoration.
 */
export function Ribbon() {
  const { t, locale } = useI18n();
  const facts: { icon: IconName; text: string }[] = [
    { icon: 'bean', text: t.home.factBeans },
    { icon: 'beans', text: t.home.ribbonBlends },
    { icon: 'pouch', text: t.home.factSizes },
    { icon: 'truck', text: t.home.factDelivery },
  ];
  const list = (copy: number) => (
    <ul key={copy} className="ribbon-list">
      {facts.map((f) => (
        <li key={f.icon}>
          <Icon name={f.icon} size={19} />
          <span dir={locale === 'ar' ? 'rtl' : 'ltr'}>{f.text}</span>
          <Star />
        </li>
      ))}
    </ul>
  );
  return (
    <section className="ribbon" aria-label={t.home.ribbonLabel} dir="ltr">
      <ul className="sr-only" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        {facts.map((f) => (
          <li key={f.icon}>{f.text}</li>
        ))}
      </ul>
      <div className="ribbon-track" aria-hidden="true">
        {Array.from({ length: COPIES }, (_, i) => list(i))}
      </div>
    </section>
  );
}
