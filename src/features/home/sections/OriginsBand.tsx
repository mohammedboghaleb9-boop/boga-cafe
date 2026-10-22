import { Link } from 'react-router';
import { onDisplay } from '@/core/showcase';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { Photo } from '@/shared/ui/Photo';
import { BeanGlyph, OriginCard } from './OriginCard';

/** The origins on show, as cards beside the harvest photo (always on the right on large screens). */
export function OriginsBand() {
  const { t } = useI18n();
  const shown = useCatalog().origins.filter(onDisplay);
  return (
    <section className="origins-band" aria-labelledby="origins-title">
      <div className="container wide origins-grid">
        <div className="origins-head">
          <div className="origins-head-text">
            <div className="origins-title">
              <span className="origins-ornament" aria-hidden="true">
                <BeanGlyph size={24} />
              </span>
              <h2 id="origins-title">{t.home.originsTitle}</h2>
            </div>
            <p className="origins-lead">{t.home.originsText}</p>
          </div>
          <Link to="/single-origin" className="btn btn-ghost btn-sm origins-all">
            {t.home.originsAll}
            <Icon name="arrow" size={16} className="flip-rtl" />
          </Link>
        </div>
        <figure className="origins-photo">
          <Photo name="harvest" alt={t.media.harvest} sizes="(min-width: 1200px) 40vw, 100vw" />
        </figure>
        {shown.length === 0 ? (
          <p className="muted origin-cards">{t.common.noOrigins}</p>
        ) : (
          <ul className="origin-cards">
            {shown.map((o) => (
              <OriginCard key={o.id} origin={o} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
