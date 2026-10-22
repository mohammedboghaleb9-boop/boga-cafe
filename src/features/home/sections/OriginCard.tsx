import type { Origin } from '@/core/types';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { RoastChip, roastLevels } from '@/shared/ui/Roast';
import { BeanGlyph } from './BeanGlyph';

/** One origin as it is in the catalog: flag, name, species, region, tasting notes and roast level. */
export function OriginCard({ origin }: { origin: Origin }) {
  const { t, l } = useI18n();
  const filled = roastLevels.indexOf(origin.roastLevel) + 1;
  return (
    <li className="origin-card reveal">
      <div className="origin-card-text">
        <h3 className="origin-name">
          <Flag code={origin.countryCode} title="" size={28} />
          <span>{l(origin.name)}</span>
        </h3>
        <p className="origin-meta">
          {t.common[origin.species]} - <bdi>{origin.region}</bdi>
        </p>
        <p className="origin-notes">{l(origin.tastingNotes)}</p>
        <p className="origin-roast-name">
          <span className="sr-only">{t.common.roast} : </span>
          {t.roast[origin.roastLevel]}
        </p>
      </div>
      <div className="origin-card-media" aria-hidden="true">
        <RoastChip level={origin.roastLevel} size={76} />
        <span className="origin-beans">
          {roastLevels.map((r, i) => (
            <BeanGlyph key={r} size={15} className={i < filled ? 'is-on' : undefined} />
          ))}
        </span>
      </div>
    </li>
  );
}
