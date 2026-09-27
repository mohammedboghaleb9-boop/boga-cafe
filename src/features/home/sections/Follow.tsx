import { useI18n } from '@/i18n';
import { SocialLinks } from '@/shared/layout/SocialLinks';

export function Follow() {
  const { t } = useI18n();
  return (
    <section className="section container follow">
      <h2>{t.home.followTitle}</h2>
      <SocialLinks withLabels />
    </section>
  );
}
