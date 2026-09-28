import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Photo } from '@/shared/ui/Photo';

/** Who we are + how an order becomes a bag: recipe, roaster, BOGA packaging, delivery. */
export function BrandStory() {
  const { t, l } = useI18n();
  const { content } = useDb();
  return (
    <section className="section container story">
      <div className="story-media">
        <figure className="story-photo">
          <Photo name="roaster" alt={t.media.roaster} className="parallax" sizes="(min-width: 900px) 50vw, 100vw" />
        </figure>
        <Photo name="label" alt={t.media.label} className="story-label" />
      </div>
      <div className="stack story-text">
        <div className="stack reveal">
          <span className="eyebrow">BOGA CAFÉ</span>
          <h2>{l(content.aboutTitle)}</h2>
          <p className="lead">{l(content.aboutText)}</p>
        </div>
        <h3 className="story-steps-title reveal">{t.home.processTitle}</h3>
        <ol className="process">
          {t.home.process.map((step, i) => (
            <li key={step.title} className="reveal">
              <span className="process-n num">{i + 1}</span>
              <span>
                <strong>{step.title}</strong>
                <span className="small muted"> · {step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
