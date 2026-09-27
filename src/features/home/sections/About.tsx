import labelImage from '@/assets/brand/label.jpg';
import { useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';

export function About() {
  const { l } = useI18n();
  const { content } = useDb();
  return (
    <section className="section container about">
      <img src={labelImage} alt="BOGA CAFÉ — étiquette" className="about-label" />
      <div className="stack">
        <span className="eyebrow">BOGA CAFÉ</span>
        <h2>{l(content.aboutTitle)}</h2>
        <p className="lead">{l(content.aboutText)}</p>
      </div>
    </section>
  );
}
