import { Link } from 'react-router';
import { onDisplay } from '@/core/showcase';
import { useCatalog } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { Photo } from '@/shared/ui/Photo';
import { BeanGlyph } from './BeanGlyph';
import { OriginCard } from './OriginCard';
import { OriginsDecor } from './OriginsDecor';

/**
 * The origins on show beside the harvest photo (always on the right on large screens).
 * Phones: title, then one sheet (the photo on top of the six rows), then the full-width button.
 */
export function OriginsBand() {
  const { t } = useI18n();
  const shown = useCatalog().origins.filter(onDisplay);
  return (
    <section className="origins-band" aria-labelledby="origins-title">
      <OriginsDecor />
      <div className="container wide origins-grid">
        <div className="origins-head">
          <div className="origins-head-text">
            <div className="origins-title">
              <span className="origins-ornament" aria-hidden="true">
                <BeanGlyph size={24} />
              </span>
              <h2 id="origins-title">{t.home.originsTitle}</h2>
            </div>
            {shown.length > 0 && <p className="origins-lead">{fmt(t.home.originsText, { n: shown.length })}</p>}
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
          <p className="muted origins-empty">{t.common.noOrigins}</p>
        ) : (
          <ul className="origin-cards">
            {shown.map((o, i) => (
              <OriginCard key={o.id} origin={o} index={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
