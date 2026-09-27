import { useI18n } from '@/i18n';

/** The concept's general flow, from choice to delivery. The order matters, so steps are numbered. */
export function Process() {
  const { t } = useI18n();
  return (
    <section className="section container">
      <h2 className="process-title">{t.home.processTitle}</h2>
      <ol className="process">
        {t.home.process.map((step, i) => (
          <li key={step.title}>
            <span className="process-n num">{i + 1}</span>
            <strong>{step.title}</strong>
            <p className="small muted">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
