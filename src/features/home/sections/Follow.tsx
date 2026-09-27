import { useI18n } from '@/i18n';
import { ChannelCards } from '@/shared/layout/ChannelCards';
import { Photo } from '@/shared/ui/Photo';

export function Follow() {
  const { t } = useI18n();
  return (
    <section className="section container follow">
      <div className="follow-head reveal">
        <h2>{t.home.followTitle}</h2>
        <p className="muted">{t.home.followText}</p>
        <ChannelCards variant="compact" only={['instagram', 'tiktok', 'facebook']} />
      </div>
      <div className="follow-grid">
        <figure className="reveal">
          <Photo name="ritualTray" alt={t.media.tray} sizes="(min-width: 720px) 33vw, 100vw" />
        </figure>
        <figure className="reveal">
          <Photo name="bagOpen" alt={t.media.openBag} sizes="(min-width: 720px) 33vw, 100vw" />
        </figure>
        <figure className="reveal">
          <Photo name="roastery" alt={t.media.roastery} sizes="(min-width: 720px) 33vw, 100vw" />
        </figure>
      </div>
    </section>
  );
}
