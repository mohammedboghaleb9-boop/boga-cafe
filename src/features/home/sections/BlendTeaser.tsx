import { Link } from 'react-router';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { Icon } from '@/shared/ui/Icon';
import { Photo } from '@/shared/ui/Photo';
import { BeanGlyph } from './BeanGlyph';

/** Uses the concept's own example: 1 kg = 50 % Colombia, 30 % Brazil, 20 % Robusta. */
const example = [
  { originId: 'colombia', percent: 50 },
  { originId: 'brazil', percent: 30 },
  { originId: 'vietnam', percent: 20 },
];

/** An eight-pointed star between two lines, above the title (the reference's ornament). */
function Ornament() {
  return (
    <span className="blend-ornament" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
        <rect x="5.5" y="5.5" width="13" height="13" />
        <rect x="5.5" y="5.5" width="13" height="13" transform="rotate(45 12 12)" />
      </svg>
    </span>
  );
}

/**
 * The Custom Blend band: the owner's backdrop (the round badge on the right of a dark field) behind the text and one
 * example card, which stay on the left in every language. Phones and tablets: the badge as a band above the text.
 * An example to explain, not a tool: no price, no control.
 */
export function BlendTeaser() {
  const { t, l } = useI18n();
  const { originIndex } = useCatalog();
  const lines = example.filter((e) => originIndex[e.originId]);
  return (
    <section className="blend-band" aria-labelledby="blend-title">
      <figure className="blend-art">
        <Photo name="blendBackdrop" alt="" sizes="(min-width: 1280px) 70vw, 100vw" />
      </figure>
      <div className="container blend-inner">
        <div className="blend-copy reveal">
          <div className="blend-head">
            <Ornament />
            <span className="eyebrow">{t.nav.customBlend}</span>
            <h2 id="blend-title">{t.home.blendHeading}</h2>
            <p className="blend-lead">{t.home.blendText}</p>
          </div>
          {lines.length > 0 && (
            <div className="blend-card">
              <p className="blend-card-title">
                <BeanGlyph size={18} />
                {t.home.blendExample}
              </p>
              <div className="blend-bar" aria-hidden="true">
                {lines.map((e, i) => (
                  <span key={e.originId} className={`blend-seg-${i + 1}`} style={{ flexGrow: e.percent }}>
                    {e.percent}%
                  </span>
                ))}
              </div>
              <ul className="blend-lines">
                {lines.map((e) => {
                  const o = originIndex[e.originId];
                  return (
                    <li key={e.originId}>
                      <Flag code={o.countryCode} title="" size={30} />
                      <span className="blend-line-name">{l(o.name)}</span>
                      <span className="blend-line-species">
                        <BeanGlyph size={16} />
                        {t.common[o.species]}
                      </span>
                      <span className="blend-line-weight num">
                        <span className="sr-only">{e.percent}% · </span>
                        {e.percent * 10} g
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <Link to="/custom-blend" className="btn blend-cta">
            <BeanGlyph size={20} />
            {t.home.ctaBlend}
            <Icon name="arrow" size={18} className="flip-rtl" />
          </Link>
        </div>
      </div>
    </section>
  );
}
