import { useI18n } from '@/i18n';

/** Who we are in two lines: the target of the "About" link. */
export function BrandIntro() {
  const { t } = useI18n();
  return (
    <section id="about" className="section container intro">
      <div className="stack reveal">
        <span className="eyebrow">BOGA CAFÉ</span>
        <h2>{t.home.introTitle}</h2>
        <p className="lead">{t.home.introText}</p>
      </div>
    </section>
  );
}
