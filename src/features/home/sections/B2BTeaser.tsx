import { Link } from 'react-router';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';

export function B2BTeaser() {
  const { t, l } = useI18n();
  const { products } = useCatalog();
  const b2b = products.filter((p) => p.active && p.kind === 'b2b');
  return (
    <section className="section container">
      <div className="b2b-teaser">
        <div className="stack">
          <span className="eyebrow">B2B / HORECA</span>
          <h2>{t.home.b2bTitle}</h2>
          <p className="muted">{t.home.b2bText}</p>
          <Link to="/b2b" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            {t.home.b2bCta}
          </Link>
        </div>
        <ul className="b2b-teaser-list">
          {b2b.map((p) => (
            <li key={p.id}>
              <Link to={`/product/${p.slug}`}>
                <strong>{l(p.name)}</strong>
                <span className="small muted">{l(p.tagline)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
