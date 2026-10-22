import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';

/** Who we are in a few lines, from the Admin "About" fields: the target of the "About" link. */
export function BrandIntro() {
  const { l } = useI18n();
  const { content } = useDb();
  return (
    <section id="about" className="section container intro">
      <div className="stack reveal">
        <span className="eyebrow">BOGA CAFÉ</span>
        <h2>{l(content.aboutTitle)}</h2>
        <p className="lead">{l(content.aboutText)}</p>
      </div>
    </section>
  );
}
