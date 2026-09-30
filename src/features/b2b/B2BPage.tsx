import { useCatalog, useDb } from '@/data/hooks';
import { ProductCard } from '@/shared/product/ProductCard';
import { fmt, useI18n } from '@/i18n';
import { whatsappLink } from '@/services/notifications';
import { Icon } from '@/shared/ui/Icon';
import { Photo } from '@/shared/ui/Photo';
import './b2b.css';
import { formatPhone } from '@/shared/contact';
import { usePageTitle } from '@/shared/layout/usePageTitle';

export function B2BPage() {
  const { t } = useI18n();
  usePageTitle(t.b2b.title);
  const { products } = useCatalog();
  const { settings } = useDb();
  // one business value, Admin → Settings (10 kg by default), in every text
  const kg = settings.b2bThresholdKg;
  const blends = products.filter((p) => p.active && p.kind === 'b2b');


  return (
    <>
      <section className="b2b-hero">
        <Photo name="barista" alt="" className="b2b-hero-img" priority sizes="100vw" />
        <div className="b2b-hero-shade" />
        <div className="container b2b-hero-inner">
          <span className="eyebrow">{t.b2b.eyebrow}</span>
          <h1>{t.b2b.title}</h1>
          <p className="lead">{fmt(t.b2b.intro, { kg })}</p>
        </div>
      </section>

      <div className="container page">
        <section className="b2b-rules">
          <h2>{t.b2b.rulesTitle}</h2>
          <ul>
            {t.b2b.rules.map((rule) => (
              <li key={rule}>
                <Icon name="check" size={18} />
                <span>{fmt(rule, { kg })}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="section">
          <h2 className="b2b-h2">{t.b2b.blendsTitle}</h2>
          <div className="pgrid">
            {blends.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>

        <div className="b2b-forms">
          <section className="panel stack b2b-large">
            <h2>{t.b2b.largeTitle}</h2>
            <p className="muted">{fmt(t.b2b.largeText, { kg })}</p>
            <a
              className="btn btn-primary"
              href={whatsappLink(settings.contact.whatsapp, `${t.contact.whatsappText} B2B / HORECA`)}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="whatsapp" size={18} /> {t.b2b.largeCta}
            </a>
            <p className="small muted handle" dir="ltr">
              {formatPhone(settings.contact.whatsapp)}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
