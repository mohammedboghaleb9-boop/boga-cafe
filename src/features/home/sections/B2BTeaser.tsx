import { Link } from 'react-router';
import { useCatalog, useSettings } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { Photo } from '@/shared/ui/Photo';

export function B2BTeaser() {
  const { t, l } = useI18n();
  const { products } = useCatalog();
  const kg = useSettings().b2bThresholdKg;
  const b2b = products.filter((p) => p.active && p.kind === 'b2b');
  return (
    <section className="b2b-band">
      <Photo name="barista" alt={t.media.barista} className="b2b-band-img parallax" sizes="100vw" />
      <div className="b2b-band-shade" />
      <div className="container b2b-band-content">
        <div className="stack b2b-band-text reveal">
          <span className="eyebrow">B2B / HORECA</span>
          <h2>{t.home.b2bTitle}</h2>
          <p>{fmt(t.home.b2bText, { kg })}</p>
          <Link to="/b2b" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            {t.home.b2bCta}
          </Link>
        </div>
        <ul className="b2b-band-list reveal">
          {b2b.map((p) => (
            <li key={p.id}>
              <Link to={`/product/${p.slug}`}>
                <span className="stack" style={{ ['--gap' as string]: '2px' }}>
                  <strong>{l(p.name)}</strong>
                  <span className="small">{l(p.tagline)}</span>
                </span>
                <Icon name="arrow" size={18} className="flip-rtl" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
