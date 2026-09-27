import { Link } from 'react-router';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';

export function Origins() {
  const { t, l } = useI18n();
  const { origins } = useCatalog();
  return (
    <section className="section container">
      <div className="section-head">
        <div className="stack">
          <h2>{t.home.originsTitle}</h2>
          <p className="muted">{t.home.originsText}</p>
        </div>
        <Link to="/single-origin" className="btn btn-ghost btn-sm">
          {t.nav.singleOrigin}
        </Link>
      </div>
      <div className="origins-grid">
        {origins
          .filter((o) => o.active)
          .map((o) => (
            <article key={o.id} className="origin-card">
              <div className="row">
                <Flag code={o.countryCode} title={l(o.name)} size={30} />
                <div>
                  <h3>{l(o.name)}</h3>
                  <span className="muted small">
                    {o.region} · {t.common[o.species]}
                  </span>
                </div>
              </div>
              <p className="small">{l(o.tastingNotes)}</p>
              <span className="small muted">
                {t.common.roast}: {t.roast[o.roastLevel]}
              </span>
            </article>
          ))}
      </div>
    </section>
  );
}
