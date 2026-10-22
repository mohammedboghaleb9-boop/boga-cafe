import { Link } from 'react-router';
import { onDisplay } from '@/core/showcase';
import heroVideo from '@/assets/video/hero-1080.mp4';
import heroVideoPortrait from '@/assets/video/hero-mobile.mp4';
import { useCatalog, useDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { media } from '@/shared/media';
import { AmbientVideo } from '@/shared/ui/AmbientVideo';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { goldParts } from '../goldTitle';

const sources = {
  video: heroVideo,
  videoPortrait: heroVideoPortrait,
  poster: media.heroPoster.src,
  posterPortrait: media.heroPosterPortrait.src,
  width: media.heroPoster.width,
  height: media.heroPoster.height,
};

/** The roaster's beans turning behind the title (owner's video), the two ways in, three facts. */
export function Hero() {
  const { t, l, locale } = useI18n();
  const { content } = useDb();
  const { origins } = useCatalog();
  const shown = origins.filter(onDisplay);
  const names = shown.slice(0, 3).map((o) => l(o.name));
  const feats: { icon: IconName; title: string; text: string }[] = [
    { icon: 'bean', title: t.home.featSpecies, text: t.home.featSpeciesText },
    ...(shown.length > 0
      ? [{ icon: 'globe' as const, title: fmt(t.home.featOrigins, { n: shown.length }), text: names.join(locale === 'ar' ? '، ' : ', ') + (shown.length > 3 ? '…' : '') }]
      : []),
    { icon: 'pin', title: t.home.featPlace, text: t.home.featPlaceText },
  ];

  return (
    <section className="hero" aria-labelledby="hero-title">
      <AmbientVideo sources={sources} />
      <div className="container wide hero-inner">
        <div className="hero-text">
          <span className="eyebrow">{t.home.eyebrow}</span>
          <h1 id="hero-title">
            {goldParts(l(content.heroTitle)).map((part, i) => (part.gold ? <em key={i}>{part.text}</em> : part.text))}
          </h1>
          <div className="hero-actions">
            <Link to="/shop" className="btn btn-gold btn-lg">
              {t.home.ctaShop} <Icon name="arrow" size={18} className="flip-rtl" />
            </Link>
            <Link to="/custom-blend" className="btn btn-veil btn-lg">
              {t.home.ctaBlend} <Icon name="beans" size={18} />
            </Link>
          </div>
          <ul className="hero-feats">
            {feats.map((f) => (
              <li key={f.icon}>
                <span className="ring">
                  <Icon name={f.icon} size={22} />
                </span>
                <span>
                  <b>{f.title}</b>
                  <small>{f.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
