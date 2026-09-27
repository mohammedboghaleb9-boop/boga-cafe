import { Link } from 'react-router';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';

/** Uses the concept's own example: 1 kg = 50 % Colombia, 30 % Brazil, 20 % Robusta. */
const example = [
  { originId: 'colombia', percent: 50 },
  { originId: 'brazil', percent: 30 },
  { originId: 'vietnam', percent: 20 },
];

export function BlendTeaser() {
  const { t, l } = useI18n();
  const { originIndex } = useCatalog();
  const lines = example.filter((e) => originIndex[e.originId]);
  return (
    <section className="blend-teaser">
      <div className="container blend-teaser-grid">
        <div className="stack">
          <span className="eyebrow">{t.nav.customBlend}</span>
          <h2>{t.home.blendTitle}</h2>
          <p>{t.home.blendText}</p>
          <Link to="/custom-blend" className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>
            {t.home.ctaBlend}
          </Link>
        </div>
        <div className="blend-example">
          <span className="small">{t.home.blendExample}</span>
          <div className="blend-example-bar" aria-hidden="true">
            {lines.map((e) => (
              <span key={e.originId} style={{ flexGrow: e.percent }}>
                {e.percent}%
              </span>
            ))}
          </div>
          <ul>
            {lines.map((e) => {
              const o = originIndex[e.originId];
              return (
                <li key={e.originId}>
                  <Flag code={o.countryCode} title={l(o.name)} />
                  <span>
                    {l(o.name)} <span className="muted-inv">· {t.common[o.species]}</span>
                  </span>
                  <strong className="num">{e.percent * 10} g</strong>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
