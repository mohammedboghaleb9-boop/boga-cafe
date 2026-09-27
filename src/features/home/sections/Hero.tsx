import { Link } from 'react-router';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { Photo } from '@/shared/ui/Photo';

/** The three real pouch sizes open the site: the whole offer in one image. */
export function Hero() {
  const { t, l } = useI18n();
  const { content } = useDb();
  const facts: { icon: IconName; text: string }[] = [
    { icon: 'bean', text: t.home.factBeans },
    { icon: 'scale', text: t.home.factSizes },
    { icon: 'truck', text: t.home.factDelivery },
    { icon: 'lock', text: t.home.factPayment },
  ];
  return (
    <section className="hero">
      <div className="hero-grid">
        <div className="hero-text">
          <span className="eyebrow">{t.home.eyebrow}</span>
          <h1>{l(content.heroTitle)}</h1>
          <p className="lead">{l(content.heroSubtitle)}</p>
          <div className="row">
            <Link to="/shop" className="btn btn-primary">
              {t.home.ctaShop}
            </Link>
            <Link to="/custom-blend" className="btn btn-ghost">
              {t.home.ctaBlend} <Icon name="arrow" size={16} className="flip-rtl" />
            </Link>
          </div>
        </div>
        <figure className="hero-media">
          <Photo name="bagsTrio" alt={t.media.hero} className="hero-img" priority sizes="(min-width: 900px) 55vw, 100vw" />
        </figure>
      </div>
      <div className="container">
        <ul className="facts-strip">
          {facts.map((f) => (
            <li key={f.icon}>
              <Icon name={f.icon} size={20} />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
