import { useI18n } from '@/i18n';
import { Photo } from '@/shared/ui/Photo';

/** How an order becomes a bag: recipe, roaster, BOGA packaging, delivery. */
export function HowItsMade() {
  const { t } = useI18n();
  return (
    <section className="section container story" aria-labelledby="how-title">
      <div className="story-media">
        <figure className="story-photo">
          <Photo name="roaster" alt={t.media.roaster} className="parallax" sizes="(min-width: 900px) 50vw, 100vw" />
        </figure>
        <Photo name="label" alt={t.media.label} className="story-label" />
      </div>
      <div className="stack story-text">
        <h2 id="how-title" className="reveal">{t.home.processTitle}</h2>
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
