import { Link } from 'react-router';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { BeanSwatch } from '@/shared/ui/BeanSwatch';
import { Flag } from '@/shared/ui/Flag';
import { Photo } from '@/shared/ui/Photo';

export function OriginsBand() {
  const { t, l } = useI18n();
  const { origins } = useCatalog();
  return (
    <section className="section container origins-band">
      <figure className="origins-photo">
        <Photo name="greenBeans" alt={t.media.greenBeans} className="parallax" sizes="(min-width: 900px) 45vw, 100vw" />
      </figure>
      <div className="stack origins-text">
        <div className="section-head reveal">
          <div className="stack">
            <h2>{t.home.originsTitle}</h2>
            <p className="muted">{t.home.originsText}</p>
          </div>
          <Link to="/single-origin" className="btn btn-ghost btn-sm">
            {t.nav.singleOrigin}
          </Link>
        </div>
        <ul className="origin-rows">
          {origins
            .filter((o) => o.active)
            .map((o) => (
              <li key={o.id} className="reveal">
                <Flag code={o.countryCode} title={l(o.name)} size={28} />
                <div>
                  <strong>{l(o.name)}</strong>
                  <span className="muted small">
                    {' '}
                    · {o.region} · {t.common[o.species]}
                  </span>
                  <p className="small origin-notes">{l(o.tastingNotes)}</p>
                </div>
                <span className="small muted origin-roast">
                  <BeanSwatch roast={o.roastLevel} species={o.species} size={60} />
                  {t.roast[o.roastLevel]}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}
